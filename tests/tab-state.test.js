import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const tabStateCode = fs.readFileSync(path.join(root, 'src/jslib/tab-state.js'), 'utf-8');
const backgroundCode = fs.readFileSync(path.join(root, 'src/background.js'), 'utf-8');
const sessionsCode = fs.readFileSync(path.join(root, 'src/jslib/sessions.js'), 'utf-8');

const loadTabStateModule = new Function('chrome', `${tabStateCode}; return { TabStateStore, reportTabBinding, fetchTabStartupState, acknowledgeTabRequestSnapshot };`);

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
