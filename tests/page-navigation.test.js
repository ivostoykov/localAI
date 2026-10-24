import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pageNavigationCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/page-navigation.js'),
    'utf-8'
);

const LONG_CONTENT = `# Job advert\n\n${'Senior engineer role with details. '.repeat(20)}\n[Apply](https://example.com/apply)`;

function createChromeFake() {
    const updatedListeners = new Set();
    const removedListeners = new Set();
    const tabs = new Map();
    const syncStore = {};
    let nextTabId = 100;
    let nextWindowId = 500;
    const windows = new Map();

    const event = (set) => ({
        addListener: fn => set.add(fn),
        removeListener: fn => set.delete(fn),
        hasListener: fn => set.has(fn)
    });

    const helpers = {
        tabs,
        windows,
        syncStore,
        // Answers the consent pop-up like the extension page would; null leaves it unanswered.
        consentChoice: 'once',
        consentRequests: [],
        answerConsent(requestId, choice, senderOverrides = {}) {
            const win = [...windows.values()].find(w => w.requestId === requestId);
            const sender = {
                id: 'test-extension',
                url: win?.url,
                tab: { id: win?.tabId, windowId: win?.id },
                ...senderOverrides
            };
            return helpers.nav.handleNavigationConsentMessage({ action: 'navigationConsentResponse', requestId, choice }, sender);
        },
        updatedListeners,
        removedListeners,
        // Navigation completion is controlled per test; the default finishes asynchronously like a browser.
        onNavigate: (tabId) => setTimeout(() => helpers.finishLoad(tabId), 0),
        addTab(tab) {
            tabs.set(tab.id, { status: 'complete', title: '', ...tab });
        },
        fireUpdated(tabId, changeInfo) {
            const tab = tabs.get(tabId);
            if (!tab) { return; }
            Object.assign(tab, changeInfo);
            [...updatedListeners].forEach(fn => fn(tabId, changeInfo, { ...tab }));
        },
        finishLoad(tabId, { finalUrl, title = 'Loaded page' } = {}) {
            helpers.fireUpdated(tabId, { status: 'loading' });
            if (finalUrl) { helpers.fireUpdated(tabId, { url: finalUrl }); }
            helpers.fireUpdated(tabId, { status: 'complete', title });
        },
        closeTab(tabId) {
            tabs.delete(tabId);
            [...removedListeners].forEach(fn => fn(tabId, {}));
        }
    };

    const chrome = {
        runtime: {
            id: 'test-extension',
            getURL: (p) => `chrome-extension://test-extension/${p}`
        },
        windows: {
            create: vi.fn(async ({ url }) => {
                const requestId = new URL(url).searchParams.get('requestId');
                const tabId = nextTabId++;
                const win = { id: nextWindowId++, url, requestId, tabId };
                windows.set(win.id, win);
                helpers.consentRequests.push(requestId);
                if (helpers.consentChoice) {
                    setTimeout(() => helpers.answerConsent(requestId, helpers.consentChoice), 0);
                }
                return { id: win.id, tabs: [{ id: tabId, windowId: win.id }] };
            }),
            get: vi.fn(async (windowId) => {
                if (!windows.has(windowId)) { throw new Error(`No window with id: ${windowId}.`); }
                return { id: windowId };
            }),
            remove: vi.fn(async (windowId) => {
                if (!windows.has(windowId)) { throw new Error(`No window with id: ${windowId}.`); }
                windows.delete(windowId);
                helpers.nav?.handleNavigationConsentWindowRemoved(windowId);
            })
        },
        storage: {
            sync: {
                get: vi.fn(async (key) => ({ [key]: structuredClone(syncStore[key]) })),
                set: vi.fn(async (obj) => { Object.assign(syncStore, structuredClone(obj)); })
            }
        },
        tabs: {
            onUpdated: event(updatedListeners),
            onRemoved: event(removedListeners),
            get: vi.fn(async (tabId) => {
                if (!tabs.has(tabId)) { throw new Error(`No tab with id: ${tabId}.`); }
                return { ...tabs.get(tabId) };
            }),
            create: vi.fn(async (props) => {
                const tab = { id: nextTabId++, url: props.url, title: '', status: 'loading', active: props.active, windowId: props.windowId };
                tabs.set(tab.id, tab);
                helpers.onNavigate(tab.id);
                return { ...tab };
            }),
            update: vi.fn(async (tabId, props) => {
                if (!tabs.has(tabId)) { throw new Error(`No tab with id: ${tabId}.`); }
                Object.assign(tabs.get(tabId), { url: props.url });
                helpers.onNavigate(tabId);
                return { ...tabs.get(tabId) };
            }),
            remove: vi.fn(async (tabId) => {
                if (!tabs.has(tabId)) { throw new Error(`No tab with id: ${tabId}.`); }
                helpers.closeTab(tabId);
            }),
            query: vi.fn(async ({ windowId }) => {
                const win = windows.get(windowId);
                return win ? [{ id: win.tabId, windowId }] : [];
            }),
            sendMessage: vi.fn(async () => undefined)
        },
        scripting: {
            executeScript: vi.fn(async () => [{ result: { readyState: 'complete', busy: 0, textLength: LONG_CONTENT.length } }])
        }
    };

    return { chrome, helpers };
}

function loadModule(chrome, callContentScriptExtractor) {
    return new Function(
        'chrome', 'callContentScriptExtractor', 'manifest', 'getLineNumber', 'storageOptionKey',
        `${pageNavigationCode}
        return { validateNavigationUrl, createNavigationSession, disposeNavigationSession, handleNavigationTabRemoved,
            requestNavigationConsent, handleNavigationConsentMessage, handleNavigationConsentWindowRemoved, pendingNavigationConsents,
            watchOwnedTabLoad, loadUrlInOwnedTab, inspectNavigationContentState, waitForNavigationContent, browseUrl, navigationSessions,
            NAVIGATION_BUSY_SELECTORS };`
    )(chrome, callContentScriptExtractor, { name: 'Local AI helper' }, () => 'test', 'laiOptions');
}

async function runWithTimers(promise) {
    let settled = false;
    promise.then(() => { settled = true; }, () => { settled = true; });
    for (let i = 0; i < 100 && !settled; i++) {
        await vi.advanceTimersByTimeAsync(1000);
    }
    return promise;
}

describe('page-navigation.js', () => {
    let chrome;
    let helpers;
    let extractor;
    let nav;

    beforeEach(() => {
        vi.useFakeTimers();
        ({ chrome, helpers } = createChromeFake());
        helpers.addTab({ id: 1, url: 'https://origin.example/form', windowId: 9, active: true });
        helpers.addTab({ id: 5, url: 'https://duckduckgo.com/?q=x', windowId: 9, active: false });
        extractor = vi.fn(async () => LONG_CONTENT);
        nav = loadModule(chrome, extractor);
        helpers.nav = nav;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe('validateNavigationUrl', () => {
        it('accepts absolute http and https URLs', () => {
            expect(nav.validateNavigationUrl(' https://example.com/a?b=1 ')).toEqual({ url: 'https://example.com/a?b=1' });
            expect(nav.validateNavigationUrl('http://example.com')).toEqual({ url: 'http://example.com/' });
        });

        it('rejects relative URLs, empty input and unsupported schemes', () => {
            expect(nav.validateNavigationUrl('/jobs/view/1').error).toMatch(/not an absolute URL/);
            expect(nav.validateNavigationUrl('').error).toMatch(/no URL provided/);
            expect(nav.validateNavigationUrl(undefined).error).toMatch(/no URL provided/);
            for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'chrome://extensions', 'data:text/html,hi', 'ftp://example.com']) {
                expect(nav.validateNavigationUrl(url).error).toMatch(/not supported/);
            }
        });
    });

    describe('consent', () => {
        const lastRequestId = () => helpers.consentRequests.at(-1);

        it('treats absent and legacy settings as not allowed and asks in an extension pop-up window', async () => {
            helpers.syncStore.laiOptions = { aiUrl: 'http://localhost:11434/api/chat', debug: false };
            const session = nav.createNavigationSession(1, new AbortController().signal);

            const result = await runWithTimers(nav.requestNavigationConsent(session, 'https://example.com/'));

            expect(result).toEqual({ granted: true, choice: 'once' });
            const [{ url, type }] = chrome.windows.create.mock.calls[0];
            expect(type).toBe('popup');
            expect(url).toBe(`chrome-extension://test-extension/navigation-consent.html?requestId=${lastRequestId()}`);
            expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ action: 'updateStatusbar' }));
            expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(1, expect.objectContaining({ action: 'requestNavigationConsent' }));
            expect(helpers.windows.size).toBe(0);
            expect(nav.pendingNavigationConsents.size).toBe(0);
        });

        it('serves the requested URL only to the bound consent page', async () => {
            helpers.consentChoice = null;
            const session = nav.createNavigationSession(1, null);
            const promise = nav.requestNavigationConsent(session, 'https://example.com/<b>x</b>');
            await vi.advanceTimersByTimeAsync(0);
            const requestId = lastRequestId();
            const win = [...helpers.windows.values()][0];
            const sender = { id: 'test-extension', url: win.url, tab: { id: win.tabId, windowId: win.id } };

            await expect(nav.handleNavigationConsentMessage({ action: 'getNavigationConsentRequest', requestId }, sender))
                .resolves.toEqual({ status: 'ok', url: 'https://example.com/<b>x</b>' });
            await expect(nav.handleNavigationConsentMessage({ action: 'getNavigationConsentRequest', requestId }, { ...sender, tab: { id: 1, windowId: 9 } }))
                .resolves.toEqual({ status: 'rejected' });

            await helpers.answerConsent(requestId, 'cancel');
            await expect(promise).resolves.toMatchObject({ granted: false });
        });

        it('rejects forged answers from content scripts, other tabs, other pages and other requests', async () => {
            helpers.consentChoice = null;
            helpers.syncStore.laiOptions = { aiModel: 'm' };
            const session = nav.createNavigationSession(1, null);
            const promise = nav.requestNavigationConsent(session, 'https://example.com/');
            await vi.advanceTimersByTimeAsync(0);
            const requestId = lastRequestId();
            const win = [...helpers.windows.values()][0];

            const forgeries = [
                { url: 'https://origin.example/form', tab: { id: 1, windowId: 9 } },
                { id: 'other-extension' },
                { url: `chrome-extension://test-extension/options.html?requestId=${requestId}` },
                { url: 'chrome-extension://test-extension/navigation-consent.html?requestId=other' },
                { tab: { id: win.tabId + 1, windowId: win.id } },
                { tab: { id: win.tabId, windowId: win.id + 1 } },
                { tab: undefined }
            ];
            for (const forged of forgeries) {
                await expect(helpers.answerConsent(requestId, 'allow', forged)).resolves.toEqual({ status: 'rejected' });
            }
            await expect(helpers.answerConsent('unknown-request', 'allow')).resolves.toEqual({ status: 'rejected' });
            await expect(helpers.answerConsent(requestId, 'grant-everything')).resolves.toEqual({ status: 'rejected' });
            expect(nav.pendingNavigationConsents.size).toBe(1);

            await expect(helpers.answerConsent(requestId, 'cancel')).resolves.toEqual({ status: 'ok' });
            await expect(promise).resolves.toMatchObject({ granted: false, reason: 'the user declined the navigation' });
            await expect(helpers.answerConsent(requestId, 'allow')).resolves.toEqual({ status: 'rejected' });
            expect(helpers.syncStore.laiOptions).toEqual({ aiModel: 'm' });
        });

        it('skips the pop-up when the persisted setting allows navigation', async () => {
            helpers.syncStore.laiOptions = { allowNavigation: true };
            const session = nav.createNavigationSession(1, null);

            await expect(nav.requestNavigationConsent(session, 'https://example.com/')).resolves.toEqual({ granted: true, choice: 'setting' });
            expect(chrome.windows.create).not.toHaveBeenCalled();
        });

        it('Allow always persists the setting without dropping other options', async () => {
            helpers.syncStore.laiOptions = { aiUrl: 'http://x/api/chat', aiModel: 'm', debug: true };
            helpers.consentChoice = 'allow';
            const session = nav.createNavigationSession(1, null);

            await expect(runWithTimers(nav.requestNavigationConsent(session, 'https://example.com/'))).resolves.toEqual({ granted: true, choice: 'allow' });
            expect(helpers.syncStore.laiOptions).toEqual({ aiUrl: 'http://x/api/chat', aiModel: 'm', debug: true, allowNavigation: true });
        });

        it('Allow this time does not change the setting or cover a later request', async () => {
            helpers.syncStore.laiOptions = { aiModel: 'm' };
            const session = nav.createNavigationSession(1, null);

            await expect(runWithTimers(nav.requestNavigationConsent(session, 'https://a.example/'))).resolves.toMatchObject({ granted: true });
            expect(helpers.syncStore.laiOptions).toEqual({ aiModel: 'm' });
            helpers.consentChoice = 'cancel';
            await expect(runWithTimers(nav.requestNavigationConsent(session, 'https://b.example/'))).resolves.toMatchObject({ granted: false });
            expect(chrome.windows.create).toHaveBeenCalledTimes(2);
        });

        it('declines when the user closes the pop-up window', async () => {
            helpers.consentChoice = null;
            const session = nav.createNavigationSession(1, null);
            const promise = nav.requestNavigationConsent(session, 'https://a.example/');
            await vi.advanceTimersByTimeAsync(0);

            const [windowId] = helpers.windows.keys();
            await chrome.windows.remove(windowId);

            await expect(promise).resolves.toMatchObject({ granted: false, reason: expect.stringMatching(/closed the permission window/) });
            expect(nav.pendingNavigationConsents.size).toBe(0);
        });

        it('declines when the pop-up cannot be opened', async () => {
            chrome.windows.create.mockRejectedValueOnce(new Error('Windows API unavailable'));
            const session = nav.createNavigationSession(1, null);

            await expect(nav.requestNavigationConsent(session, 'https://a.example/')).resolves.toMatchObject({ granted: false, reason: expect.stringMatching(/could not be shown/) });
            expect(nav.pendingNavigationConsents.size).toBe(0);
        });

        it('declines without a pop-up when there is no originating tab', async () => {
            const session = nav.createNavigationSession(null, null);
            await expect(nav.requestNavigationConsent(session, 'https://a.example/')).resolves.toMatchObject({ granted: false });
            expect(chrome.windows.create).not.toHaveBeenCalled();
        });

        it('times out an unanswered pop-up, closes it and declines', async () => {
            helpers.consentChoice = null;
            const session = nav.createNavigationSession(1, null);

            const promise = nav.requestNavigationConsent(session, 'https://a.example/');
            await vi.advanceTimersByTimeAsync(120000);

            await expect(promise).resolves.toMatchObject({ granted: false, reason: expect.stringMatching(/did not answer/) });
            expect(helpers.windows.size).toBe(0);
            expect(nav.pendingNavigationConsents.size).toBe(0);
        });

        it('cancellation while waiting closes the pop-up and propagates the abort', async () => {
            helpers.consentChoice = null;
            const controller = new AbortController();
            const session = nav.createNavigationSession(1, controller.signal);

            const promise = nav.requestNavigationConsent(session, 'https://a.example/');
            await vi.advanceTimersByTimeAsync(0);
            const requestId = lastRequestId();
            controller.abort('User aborted last request.');

            await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
            expect(helpers.windows.size).toBe(0);
            await expect(helpers.answerConsent(requestId, 'allow')).resolves.toEqual({ status: 'rejected' });
        });

        it('closes the pop-up of every loop from a closed origin tab, including an older loop for the same tab', async () => {
            helpers.consentChoice = null;
            const older = nav.createNavigationSession(1, new AbortController().signal);
            const newer = nav.createNavigationSession(1, new AbortController().signal);
            const olderConsent = nav.requestNavigationConsent(older, 'https://a.example/');
            const newerConsent = nav.requestNavigationConsent(newer, 'https://b.example/');
            olderConsent.catch(() => {});
            newerConsent.catch(() => {});
            await vi.advanceTimersByTimeAsync(0);
            expect(helpers.windows.size).toBe(2);

            await nav.handleNavigationTabRemoved(1);

            await expect(olderConsent).rejects.toMatchObject({ name: 'AbortError' });
            await expect(newerConsent).rejects.toMatchObject({ name: 'AbortError' });
            expect(helpers.windows.size).toBe(0);
            expect(nav.pendingNavigationConsents.size).toBe(0);
            expect(chrome.tabs.create).not.toHaveBeenCalled();
        });

        it('does not open a pop-up when the origin closes while the permission setting is being read', async () => {
            let releaseRead;
            const read = chrome.storage.sync.get.getMockImplementation();
            chrome.storage.sync.get.mockImplementationOnce(async (key) => {
                await new Promise(resolve => { releaseRead = resolve; });
                return read(key);
            });
            const session = nav.createNavigationSession(1, new AbortController().signal);
            const promise = nav.requestNavigationConsent(session, 'https://a.example/');
            promise.catch(() => {});
            await vi.advanceTimersByTimeAsync(0);

            helpers.closeTab(1);
            await nav.handleNavigationTabRemoved(1);
            releaseRead();

            await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
            expect(chrome.windows.create).not.toHaveBeenCalled();
            expect(nav.pendingNavigationConsents.size).toBe(0);
        });

        it('does not open a pop-up when the origin closes while the status message is being sent', async () => {
            let releaseNotify;
            chrome.tabs.sendMessage.mockImplementationOnce(() => new Promise(resolve => { releaseNotify = resolve; }));
            const session = nav.createNavigationSession(1, new AbortController().signal);
            const promise = nav.requestNavigationConsent(session, 'https://a.example/');
            promise.catch(() => {});
            await vi.advanceTimersByTimeAsync(0);

            helpers.closeTab(1);
            await nav.handleNavigationTabRemoved(1);
            releaseNotify();

            await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
            expect(chrome.windows.create).not.toHaveBeenCalled();
            expect(nav.pendingNavigationConsents.size).toBe(0);
        });

        it('does not save Allow always when the origin closed before the answer arrived', async () => {
            helpers.consentChoice = null;
            helpers.syncStore.laiOptions = { aiModel: 'm' };
            const session = nav.createNavigationSession(1, null);
            const promise = nav.requestNavigationConsent(session, 'https://a.example/');
            promise.catch(() => {});
            await vi.advanceTimersByTimeAsync(0);

            helpers.tabs.delete(1);
            await helpers.answerConsent(helpers.consentRequests.at(-1), 'allow');

            await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
            expect(helpers.syncStore.laiOptions).toEqual({ aiModel: 'm' });
            expect(helpers.windows.size).toBe(0);
        });

        it('keeps concurrent requests bound to their own pop-up windows', async () => {
            helpers.consentChoice = null;
            helpers.addTab({ id: 2, url: 'https://other.example/', windowId: 9 });
            const first = nav.requestNavigationConsent(nav.createNavigationSession(1, null), 'https://a.example/');
            const second = nav.requestNavigationConsent(nav.createNavigationSession(2, null), 'https://b.example/');
            await vi.advanceTimersByTimeAsync(0);
            const [firstId, secondId] = helpers.consentRequests;
            const firstWindow = [...helpers.windows.values()].find(w => w.requestId === firstId);

            await expect(helpers.answerConsent(secondId, 'once', { url: firstWindow.url, tab: { id: firstWindow.tabId, windowId: firstWindow.id } }))
                .resolves.toEqual({ status: 'rejected' });
            await helpers.answerConsent(secondId, 'once');
            await helpers.answerConsent(firstId, 'cancel');

            await expect(first).resolves.toMatchObject({ granted: false });
            await expect(second).resolves.toMatchObject({ granted: true, choice: 'once' });
        });
    });

    describe('browseUrl', () => {
        it('does not create or load any tab when consent is declined', async () => {
            helpers.consentChoice = 'cancel';
            const session = nav.createNavigationSession(1, null);

            const result = await runWithTimers(nav.browseUrl(session, 'https://example.com/'));

            expect(result).toMatch(/was not performed: the user declined/);
            expect(chrome.tabs.create).not.toHaveBeenCalled();
            expect(chrome.tabs.update).not.toHaveBeenCalled();
        });

        it('returns validation errors without asking for consent', async () => {
            const session = nav.createNavigationSession(1, null);
            await expect(nav.browseUrl(session, '/relative')).resolves.toMatch(/not an absolute URL/);
            expect(chrome.windows.create).not.toHaveBeenCalled();
        });

        it('opens the URL directly in an inactive tab in the origin window and returns final URL and content', async () => {
            helpers.syncStore.laiOptions = { allowNavigation: true };
            helpers.onNavigate = (tabId) => setTimeout(() => helpers.finishLoad(tabId, { finalUrl: 'https://example.com/final', title: 'Final' }), 0);
            const session = nav.createNavigationSession(1, null);

            const result = JSON.parse(await runWithTimers(nav.browseUrl(session, 'https://example.com/start')));

            expect(chrome.tabs.create).toHaveBeenCalledWith({ active: false, url: 'https://example.com/start', windowId: 9 });
            expect(result).toMatchObject({ requestedUrl: 'https://example.com/start', finalUrl: 'https://example.com/final', title: 'Final', content: LONG_CONTENT });
            expect(result.content).toContain('[Apply](https://example.com/apply)');
            expect(result.warning).toBeUndefined();
            expect(extractor).toHaveBeenCalledWith(session.ownedTabId, 'getEnhancedPageContent', null);
            expect(helpers.tabs.get(1)).toMatchObject({ url: 'https://origin.example/form', active: true });
            expect(chrome.tabs.update).not.toHaveBeenCalledWith(1, expect.anything());
        });

        it('reuses one owned tab for successive calls and closes it only on dispose', async () => {
            helpers.syncStore.laiOptions = { allowNavigation: true };
            const session = nav.createNavigationSession(1, null);

            await runWithTimers(nav.browseUrl(session, 'https://a.example/'));
            const ownedTabId = session.ownedTabId;
            await runWithTimers(nav.browseUrl(session, 'https://b.example/'));

            expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
            expect(chrome.tabs.update).toHaveBeenCalledWith(ownedTabId, { url: 'https://b.example/' });
            expect(helpers.tabs.has(ownedTabId)).toBe(true);

            await nav.disposeNavigationSession(session);

            expect(helpers.tabs.has(ownedTabId)).toBe(false);
            expect(helpers.tabs.has(1)).toBe(true);
            expect(helpers.tabs.has(5)).toBe(true);
            expect(nav.navigationSessions.has(session)).toBe(false);
            expect(helpers.updatedListeners.size).toBe(0);
            expect(helpers.removedListeners.size).toBe(0);
        });

        it('isolates concurrent loops and the search tab', async () => {
            helpers.syncStore.laiOptions = { allowNavigation: true };
            helpers.addTab({ id: 2, url: 'https://other.example/', windowId: 9 });
            const first = nav.createNavigationSession(1, null);
            const second = nav.createNavigationSession(2, null);

            await runWithTimers(Promise.all([
                nav.browseUrl(first, 'https://a.example/'),
                nav.browseUrl(second, 'https://b.example/')
            ]));
            expect(first.ownedTabId).not.toBe(second.ownedTabId);

            await nav.handleNavigationTabRemoved(1);

            expect(first.disposed).toBe(true);
            expect(second.disposed).toBe(false);
            expect(helpers.tabs.has(second.ownedTabId)).toBe(true);
            expect(helpers.tabs.has(5)).toBe(true);
            expect(chrome.tabs.remove).toHaveBeenCalledTimes(1);
        });

        it('reports a redirect through the final URL', async () => {
            helpers.syncStore.laiOptions = { allowNavigation: true };
            helpers.onNavigate = (tabId) => setTimeout(() => helpers.finishLoad(tabId, { finalUrl: 'https://login.example/?next=job' }), 0);
            const session = nav.createNavigationSession(1, null);

            const result = JSON.parse(await runWithTimers(nav.browseUrl(session, 'https://jobs.example/view/1')));

            expect(result.requestedUrl).toBe('https://jobs.example/view/1');
            expect(result.finalUrl).toBe('https://login.example/?next=job');
        });

        it('returns an explicit error for unreachable or error pages', async () => {
            helpers.syncStore.laiOptions = { allowNavigation: true };
            chrome.scripting.executeScript.mockRejectedValueOnce(new Error('Frame with ID 0 is showing error page'));
            const session = nav.createNavigationSession(1, null);

            const result = JSON.parse(await runWithTimers(nav.browseUrl(session, 'https://unreachable.invalid/')));

            expect(result.error).toMatch(/could not be loaded or read/);
            expect(result.content).toBeUndefined();
            expect(extractor).not.toHaveBeenCalled();
        });

        it('reports a load timeout and returns any content it could still read as incomplete', async () => {
            helpers.syncStore.laiOptions = { allowNavigation: true };
            helpers.onNavigate = (tabId) => setTimeout(() => helpers.fireUpdated(tabId, { status: 'loading' }), 0);
            const session = nav.createNavigationSession(1, null);

            const result = JSON.parse(await runWithTimers(nav.browseUrl(session, 'https://slow.example/')));

            expect(result.warning).toMatch(/did not finish loading in time/);
            expect(result.content).toBe(LONG_CONTENT);
            expect(helpers.updatedListeners.size).toBe(0);
            expect(helpers.removedListeners.size).toBe(0);
        });

        it('reports manual closure of the owned tab during loading and recreates it on the next call', async () => {
            helpers.syncStore.laiOptions = { allowNavigation: true };
            helpers.onNavigate = (tabId) => setTimeout(() => {
                helpers.fireUpdated(tabId, { status: 'loading' });
                helpers.closeTab(tabId);
                nav.handleNavigationTabRemoved(tabId);
            }, 0);
            const session = nav.createNavigationSession(1, null);

            const result = await runWithTimers(nav.browseUrl(session, 'https://a.example/'));

            expect(result).toMatch(/browsing tab was closed before the page finished loading/);
            expect(session.ownedTabId).toBeNull();
            expect(helpers.updatedListeners.size).toBe(0);

            helpers.onNavigate = (tabId) => setTimeout(() => helpers.finishLoad(tabId), 0);
            await runWithTimers(nav.browseUrl(session, 'https://b.example/'));
            expect(chrome.tabs.create).toHaveBeenCalledTimes(2);
        });

        it('returns extractor failures as a useful tool result', async () => {
            helpers.syncStore.laiOptions = { allowNavigation: true };
            extractor.mockResolvedValue('Error: Could not communicate with page. The page may not support content extraction.');
            const session = nav.createNavigationSession(1, null);

            const result = JSON.parse(await runWithTimers(nav.browseUrl(session, 'https://a.example/')));

            expect(result.finalUrl).toBe('https://a.example/');
            expect(result.error).toMatch(/Content extraction failed: Error: Could not communicate/);
        });

        it('waits for extractor output to settle and does not treat a loading skeleton as ready', async () => {
            helpers.syncStore.laiOptions = { allowNavigation: true };
            const skeleton = 'Loading...';
            extractor
                .mockResolvedValueOnce(skeleton)
                .mockResolvedValueOnce(skeleton)
                .mockResolvedValueOnce(LONG_CONTENT)
                .mockResolvedValue(LONG_CONTENT);
            const session = nav.createNavigationSession(1, null);

            const result = JSON.parse(await runWithTimers(nav.browseUrl(session, 'https://spa.example/route')));

            expect(result.content).toBe(LONG_CONTENT);
            expect(result.contentStatus).toBe('settled');
            expect(result.warning).toBeUndefined();
            expect(extractor).toHaveBeenCalledTimes(4);
        });

        it('does not accept a long, stable skeleton while loading indicators are visible', async () => {
            helpers.syncStore.laiOptions = { allowNavigation: true };
            const skeleton = `# Jobs\n\n${'Loading job details placeholder text. '.repeat(10)}`;
            expect(skeleton.length).toBeGreaterThanOrEqual(200);
            const busyState = [{ result: { readyState: 'complete', busy: 4, textLength: skeleton.length } }];
            chrome.scripting.executeScript
                .mockResolvedValueOnce(busyState)
                .mockResolvedValueOnce(busyState)
                .mockResolvedValueOnce(busyState);
            extractor
                .mockResolvedValueOnce(skeleton)
                .mockResolvedValueOnce(skeleton)
                .mockResolvedValueOnce(skeleton)
                .mockResolvedValue(LONG_CONTENT);
            const session = nav.createNavigationSession(1, null);

            const result = JSON.parse(await runWithTimers(nav.browseUrl(session, 'https://www.linkedin.com/jobs/view/1/')));

            expect(result.content).toBe(LONG_CONTENT);
            expect(result.contentStatus).toBe('settled');
            expect(extractor).toHaveBeenCalledTimes(5);
        });

        it('reports a skeleton that never resolves as incomplete within the deadline', async () => {
            helpers.syncStore.laiOptions = { allowNavigation: true };
            const skeleton = `# Jobs\n\n${'Loading job details placeholder text. '.repeat(10)}`;
            chrome.scripting.executeScript.mockResolvedValue([{ result: { readyState: 'complete', busy: 2, textLength: skeleton.length } }]);
            extractor.mockResolvedValue(skeleton);
            const session = nav.createNavigationSession(1, null);

            const result = JSON.parse(await runWithTimers(nav.browseUrl(session, 'https://www.linkedin.com/jobs/view/1/')));

            expect(result.contentStatus).toBe('incomplete');
            expect(result.warning).toMatch(/Loading indicators were still visible/);
            expect(result.content).toBe(skeleton);
            expect(extractor.mock.calls.length).toBeLessThanOrEqual(17);
        });

        it('returns bounded incomplete content honestly when the page never settles', async () => {
            helpers.syncStore.laiOptions = { allowNavigation: true };
            let counter = 0;
            extractor.mockImplementation(async () => `${LONG_CONTENT} ${counter++}`);
            const session = nav.createNavigationSession(1, null);

            const result = JSON.parse(await runWithTimers(nav.browseUrl(session, 'https://feed.example/')));

            expect(result.warning).toMatch(/still changing or very short/);
            expect(result.contentStatus).toBe('incomplete');
            expect(result.content).toMatch(/^# Job advert/);
            expect(extractor.mock.calls.length).toBeLessThanOrEqual(17);
        });

        it('aborts an in-flight load on cancellation without leaking listeners', async () => {
            helpers.syncStore.laiOptions = { allowNavigation: true };
            helpers.onNavigate = () => {};
            const controller = new AbortController();
            const session = nav.createNavigationSession(1, controller.signal);

            const promise = nav.browseUrl(session, 'https://a.example/');
            promise.catch(() => {});
            await vi.advanceTimersByTimeAsync(10);
            controller.abort('User aborted last request.');

            await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
            expect(helpers.updatedListeners.size).toBe(0);
            expect(helpers.removedListeners.size).toBe(0);

            const ownedTabId = session.ownedTabId;
            await nav.disposeNavigationSession(session);
            expect(helpers.tabs.has(ownedTabId)).toBe(false);
        });

        it('closes a tab created after the loop was disposed', async () => {
            helpers.syncStore.laiOptions = { allowNavigation: true };
            const session = nav.createNavigationSession(1, null);
            const create = chrome.tabs.create.getMockImplementation();
            chrome.tabs.create.mockImplementationOnce(async (props) => {
                await nav.disposeNavigationSession(session);
                return create(props);
            });

            await expect(runWithTimers(nav.browseUrl(session, 'https://a.example/'))).rejects.toMatchObject({ name: 'AbortError' });
            expect([...helpers.tabs.keys()].sort()).toEqual([1, 5]);
        });

        it.each([
            ['permission off', {}],
            ['permission on', { allowNavigation: true }]
        ])('does not ask or open a tab once the originating tab is gone (%s)', async (label, options) => {
            helpers.syncStore.laiOptions = options;
            const session = nav.createNavigationSession(77, null);

            await expect(nav.browseUrl(session, 'https://a.example/')).rejects.toMatchObject({ name: 'AbortError' });

            expect(chrome.windows.create).not.toHaveBeenCalled();
            expect(chrome.tabs.create).not.toHaveBeenCalled();
            expect(session.disposed).toBe(true);
            expect(nav.navigationSessions.has(session)).toBe(false);
        });

        it('does not open a tab when the originating tab closes while consent is pending', async () => {
            helpers.consentChoice = null;
            const session = nav.createNavigationSession(1, null);
            const promise = nav.browseUrl(session, 'https://a.example/');
            promise.catch(() => {});
            await vi.advanceTimersByTimeAsync(0);

            helpers.tabs.delete(1);
            await helpers.answerConsent(helpers.consentRequests.at(-1), 'once');

            await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
            expect(chrome.tabs.create).not.toHaveBeenCalled();
            expect(helpers.windows.size).toBe(0);
        });

        it('refuses to navigate after the loop has been disposed', async () => {
            const session = nav.createNavigationSession(1, null);
            await nav.disposeNavigationSession(session);
            await expect(nav.browseUrl(session, 'https://a.example/')).resolves.toMatch(/no active model request/);
            expect(chrome.tabs.create).not.toHaveBeenCalled();
        });
    });

    describe('watchOwnedTabLoad', () => {
        it('replays events received before the tab id is known', async () => {
            const watcher = nav.watchOwnedTabLoad(null, 1000);
            helpers.addTab({ id: 42, url: 'https://a.example/', status: 'loading' });
            helpers.finishLoad(42);
            watcher.setTabId(42);

            await expect(watcher.promise).resolves.toMatchObject({ id: 42 });
            expect(helpers.updatedListeners.size).toBe(0);
        });

        it('ignores a stale complete without a fresh loading event and about:blank completes', async () => {
            helpers.addTab({ id: 42, url: 'about:blank', status: 'loading' });
            const watcher = nav.watchOwnedTabLoad(null, 1000);
            watcher.setTabId(42);
            let resolved = false;
            watcher.promise.then(() => { resolved = true; }, () => {});

            helpers.fireUpdated(42, { status: 'complete' });
            helpers.fireUpdated(42, { status: 'loading' });
            helpers.fireUpdated(42, { status: 'complete' });
            await Promise.resolve();
            expect(resolved).toBe(false);

            helpers.fireUpdated(42, { url: 'https://a.example/' });
            helpers.fireUpdated(42, { status: 'complete' });
            await expect(watcher.promise).resolves.toMatchObject({ url: 'https://a.example/' });
        });

        it('ignores other tabs', async () => {
            helpers.addTab({ id: 42, url: 'https://a.example/' });
            const watcher = nav.watchOwnedTabLoad(null, 1000);
            watcher.setTabId(42);
            helpers.finishLoad(5);
            helpers.closeTab(5);

            await vi.advanceTimersByTimeAsync(1000);
            await expect(watcher.promise).rejects.toMatchObject({ name: 'TimeoutError' });
        });
    });

    describe('inspectNavigationContentState', () => {
        const filler = 'Visible text. '.repeat(20);
        const inspect = (html) => {
            document.body.innerHTML = html;
            return nav.inspectNavigationContentState(nav.NAVIGATION_BUSY_SELECTORS);
        };

        it('counts visible loading placeholders in the main content region', () => {
            const state = inspect(`<main><div class="jobs-ghost-fadein-placeholder">${filler}</div><div class="artdeco-loader"></div></main>`);
            expect(state.busy).toBeGreaterThanOrEqual(2);
            expect(state.textLength).toBeGreaterThanOrEqual(200);
        });

        it('treats an aria-busy region and progress bars as busy', () => {
            expect(inspect(`<main aria-busy="true"><p>${filler}</p></main>`).busy).toBeGreaterThan(0);
            expect(inspect(`<main><div role="progressbar"></div><p>${filler}</p></main>`).busy).toBeGreaterThan(0);
        });

        it('ignores hidden placeholders and indicators outside the content region', () => {
            const state = inspect(`<nav><div class="skeleton">menu</div></nav><main><div class="skeleton" style="display:none"></div><p>${filler}</p></main>`);
            expect(state.busy).toBe(0);
            expect(state.readyState).toBe(document.readyState);
        });

        it('falls back to the body when there is no main region', () => {
            expect(inspect(`<div class="loading-spinner"></div><p>${filler}</p>`).busy).toBeGreaterThan(0);
            expect(inspect(`<p>${filler}</p>`).busy).toBe(0);
        });
    });
});
