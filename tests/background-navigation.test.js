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

const requestHelpersCode = ['registerRequestController', 'unregisterRequestController', 'throwIfRequestCancelled', 'sendStreamAbort', 'createStreamRequestId', 'sendStreamError', 'wasTerminalMessageDelivered']
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
        streamRequestState: {
            sweepExpired: vi.fn(async () => undefined),
            checkpoint: vi.fn(async () => true),
            remove: vi.fn(async () => undefined),
            removeForTab: vi.fn(async () => undefined)
        },
        manifest: { name: 'Local AI helper' },
        getLineNumber: () => 'test',
        openTabs: new Set([1, 2]),
        chrome: {
            runtime: {},
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
        getSessionForRequest: vi.fn(async (sessionId) => sessionId ? ({ id: sessionId, messages: [], titleGenerated: true }) : null),
        missingSessionMessage: 'No chat session was identified for this request. Please reload the page and try again.',
        processCommandArguments: vi.fn(async () => ({ pageContent: null, pageHash: null })),
        replaceCommandPlaceholders: (text) => text,
        backgroundMemory: {
            buildOptimisedContext: vi.fn(async () => [{ role: 'user', content: 'hi' }]),
            getContext: vi.fn(async () => ({})),
            storeToolCallEmbedding: vi.fn(async () => undefined),
            storeTurnWithEmbeddings: vi.fn(async () => undefined)
        },
        getVisibleSessionMessages: (messages) => messages,
        saveSession: vi.fn(async () => true),
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

const request = () => ({ action: 'fetchData', url: 'http://localhost:11434/api/chat', tools: true, data: { userInput: 'Read these links' }, sessionId: 'session-1' });
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

    it('checkpoints a completed request after receiver loss and saves the assistant once', async () => {
        const { deps } = createDeps([{ message: { role: 'assistant', content: 'Saved answer' } }]);
        deps.consumeStreamResponse.mockResolvedValueOnce({ responseText: '{}', body: { message: { role: 'assistant', content: 'Saved answer' } } });
        const result = await loadFetchDataAction(deps)({ ...request(), requestId: '11111111-1111-4111-8111-111111111111' }, sender);
        expect(result.status).toBe('success');
        expect(deps.saveSession).toHaveBeenCalledTimes(2);
        expect(deps.streamRequestState.checkpoint).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'complete' }), true);
        expect(deps.chrome.tabs.sendMessage).not.toHaveBeenCalledWith(1, expect.objectContaining({ action: 'streamError' }));
    });

    it('checkpoints aborted state after receiver loss', async () => {
        const { deps } = createDeps([]);
        deps.consumeStreamResponse.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
        const result = await loadFetchDataAction(deps)({ ...request(), requestId: '22222222-2222-4222-8222-222222222222' }, sender);
        expect(result.status).toBe('aborted');
        expect(deps.streamRequestState.checkpoint).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'aborted' }), true);
    });

    it('aborts and checkpoints state when the originating tab closes after receiver loss', async () => {
        const { deps } = createDeps([]);
        let onRemoved;
        deps.chrome.tabs.onRemoved = { addListener: fn => { onRemoved = fn; } };
        deps.chrome.tabs.query = vi.fn(async () => []);
        deps.chrome.storage = { local: { get: vi.fn(async () => ({})), remove: vi.fn() } };
        registerOnRemoved(deps);
        deps.consumeStreamResponse.mockImplementation((response, tabId, debug, signal) => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Originating tab closed.', 'AbortError')), { once: true });
        }));
        const pending = loadFetchDataAction(deps)({ ...request(), requestId: '77777777-7777-4777-8777-777777777777' }, sender);
        await vi.waitFor(() => expect(deps.consumeStreamResponse).toHaveBeenCalled());
        deps.openTabs.delete(1);
        await onRemoved(1);
        await expect(pending).resolves.toMatchObject({ status: 'aborted' });
        expect(deps.streamRequestState.checkpoint).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'aborted' }), true);
    });

    it('records genuine errors and sends a request-scoped stream error', async () => {
        const { deps } = createDeps([]);
        deps.consumeStreamResponse.mockRejectedValueOnce(new Error('model failed'));
        const result = await loadFetchDataAction(deps)({ ...request(), requestId: '33333333-3333-4333-8333-333333333333' }, sender);
        expect(result.status).toBe('error');
        expect(deps.streamRequestState.checkpoint).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error', error: 'model failed' }), true);
        expect(deps.chrome.tabs.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ action: 'streamError', requestId: '33333333-3333-4333-8333-333333333333' }));
    });

    it('removes terminal state only after a matching acknowledgement', async () => {
        const { deps } = createDeps([{ message: { role: 'assistant', content: 'Answer' } }]);
        deps.handleStreamEnd.mockResolvedValueOnce({ requestId: '44444444-4444-4444-8444-444444444444' });
        await loadFetchDataAction(deps)({ ...request(), requestId: '44444444-4444-4444-8444-444444444444' }, sender);
        expect(deps.streamRequestState.remove).toHaveBeenCalledWith('44444444-4444-4444-8444-444444444444');
    });

    it('retains terminal state for null, missing, and failed terminal acknowledgements', async () => {
        for (const acknowledgement of [{ requestId: null }, undefined]) {
            const { deps } = createDeps([{ message: { role: 'assistant', content: 'Answer' } }]);
            deps.handleStreamEnd.mockResolvedValueOnce(acknowledgement);
            await loadFetchDataAction(deps)({ ...request(), requestId: '55555555-5555-4555-8555-555555555555' }, sender);
            expect(deps.streamRequestState.remove).not.toHaveBeenCalled();
        }
    });

    it('removes setup-aborted state after a matching abort acknowledgement', async () => {
        const { deps } = createDeps([]);
        let resolveOptions;
        deps.getLaiOptions.mockImplementation(() => new Promise(resolve => { resolveOptions = resolve; }));
        deps.chrome.tabs.sendMessage.mockResolvedValue({ requestId: '66666666-6666-4666-8666-666666666666' });
        const pending = loadFetchDataAction(deps)({ ...request(), requestId: '66666666-6666-4666-8666-666666666666' }, sender);
        await vi.waitFor(() => expect(resolveOptions).toBeTypeOf('function'));
        deps.openTabs.delete(1);
        resolveOptions({ toolFunc: '', debug: false });
        await pending;
        expect(deps.streamRequestState.remove).toHaveBeenCalledWith('66666666-6666-4666-8666-666666666666');
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

        const result = await fetchDataAction(request(), sender);

        expect(result.status).toBe('aborted');
        expect(deps.chrome.tabs.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ action: 'streamAbort' }));
        expect(deps.chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
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
        deps.getSessionForRequest
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
        deps.getSessionForRequest.mockRejectedValueOnce(new Error('storage unavailable'));
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
            expect(deps.saveSession).not.toHaveBeenCalled();
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
            ['getSessionForRequest'],
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
            deps.getSessionForRequest.mockImplementation(async () => ({ id: 'session-1', messages: [] }));
            let writes = 0;
            deps.saveSession.mockImplementation(async () => {
                writes++;
                if (writes === 2) { await gate.promise; }
                return true;
            });
            const fetchDataAction = loadFetchDataAction(deps);

            const pending = fetchDataAction(request(), sender);
            await vi.waitFor(() => expect(deps.saveSession).toHaveBeenCalledTimes(2));
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
            deps.getSessionForRequest.mockImplementation(async () => ({ id: 'session-1', messages: [] }));
            deps.handleStreamEnd.mockImplementation(async () => { await closeOrigin(deps); });
            const fetchDataAction = loadFetchDataAction(deps);

            const result = await fetchDataAction(request(), sender);

            expect(result.status).toBe('success');
            expect(deps.backgroundMemory.storeTurnWithEmbeddings).toHaveBeenCalledTimes(1);
            expect(deps.generateAndUpdateSessionTitle).not.toHaveBeenCalled();
            expect(deps.chrome.tabs.sendMessage).not.toHaveBeenCalledWith(1, expect.objectContaining({ action: 'streamAbort' }));
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
            const writesBefore = deps.saveSession.mock.calls.length;
            await closeOrigin(deps);
            gate.release();
            await pending;

            expect(deps.saveSession.mock.calls.length).toBe(writesBefore);
            expect(deps.backgroundMemory.storeToolCallEmbedding).not.toHaveBeenCalled();
            expect(deps.fetch).toHaveBeenCalledTimes(1);
            expect(deps.disposeNavigationSession).toHaveBeenCalledTimes(1);
            expect(deps.originRequestControllers.size).toBe(0);
        });
    });

    describe('request session identity (#29)', () => {
        const plainBodies = () => [{ message: { role: 'assistant', content: 'Answer' } }];
        const deferred = () => {
            let release;
            const promise = new Promise(resolve => { release = resolve; });
            return { promise, release };
        };

        it('refuses a request without a session id instead of selecting another session', async () => {
            const { deps } = createDeps(plainBodies());
            const fetchDataAction = loadFetchDataAction(deps);
            const req = request();
            delete req.sessionId;

            const result = await fetchDataAction(req, sender);

            expect(result).toEqual({ status: 'error', message: deps.missingSessionMessage });
            expect(deps.showUIMessage).toHaveBeenCalledWith(deps.missingSessionMessage, 'error', sender.tab);
            expect(deps.backgroundMemory.buildOptimisedContext).not.toHaveBeenCalled();
            expect(deps.saveSession).not.toHaveBeenCalled();
            expect(deps.fetch).not.toHaveBeenCalled();
            expect(deps.originRequestControllers.size).toBe(0);
        });

        it('keeps concurrent requests from two tabs bound to their own sessions throughout', async () => {
            const { deps } = createDeps([]);
            deps.getSessionForRequest.mockImplementation(async (sessionId) => ({ id: sessionId, messages: [] }));
            const gate = deferred();
            deps.consumeStreamResponse
                .mockImplementationOnce(async () => { await gate.promise; return { responseText: '', body: { message: { role: 'assistant', content: '', tool_calls: [toolCall('https://a.example/')] } } }; })
                .mockImplementationOnce(async () => { await gate.promise; return { responseText: '', body: { message: { role: 'assistant', content: '', tool_calls: [toolCall('https://b.example/')] } } }; })
                .mockImplementation(async () => ({ responseText: '', body: { message: { role: 'assistant', content: 'Done' } } }));
            const fetchDataAction = loadFetchDataAction(deps);

            const tabA = fetchDataAction({ ...request(), sessionId: 'session-A' }, { tab: { id: 1, url: 'https://www.linkedin.com/jobs/' } });
            const tabB = fetchDataAction({ ...request(), sessionId: 'session-B' }, { tab: { id: 2, url: 'https://news.ycombinator.com/' } });
            await vi.waitFor(() => expect(deps.consumeStreamResponse).toHaveBeenCalledTimes(2));
            gate.release();
            await Promise.all([tabA, tabB]);

            const bySession = (calls, idx) => calls.map(call => call[idx]);
            expect(bySession(deps.backgroundMemory.buildOptimisedContext.mock.calls, 0).sort()).toEqual(['session-A', 'session-B']);
            for (const call of deps.backgroundMemory.buildOptimisedContext.mock.calls) {
                expect(call[8]).toBe(call[0] === 'session-A' ? 1 : 2);
            }
            for (const call of deps.resolveToolCalls.mock.calls) {
                expect(call[3]).toBe(call[2].id === 1 ? 'session-A' : 'session-B');
            }
            for (const call of deps.saveSession.mock.calls) {
                expect(['session-A', 'session-B']).toContain(call[0].id);
            }
            for (const call of deps.backgroundMemory.storeTurnWithEmbeddings.mock.calls) {
                expect(call[0]).toBe(call[1] === 1 ? 'session-A' : 'session-B');
            }
            for (const call of deps.generateAndUpdateSessionTitle.mock.calls) {
                expect(call[1]).toBe(call[2].id === 1 ? 'session-A' : 'session-B');
            }
            expect(deps.generateAndUpdateSessionTitle).toHaveBeenCalledTimes(2);
        });

        it('reads images and stored context of the request session only', async () => {
            const { deps } = createDeps(plainBodies());
            deps.getSessionForRequest.mockImplementation(async (sessionId) => ({ id: sessionId, messages: [], titleGenerated: true }));
            const fetchDataAction = loadFetchDataAction(deps);

            await fetchDataAction({ ...request(), sessionId: 'session-B' }, { tab: { id: 2, url: 'https://news.ycombinator.com/' } });

            expect(deps.backgroundMemory.getContext).toHaveBeenCalledWith('session-B');
            expect(deps.backgroundMemory.getContext.mock.calls.every(call => call[0] === 'session-B')).toBe(true);
        });
    });
});

describe('storeImageHandler session identity (#29)', () => {
    const storeImageHandlerCode = backgroundCode.match(/async function storeImageHandler\([\s\S]*?\n}\n/)[0];
    const loadStoreImageHandler = new Function('deps', `with (deps) { ${storeImageHandlerCode}; return storeImageHandler; }`);
    const createImageDeps = () => ({
        manifest: { name: 'Local AI helper' },
        getLineNumber: () => 'test',
        missingSessionMessage: 'No chat session was identified for this request. Please reload the page and try again.',
        getSessionForRequest: vi.fn(async (sessionId) => sessionId ? { id: sessionId, messages: [] } : null),
        sessionRepository: { storeImage: vi.fn(async () => undefined) }
    });

    it('stores the image under the session named by the request', async () => {
        const deps = createImageDeps();
        const storeImageHandler = loadStoreImageHandler(deps);

        const result = await storeImageHandler('aGVsbG8=', 'a.png', 'image/png', 'session-B');

        expect(result.status).toBe('success');
        expect(deps.sessionRepository.storeImage).toHaveBeenCalledWith('session-B', expect.objectContaining({ id: result.imageId, filename: 'a.png' }));
    });

    it('refuses an image without a session id instead of attaching it to another session', async () => {
        const deps = createImageDeps();
        const storeImageHandler = loadStoreImageHandler(deps);

        const result = await storeImageHandler('aGVsbG8=', 'a.png', 'image/png');

        expect(result).toEqual({ status: 'error', message: deps.missingSessionMessage });
        expect(deps.sessionRepository.storeImage).not.toHaveBeenCalled();
    });
});

describe('concurrent first prompts with real session storage (#29)', () => {
    const sessionsCode = fs.readFileSync(path.join(__dirname, '../src/jslib/sessions.js'), 'utf-8');
    const sessionsExports = 'getOrCreateActiveSessionId, getActiveSessionId, getSessionForRequest, saveSession, queueSessionMutation, getAllSessions, setAllSessions';
    // Models chrome.storage.local: values are structured clones and every call resolves on a later task,
    // so concurrent read-modify-write sequences interleave as they do in the extension.
    const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));
    const localStore = new Map();
    const latentStorageChrome = {
        ...global.chrome,
        storage: {
            ...global.chrome.storage,
            local: {
                get: async (keys) => {
                    await nextTask();
                    const wanted = keys == null ? [...localStore.keys()] : [].concat(keys);
                    return Object.fromEntries(wanted.filter(k => localStore.has(k)).map(k => [k, structuredClone(localStore.get(k))]));
                },
                set: async (items) => {
                    await nextTask();
                    for (const [k, v] of Object.entries(items)) { localStore.set(k, structuredClone(v)); }
                },
                remove: async (keys) => {
                    await nextTask();
                    [].concat(keys).forEach(k => localStore.delete(k));
                }
            }
        }
    };
    const loadSessionsRealm = () => new Function('chrome', 'manifest', 'getLineNumber', 'allSessionsStorageKey', 'activeSessionIdKey', 'storageUserCommandsKey', 'storageOptionKey', 'activePageStorageKey', 'aiUserCommands',
        `${sessionsCode}; return { ${sessionsExports} };`
    )(latentStorageChrome, global.manifest, global.getLineNumber, global.allSessionsStorageKey, global.activeSessionIdKey, global.storageUserCommandsKey, global.storageOptionKey, global.activePageStorageKey, []);
    const titleCode = backgroundCode.match(/async function generateAndUpdateSessionTitle\([\s\S]*?\n}\n/)[0];
    const loadTitleUpdater = new Function('deps', `with (deps) { ${titleCode}; return generateAndUpdateSessionTitle; }`);

    beforeEach(() => {
        localStore.clear();
    });

    it('serialises concurrent creation and saving of two sessions in the background realm', async () => {
        const background = loadSessionsRealm();

        const [created1, created2] = await Promise.all([
            background.getSessionForRequest('session-A'),
            background.getSessionForRequest('session-B')
        ]);
        created1.messages.push({ role: 'user', content: 'A1' });
        created2.messages.push({ role: 'user', content: 'B1' });
        const saved = await Promise.all([background.saveSession(created1), background.saveSession(created2)]);

        expect(saved).toEqual([true, true]);
        const stored = await background.getAllSessions();
        expect(stored.map(s => [s.id, s.messages.map(m => m.content)]).sort()).toEqual([['session-A', ['A1']], ['session-B', ['B1']]]);
    });

    it('keeps an empty session created by another tab when saving, and appends a missing record', async () => {
        const background = loadSessionsRealm();
        await background.setAllSessions([{ id: 'empty-B', title: 'B', messages: [] }]);

        const saved = await background.saveSession({ id: 'session-A', title: 'A', messages: [{ role: 'user', content: 'A1' }] });

        expect(saved).toBe(true);
        expect((await background.getAllSessions()).map(s => s.id)).toEqual(['empty-B', 'session-A']);
    });

    it('preserves both sessions and their histories when two tabs send their first prompts at once', async () => {
        const background = loadSessionsRealm();
        const tabA = loadSessionsRealm();
        const tabB = loadSessionsRealm();
        const sessionIdA = await tabA.getOrCreateActiveSessionId();
        const sessionIdB = await tabB.getOrCreateActiveSessionId();

        const { deps } = createDeps([]);
        deps.getSessionForRequest = background.getSessionForRequest;
        deps.saveSession = background.saveSession;
        deps.generateAndUpdateSessionTitle = loadTitleUpdater({
            generateSessionTitle: async (text) => `Title ${text}`,
            queueSessionMutation: background.queueSessionMutation,
            getAllSessions: background.getAllSessions,
            setAllSessions: background.setAllSessions
        });
        deps.consumeStreamResponse.mockImplementation(async () => ({
            responseText: '',
            body: { message: { role: 'assistant', content: `answer ${deps.consumeStreamResponse.mock.calls.length}` } }
        }));
        const fetchDataAction = loadFetchDataAction(deps);

        const results = await Promise.all([
            fetchDataAction({ ...request(), sessionId: sessionIdA, data: { userInput: 'LinkedIn question' } }, { tab: { id: 1, url: 'https://www.linkedin.com/jobs/' } }),
            fetchDataAction({ ...request(), sessionId: sessionIdB, data: { userInput: 'HN question' } }, { tab: { id: 2, url: 'https://news.ycombinator.com/' } })
        ]);

        expect(results.map(r => r.status)).toEqual(['success', 'success']);
        const stored = await background.getAllSessions();
        const byId = Object.fromEntries(stored.map(s => [s.id, s]));
        expect(Object.keys(byId).sort()).toEqual([sessionIdA, sessionIdB].sort());
        expect(byId[sessionIdA].messages.map(m => m.content)).toEqual(['LinkedIn question', expect.stringMatching(/^answer /)]);
        expect(byId[sessionIdB].messages.map(m => m.content)).toEqual(['HN question', expect.stringMatching(/^answer /)]);
        expect(byId[sessionIdA].title).toBe('Title LinkedIn question');
        expect(byId[sessionIdB].title).toBe('Title HN question');
        expect(await background.getActiveSessionId()).toBeNull();
    });

    it('refuses to continue when the session cannot be persisted', async () => {
        const background = loadSessionsRealm();
        const { deps } = createDeps([{ message: { role: 'assistant', content: 'Answer' } }]);
        deps.getSessionForRequest = background.getSessionForRequest;
        deps.saveSession = vi.fn(async () => false);
        deps.sessionSaveFailedMessage = 'Failed to save the chat session, so the request was stopped. Please try again.';
        const fetchDataAction = loadFetchDataAction(deps);

        const result = await fetchDataAction({ ...request(), sessionId: 'session-X' }, sender);

        expect(result).toEqual({ status: 'error', message: deps.sessionSaveFailedMessage });
        expect(deps.fetch).not.toHaveBeenCalled();
        expect(deps.backgroundMemory.storeTurnWithEmbeddings).not.toHaveBeenCalled();
    });

    it('stops before storing the turn when the final save fails', async () => {
        const { deps } = createDeps([{ message: { role: 'assistant', content: 'Answer' } }]);
        deps.sessionSaveFailedMessage = 'Failed to save the chat session, so the request was stopped. Please try again.';
        let writes = 0;
        deps.saveSession = vi.fn(async () => ++writes === 1);
        const fetchDataAction = loadFetchDataAction(deps);

        const result = await fetchDataAction(request(), sender);

        expect(result).toEqual({ status: 'error', message: deps.sessionSaveFailedMessage });
        expect(deps.backgroundMemory.storeTurnWithEmbeddings).not.toHaveBeenCalled();
        expect(deps.handleStreamEnd).not.toHaveBeenCalled();
        expect(deps.generateAndUpdateSessionTitle).not.toHaveBeenCalled();
    });
});
