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

const requestHelpersCode = ['registerRequestController', 'unregisterRequestController', 'throwIfRequestCancelled', 'sendStreamAbort']
    .map(name => backgroundCode.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}\\n`))[0])
    .join('\n');

// The background script relies on globals; `with` scopes the stubs for the extracted code only.
const loadFetchDataAction = new Function('deps', `with (deps) { ${requestHelpersCode}\n${fetchDataActionCode}; return fetchDataAction; }`);
const registerOnRemoved = new Function('deps', `with (deps) { ${onRemovedListenerCode} }`);

const toolCall = (url) => ({ function: { name: 'browse_url', arguments: { url } } });

function createDeps(bodies) {
    const sessions = [];
    let deps;
    deps = {
        controllers: new Map(),
        originRequestControllers: new Map(),
        manifest: { name: 'Local AI helper' },
        getLineNumber: () => 'test',
        openTabs: new Set([1, 2]),
        chrome: {
            tabs: {
                sendMessage: vi.fn(async () => undefined),
                get: vi.fn(async (tabId) => {
                    if (!deps.openTabs.has(tabId)) { throw new Error(`No tab with id: ${tabId}.`); }
                    return { id: tabId };
                })
            }
        },
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

        deps.openTabs.delete(1);
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

        deps.openTabs.delete(1);
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

    it('stops an older request that is still in setup when the shared origin tab closes', async () => {
        const { deps, sessions } = createDeps([]);
        let releaseOlderSetup;
        deps.getActiveSession
            .mockImplementationOnce(() => new Promise(resolve => {
                releaseOlderSetup = () => resolve({ id: 'session-1', messages: [], titleGenerated: true });
            }))
            .mockImplementation(async () => ({ id: 'session-1', messages: [], titleGenerated: true }));
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
        await vi.waitFor(() => expect(releaseOlderSetup).toBeTypeOf('function'));
        const newer = fetchDataAction(request(), sender);
        await vi.waitFor(() => expect(deps.resolveToolCalls).toHaveBeenCalledTimes(1));
        expect(deps.originRequestControllers.get(1).size).toBe(2);

        deps.openTabs.delete(1);
        await onRemoved(1);
        releaseOlderSetup();
        await Promise.all([older, newer]);

        expect(deps.createNavigationSession).toHaveBeenCalledTimes(1);
        expect(deps.resolveToolCalls).toHaveBeenCalledTimes(1);
        expect(deps.fetch).toHaveBeenCalledTimes(1);
        expect(sessions[0].signal.aborted).toBe(true);
        expect(deps.disposeNavigationSession).toHaveBeenCalledWith(sessions[0]);
        expect(deps.originRequestControllers.has(1)).toBe(false);
        expect(deps.controllers.has(1)).toBe(false);
    });

    it('releases its controller when setup fails before the tool loop', async () => {
        const { deps } = createDeps([]);
        deps.getActiveSession.mockRejectedValueOnce(new Error('storage unavailable'));
        const fetchDataAction = loadFetchDataAction(deps);

        await expect(fetchDataAction(request(), sender)).rejects.toThrow('storage unavailable');

        expect(deps.createNavigationSession).not.toHaveBeenCalled();
        expect(deps.disposeNavigationSession).not.toHaveBeenCalled();
        expect(deps.originRequestControllers.has(1)).toBe(false);
        expect(deps.controllers.has(1)).toBe(false);
    });

    describe('cancellation during setup', () => {
        const deferred = () => {
            let release;
            const promise = new Promise(resolve => { release = resolve; });
            return { promise, release };
        };

        const closeOrigin = async (deps) => {
            let onRemoved;
            deps.chrome.tabs.onRemoved = { addListener: (fn) => { onRemoved = fn; } };
            deps.chrome.tabs.query = vi.fn(async () => []);
            deps.chrome.storage = { local: { get: vi.fn(async () => ({})), remove: vi.fn() } };
            registerOnRemoved(deps);
            deps.openTabs.delete(1);
            await onRemoved(1);
        };

        const expectNothingAfterClose = (deps, result) => {
            expect(result.status).toBe('aborted');
            expect(deps.setActiveSession).not.toHaveBeenCalled();
            expect(deps.fetch).not.toHaveBeenCalled();
            expect(deps.createNavigationSession).not.toHaveBeenCalled();
            expect(deps.backgroundMemory.storeTurnWithEmbeddings).not.toHaveBeenCalled();
            expect(deps.originRequestControllers.size).toBe(0);
            expect(deps.controllers.size).toBe(0);
        };

        it.each([
            ['getLaiOptions'],
            ['getPromptTools'],
            ['getAiUrl']
        ])('stops when the origin closes while %s is pending', async (step) => {
            const { deps } = createDeps([]);
            const gate = deferred();
            deps[step].mockImplementationOnce(async () => {
                await gate.promise;
                return step === 'getAiUrl' ? 'http://localhost:11434/api/chat' : step === 'getPromptTools' ? [] : { toolFunc: '' };
            });
            const fetchDataAction = loadFetchDataAction(deps);
            const req = request();
            if (step === 'getAiUrl') { delete req.url; }

            const pending = fetchDataAction(req, sender);
            await vi.waitFor(() => expect(deps[step]).toHaveBeenCalled());
            expect(deps.originRequestControllers.get(1).size).toBe(1);
            await closeOrigin(deps);
            gate.release();

            expectNothingAfterClose(deps, await pending);
        });

        it.each([
            ['getActiveSession'],
            ['processCommandArguments'],
            ['buildOptimisedContext'],
            ['getContext']
        ])('does not write the session when the origin closes while %s is pending', async (step) => {
            const { deps } = createDeps([]);
            const gate = deferred();
            const target = step in deps.backgroundMemory ? deps.backgroundMemory : deps;
            const original = target[step].getMockImplementation();
            target[step].mockImplementationOnce(async (...args) => {
                await gate.promise;
                return original(...args);
            });
            const fetchDataAction = loadFetchDataAction(deps);

            const pending = fetchDataAction(request(), sender);
            await vi.waitFor(() => expect(target[step]).toHaveBeenCalled());
            await closeOrigin(deps);
            gate.release();

            expectNothingAfterClose(deps, await pending);
        });

        it('checks that a fallback tab is still open before any setup', async () => {
            const { deps } = createDeps([]);
            deps.validateAndGetTabId.mockResolvedValueOnce(7);
            const fetchDataAction = loadFetchDataAction(deps);

            const result = await fetchDataAction(request(), { tab: undefined });

            expect(result.status).toBe('aborted');
            expect(deps.getLaiOptions).not.toHaveBeenCalled();
            expect(deps.fetch).not.toHaveBeenCalled();
            expect(deps.originRequestControllers.size).toBe(0);
        });

        it('does not start a tool call when the origin closes while the model response is being read', async () => {
            const gate = deferred();
            const { deps } = createDeps([]);
            deps.consumeStreamResponse.mockImplementationOnce(async () => {
                await gate.promise;
                return { responseText: '', body: { message: { role: 'assistant', content: '', tool_calls: [toolCall('https://a.example/')] } } };
            });
            const fetchDataAction = loadFetchDataAction(deps);

            const pending = fetchDataAction(request(), sender);
            await vi.waitFor(() => expect(deps.consumeStreamResponse).toHaveBeenCalled());
            await closeOrigin(deps);
            gate.release();
            await pending;

            expect(deps.resolveToolCalls).not.toHaveBeenCalled();
            expect(deps.originRequestControllers.size).toBe(0);
        });

        it('does not start the next tool when the origin closes while the previous tool result is being stored', async () => {
            const gate = deferred();
            const { deps } = createDeps([
                { message: { role: 'assistant', content: '', tool_calls: [toolCall('https://a.example/'), toolCall('https://b.example/')] } }
            ]);
            deps.backgroundMemory.storeToolCallEmbedding.mockImplementationOnce(() => gate.promise);
            const fetchDataAction = loadFetchDataAction(deps);

            const pending = fetchDataAction(request(), sender);
            await vi.waitFor(() => expect(deps.backgroundMemory.storeToolCallEmbedding).toHaveBeenCalled());
            await closeOrigin(deps);
            gate.release();
            await pending;

            expect(deps.resolveToolCalls).toHaveBeenCalledTimes(1);
            expect(deps.fetch).toHaveBeenCalledTimes(1);
            expect(deps.originRequestControllers.size).toBe(0);
        });

        it('does not store the turn or generate a title when the origin closes while the final answer is being saved', async () => {
            const gate = deferred();
            const { deps } = createDeps([{ message: { role: 'assistant', content: 'Final answer' } }]);
            deps.getActiveSession.mockImplementation(async () => ({ id: 'session-1', messages: [] }));
            let writes = 0;
            deps.setActiveSession.mockImplementation(async () => {
                writes++;
                if (writes === 2) { await gate.promise; }
            });
            const fetchDataAction = loadFetchDataAction(deps);

            const pending = fetchDataAction(request(), sender);
            await vi.waitFor(() => expect(deps.setActiveSession).toHaveBeenCalledTimes(2));
            await closeOrigin(deps);
            gate.release();
            await pending;

            expect(deps.backgroundMemory.storeTurnWithEmbeddings).not.toHaveBeenCalled();
            expect(deps.generateAndUpdateSessionTitle).not.toHaveBeenCalled();
            expect(deps.handleStreamEnd).not.toHaveBeenCalled();
            expect(deps.originRequestControllers.size).toBe(0);
        });

        it('skips title generation but keeps the delivered answer when the origin closes after delivery', async () => {
            const { deps } = createDeps([{ message: { role: 'assistant', content: 'Final answer' } }]);
            deps.getActiveSession.mockImplementation(async () => ({ id: 'session-1', messages: [] }));
            deps.handleStreamEnd.mockImplementation(async () => { await closeOrigin(deps); });
            const fetchDataAction = loadFetchDataAction(deps);

            const result = await fetchDataAction(request(), sender);

            expect(result.status).toBe('success');
            expect(deps.backgroundMemory.storeTurnWithEmbeddings).toHaveBeenCalledTimes(1);
            expect(deps.generateAndUpdateSessionTitle).not.toHaveBeenCalled();
            expect(deps.chrome.tabs.sendMessage).not.toHaveBeenCalledWith(1, { action: 'streamAbort' });
        });

        it('does not persist tool results when the origin closes during a tool call', async () => {
            const { deps } = createDeps([
                { message: { role: 'assistant', content: '', tool_calls: [toolCall('https://a.example/')] } }
            ]);
            const gate = deferred();
            deps.resolveToolCalls.mockImplementationOnce(async () => {
                await gate.promise;
                return 'tool result';
            });
            const fetchDataAction = loadFetchDataAction(deps);

            const pending = fetchDataAction(request(), sender);
            await vi.waitFor(() => expect(deps.resolveToolCalls).toHaveBeenCalled());
            const writesBefore = deps.setActiveSession.mock.calls.length;
            await closeOrigin(deps);
            gate.release();
            await pending;

            expect(deps.setActiveSession.mock.calls.length).toBe(writesBefore);
            expect(deps.backgroundMemory.storeToolCallEmbedding).not.toHaveBeenCalled();
            expect(deps.fetch).toHaveBeenCalledTimes(1);
            expect(deps.disposeNavigationSession).toHaveBeenCalledTimes(1);
            expect(deps.originRequestControllers.size).toBe(0);
        });
    });
});
