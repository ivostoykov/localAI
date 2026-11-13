import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const tabStateCode = fs.readFileSync(path.join(root, 'src/jslib/tab-state.js'), 'utf-8');
const backgroundCode = fs.readFileSync(path.join(root, 'src/background.js'), 'utf-8');
const sessionsCode = fs.readFileSync(path.join(root, 'src/jslib/sessions.js'), 'utf-8');

const loadTabStateModule = new Function('chrome', `${tabStateCode}; return { TabStateStore, reportTabBinding, fetchTabStartupState, fetchOpenSessions, acknowledgeTabRequestSnapshot };`);

const extractFunction = (name) => backgroundCode.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}\\n`))[0];
const backgroundHandlersCode = ['updateTabBindingForSender', 'getTabRequestSnapshotForSender', 'readTabStartupStateForSender', 'removeStreamRequestStateForSender']
    .map(extractFunction)
    .join('\n');
const loadBackgroundHandlers = new Function('deps', `with (deps) { ${tabStateCode}\n${backgroundHandlersCode}; return { updateTabBindingForSender, getTabRequestSnapshotForSender, readTabStartupStateForSender, removeStreamRequestStateForSender }; }`);

function createStorage(entries = {}) {
    return {
        entries,
        set: vi.fn(async values => Object.assign(entries, values)),
        get: vi.fn(async keys => {
            if (keys == null) { return { ...entries }; }
            const wanted = [].concat(keys);
            return Object.fromEntries(wanted.filter(key => key in entries).map(key => [key, entries[key]]));
        }),
        remove: vi.fn(async keys => [].concat(keys).forEach(key => delete entries[key]))
    };
}

describe('TabStateStore', () => {
    it('merges updates, keeps unrelated fields and stamps updatedAt', async () => {
        const { TabStateStore } = loadTabStateModule({});
        const storage = createStorage();
        const store = new TabStateStore({ storage });

        await store.update(1, { sessionId: 's1' });
        await store.update(1, { panelOpen: true });

        const binding = await store.get(1);
        expect(binding).toMatchObject({ tabId: 1, sessionId: 's1', panelOpen: true });
        expect(typeof binding.updatedAt).toBe('number');
    });

    it('keeps the binding for a closed panel and clears the session identity on null', async () => {
        const { TabStateStore } = loadTabStateModule({});
        const storage = createStorage();
        const store = new TabStateStore({ storage });

        await store.update(1, { sessionId: 's1', panelOpen: false });
        await store.update(1, { sessionId: null });

        expect(await store.get(1)).toMatchObject({ tabId: 1, sessionId: null, panelOpen: false });
    });

    it('removes the binding for a closed tab only', async () => {
        const { TabStateStore } = loadTabStateModule({});
        const storage = createStorage();
        const store = new TabStateStore({ storage });

        await store.update(1, { sessionId: 's1' });
        await store.update(2, { sessionId: 's2' });
        await store.remove(1);

        expect(await store.get(1)).toBeNull();
        expect(await store.get(2)).toMatchObject({ sessionId: 's2' });
    });
});

function createHandlerDeps(entries = {}) {
    const storage = createStorage(entries);
    const { TabStateStore } = loadTabStateModule({});
    const deps = {
        tabState: new TabStateStore({ storage }),
        liveStreamStates: new Map(),
        streamRequestState: {
            latestForTab: vi.fn(async (tabId, sessionId) => {
                let latest = null;
                for (const [key, state] of Object.entries(entries)) {
                    if (!key.startsWith('laiStreamRequest:') || state?.tabId !== tabId) { continue; }
                    if (sessionId != null && state?.sessionId !== sessionId) { continue; }
                    if (!latest || (state?.updatedAt ?? 0) > (latest.updatedAt ?? 0)) { latest = state; }
                }
                return latest;
            }),
            get: vi.fn(async requestId => entries[`laiStreamRequest:${requestId}`] ?? null),
            remove: vi.fn(async requestId => { delete entries[`laiStreamRequest:${requestId}`]; })
        },
        manifest: { name: 'Local AI helper' },
        getLineNumber: () => 'test'
    };
    return { deps, storage, entries };
}

describe('background tab state handlers (#40)', () => {
    it('binds by sender tab id and ignores any tab id in the payload', async () => {
        const { deps } = createHandlerDeps();
        const handlers = loadBackgroundHandlers(deps);

        await handlers.updateTabBindingForSender({ tabId: 999, sessionId: 's1', panelOpen: true }, { tab: { id: 7 } });

        expect(await deps.tabState.get(7)).toMatchObject({ tabId: 7, sessionId: 's1', panelOpen: true });
        expect(await deps.tabState.get(999)).toBeNull();
    });

    it('returns a live snapshot from the in-memory registry, not the throttled storage copy', async () => {
        const { deps } = createHandlerDeps({
            'laiStreamRequest:r1': { requestId: 'r1', tabId: 7, sessionId: 's1', status: 'streaming', content: 'stale', thinking: '', seq: 2, model: 'm', updatedAt: 100 }
        });
        deps.liveStreamStates.set('r1', { requestId: 'r1', tabId: 7, sessionId: 's1', status: 'streaming', content: 'fresh accumulated', thinking: 'deep', seq: 9, model: 'm' });
        const handlers = loadBackgroundHandlers(deps);

        await deps.tabState.update(7, { sessionId: 's1' });
        const state = await handlers.readTabStartupStateForSender({ tab: { id: 7 } });

        expect(state.request).toEqual({ requestId: 'r1', status: 'streaming', content: 'fresh accumulated', thinking: 'deep', seq: 9, model: 'm' });
    });

    it('reports a stored streaming request without a live request as interrupted and cleans it up', async () => {
        const { deps, entries } = createHandlerDeps({
            'laiStreamRequest:r1': { requestId: 'r1', tabId: 7, sessionId: 's1', status: 'streaming', content: 'partial', thinking: '', seq: 4, model: 'm', updatedAt: 100 }
        });
        const handlers = loadBackgroundHandlers(deps);

        await deps.tabState.update(7, { sessionId: 's1' });
        const state = await handlers.readTabStartupStateForSender({ tab: { id: 7 } });

        expect(state.request).toMatchObject({ requestId: 'r1', status: 'error', error: 'Stream interrupted by a page reload.', content: 'partial' });
        expect(entries['laiStreamRequest:r1']).toBeUndefined();
    });


    it('returns the stored terminal snapshot with its error message', async () => {
        const { deps, entries } = createHandlerDeps({
            'laiStreamRequest:r2': { requestId: 'r2', tabId: 7, sessionId: 's1', status: 'aborted', content: 'partial', thinking: '', seq: 4, model: 'm', error: undefined, updatedAt: 100 },
            'laiStreamRequest:r3': { requestId: 'r3', tabId: 7, sessionId: 's1', status: 'error', content: '', thinking: '', seq: 2, model: 'm', error: 'connection refused', updatedAt: 200 }
        });
        const handlers = loadBackgroundHandlers(deps);

        await deps.tabState.update(7, { sessionId: 's1' });
        let state = await handlers.readTabStartupStateForSender({ tab: { id: 7 } });
        expect(state.request).toMatchObject({ requestId: 'r3', status: 'error', error: 'connection refused' });

        delete entries['laiStreamRequest:r3'];
        state = await handlers.readTabStartupStateForSender({ tab: { id: 7 } });
        expect(state.request).toMatchObject({ requestId: 'r2', status: 'aborted', content: 'partial' });
        expect('error' in state.request).toBe(false);
    });

    it('never returns another tab\'s request, even for the same session id', async () => {
        const { deps } = createHandlerDeps({
            'laiStreamRequest:r1': { requestId: 'r1', tabId: 1, sessionId: 'shared', status: 'streaming', content: 'tab one', thinking: '', seq: 1, model: 'm', updatedAt: 100 },
            'laiStreamRequest:r2': { requestId: 'r2', tabId: 2, sessionId: 'shared', status: 'streaming', content: 'tab two', thinking: '', seq: 1, model: 'm', updatedAt: 100 }
        });
        deps.liveStreamStates.set('r1', { requestId: 'r1', tabId: 1, sessionId: 'shared', status: 'streaming', content: 'tab one', thinking: '', seq: 1, model: 'm' });
        deps.liveStreamStates.set('r2', { requestId: 'r2', tabId: 2, sessionId: 'shared', status: 'streaming', content: 'tab two', thinking: '', seq: 1, model: 'm' });
        const handlers = loadBackgroundHandlers(deps);

        await deps.tabState.update(2, { sessionId: 'shared' });
        const state = await handlers.readTabStartupStateForSender({ tab: { id: 2 } });

        expect(state.request).toMatchObject({ requestId: 'r2', content: 'tab two' });
        expect(state.request.content).not.toBe('tab one');
    });

    it('skips the request snapshot when the latest request belongs to another session', async () => {
        const { deps } = createHandlerDeps({
            'laiStreamRequest:r1': { requestId: 'r1', tabId: 7, sessionId: 'other-session', status: 'streaming', content: 'x', thinking: '', seq: 1, model: 'm', updatedAt: 100 }
        });
        const handlers = loadBackgroundHandlers(deps);

        await deps.tabState.update(7, { sessionId: 's1' });
        const state = await handlers.readTabStartupStateForSender({ tab: { id: 7 } });

        expect(state.request).toBeNull();
    });

    it('returns an empty startup state for a tab without a binding', async () => {
        const { deps } = createHandlerDeps();
        const handlers = loadBackgroundHandlers(deps);

        const state = await handlers.readTabStartupStateForSender({ tab: { id: 7 } });

        expect(state.tab).toBeNull();
        expect(state.request).toBeNull();
    });

    it('removes request state only when the stored request belongs to the sender tab', async () => {
        const { deps, entries } = createHandlerDeps({
            'laiStreamRequest:r1': { requestId: 'r1', tabId: 1, sessionId: 's1', status: 'complete', updatedAt: 100 }
        });
        const handlers = loadBackgroundHandlers(deps);

        await handlers.removeStreamRequestStateForSender({ requestId: 'r1' }, { tab: { id: 2 } });
        expect(entries['laiStreamRequest:r1']).toBeDefined();

        await handlers.removeStreamRequestStateForSender({ requestId: 'r1' }, { tab: { id: 1 } });
        expect(entries['laiStreamRequest:r1']).toBeUndefined();
    });
});

describe('background context never reports tab bindings (#40, #29)', () => {
    it('loads sessions.js without a window and sends no updateTabState message', async () => {
        const sendMessage = vi.fn(async () => undefined);
        const chrome = {
            runtime: { sendMessage, getManifest: () => ({ name: 'Local AI helper' }) },
            storage: {
                local: createStorage({}),
                session: createStorage({})
            }
        };
        const loadSessions = new Function('chrome', 'manifest', 'getLineNumber', 'allSessionsStorageKey', 'activeSessionIdKey', 'storageUserCommandsKey', 'storageOptionKey', 'activePageStorageKey', 'aiUserCommands', 'crypto',
            `${sessionsCode}; return { createNewSession, getSessionForRequest, deleteSessionById, getOrCreateActiveSessionId };`);
        const sessions = loadSessions(chrome, { name: 'Local AI helper' }, () => 'test',
            'LAI_SESSIONS', 'LAI_ACTIVE_SESSION_ID', 'LAI_USER_COMMANDS', 'LAI_OPTIONS', 'LAI_ACTIVE_PAGE', [], global.crypto);

        await sessions.createNewSession('background made session');
        await sessions.getSessionForRequest('requested-session');
        await sessions.deleteSessionById('requested-session');

        for (const call of sendMessage.mock.calls) {
            expect(call[0]).not.toMatchObject({ action: 'updateTabState' });
        }
        expect(sendMessage.mock.calls.filter(call => call[0]?.action === 'updateTabState')).toHaveLength(0);
    });
});

describe('tab state follow-ups (#40 review)', () => {
    it('refuses to remove the stored state of a request that is still live', async () => {
        const { deps, entries } = createHandlerDeps({
            'laiStreamRequest:r1': { requestId: 'r1', tabId: 1, sessionId: 's1', status: 'streaming', content: 'x', thinking: '', seq: 1, model: 'm', updatedAt: 1 }
        });
        deps.liveStreamStates.set('r1', { requestId: 'r1' });
        const handlers = loadBackgroundHandlers(deps);

        await handlers.removeStreamRequestStateForSender({ requestId: 'r1' }, { tab: { id: 1 } });

        expect(entries['laiStreamRequest:r1']).toBeDefined();
        expect(deps.streamRequestState.remove).not.toHaveBeenCalled();
    });

    it('keeps two tabs apart when both read their startup state concurrently', async () => {
        const { deps } = createHandlerDeps({
            'laiStreamRequest:r1': { requestId: 'r1', tabId: 1, sessionId: 's1', status: 'complete', content: 'one', thinking: '', seq: 2, model: 'm', updatedAt: 5 },
            'laiStreamRequest:r2': { requestId: 'r2', tabId: 2, sessionId: 's2', status: 'aborted', content: 'two', thinking: '', seq: 4, model: 'm', updatedAt: 6 }
        });
        const handlers = loadBackgroundHandlers(deps);
        await Promise.all([
            handlers.updateTabBindingForSender({ sessionId: 's1', panelOpen: true }, { tab: { id: 1 } }),
            handlers.updateTabBindingForSender({ sessionId: 's2', panelOpen: false }, { tab: { id: 2 } })
        ]);

        const [first, second, third] = await Promise.all([
            handlers.readTabStartupStateForSender({ tab: { id: 1 } }),
            handlers.readTabStartupStateForSender({ tab: { id: 2 } }),
            handlers.readTabStartupStateForSender({ tab: { id: 3 } })
        ]);

        expect(first).toMatchObject({ tab: { tabId: 1, sessionId: 's1', panelOpen: true }, request: { requestId: 'r1', content: 'one' } });
        expect(second).toMatchObject({ tab: { tabId: 2, sessionId: 's2', panelOpen: false }, request: { requestId: 'r2', content: 'two' } });
        expect(third).toEqual({ tab: null, request: null });
    });

    it('sends nothing from the background context, where chrome.tabs exists', async () => {
        const sendMessage = vi.fn(async () => undefined);
        const { reportTabBinding } = loadTabStateModule({ runtime: { sendMessage }, tabs: { query: vi.fn() } });

        await reportTabBinding({ sessionId: 's1' });

        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('sends the update from a content script, where chrome.tabs is absent', async () => {
        const sendMessage = vi.fn(async () => undefined);
        const { reportTabBinding } = loadTabStateModule({ runtime: { sendMessage } });

        await reportTabBinding({ sessionId: 's1' });

        expect(sendMessage).toHaveBeenCalledWith({ action: 'updateTabState', sessionId: 's1' });
    });

    describe('session identity changes report the binding from sessions.js', () => {
        const loadSessionsWithReporter = (reportTabBinding) => {
            const chrome = {
                runtime: { sendMessage: vi.fn(async () => undefined) },
                storage: { local: createStorage({}), session: createStorage({}) }
            };
            return new Function('chrome', 'manifest', 'getLineNumber', 'allSessionsStorageKey', 'activeSessionIdKey', 'storageUserCommandsKey', 'storageOptionKey', 'activePageStorageKey', 'aiUserCommands', 'crypto', 'reportTabBinding',
                `${sessionsCode}; return { createNewSession, getSession, setActiveSessionId, deleteActiveSessionId, getOrCreateActiveSessionId, getActiveSessionId };`
            )(chrome, { name: 'Local AI helper' }, () => 'test', 'LAI_SESSIONS', 'LAI_ACTIVE_SESSION_ID', 'LAI_USER_COMMANDS', 'LAI_OPTIONS', 'LAI_ACTIVE_PAGE', [], global.crypto, reportTabBinding);
        };

        it('reports a new id once and not again while it is unchanged', async () => {
            const report = vi.fn(async () => undefined);
            const sessions = loadSessionsWithReporter(report);

            const sessionId = await sessions.getOrCreateActiveSessionId();
            await sessions.setActiveSessionId(sessionId);
            await sessions.getOrCreateActiveSessionId();

            expect(report.mock.calls).toEqual([[{ sessionId }]]);
        });

        it('reports sessions created implicitly by createNewSession and getSession', async () => {
            const report = vi.fn(async () => undefined);
            const sessions = loadSessionsWithReporter(report);

            const created = await sessions.createNewSession('Attachment Session');
            await sessions.deleteActiveSessionId();
            const implicit = await sessions.getSession();

            expect(report.mock.calls).toEqual([
                [{ sessionId: created.id }],
                [{ sessionId: null }],
                [{ sessionId: implicit.id }]
            ]);
        });

        it('reports null once when the active session is dropped and stays silent when there was none', async () => {
            const report = vi.fn(async () => undefined);
            const sessions = loadSessionsWithReporter(report);

            await sessions.deleteActiveSessionId();
            expect(report).not.toHaveBeenCalled();

            await sessions.setActiveSessionId('s1');
            await sessions.deleteActiveSessionId();
            await sessions.deleteActiveSessionId();

            expect(report.mock.calls).toEqual([[{ sessionId: 's1' }], [{ sessionId: null }]]);
        });
    });
});

describe('tab-state wiring (#40)', () => {
    const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf-8'));

    it('lists tab-state.js in every background and content script list', () => {
        expect(backgroundCode).toMatch(/importBackgroundScript\('jslib\/tab-state\.js'\)/);

        const firefox = readJson('Firefox/manifest.json');
        expect(firefox.background.scripts).toContain('jslib/tab-state.js');
        expect(firefox.content_scripts[0].js).toContain('jslib/tab-state.js');

        for (const manifest of ['src/manifest.json', 'Chrome/manifest.json']) {
            expect(readJson(manifest).content_scripts[0].js).toContain('jslib/tab-state.js');
        }
    });

    it('does not instantiate the store or the live-request registry at module scope', () => {
        expect(tabStateCode).not.toMatch(/new TabStateStore\(/);
        expect(tabStateCode).not.toMatch(/liveStreamStates/);
        expect(backgroundCode).toMatch(/const tabState = new TabStateStore\(\)/);
    });
});

describe('TabStateStore.listBySession (#62)', () => {
    it('selects matching bindings only within the binding namespace', async () => {
        const { TabStateStore } = loadTabStateModule({});
        const storage = createStorage({
            'laiTabState:1': { tabId: 1, sessionId: 's1' },
            'laiTabState:2': { tabId: 2, sessionId: 's2' },
            'laiTabState:3': { tabId: 3, sessionId: null },
            'laiTabState:4': null,
            'unrelated:5': { tabId: 5, sessionId: 's1' }
        });
        const store = new TabStateStore({ storage });
        expect(await store.listBySession('s1')).toEqual([{ tabId: 1, sessionId: 's1' }]);
        expect(await store.listBySession(' s1')).toEqual([]);
    });

    it.each(['', ' ', null, undefined, 1, {}, []])('rejects invalid session %j', async sessionId => {
        const { TabStateStore } = loadTabStateModule({});
        const storage = createStorage();
        expect(await new TabStateStore({ storage }).listBySession(sessionId)).toEqual([]);
        expect(storage.get).not.toHaveBeenCalled();
    });

    it('returns an empty list and warns on storage failure', async () => {
        const { TabStateStore } = loadTabStateModule({});
        const failure = new Error('Storage unavailable');
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const storage = { get: vi.fn().mockRejectedValue(failure) };
            expect(await new TabStateStore({ storage }).listBySession('s1')).toEqual([]);
            expect(warning).toHaveBeenCalledWith('>>> Failed to read tab state', failure);
            expect(await new TabStateStore({ storage: null }).listBySession('s1')).toEqual([]);
        } finally {
            warning.mockRestore();
        }
    });
});

describe('open-session report (#63)', () => {
    function setup() {
        const storage = createStorage({
            'laiTabState:1': { tabId: 1, sessionId: 'shared', panelOpen: true },
            'laiTabState:2': { tabId: 2, sessionId: 'shared', panelOpen: false },
            'laiTabState:3': { tabId: 3, sessionId: 'other' },
            'laiTabState:4': { tabId: 4, sessionId: 'closed' },
            'laiTabState:5': { tabId: 5, sessionId: null },
            'laiTabState:6': { tabId: 6, sessionId: ' ' },
            'laiTabState:7': { tabId: 7, sessionId: 123 },
            'laiTabState:8': null,
            'laiTabState:9': { sessionId: 'malformed' },
            'unrelated:10': { tabId: 10, sessionId: 'unrelated' }
        });
        const { TabStateStore } = loadTabStateModule({});
        const tabState = new TabStateStore({ storage });
        const tabs = { get: vi.fn(async id => {
            if (id === 4) { throw new Error('Closed'); }
            return { id, title: 'Private title', url: 'https://private.example/' };
        }) };
        const handle = new Function('tabState', 'chrome', `${extractFunction('getOpenSessionsForSender')}\n${extractFunction('handleRuntimeMessage')}; return handleRuntimeMessage;`)(tabState, { tabs });
        return { storage, tabState, tabs, handle };
    }

    it('lists only valid session bindings in the binding namespace', async () => {
        const { tabState } = setup();
        expect((await tabState.listAll()).map(binding => binding.tabId)).toEqual([1, 2, 3, 4]);
    });

    it('returns unique sessions in existing tabs and identifies only the sender tab', async () => {
        const { handle, tabs, storage } = setup();
        expect(await handle({ action: 'getOpenSessions', tabId: 3 }, { tab: { id: 1 } })).toEqual({
            openSessionIds: ['shared', 'other'], ownSessionId: 'shared'
        });
        expect(tabs.get.mock.calls).toEqual([[1], [2], [3], [4]]);
        expect(storage.remove).not.toHaveBeenCalled();
    });

    it('drops a closed tab session on the next report', async () => {
        const { handle, tabs } = setup();
        await handle({ action: 'getOpenSessions' }, { tab: { id: 3 } });
        tabs.get.mockImplementation(async id => {
            if (id === 3 || id === 4) { throw new Error('Closed'); }
            return { id };
        });
        expect(await handle({ action: 'getOpenSessions' }, { tab: { id: 3 } })).toEqual({
            openSessionIds: ['shared'], ownSessionId: null
        });
    });

    it.each([{}, { tab: { id: 99 } }, { tab: { id: 5 } }])('returns no own session for sender %j', async sender => {
        const { handle } = setup();
        expect(await handle({ action: 'getOpenSessions', tabId: 1 }, sender)).toEqual({
            openSessionIds: ['shared', 'other'], ownSessionId: null
        });
    });

    it('returns an empty report on storage failure', async () => {
        const { storage, handle, tabs } = setup();
        storage.get.mockRejectedValue(new Error('Unavailable'));
        expect(await handle({ action: 'getOpenSessions' }, { tab: { id: 1 } })).toEqual({
            openSessionIds: [], ownSessionId: null
        });
        expect(tabs.get).not.toHaveBeenCalled();
        const { TabStateStore } = loadTabStateModule({});
        expect(await new TabStateStore({ storage: null }).listAll()).toEqual([]);
    });

    it('requests the report without supplying a tab identity', async () => {
        const reply = { openSessionIds: ['s1'], ownSessionId: 's1' };
        const sendMessage = vi.fn(async () => reply);
        const { fetchOpenSessions } = loadTabStateModule({ runtime: { sendMessage } });
        expect(await fetchOpenSessions()).toEqual(reply);
        expect(sendMessage).toHaveBeenCalledWith({ action: 'getOpenSessions' });
    });

    it.each(['reject', 'lastError', 'no-reply'])('returns an empty report for messaging failure %s', async failure => {
        const runtime = { sendMessage: vi.fn(async () => undefined) };
        if (failure === 'reject') { runtime.sendMessage.mockRejectedValue(new Error('Unavailable')); }
        if (failure === 'lastError') { runtime.lastError = { message: 'Unavailable' }; }
        const { fetchOpenSessions } = loadTabStateModule({ runtime });
        expect(await fetchOpenSessions()).toEqual({ openSessionIds: [], ownSessionId: null });
    });
});
