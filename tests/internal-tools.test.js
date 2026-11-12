import { describe, it, expect } from 'vitest';
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
