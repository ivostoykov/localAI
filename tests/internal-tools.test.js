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
