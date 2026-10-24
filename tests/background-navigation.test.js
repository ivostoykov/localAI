import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backgroundCode = fs.readFileSync(
    path.join(__dirname, '../src/background.js'),
    'utf-8'
);

const fetchDataActionCode = backgroundCode.match(/async function fetchDataAction\([\s\S]*?\n}\n/)[0];
const onRemovedListenerCode = backgroundCode.match(/chrome\.tabs\.onRemoved\.addListener\(async \(tabId\) => \{[\s\S]*?\n\}\);\n/)[0];

// The background script relies on globals; `with` scopes the stubs for the extracted code only.
const loadFetchDataAction = new Function('deps', `with (deps) { ${fetchDataActionCode}; return fetchDataAction; }`);
const registerOnRemoved = new Function('deps', `with (deps) { ${onRemovedListenerCode} }`);

const toolCall = (url) => ({ function: { name: 'browse_url', arguments: { url } } });

function createDeps(bodies) {
    const sessions = [];
    const deps = {
        controllers: new Map(),
        originRequestControllers: new Map(),
        manifest: { name: 'Local AI helper' },
        getLineNumber: () => 'test',
        chrome: { tabs: { sendMessage: vi.fn(async () => undefined) } },
        getLaiOptions: vi.fn(async () => ({ toolFunc: '', debug: false })),
        getPromptTools: vi.fn(async () => [{ type: 'function', function: { name: 'browse_url' } }]),
        getAiUrl: vi.fn(async () => 'http://localhost:11434/api/chat'),
        showUIMessage: vi.fn(),
        validateAndGetTabId: vi.fn(async () => null),
        getAiModel: vi.fn(async () => 'model'),
        resolveModelNameForRequest: vi.fn(async (model) => model),
        applyAutomaticModelOptions: vi.fn(async (data) => data),
        getActiveSession: vi.fn(async () => ({ id: 'session-1', messages: [], titleGenerated: true })),
        processCommandArguments: vi.fn(async () => ({ pageContent: null, pageHash: null })),
        replaceCommandPlaceholders: (text) => text,
        backgroundMemory: {
            buildOptimisedContext: vi.fn(async () => [{ role: 'user', content: 'hi' }]),
            getContext: vi.fn(async () => ({})),
            storeToolCallEmbedding: vi.fn(async () => undefined),
            storeTurnWithEmbeddings: vi.fn(async () => undefined)
        },
        getVisibleSessionMessages: (messages) => messages,
        setActiveSession: vi.fn(async () => undefined),
        modelCanUseTools: vi.fn(async () => true),
        dumpInFrontConsole: vi.fn(async () => undefined),
        fetch: vi.fn(async () => ({ ok: true, status: 200 })),
        consumeStreamResponse: vi.fn(async () => {
            const next = bodies.shift();
            if (next instanceof Error) { throw next; }
            return { responseText: JSON.stringify(next), body: next };
        }),
        resolveToolCalls: vi.fn(async () => 'tool result'),
        updateUIStatusBar: vi.fn(async () => undefined),
        checkResponseTextAndBody: vi.fn(async () => undefined),
        sanitizeAssistantMessageForHistory: (message) => message,
        handleStreamEnd: vi.fn(async () => undefined),
        handleResponse: vi.fn(async () => undefined),
        generateAndUpdateSessionTitle: vi.fn(async () => undefined),
        createNavigationSession: vi.fn((originTabId, signal) => {
            const session = { id: `nav-${sessions.length + 1}`, originTabId, signal, disposed: false };
            sessions.push(session);
            return session;
        }),
        disposeNavigationSession: vi.fn(async (session) => { session.disposed = true; }),
        handleNavigationTabRemoved: vi.fn(async () => undefined),
        removeActiveSessionPageData: vi.fn(async () => undefined),
        activePageStorageKey: 'LAI_ACTIVE_PAGE'
    };
    return { deps, sessions };
}

const request = () => ({ action: 'fetchData', url: 'http://localhost:11434/api/chat', tools: true, data: { userInput: 'Read these links' } });
const sender = { tab: { id: 1, url: 'https://origin.example/' } };

describe('background.js navigation lifecycle', () => {
    let bodies;

    beforeEach(() => {
        bodies = [
            { message: { role: 'assistant', content: '', tool_calls: [toolCall('https://a.example/'), toolCall('https://b.example/')] } },
            { message: { role: 'assistant', content: '', tool_calls: [toolCall('https://c.example/')] } },
            { message: { role: 'assistant', content: 'Final answer' } }
        ];
    });

    it('uses one navigation session for the whole tool loop and disposes it after the final response', async () => {
        const { deps, sessions } = createDeps(bodies);
        deps.handleStreamEnd.mockImplementation(async () => {
            expect(sessions[0].disposed).toBe(false);
        });
        const fetchDataAction = loadFetchDataAction(deps);

        const result = await fetchDataAction(request(), sender);

        expect(result.status).toBe('success');
        expect(deps.createNavigationSession).toHaveBeenCalledTimes(1);
        expect(deps.createNavigationSession).toHaveBeenCalledWith(1, expect.any(Object));
        expect(deps.resolveToolCalls).toHaveBeenCalledTimes(3);
        for (const call of deps.resolveToolCalls.mock.calls) {
            expect(call[2]).toBe(sender.tab);
            expect(call[4]).toBe(sessions[0]);
        }
        expect(deps.disposeNavigationSession).toHaveBeenCalledTimes(1);
        expect(deps.disposeNavigationSession).toHaveBeenCalledWith(sessions[0]);
        expect(sessions[0].disposed).toBe(true);
    });

    it('feeds tool results back into the same conversation without synthetic user turns', async () => {
        const { deps } = createDeps(bodies);
        const sentBodies = [];
        deps.fetch.mockImplementation(async (url, options) => {
            sentBodies.push(JSON.parse(options.body));
            return { ok: true, status: 200 };
        });
        const fetchDataAction = loadFetchDataAction(deps);

        await fetchDataAction(request(), sender);

        const lastMessages = sentBodies[2].messages;
        expect(lastMessages.filter(m => m.role === 'user')).toHaveLength(1);
        expect(lastMessages.filter(m => m.role === 'tool').map(m => m.tool_name)).toEqual(['browse_url', 'browse_url', 'browse_url']);
    });

    it('disposes the navigation session when the loop fails', async () => {
        bodies.splice(1, 2, new Error('model failed'));
        const { deps, sessions } = createDeps(bodies);
        const fetchDataAction = loadFetchDataAction(deps);

        const result = await fetchDataAction(request(), sender);

        expect(result.status).toBe('error');
        expect(deps.disposeNavigationSession).toHaveBeenCalledWith(sessions[0]);
    });

    it('disposes the navigation session when the loop is cancelled during a tool call', async () => {
        const { deps, sessions } = createDeps(bodies);
        deps.resolveToolCalls.mockImplementationOnce(async () => {
            deps.controllers.get(1).abort('User aborted last request.');
            throw new DOMException('The operation was aborted.', 'AbortError');
        });
        const fetchDataAction = loadFetchDataAction(deps);

        await fetchDataAction(request(), sender);

        expect(deps.chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { action: 'streamAbort' });
        expect(deps.disposeNavigationSession).toHaveBeenCalledWith(sessions[0]);
        expect(sessions[0].signal.aborted).toBe(true);
        expect(deps.controllers.has(1)).toBe(false);
    });

    it('does not remove a newer loop controller for the same tab when an older loop finishes', async () => {
        const { deps } = createDeps(bodies);
        const newer = new AbortController();
        deps.handleStreamEnd.mockImplementation(async () => {
            deps.controllers.set(1, newer);
        });
        const fetchDataAction = loadFetchDataAction(deps);

        await fetchDataAction(request(), sender);

        expect(deps.controllers.get(1)).toBe(newer);
    });

    it('aborts the loop and disposes its navigation when the originating tab closes', async () => {
        const { deps } = createDeps(bodies);
        let onRemoved;
        deps.chrome.tabs.onRemoved = { addListener: (fn) => { onRemoved = fn; } };
        deps.chrome.tabs.query = vi.fn(async () => []);
        deps.chrome.storage = { local: { get: vi.fn(async () => ({})), remove: vi.fn() } };
        registerOnRemoved(deps);
        const controller = new AbortController();
        const other = new AbortController();
        deps.controllers.set(1, controller);
        deps.controllers.set(2, other);

        await onRemoved(1);

        expect(controller.signal.aborted).toBe(true);
        expect(other.signal.aborted).toBe(false);
        expect(deps.controllers.has(1)).toBe(false);
        expect(deps.handleNavigationTabRemoved).toHaveBeenCalledWith(1);
    });

    it('aborts every concurrent loop from a closed origin tab and leaves other tabs running', async () => {
        const { deps, sessions } = createDeps([]);
        deps.consumeStreamResponse.mockImplementation(async () => ({
            responseText: '',
            body: { message: { role: 'assistant', content: '', tool_calls: [toolCall('https://a.example/')] } }
        }));
        deps.resolveToolCalls.mockImplementation((call, base, tab, sessionId, navigationSession) => new Promise((resolve, reject) => {
            const fail = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
            if (navigationSession.signal.aborted) { fail(); return; }
            navigationSession.signal.addEventListener('abort', fail, { once: true });
        }));
        let onRemoved;
        deps.chrome.tabs.onRemoved = { addListener: (fn) => { onRemoved = fn; } };
        deps.chrome.tabs.query = vi.fn(async () => []);
        deps.chrome.storage = { local: { get: vi.fn(async () => ({})), remove: vi.fn() } };
        registerOnRemoved(deps);
        const fetchDataAction = loadFetchDataAction(deps);

        const older = fetchDataAction(request(), sender);
        const newer = fetchDataAction(request(), sender);
        const other = fetchDataAction(request(), { tab: { id: 2, url: 'https://other.example/' } });
        await vi.waitFor(() => expect(deps.resolveToolCalls).toHaveBeenCalledTimes(3));
        expect(deps.originRequestControllers.get(1).size).toBe(2);

        await onRemoved(1);
        await Promise.all([older, newer]);

        const [olderSession, newerSession, otherSession] = sessions;
        expect(olderSession.signal.aborted).toBe(true);
        expect(newerSession.signal.aborted).toBe(true);
        expect(otherSession.signal.aborted).toBe(false);
        expect(deps.disposeNavigationSession).toHaveBeenCalledWith(olderSession);
        expect(deps.disposeNavigationSession).toHaveBeenCalledWith(newerSession);
        expect(deps.disposeNavigationSession).not.toHaveBeenCalledWith(otherSession);
        expect(deps.originRequestControllers.has(1)).toBe(false);
        expect(deps.controllers.has(1)).toBe(false);
        expect(deps.originRequestControllers.get(2).size).toBe(1);

        deps.controllers.get(2).abort('test cleanup');
        await other;
        expect(deps.originRequestControllers.has(2)).toBe(false);
    });

    it('an older loop finishing keeps the newer loop of the same tab registered and abortable', async () => {
        const { deps, sessions } = createDeps([]);
        let releaseOlder;
        deps.consumeStreamResponse
            .mockImplementationOnce(() => new Promise(resolve => { releaseOlder = () => resolve({ responseText: '', body: { message: { role: 'assistant', content: 'Older answer' } } }); }))
            .mockImplementationOnce(async () => ({ responseText: '', body: { message: { role: 'assistant', content: '', tool_calls: [toolCall('https://b.example/')] } } }));
        deps.resolveToolCalls.mockImplementation((call, base, tab, sessionId, navigationSession) => new Promise((resolve, reject) => {
            navigationSession.signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true });
        }));
        const fetchDataAction = loadFetchDataAction(deps);

        const older = fetchDataAction(request(), sender);
        await vi.waitFor(() => expect(releaseOlder).toBeTypeOf('function'));
        const newer = fetchDataAction(request(), sender);
        await vi.waitFor(() => expect(deps.resolveToolCalls).toHaveBeenCalledTimes(1));
        releaseOlder();
        await older;

        expect(deps.controllers.get(1)).toBe([...deps.originRequestControllers.get(1)][0]);
        expect(deps.originRequestControllers.get(1).size).toBe(1);

        deps.controllers.get(1).abort('User aborted last request.');
        await newer;
        expect(sessions[1].signal.aborted).toBe(true);
        expect(deps.originRequestControllers.has(1)).toBe(false);
    });
});
