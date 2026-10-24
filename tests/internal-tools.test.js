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
