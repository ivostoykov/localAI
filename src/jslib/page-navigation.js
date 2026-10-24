/**
 * Page Navigation Module
 * Opens model-requested URLs in an inactive background tab owned by a single model tool loop.
 * Runs in the background service worker context.
 */

const NAVIGATION_LOAD_TIMEOUT_MS = 30000;
const NAVIGATION_READY_TIMEOUT_MS = 10000;
const NAVIGATION_QUIET_MS = 800;
const NAVIGATION_MIN_TEXT_LENGTH = 200;
const NAVIGATION_CONSENT_TIMEOUT_MS = 120000;
const NAVIGATION_SUPPORTED_PROTOCOLS = ['http:', 'https:'];

const navigationSessions = new Set();

function createNavigationAbortError(reason = 'The operation was aborted.') {
    return new DOMException(typeof reason === 'string' ? reason : 'The operation was aborted.', 'AbortError');
}

function validateNavigationUrl(rawUrl) {
    const value = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!value) {
        return { error: 'Navigation failed: no URL provided. Provide an absolute http or https URL.' };
    }

    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        return { error: `Navigation failed: "${value}" is not an absolute URL. Resolve it against the page it came from and provide an absolute http or https URL.` };
    }

    if (!NAVIGATION_SUPPORTED_PROTOCOLS.includes(parsed.protocol)) {
        return { error: `Navigation failed: the "${parsed.protocol}" scheme is not supported. Only http and https URLs can be opened.` };
    }

    return { url: parsed.href };
}

function createNavigationSession(originTabId = null, signal = null) {
    const session = { originTabId, signal, ownedTabId: null, disposed: false };
    navigationSessions.add(session);
    return session;
}

async function disposeNavigationSession(session) {
    if (!session || session.disposed) { return; }

    session.disposed = true;
    navigationSessions.delete(session);

    const tabId = session.ownedTabId;
    session.ownedTabId = null;
    if (tabId == null) { return; }

    try {
        await chrome.tabs.remove(tabId);
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Closed browsing tab`, tabId);
    } catch (err) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Browsing tab already closed`, tabId, err?.message);
    }
}

async function handleNavigationTabRemoved(tabId) {
    for (const session of [...navigationSessions]) {
        if (session.ownedTabId === tabId) {
            session.ownedTabId = null;
        }
        if (session.originTabId === tabId) {
            await disposeNavigationSession(session);
        }
    }
}

function raceNavigationStep(promise, signal, timeoutMs, timeoutMessage) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(createNavigationAbortError(signal.reason));
            return;
        }

        const timer = timeoutMs > 0
            ? setTimeout(() => settle(reject, Object.assign(new Error(timeoutMessage), { name: 'TimeoutError' })), timeoutMs)
            : null;
        const onAbort = () => settle(reject, createNavigationAbortError(signal.reason));
        signal?.addEventListener('abort', onAbort, { once: true });

        function settle(fn, value) {
            if (timer) { clearTimeout(timer); }
            signal?.removeEventListener('abort', onAbort);
            fn(value);
        }

        Promise.resolve(promise).then(value => settle(resolve, value), err => settle(reject, err));
    });
}

async function getNavigationPermission() {
    const stored = await chrome.storage.sync.get(storageOptionKey);
    return stored?.[storageOptionKey]?.allowNavigation === true;
}

async function persistNavigationPermission() {
    const stored = await chrome.storage.sync.get(storageOptionKey);
    const options = stored?.[storageOptionKey] || {};
    await chrome.storage.sync.set({ [storageOptionKey]: { ...options, allowNavigation: true } });
}

async function dismissNavigationConsent(originTabId, requestId) {
    try {
        await chrome.tabs.sendMessage(originTabId, { action: 'dismissNavigationConsent', requestId });
    } catch (err) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Consent dialogue dismissal skipped`, err?.message);
    }
}

async function requestNavigationConsent(session, url) {
    if (await getNavigationPermission()) {
        return { granted: true, choice: 'setting' };
    }

    if (session?.originTabId == null) {
        return { granted: false, reason: 'no originating chat is available to ask the user for permission' };
    }

    const requestId = crypto.randomUUID();
    let response;
    try {
        response = await raceNavigationStep(
            chrome.tabs.sendMessage(session.originTabId, { action: 'requestNavigationConsent', requestId, url }),
            session.signal,
            NAVIGATION_CONSENT_TIMEOUT_MS,
            'The user did not respond to the navigation request in time.'
        );
    } catch (err) {
        if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
            await dismissNavigationConsent(session.originTabId, requestId);
        }
        if (err?.name === 'AbortError') { throw err; }
        if (err?.name === 'TimeoutError') {
            return { granted: false, reason: 'the user did not answer the permission request' };
        }
        console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Navigation consent dialogue unavailable`, err?.message);
        return { granted: false, reason: 'the permission dialogue could not be shown' };
    }

    switch (response?.choice) {
        case 'allow':
            await persistNavigationPermission();
            return { granted: true, choice: 'allow' };
        case 'once':
            return { granted: true, choice: 'once' };
        case 'cancel':
            return { granted: false, reason: 'the user declined the navigation' };
        default:
            return { granted: false, reason: response?.error ? 'the permission dialogue could not be shown' : 'the user did not grant permission' };
    }
}

function watchOwnedTabLoad(signal, timeoutMs = NAVIGATION_LOAD_TIMEOUT_MS) {
    let targetTabId = null;
    let sawLoading = false;
    let settled = false;
    const buffered = [];
    let resolvePromise;
    let rejectPromise;

    const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });
    promise.catch(() => {});

    const timer = setTimeout(() => {
        settle(rejectPromise, Object.assign(new Error('The page did not finish loading in time.'), { name: 'TimeoutError' }));
    }, timeoutMs);
    const onAbort = () => settle(rejectPromise, createNavigationAbortError(signal?.reason));

    function settle(fn, value) {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onRemoved.removeListener(onRemoved);
        signal?.removeEventListener('abort', onAbort);
        fn(value);
    }

    function handleUpdate(tabId, changeInfo = {}, tab = {}) {
        if (tabId !== targetTabId) { return; }
        if (changeInfo.status === 'loading' || changeInfo.url) {
            sawLoading = true;
        }
        if (changeInfo.status === 'complete' && sawLoading && tab?.url !== 'about:blank') {
            settle(resolvePromise, tab);
        }
    }

    function handleRemoval(tabId) {
        if (tabId !== targetTabId) { return; }
        settle(rejectPromise, Object.assign(new Error('The browsing tab was closed before the page finished loading.'), { name: 'TabClosedError' }));
    }

    function onUpdated(tabId, changeInfo, tab) {
        if (targetTabId == null) {
            buffered.push(['update', tabId, changeInfo, tab]);
            return;
        }
        handleUpdate(tabId, changeInfo, tab);
    }

    function onRemoved(tabId) {
        if (targetTabId == null) {
            buffered.push(['remove', tabId]);
            return;
        }
        handleRemoval(tabId);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    if (signal?.aborted) {
        onAbort();
    } else {
        signal?.addEventListener('abort', onAbort, { once: true });
    }

    return {
        promise,
        setTabId(tabId) {
            targetTabId = tabId;
            for (const [type, id, changeInfo, tab] of buffered.splice(0)) {
                if (type === 'update') { handleUpdate(id, changeInfo, tab); }
                else { handleRemoval(id); }
            }
        },
        cancel() {
            settle(() => {}, undefined);
        }
    };
}

async function loadUrlInOwnedTab(session, url) {
    const watcher = watchOwnedTabLoad(session.signal);
    try {
        if (session.ownedTabId != null) {
            watcher.setTabId(session.ownedTabId);
            await chrome.tabs.update(session.ownedTabId, { url });
        } else {
            const origin = session.originTabId != null ? await chrome.tabs.get(session.originTabId).catch(() => null) : null;
            const createProperties = { active: false, url };
            if (origin?.windowId != null) { createProperties.windowId = origin.windowId; }
            const tab = await chrome.tabs.create(createProperties);
            if (session.disposed) {
                await chrome.tabs.remove(tab.id).catch(() => {});
                throw createNavigationAbortError('The model request ended before the page was opened.');
            }
            session.ownedTabId = tab.id;
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Created browsing tab`, tab.id);
            watcher.setTabId(tab.id);
        }
    } catch (err) {
        watcher.cancel();
        throw err;
    }

    try {
        await watcher.promise;
        return { timedOut: false };
    } catch (err) {
        if (err?.name === 'TimeoutError') { return { timedOut: true }; }
        throw err;
    }
}

async function waitForNavigationContent(tabId, signal) {
    const results = await raceNavigationStep(
        chrome.scripting.executeScript({
            target: { tabId },
            func: (quietMs, maxMs, minTextLength) => new Promise(resolve => {
                const started = Date.now();
                let lastChange = Date.now();
                const observer = new MutationObserver(() => { lastChange = Date.now(); });
                observer.observe(document.documentElement || document, { childList: true, subtree: true, characterData: true });
                const timer = setInterval(() => {
                    const textLength = (document.body?.innerText || '').trim().length;
                    const quiet = Date.now() - lastChange >= quietMs;
                    const ready = document.readyState === 'complete' && quiet && textLength >= minTextLength;
                    if (ready || Date.now() - started >= maxMs) {
                        clearInterval(timer);
                        observer.disconnect();
                        resolve({ ready, textLength });
                    }
                }, 200);
            }),
            args: [NAVIGATION_QUIET_MS, NAVIGATION_READY_TIMEOUT_MS, NAVIGATION_MIN_TEXT_LENGTH]
        }),
        signal,
        NAVIGATION_READY_TIMEOUT_MS + 5000,
        'The page content did not become available in time.'
    );

    return results?.[0]?.result || { ready: false, textLength: 0 };
}

// A quiet DOM can still be a loading skeleton, so content counts as ready only when
// two consecutive extractions agree and carry enough text; otherwise the last result is returned as incomplete.
async function extractNavigationContent(tabId, signal, timeoutMs = NAVIGATION_READY_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    let previous = null;
    let lastContent = '';
    let lastError = '';

    while (true) {
        let content = '';
        try {
            content = await raceNavigationStep(
                callContentScriptExtractor(tabId, 'getEnhancedPageContent', null),
                signal,
                timeoutMs,
                'Page content extraction timed out.'
            );
        } catch (err) {
            if (err?.name === 'AbortError') { throw err; }
            lastError = err?.message || 'Page content extraction failed.';
        }

        if (typeof content === 'string' && content && !content.startsWith('Error') && !content.startsWith('No result from')) {
            if (content === previous && content.length >= NAVIGATION_MIN_TEXT_LENGTH) {
                return { content, stable: true };
            }
            previous = content;
            lastContent = content;
        } else if (content) {
            lastError = content;
        }

        if (Date.now() >= deadline) { break; }
        await raceNavigationStep(new Promise(resolve => setTimeout(resolve, 1000)), signal, 0);
    }

    return lastContent
        ? { content: lastContent, stable: false }
        : { error: lastError || 'No content could be extracted.' };
}

async function browseUrl(session, rawUrl) {
    if (!session || session.disposed) {
        return 'Navigation failed: no active model request owns a browsing tab.';
    }

    const { url, error } = validateNavigationUrl(rawUrl);
    if (error) { return error; }

    const consent = await requestNavigationConsent(session, url);
    if (!consent.granted) {
        return `Navigation to ${url} was not performed: ${consent.reason}. Do not retry this URL unless the user asks for it.`;
    }
    if (session.disposed || session.signal?.aborted) {
        throw createNavigationAbortError(session.signal?.reason);
    }

    let loadState;
    try {
        loadState = await loadUrlInOwnedTab(session, url);
    } catch (err) {
        if (session.disposed || err?.name === 'AbortError') { throw createNavigationAbortError(session.signal?.reason); }
        if (err?.name === 'TabClosedError') { return `Navigation to ${url} failed: ${err.message}`; }
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to open ${url}`, err);
        return `Navigation to ${url} failed: ${err?.message || 'the browsing tab could not be opened.'}`;
    }

    const tabId = session.ownedTabId;
    if (tabId == null) {
        return `Navigation to ${url} failed: the browsing tab was closed.`;
    }

    let readiness;
    try {
        readiness = await waitForNavigationContent(tabId, session.signal);
    } catch (err) {
        if (session.disposed || err?.name === 'AbortError') { throw createNavigationAbortError(session.signal?.reason); }
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab) { return `Navigation to ${url} failed: the browsing tab was closed.`; }
        console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Page not readable: ${url}`, err?.message);
        return JSON.stringify({
            requestedUrl: url,
            finalUrl: tab.url || url,
            error: 'The page could not be loaded or read. It may be unreachable, blocked or a browser error page.'
        }, null, 2);
    }

    const extraction = await extractNavigationContent(tabId, session.signal);
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) { return `Navigation to ${url} failed: the browsing tab was closed.`; }

    const result = {
        requestedUrl: url,
        finalUrl: tab.url || url,
        title: tab.title || ''
    };

    if (extraction.error) {
        result.error = `Content extraction failed: ${extraction.error}`;
        return JSON.stringify(result, null, 2);
    }

    const warnings = [];
    if (loadState.timedOut) { warnings.push('The page did not finish loading in time; content may be incomplete.'); }
    if (!readiness.ready || !extraction.stable) { warnings.push('The page content was still changing or very short when it was read; content may be incomplete.'); }
    if (warnings.length > 0) { result.warning = warnings.join(' '); }

    result.content = extraction.content;
    return JSON.stringify(result, null, 2);
}
