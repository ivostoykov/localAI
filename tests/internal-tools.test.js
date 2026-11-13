import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const internalToolsCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/internal-tools.js'),
    'utf-8'
);

const executeInternalToolsCode = new Function(
    `${internalToolsCode}; return { INTERNAL_TOOL_DEFINITIONS };`
);

describe('internal-tools.js', () => {
    it.each(['get_current_tab_page_content', 'get_enhanced_page_content', 'get_main_content'])(
        'explains coverage in %s', name => {
            const { INTERNAL_TOOL_DEFINITIONS } = executeInternalToolsCode();
            const tool = INTERNAL_TOOL_DEFINITIONS.find(tool => tool.function.name === name);
            expect(tool.function.description).toContain("The PAGE METADATA header reports 'Content scope' and 'Coverage' (extracted versus visible page characters); when coverage is low, say that the answer is based on partial page content.");
        }
    );

    it('explains search result truncation', () => {
        const { INTERNAL_TOOL_DEFINITIONS } = executeInternalToolsCode();
        const tool = INTERNAL_TOOL_DEFINITIONS.find(tool => tool.function.name === 'search_web');
        expect(tool.function.description).toContain("A result ending with '[TRUNCATED: ...]' was cut to the stated length.");
    });

    it('uses Ollama-compatible function tool definitions', () => {
        const { INTERNAL_TOOL_DEFINITIONS } = executeInternalToolsCode();

        expect(INTERNAL_TOOL_DEFINITIONS.length).toBeGreaterThan(0);
        expect(INTERNAL_TOOL_DEFINITIONS.every(tool => tool.type === 'function')).toBe(true);
    });
});

describe('browse_url internal tool', () => {
    const loadWithStubs = (stubs) => new Function(
        'browseUrl', 'searchWeb', 'chrome', 'manifest', 'getLineNumber',
        `${internalToolsCode}; return { INTERNAL_TOOL_DEFINITIONS, execInternalTool, isInternalTool };`
    )(stubs.browseUrl, stubs.searchWeb, stubs.chrome, { name: 'Local AI helper' }, () => 'test');

    it('defines an absolute-URL browse_url tool', () => {
        const { INTERNAL_TOOL_DEFINITIONS, isInternalTool } = loadWithStubs({});
        const tool = INTERNAL_TOOL_DEFINITIONS.find(t => t.function.name === 'browse_url');

        expect(isInternalTool('browse_url')).toBe(true);
        expect(tool.function.parameters.required).toEqual(['url']);
        expect(tool.function.description).toMatch(/absolute http or https URL/);
    });

    it('passes the loop navigation session and URL to browseUrl', async () => {
        const browseUrl = async (session, url) => `${session.id}:${url}`;
        const { execInternalTool } = loadWithStubs({ browseUrl });
        const call = { function: { name: 'browse_url', arguments: { url: 'https://example.com/' } } };

        await expect(execInternalTool(call, 1, { navigationSession: { id: 'loop-a' } })).resolves.toBe('loop-a:https://example.com/');
    });

    it('keeps current-page tools on the originating tab', async () => {
        const calls = [];
        const chrome = { tabs: { sendMessage: async (tabId, msg) => { calls.push([tabId, msg.functionName]); return { result: 'origin content' }; } } };
        const { execInternalTool } = loadWithStubs({ chrome });
        const call = { function: { name: 'get_current_tab_page_content', arguments: {} } };

        await execInternalTool(call, 1, { navigationSession: { id: 'loop-a', ownedTabId: 101 } });

        expect(calls).toEqual([[1, 'getEnhancedPageContent']]);
    });
});

describe('session-scoped internal tools (#29)', () => {
    const loadWithMemory = (backgroundMemory) => new Function(
        'backgroundMemory', 'getActiveSessionId', 'manifest', 'getLineNumber',
        `${internalToolsCode}; return { execInternalTool };`
    )(backgroundMemory, async () => { throw new Error('global active session must not be read'); }, { name: 'Local AI helper' }, () => 'test');

    const recordingMemory = () => {
        const calls = [];
        return {
            calls,
            getSessionPages: async (sessionId) => { calls.push(['getSessionPages', sessionId]); return [{ url: `page-of-${sessionId}` }]; },
            getLastSessionPages: async (sessionId, count) => { calls.push(['getLastSessionPages', sessionId, count]); return [{ url: `page-of-${sessionId}` }]; },
            clearSessionPages: async (sessionId) => { calls.push(['clearSessionPages', sessionId]); return true; },
            query: async (store, index, sessionId) => { calls.push(['query', sessionId]); return [{ turnNumber: 1, userMessage: `q-${sessionId}`, assistantResponse: 'a', timestamp: 0 }]; },
            semanticSearch: async (query, options) => { calls.push(['semanticSearch', options]); return []; }
        };
    };
    const call = (name, args = {}) => ({ function: { name, arguments: args } });

    it('uses the request session id from the tool context', async () => {
        const memory = recordingMemory();
        const { execInternalTool } = loadWithMemory(memory);
        const context = { sessionId: 'session-B' };

        await execInternalTool(call('get_all_session_pages'), 2, context);
        await execInternalTool(call('get_last_session_pages', { count: 2 }), 2, context);
        await execInternalTool(call('clear_old_page_context'), 2, context);
        const turn = await execInternalTool(call('get_conversation_turn', { turn_number: 1 }), 2, context);
        await execInternalTool(call('search_conversation_history', { query: 'x' }), 2, context);
        await execInternalTool(call('search_conversation_history', { query: 'x', scope: 'current_tab' }), 2, context);

        expect(memory.calls.slice(0, 4)).toEqual([
            ['getSessionPages', 'session-B'],
            ['getLastSessionPages', 'session-B', 2],
            ['clearSessionPages', 'session-B'],
            ['query', 'session-B']
        ]);
        expect(turn).toContain('q-session-B');
        expect(memory.calls[4][1]).toMatchObject({ sessionId: 'session-B', tabId: null });
        expect(memory.calls[5][1]).toMatchObject({ sessionId: 'session-B', tabId: 2 });
    });

    it('does not fall back to another session or search everything when the session id is missing', async () => {
        const memory = recordingMemory();
        const { execInternalTool } = loadWithMemory(memory);

        for (const name of ['get_all_session_pages', 'get_last_session_pages', 'clear_old_page_context', 'get_conversation_turn']) {
            await expect(execInternalTool(call(name, { turn_number: 1 }), 2, {})).resolves.toBe('No active session yet.');
        }
        await expect(execInternalTool(call('search_conversation_history', { query: 'x' }), 2, {})).resolves.toBe('No active session yet.');
        await expect(execInternalTool(call('search_conversation_history', { query: 'x', scope: 'current_tab' }), 2, {})).resolves.toBe('No active session yet.');

        expect(memory.calls).toEqual([]);
    });
});

describe('session tab tools (#62)', () => {
    const tabStateCode = fs.readFileSync(path.join(__dirname, '../src/jslib/tab-state.js'), 'utf-8');
    const backgroundCode = fs.readFileSync(path.join(__dirname, '../src/background.js'), 'utf-8');
    const resolverCode = backgroundCode.match(/async function resolveToolCalls\([\s\S]*?\n}\n/)[0];
    const call = (name, args = {}) => ({ function: { name, arguments: args } });

    function setup() {
        const entries = {
            'laiTabState:1': { tabId: 1, sessionId: 's1' },
            'laiTabState:2': { tabId: 2, sessionId: 's1' },
            'laiTabState:3': { tabId: 3, sessionId: 'foreign' },
            'laiTabState:4': { tabId: 4, sessionId: null },
            'other:5': { tabId: 5, sessionId: 's1' }
        };
        const storage = {
            get: vi.fn(async key => key == null ? { ...entries } : { [key]: entries[key] }),
            set: vi.fn()
        };
        const chrome = {
            tabs: {
                get: vi.fn(async id => ({ id, title: `Page ${id}`, url: `https://example.com/${id}` })),
                sendMessage: vi.fn(async () => ({ result: 'Other page content' }))
            },
            storage: { local: { get: vi.fn(async () => ({})), set: vi.fn() } }
        };
        const deps = {
            chrome,
            manifest: { name: 'Local AI helper' },
            getLineNumber: () => 'test',
            dumpInFrontConsole: vi.fn(),
            updateUIStatusBar: vi.fn(),
            browseUrl: vi.fn(),
            backgroundMemory: { storeContext: vi.fn(), addPageToSession: vi.fn() }
        };
        const tools = new Function('deps', `with (deps) {
            ${tabStateCode}
            const tabState = new TabStateStore({ storage: deps.storage });
            ${internalToolsCode}
            ${resolverCode}
            return { execInternalTool, resolveToolCalls, tabState, getInternalToolNames, isInternalTool, INTERNAL_TOOL_DEFINITIONS };
        }`)({ ...deps, storage });
        const context = { sessionId: 's1', tabState: tools.tabState };
        return { ...tools, deps, chrome, entries, storage, context,
            list: () => tools.execInternalTool(call('list_session_tabs'), 1, context),
            read: reference => tools.execInternalTool(call('read_session_tab_page', { tab_reference: reference }), 1, context)
        };
    }

    it('lists only other live tabs sharing the request session', async () => {
        const env = setup();
        env.entries['laiTabState:6'] = { tabId: 6, sessionId: 's1' };
        env.chrome.tabs.get.mockImplementation(async id => {
            if (id === 6) { throw new Error('Closed'); }
            return { id, title: 'Other page', url: 'https://example.com/other' };
        });
        expect(JSON.parse(await env.list())).toEqual([
            { tab_reference: 2, title: 'Other page', url: 'https://example.com/other' }
        ]);
        expect(env.chrome.tabs.get.mock.calls).toEqual([[2], [6]]);
        expect(env.chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('marks discarded tabs and handles missing title and URL', async () => {
        const env = setup();
        env.chrome.tabs.get.mockResolvedValue({ id: 2, discarded: true });
        expect(JSON.parse(await env.list())).toEqual([
            { tab_reference: 2, title: 'Title unavailable', url: 'URL unavailable', note: 'Tab is discarded.' }
        ]);
    });

    it('reports an empty list plainly', async () => {
        const env = setup();
        delete env.entries['laiTabState:2'];
        expect(await env.list()).toBe('No other open tabs share this session.');
    });

    it.each(['list_session_tabs', 'read_session_tab_page'])('%s requires a request session', async name => {
        const env = setup();
        for (const sessionId of [undefined, '', ' ', 123]) {
            expect(await env.execInternalTool(call(name, { tab_reference: 2 }), 1, { ...env.context, sessionId }))
                .toBe('No active session yet.');
        }
        expect(env.storage.get).not.toHaveBeenCalled();
        expect(env.chrome.tabs.get).not.toHaveBeenCalled();
    });

    it('reads fresh content using the current-page extractor with a title and URL header', async () => {
        const env = setup();
        expect(await env.read('2')).toBe('Tab: Page 2 — https://example.com/2\nOther page content');
        expect(env.chrome.tabs.sendMessage).toHaveBeenCalledWith(2, {
            action: 'callContentExtractor', functionName: 'getEnhancedPageContent', argument: null
        });
        env.chrome.tabs.sendMessage.mockResolvedValue({ result: 'Changed content' });
        expect(await env.read(2)).toContain('\nChanged content');
        expect(env.deps.browseUrl).not.toHaveBeenCalled();
    });

    it('refuses foreign, unbound and unknown tabs without revealing or messaging them', async () => {
        const env = setup();
        for (const id of [3, 4, 999]) {
            expect(await env.read(id)).toBe('Tab is not available in this session.');
        }
        expect(env.chrome.tabs.get).not.toHaveBeenCalled();
        expect(env.chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('rechecks the binding after listing', async () => {
        const env = setup();
        await env.list();
        env.entries['laiTabState:2'].sessionId = 'foreign';
        expect(await env.read(2)).toBe('Tab is not available in this session.');
        expect(env.chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('reports a closed tab', async () => {
        const env = setup();
        env.chrome.tabs.get.mockRejectedValue(new Error('Closed'));
        expect(await env.read(2)).toBe('Tab is closed.');
        expect(env.chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('does not message a discarded tab', async () => {
        const env = setup();
        env.chrome.tabs.get.mockResolvedValue({ id: 2, discarded: true });
        expect(await env.read(2)).toBe('Tab is discarded.');
        expect(env.chrome.tabs.sendMessage).not.toHaveBeenCalled();
        expect(env.deps.browseUrl).not.toHaveBeenCalled();
    });

    it.each([undefined, {}, { error: 'Failed' }, { result: '' }, { result: ' ' }, { result: {} }])(
        'reports an unreachable tab for response %j', async response => {
            const env = setup();
            env.chrome.tabs.sendMessage.mockResolvedValue(response);
            expect(await env.read(2)).toBe('Tab is unreachable.');
        }
    );

    it('reports messaging rejection without throwing or browsing', async () => {
        const env = setup();
        env.chrome.tabs.sendMessage.mockRejectedValue(new Error('No receiver'));
        expect(await env.read(2)).toBe('Tab is unreachable.');
        expect(env.deps.browseUrl).not.toHaveBeenCalled();
    });

    it('times out a silent content script after ten seconds and clears the timer', async () => {
        vi.useFakeTimers();
        try {
            const env = setup();
            env.chrome.tabs.sendMessage.mockImplementation(() => new Promise(() => {}));
            const result = env.read(2);
            await vi.advanceTimersByTimeAsync(9999);
            expect(vi.getTimerCount()).toBe(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(await result).toBe('Tab is unreachable.');
            expect(vi.getTimerCount()).toBe(0);
            env.chrome.tabs.sendMessage.mockResolvedValue({ result: 'Immediate' });
            await env.read(2);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('directs own-tab requests to the current-page tool', async () => {
        const env = setup();
        expect(await env.read('1')).toBe('Use get_current_tab_page_content for the requesting tab.');
        expect(env.chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it.each([undefined, null, '', ' ', '2junk', '2.5', 2.5, -1, 0, Infinity, {}, [], true])(
        'rejects malformed tab reference %j', async reference => {
            const env = setup();
            expect(await env.read(reference)).toBe('Invalid tab reference. Call list_session_tabs first.');
            expect(env.storage.get).not.toHaveBeenCalled();
            expect(env.chrome.tabs.sendMessage).not.toHaveBeenCalled();
        }
    );

    it.each(['list_session_tabs', 'read_session_tab_page'])('registers a well-formed %s definition', name => {
        const env = setup();
        expect(env.isInternalTool(name)).toBe(true);
        expect(env.getInternalToolNames()).toContain(name);
        const definition = env.INTERNAL_TOOL_DEFINITIONS.find(tool => tool.function.name === name);
        expect(definition).toMatchObject({ type: 'function', strict: true, function: { parameters: { type: 'object' } } });
        expect(definition.function.description).toContain("Only tabs sharing this conversation's session are reachable");
        expect(definition.function.parameters.required).toEqual(name === 'list_session_tabs' ? [] : ['tab_reference']);
        if (name === 'read_session_tab_page') {
            expect(definition.function.parameters.properties.tab_reference.type).toBe('integer');
        }
    });

    it('keeps another tab read out of stored page context through background dispatch and subsequent reuse', async () => {
        const env = setup();
        const memoryCode = fs.readFileSync(path.join(__dirname, '../src/background-memory.js'), 'utf-8');
        const { BackgroundMemory } = new Function('chrome', 'activePageStorageKey', `${memoryCode}; return { BackgroundMemory };`)(env.chrome, 'LAI_ACTIVE_PAGE');
        const memory = new BackgroundMemory();
        const storedContext = { tabId: 1, pageUrl: 'https://example.com/1', pageContent: 'Origin page', pageHash: 'origin', attachments: [] };
        memory.init = vi.fn();
        memory.getContext = vi.fn(async () => storedContext);
        memory.getRecentTurns = vi.fn(async () => []);
        memory.storeContext = vi.fn();
        Object.assign(env.deps.backgroundMemory, memory);
        const result = await env.resolveToolCalls(call('read_session_tab_page', { tab_reference: 2 }), '', { id: 1 }, 's1');
        expect(result).toContain('Other page content');
        expect(env.deps.backgroundMemory.storeContext).not.toHaveBeenCalled();
        expect(env.deps.backgroundMemory.addPageToSession).not.toHaveBeenCalled();
        expect(env.chrome.storage.local.set).not.toHaveBeenCalled();
        expect(env.storage.set).not.toHaveBeenCalled();
        const nextContext = await memory.buildOptimisedContext('s1', '@{{page}}', 2, '', null, [], null, true, 1);
        expect(nextContext).toContainEqual({ role: 'user', content: '[PAGE CONTENT]:\nOrigin page' });
        expect(JSON.stringify(nextContext)).not.toContain('Other page content');
        expect(storedContext.pageUrl).toBe('https://example.com/1');
    });
});
