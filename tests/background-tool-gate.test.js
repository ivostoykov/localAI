import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backgroundCode = fs.readFileSync(path.join(__dirname, '../src/background.js'), 'utf-8');

const extract = name => backgroundCode.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}\\n`))[0];
const gateCode = [
    backgroundCode.match(/const MAX_REJECTED_TOOL_ROUNDS = \d+;/)[0],
    ...['getOfferedToolNames', 'getToolCallRejection', 'getRejectedToolCallMessage', 'buildExternalToolUrl', 'resolveToolCalls', 'fetchDataAction',
        'registerRequestController', 'unregisterRequestController', 'throwIfRequestCancelled', 'sendStreamAbort',
        'createStreamRequestId', 'sendStreamError', 'wasTerminalMessageDelivered'].map(extract)
].join('\n');

const memorySource = fs.readFileSync(path.join(__dirname, '../src/background-memory.js'), 'utf-8');
const roleBoundaryCode = [
    memorySource.match(/const REFERENCE_MATERIAL_NOTICE = .*;\n/)[0],
    memorySource.match(/function formatReferenceMaterial\([\s\S]*?\n}\n/)[0],
    memorySource.match(/const REFERENCE_MESSAGES = new WeakSet\(\);\n/)[0],
    memorySource.match(/function createReferenceMessage\([\s\S]*?\n}\n/)[0],
    memorySource.match(/function isReferenceMessage\([\s\S]*?\n}\n/)[0],
    ...['selectSystemInstructions', 'enforceSystemRoleBoundary', 'normaliseModelReplyMessage']
        .map(name => backgroundCode.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`))[0])
].join('\n');

const load = deps => new Function('deps', `with (deps) { ${gateCode}\n${roleBoundaryCode}\nreturn { fetchDataAction, resolveToolCalls, buildExternalToolUrl, getOfferedToolNames }; }`)(deps);

const INTERNAL = [
    { type: 'function', function: { name: 'browse_url', parameters: { type: 'object', properties: { url: { type: 'string' } } } } },
    { type: 'function', function: { name: 'get_current_page', parameters: { type: 'object', properties: {} } } }
];
const external = name => ({ type: 'function', function: { name, parameters: { type: 'object', properties: { city: { type: 'string' } } } } });
const call = (name, args = {}) => ({ function: { name, arguments: args } });
const toolsReply = (...calls) => ({ message: { role: 'assistant', content: '', tool_calls: calls } });
const finalReply = { message: { role: 'assistant', content: 'Final answer' } };

function createEnv({ bodies, externalTools = [], toolFunc = 'http://tools.local/api', canUseTools = true }) {
    const sentBodies = [];
    const deps = {
        controllers: new Map(),
        originRequestControllers: new Map(),
        liveStreamStates: new Map(),
        tabState: {},
        streamRequestState: {
            sweepExpired: vi.fn(async () => undefined),
            checkpoint: vi.fn(async () => true),
            remove: vi.fn(async () => undefined)
        },
        manifest: { name: 'Local AI helper' },
        getLineNumber: () => 'test',
        console: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() },
        chrome: { runtime: {}, tabs: { sendMessage: vi.fn(async () => undefined), get: vi.fn(async id => ({ id })) } },
        getLaiOptions: vi.fn(async () => ({ toolFunc, debug: false })),
        getPromptTools: vi.fn(async () => [...INTERNAL, ...externalTools]),
        getInternalToolNames: () => INTERNAL.map(tool => tool.function.name),
        getAiUrl: vi.fn(async () => 'http://localhost:11434/api/chat'),
        showUIMessage: vi.fn(),
        validateAndGetTabId: vi.fn(async () => null),
        getAiModel: vi.fn(async () => 'model'),
        resolveModelNameForRequest: vi.fn(async model => model),
        applyAutomaticModelOptions: vi.fn(async data => data),
        getSessionForRequest: vi.fn(async id => ({ id, messages: [], titleGenerated: true })),
        processCommandArguments: vi.fn(async () => ({ pageContent: null, pageHash: null })),
        replaceCommandPlaceholders: text => text,
        backgroundMemory: {
            buildOptimisedContext: vi.fn(async () => [{ role: 'user', content: 'hi' }]),
            getContext: vi.fn(async () => ({})),
            storeToolCallEmbedding: vi.fn(async () => undefined),
            storeTurnWithEmbeddings: vi.fn(async () => undefined)
        },
        getVisibleSessionMessages: messages => messages,
        saveSession: vi.fn(async () => true),
        modelCanUseTools: vi.fn(async () => canUseTools),
        dumpInFrontConsole: vi.fn(async () => undefined),
        fetch: vi.fn(async (url, options) => {
            sentBodies.push(JSON.parse(options.body));
            return { ok: true, status: 200 };
        }),
        consumeStreamResponse: vi.fn(async () => {
            const next = bodies.shift() ?? finalReply;
            return { responseText: JSON.stringify(next), body: next };
        }),
        execInternalTool: vi.fn(async () => 'internal result'),
        fetchExtResponse: vi.fn(async () => ({ status: 200, json: async () => ({ temp: 21 }) })),
        updateUIStatusBar: vi.fn(async () => undefined),
        checkResponseTextAndBody: vi.fn(async () => undefined),
        sanitizeAssistantMessageForHistory: message => message,
        handleStreamEnd: vi.fn(async () => undefined),
        handleResponse: vi.fn(async () => undefined),
        generateAndUpdateSessionTitle: vi.fn(async () => undefined),
        createNavigationSession: vi.fn(() => ({ id: 'nav' })),
        disposeNavigationSession: vi.fn(async () => undefined)
    };
    const api = load(deps);
    const run = (extra = {}) => api.fetchDataAction({
        action: 'fetchData', url: 'http://localhost:11434/api/chat', tools: true,
        data: { userInput: 'Do it' }, sessionId: 'session-1', ...extra
    }, { tab: { id: 1, url: 'https://origin.example/' } });
    const toolMessages = () => sentBodies.at(-1).messages.filter(message => message.role === 'tool');
    return { deps, api, run, sentBodies, toolMessages };
}

const expectNothingExecuted = deps => {
    expect(deps.execInternalTool).not.toHaveBeenCalled();
    expect(deps.fetchExtResponse).not.toHaveBeenCalled();
    expect(deps.createNavigationSession.mock.results.length).toBeLessThanOrEqual(1);
};

describe('tool call gate (#97)', () => {
    it('executes nothing when tools are disabled, even for a recognised built-in call', async () => {
        const env = createEnv({ bodies: [toolsReply(call('browse_url', { url: 'https://a.example/' }), call('get_current_page'))] });
        const result = await env.run({ tools: false });
        expect(result.status).toBe('success');
        expectNothingExecuted(env.deps);
        expect(env.sentBodies[0]).not.toHaveProperty('tools');
        expect(env.toolMessages()).toHaveLength(2);
        expect(env.toolMessages()[0].content).toContain('rejected and not executed');
    });

    it('ignores a tools list supplied by the sender when tools are disabled', async () => {
        const env = createEnv({ bodies: [toolsReply(call('browse_url', { url: 'https://a.example/' }))] });
        await env.run({ tools: false, data: { userInput: 'Do it', tools: INTERNAL, tool_choice: 'auto' } });
        expectNothingExecuted(env.deps);
        expect(env.sentBodies[0]).not.toHaveProperty('tools');
        expect(env.sentBodies[0]).not.toHaveProperty('tool_choice');
    });

    it('executes nothing when the model does not support tools', async () => {
        const env = createEnv({ bodies: [toolsReply(call('browse_url', { url: 'https://a.example/' }))], canUseTools: false });
        await env.run();
        expectNothingExecuted(env.deps);
        expect(env.sentBodies[0]).not.toHaveProperty('tools');
    });

    it.each(['ext_weather', 'BROWSE_URL', 'browse_url ', '', undefined])('rejects an enabled but unoffered call %j', async name => {
        const env = createEnv({ bodies: [toolsReply(call(name))] });
        await env.run();
        expectNothingExecuted(env.deps);
        expect(env.sentBodies[0].tools.map(tool => tool.function.name)).toEqual(['browse_url', 'get_current_page']);
        expect(env.toolMessages()[0].content).toContain('not offered on this request');
    });

    it('applies the offered list on every streamed follow-up round', async () => {
        const env = createEnv({
            bodies: [
                toolsReply(call('browse_url', { url: 'https://a.example/' })),
                toolsReply(call('ext_weather', { city: 'Sofia' }), call('get_current_page')),
                finalReply
            ]
        });
        const result = await env.run();
        expect(result.status).toBe('success');
        expect(env.deps.fetch).toHaveBeenCalledTimes(3);
        expect(env.deps.consumeStreamResponse).toHaveBeenCalledTimes(3);
        expect(env.deps.execInternalTool.mock.calls.map(([toolCall]) => toolCall.function.name)).toEqual(['browse_url', 'get_current_page']);
        expect(env.deps.fetchExtResponse).not.toHaveBeenCalled();
        for (const body of env.sentBodies) {
            expect(body.tools.map(tool => tool.function.name)).toEqual(['browse_url', 'get_current_page']);
        }
    });

    it('stops after repeated rounds of only unoffered calls without executing any', async () => {
        const env = createEnv({ bodies: Array.from({ length: 5 }, () => toolsReply(call('browse_url', { url: 'https://a.example/' }))) });
        const result = await env.run({ tools: false });
        expect(result.status).toBe('error');
        expect(result.message).toContain('rejected (3 rounds in a row)');
        expect(env.deps.fetch).toHaveBeenCalledTimes(3);
        expectNothingExecuted(env.deps);
    });

    it('runs a valid offered built-in and a valid offered external tool', async () => {
        const env = createEnv({
            bodies: [toolsReply(call('browse_url', { url: 'https://a.example/' }), call('ext_weather', { city: 'Sofia' }))],
            externalTools: [external('ext_weather')]
        });
        const result = await env.run();
        expect(result.status).toBe('success');
        expect(env.deps.execInternalTool).toHaveBeenCalledOnce();
        expect(env.deps.execInternalTool.mock.calls[0][0].function.name).toBe('browse_url');
        expect(env.deps.fetchExtResponse).toHaveBeenCalledOnce();
        const [url, options] = env.deps.fetchExtResponse.mock.calls[0];
        expect(url).toBe('http://tools.local/api/ext_weather');
        expect(options).toMatchObject({ method: 'POST', redirect: 'error', body: JSON.stringify({ city: 'Sofia' }) });
        expect(env.toolMessages().map(message => message.content)).toEqual(['internal result', JSON.stringify({ temp: 21 })]);
    });

    it.each(['../admin', '..', '.', 'a/b', 'a\\b', '%2e%2e', '%2F', 'a\nb', 'a\u0000b', 'http://evil.example/x'])(
        'refuses the unsafe offered external name %j before any POST', async name => {
            const env = createEnv({ bodies: [toolsReply(call(name, { city: 'Sofia' }))], externalTools: [external(name)] });
            await env.run();
            expectNothingExecuted(env.deps);
            expect(env.sentBodies[0].tools.map(tool => tool.function.name)).toContain(name);
            expect(env.toolMessages()[0].content).toContain('rejected and not executed');
        }
    );

    it.each([
        ['.hidden', 'http://tools.local/api/.hidden'],
        ['...', 'http://tools.local/api/...'],
        ['a b', 'http://tools.local/api/a%20b'],
        ['a?x=1', 'http://tools.local/api/a%3Fx%3D1'],
        ['a#frag', 'http://tools.local/api/a%23frag']
    ])('keeps the configured single-segment name %j, encoded under the endpoint', async (name, expected) => {
        const env = createEnv({ bodies: [toolsReply(call(name, { city: 'Sofia' }))], externalTools: [external(name)] });
        await env.run();
        expect(env.deps.fetchExtResponse).toHaveBeenCalledOnce();
        expect(env.deps.fetchExtResponse.mock.calls[0][0]).toBe(expected);
        expect(env.deps.fetchExtResponse.mock.calls[0][1].redirect).toBe('error');
    });

    it('stops after repeated offered but unsafe external calls without any POST', async () => {
        const env = createEnv({ bodies: Array.from({ length: 5 }, () => toolsReply(call('../admin'))), externalTools: [external('../admin')] });
        const result = await env.run();
        expect(result.status).toBe('error');
        expect(env.deps.fetch).toHaveBeenCalledTimes(3);
        expectNothingExecuted(env.deps);
    });

    it('keeps call arguments out of rejection logs', async () => {
        const secret = 'SECRET-ARGUMENT-VALUE';
        const env = createEnv({ bodies: [toolsReply(call('ext_weather', { city: secret }), call('../admin', { city: secret }))], externalTools: [external('../admin')] });
        await env.run();
        const logged = JSON.stringify([env.deps.console.warn.mock.calls, env.deps.dumpInFrontConsole.mock.calls.filter(([, , type]) => type === 'warn')]);
        expect(env.deps.console.warn).toHaveBeenCalled();
        expect(logged).not.toContain(secret);
    });

    it('refuses an offered external call when no endpoint is configured', async () => {
        const env = createEnv({ bodies: [toolsReply(call('ext_weather'))], externalTools: [external('ext_weather')], toolFunc: '' });
        await env.run();
        expectNothingExecuted(env.deps);
        expect(env.toolMessages()[0].content).toContain('not configured');
    });

    it('fails closed in resolveToolCalls without an offered list', async () => {
        const env = createEnv({ bodies: [] });
        const result = await env.api.resolveToolCalls(call('browse_url', { url: 'https://a.example/' }), 'http://tools.local/api', { id: 1 }, 's1');
        expect(result).toContain('not offered');
        expectNothingExecuted(env.deps);
    });
});

describe('buildExternalToolUrl (#97)', () => {
    const { buildExternalToolUrl } = createEnv({ bodies: [] }).api;

    it.each([
        ['http://tools.local', 'fn', 'http://tools.local/fn'],
        ['http://tools.local/', 'fn', 'http://tools.local/fn'],
        ['http://tools.local/api', 'get_weather', 'http://tools.local/api/get_weather'],
        ['http://tools.local/api//', 'v1.lookup-x', 'http://tools.local/api/v1.lookup-x'],
        ['https://tools.local:8443/a/b?key=1#frag', 'fn', 'https://tools.local:8443/a/b/fn?key=1'],
        ['http://tools.local/api', '.hidden', 'http://tools.local/api/.hidden'],
        ['http://tools.local/api', 'a b', 'http://tools.local/api/a%20b']
    ])('keeps %s + %s under the endpoint', (base, name, expected) => {
        expect(buildExternalToolUrl(base, name)).toBe(expected);
    });

    it.each([['', 'fn'], ['   ', 'fn'], [undefined, 'fn'], ['not a url', 'fn'], ['file:///tmp', 'fn'], ['javascript:alert(1)', 'fn']])(
        'rejects the endpoint %j', (base, name) => {
            expect(() => buildExternalToolUrl(base, name)).toThrow();
        }
    );

    it.each(['..', '.', '../x', 'a/b', 'a\\b', '%2e', '%2e%2e', 'a\tb', '', null, 42])('rejects the name %j', name => {
        expect(() => buildExternalToolUrl('http://tools.local/api', name)).toThrow();
    });
});
