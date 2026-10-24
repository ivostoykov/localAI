/**
 * Page Navigation Module
 * Opens model-requested URLs in an inactive background tab owned by a single model tool loop.
 * Runs in the background service worker context.
 */

const NAVIGATION_LOAD_TIMEOUT_MS = 30000;
const NAVIGATION_READY_TIMEOUT_MS = 15000;
const NAVIGATION_STATE_TIMEOUT_MS = 5000;
const NAVIGATION_BUSY_SELECTORS = [
    '[aria-busy="true"]',
    '[role="progressbar"]',
    '[class*="skeleton" i]',
    '[class*="shimmer" i]',
    '[class*="ghost" i]',
    '[class*="placeholder" i]',
    '[class*="loader" i]',
    '[class*="spinner" i]',
    '[class*="loading" i]'
];
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
    session.pendingConsent?.settle({ choice: 'disposed' });

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

const NAVIGATION_CONSENT_PAGE = 'navigation-consent.html';
const NAVIGATION_CONSENT_CHOICES = ['allow', 'once', 'cancel'];

// Consent is answered only from the extension's own pop-up window: the visited page shares the
// sidebar's DOM and could forge or disguise an in-chat answer.
const pendingNavigationConsents = new Map();

function isNavigationConsentSender(sender, pending) {
    if (!sender || !pending || sender.id !== chrome.runtime.id) { return false; }

    let senderUrl;
    let pageUrl;
    try {
        senderUrl = new URL(sender.url);
        pageUrl = new URL(chrome.runtime.getURL(NAVIGATION_CONSENT_PAGE));
    } catch {
        return false;
    }

    return senderUrl.protocol === pageUrl.protocol
        && senderUrl.host === pageUrl.host
        && senderUrl.pathname === pageUrl.pathname
        && senderUrl.searchParams.get('requestId') === pending.requestId
        && pending.tabId != null
        && sender.tab?.id === pending.tabId
        && sender.tab?.windowId === pending.windowId;
}

async function handleNavigationConsentMessage(request = {}, sender = {}) {
    const pending = pendingNavigationConsents.get(request?.requestId);
    await pending?.opened;
    if (!isNavigationConsentSender(sender, pending) || pending.settled) {
        console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Rejected navigation consent message`, {
            action: request?.action,
            senderUrl: sender?.url,
            senderTabId: sender?.tab?.id
        });
        return { status: 'rejected' };
    }

    switch (request.action) {
        case 'getNavigationConsentRequest':
            return { status: 'ok', url: pending.url };
        case 'navigationConsentKeepAlive':
            return { status: 'ok' };
        case 'navigationConsentResponse':
            if (!NAVIGATION_CONSENT_CHOICES.includes(request.choice)) { return { status: 'rejected' }; }
            pending.settle({ choice: request.choice });
            return { status: 'ok' };
        default:
            return { status: 'rejected' };
    }
}

function handleNavigationConsentWindowRemoved(windowId) {
    for (const pending of pendingNavigationConsents.values()) {
        if (pending.windowId === windowId) {
            pending.settle({ choice: 'closed' });
        }
    }
}

async function openNavigationConsentWindow(requestId) {
    const url = `${chrome.runtime.getURL(NAVIGATION_CONSENT_PAGE)}?requestId=${encodeURIComponent(requestId)}`;
    const win = await chrome.windows.create({ url, type: 'popup', width: 560, height: 360, focused: true });
    let tabId = win?.tabs?.[0]?.id ?? null;
    if (tabId == null && win?.id != null) {
        const [tab] = await chrome.tabs.query({ windowId: win.id });
        tabId = tab?.id ?? null;
    }
    return { windowId: win?.id ?? null, tabId };
}

async function notifyNavigationStatus(tabId, message) {
    if (tabId == null) { return; }
    try {
        await chrome.tabs.sendMessage(tabId, { action: 'updateStatusbar', message });
    } catch (err) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Navigation status skipped`, err?.message);
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
    const pending = { requestId, url, windowId: null, tabId: null, settled: false };
    let markOpened;
    pending.opened = new Promise(resolve => { markOpened = resolve; });
    const answer = new Promise(resolve => {
        pending.settle = (value) => {
            if (pending.settled) { return; }
            pending.settled = true;
            resolve(value);
        };
    });
    pendingNavigationConsents.set(requestId, pending);
    session.pendingConsent = pending;

    let response;
    try {
        await notifyNavigationStatus(session.originTabId, 'Waiting for permission to open a page - see the Local AI pop-up window.');
        try {
            Object.assign(pending, await openNavigationConsentWindow(requestId));
        } finally {
            markOpened();
        }
        if (pending.windowId == null || pending.tabId == null || !await chrome.windows.get(pending.windowId).catch(() => null)) {
            pending.settle({ choice: 'closed' });
        }
        response = await raceNavigationStep(
            answer,
            session.signal,
            NAVIGATION_CONSENT_TIMEOUT_MS,
            'The user did not respond to the navigation request in time.'
        );
    } catch (err) {
        if (err?.name === 'AbortError') { throw err; }
        if (err?.name === 'TimeoutError') {
            return { granted: false, reason: 'the user did not answer the permission request' };
        }
        console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Navigation consent window unavailable`, err?.message);
        return { granted: false, reason: 'the permission window could not be shown' };
    } finally {
        pending.settle({ choice: 'closed' });
        pendingNavigationConsents.delete(requestId);
        if (session.pendingConsent === pending) { delete session.pendingConsent; }
        if (pending.windowId != null) {
            await chrome.windows.remove(pending.windowId).catch(() => {});
        }
    }

    if (session.disposed || response?.choice === 'disposed') {
        throw createNavigationAbortError('The model request ended while waiting for permission.');
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
            return { granted: false, reason: 'the user closed the permission window without granting permission' };
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

// Runs in the browsing tab, so it must stay self-contained.
function inspectNavigationContentState(busySelectors = []) {
    const region = document.querySelector('main, [role="main"], article') || document.body;
    let busy = 0;
    if (region) {
        if (region.getAttribute?.('aria-busy') === 'true') { busy++; }
        for (const selector of busySelectors) {
            let elements = [];
            try { elements = region.querySelectorAll(selector); } catch { continue; }
            for (const el of elements) {
                const style = getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') { continue; }
                busy++;
            }
        }
    }

    return {
        readyState: document.readyState,
        busy,
        textLength: (region?.innerText || region?.textContent || '').trim().length
    };
}

async function getNavigationContentState(tabId, signal) {
    const results = await raceNavigationStep(
        chrome.scripting.executeScript({
            target: { tabId },
            func: inspectNavigationContentState,
            args: [NAVIGATION_BUSY_SELECTORS]
        }),
        signal,
        NAVIGATION_STATE_TIMEOUT_MS,
        'The page did not respond in time.'
    );

    return results?.[0]?.result || null;
}

// Content counts as settled only when the main content region shows no loading indicators and two
// consecutive extractions agree with enough text. This is a heuristic: a stable placeholder, login wall
// or consent page without such indicators still passes, so callers also get the final URL.
async function waitForNavigationContent(tabId, signal, timeoutMs = NAVIGATION_READY_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    let previous = null;
    let lastContent = '';
    let lastError = '';
    let lastState = null;
    let firstCheck = true;

    while (true) {
        let state = null;
        try {
            state = await getNavigationContentState(tabId, signal);
        } catch (err) {
            if (err?.name === 'AbortError') { throw err; }
            if (firstCheck) {
                throw Object.assign(new Error(err?.message || 'The page could not be read.'), { name: 'PageUnreadableError' });
            }
        }
        firstCheck = false;
        lastState = state;

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
            const settled = state?.readyState === 'complete'
                && state?.busy === 0
                && content === previous
                && content.length >= NAVIGATION_MIN_TEXT_LENGTH;
            if (settled) {
                return { content, status: 'settled' };
            }
            previous = content;
            lastContent = content;
        } else if (content) {
            lastError = content;
        }

        if (Date.now() >= deadline) { break; }
        await raceNavigationStep(new Promise(resolve => setTimeout(resolve, 1000)), signal, 0);
    }

    if (!lastContent) {
        return { error: lastError || 'No content could be extracted.' };
    }

    return {
        content: lastContent,
        status: 'incomplete',
        reason: lastState?.busy > 0
            ? 'Loading indicators were still visible in the main content when it was read; the intended content may not have loaded.'
            : 'The page content was still changing or very short when it was read; content may be incomplete.'
    };
}

// The originating tab can close while a request is still being set up, before its session is
// registered for closure handling; such a session must not ask for consent or open a page.
async function isNavigationOriginClosed(session) {
    if (session?.originTabId == null) { return false; }
    return !await chrome.tabs.get(session.originTabId).catch(() => null);
}

async function stopIfNavigationOriginClosed(session) {
    if (!await isNavigationOriginClosed(session)) { return; }
    await disposeNavigationSession(session);
    throw createNavigationAbortError('The originating tab was closed.');
}

async function browseUrl(session, rawUrl) {
    if (!session || session.disposed) {
        return 'Navigation failed: no active model request owns a browsing tab.';
    }

    const { url, error } = validateNavigationUrl(rawUrl);
    if (error) { return error; }

    await stopIfNavigationOriginClosed(session);
    const consent = await requestNavigationConsent(session, url);
    if (!consent.granted) {
        return `Navigation to ${url} was not performed: ${consent.reason}. Do not retry this URL unless the user asks for it.`;
    }
    if (session.disposed || session.signal?.aborted) {
        throw createNavigationAbortError(session.signal?.reason);
    }
    await stopIfNavigationOriginClosed(session);

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

    let extraction;
    try {
        extraction = await waitForNavigationContent(tabId, session.signal);
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
    if (extraction.status !== 'settled') { warnings.push(extraction.reason); }
    result.contentStatus = loadState.timedOut ? 'incomplete' : extraction.status;
    if (warnings.length > 0) { result.warning = warnings.join(' '); }

    result.content = extraction.content;
    return JSON.stringify(result, null, 2);
}
