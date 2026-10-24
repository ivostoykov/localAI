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

    const event = (set) => ({
        addListener: fn => set.add(fn),
        removeListener: fn => set.delete(fn),
        hasListener: fn => set.has(fn)
    });

    const helpers = {
        tabs,
        syncStore,
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
            sendMessage: vi.fn(async () => ({ choice: 'once' }))
        },
        scripting: {
            executeScript: vi.fn(async () => [{ result: { ready: true, textLength: LONG_CONTENT.length } }])
        }
    };

    return { chrome, helpers };
}

function loadModule(chrome, callContentScriptExtractor) {
    return new Function(
        'chrome', 'callContentScriptExtractor', 'manifest', 'getLineNumber', 'storageOptionKey',
        `${pageNavigationCode}
        return { validateNavigationUrl, createNavigationSession, disposeNavigationSession, handleNavigationTabRemoved,
            requestNavigationConsent, watchOwnedTabLoad, loadUrlInOwnedTab, extractNavigationContent, browseUrl, navigationSessions };`
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
        it('treats absent and legacy settings as not allowed and asks the originating chat', async () => {
            helpers.syncStore.laiOptions = { aiUrl: 'http://localhost:11434/api/chat', debug: false };
            const session = nav.createNavigationSession(1, new AbortController().signal);

            const result = await nav.requestNavigationConsent(session, 'https://example.com/');

            expect(result).toEqual({ granted: true, choice: 'once' });
            expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({
                action: 'requestNavigationConsent',
                url: 'https://example.com/'
            }));
        });

        it('skips the dialogue when the persisted setting allows navigation', async () => {
            helpers.syncStore.laiOptions = { allowNavigation: true };
            const session = nav.createNavigationSession(1, null);

            await expect(nav.requestNavigationConsent(session, 'https://example.com/')).resolves.toEqual({ granted: true, choice: 'setting' });
            expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        });

        it('Allow persists the setting without dropping other options', async () => {
            helpers.syncStore.laiOptions = { aiUrl: 'http://x/api/chat', aiModel: 'm', debug: true };
            chrome.tabs.sendMessage.mockResolvedValueOnce({ choice: 'allow' });
            const session = nav.createNavigationSession(1, null);

            await expect(nav.requestNavigationConsent(session, 'https://example.com/')).resolves.toEqual({ granted: true, choice: 'allow' });
            expect(helpers.syncStore.laiOptions).toEqual({ aiUrl: 'http://x/api/chat', aiModel: 'm', debug: true, allowNavigation: true });
        });

        it('Allow only this time does not change the setting or cover a later request', async () => {
            helpers.syncStore.laiOptions = { aiModel: 'm' };
            chrome.tabs.sendMessage.mockResolvedValueOnce({ choice: 'once' }).mockResolvedValueOnce({ choice: 'cancel' });
            const session = nav.createNavigationSession(1, null);

            await expect(nav.requestNavigationConsent(session, 'https://a.example/')).resolves.toMatchObject({ granted: true });
            expect(helpers.syncStore.laiOptions).toEqual({ aiModel: 'm' });
            await expect(nav.requestNavigationConsent(session, 'https://b.example/')).resolves.toMatchObject({ granted: false });
            expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
        });

        it('declines on Cancel, unknown answers and a missing UI', async () => {
            const session = nav.createNavigationSession(1, null);
            chrome.tabs.sendMessage
                .mockResolvedValueOnce({ choice: 'cancel' })
                .mockResolvedValueOnce({ error: 'Local AI UI is not ready yet.' })
                .mockResolvedValueOnce({ choice: 'unavailable' })
                .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'));

            await expect(nav.requestNavigationConsent(session, 'https://a.example/')).resolves.toEqual({ granted: false, reason: 'the user declined the navigation' });
            await expect(nav.requestNavigationConsent(session, 'https://a.example/')).resolves.toMatchObject({ granted: false, reason: expect.stringMatching(/could not be shown/) });
            await expect(nav.requestNavigationConsent(session, 'https://a.example/')).resolves.toMatchObject({ granted: false });
            await expect(nav.requestNavigationConsent(session, 'https://a.example/')).resolves.toMatchObject({ granted: false, reason: expect.stringMatching(/could not be shown/) });
        });

        it('declines without a dialogue when there is no originating tab', async () => {
            const session = nav.createNavigationSession(null, null);
            await expect(nav.requestNavigationConsent(session, 'https://a.example/')).resolves.toMatchObject({ granted: false });
            expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        });

        it('times out an unanswered dialogue, dismisses it and declines', async () => {
            chrome.tabs.sendMessage.mockImplementation(async (tabId, message) => (
                message.action === 'requestNavigationConsent' ? new Promise(() => {}) : undefined
            ));
            const session = nav.createNavigationSession(1, null);

            const promise = nav.requestNavigationConsent(session, 'https://a.example/');
            await vi.advanceTimersByTimeAsync(120000);

            await expect(promise).resolves.toMatchObject({ granted: false, reason: expect.stringMatching(/did not answer/) });
            expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(1, expect.objectContaining({ action: 'dismissNavigationConsent' }));
        });

        it('cancellation while waiting dismisses the dialogue and propagates the abort', async () => {
            chrome.tabs.sendMessage.mockImplementation(async (tabId, message) => (
                message.action === 'requestNavigationConsent' ? new Promise(() => {}) : undefined
            ));
            const controller = new AbortController();
            const session = nav.createNavigationSession(1, controller.signal);

            const promise = nav.requestNavigationConsent(session, 'https://a.example/');
            controller.abort('User aborted last request.');

            await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
            const dismiss = chrome.tabs.sendMessage.mock.calls.find(([, msg]) => msg.action === 'dismissNavigationConsent');
            const request = chrome.tabs.sendMessage.mock.calls.find(([, msg]) => msg.action === 'requestNavigationConsent');
            expect(dismiss[1].requestId).toBe(request[1].requestId);
        });
    });

    describe('browseUrl', () => {
        it('does not create or load any tab when consent is declined', async () => {
            chrome.tabs.sendMessage.mockResolvedValueOnce({ choice: 'cancel' });
            const session = nav.createNavigationSession(1, null);

            const result = await nav.browseUrl(session, 'https://example.com/');

            expect(result).toMatch(/was not performed: the user declined/);
            expect(chrome.tabs.create).not.toHaveBeenCalled();
            expect(chrome.tabs.update).not.toHaveBeenCalled();
        });

        it('returns validation errors without asking for consent', async () => {
            const session = nav.createNavigationSession(1, null);
            await expect(nav.browseUrl(session, '/relative')).resolves.toMatch(/not an absolute URL/);
            expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
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
            expect(result.warning).toBeUndefined();
            expect(extractor).toHaveBeenCalledTimes(4);
        });

        it('returns bounded incomplete content honestly when the page never settles', async () => {
            helpers.syncStore.laiOptions = { allowNavigation: true };
            let counter = 0;
            extractor.mockImplementation(async () => `${LONG_CONTENT} ${counter++}`);
            const session = nav.createNavigationSession(1, null);

            const result = JSON.parse(await runWithTimers(nav.browseUrl(session, 'https://feed.example/')));

            expect(result.warning).toMatch(/content may be incomplete/);
            expect(result.content).toMatch(/^# Job advert/);
            expect(extractor.mock.calls.length).toBeLessThanOrEqual(12);
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
});
