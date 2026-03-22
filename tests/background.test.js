import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from '@webext-core/fake-browser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backgroundCode = fs.readFileSync(
    path.join(__dirname, '../src/background.js'),
    'utf-8'
);

// Extract only the pure functions we want to test
const processTextChunkCode = backgroundCode.match(/function processTextChunk\([\s\S]*?\n}\n/)[0];
const getLastConsecutiveUserRecordsCode = backgroundCode.match(/function getLastConsecutiveUserRecords\([\s\S]*?\n}\n/)[0];
const replaceCommandPlaceholdersCode = backgroundCode.match(/function replaceCommandPlaceholders\([\s\S]*?\n}\n/)[0];
const getLineNumberCode = 'function getLineNumber() { return "test:1"; }';
const isMessagePersistableCode = backgroundCode.match(/function isMessagePersistable\([\s\S]*?\n}\n/)[0];
const sanitizeAssistantMessageForHistoryCode = backgroundCode.match(/function sanitizeAssistantMessageForHistory\([\s\S]*?\n}\n/)[0];
const modelCanThinkCode = backgroundCode.match(/async function modelCanThink\([\s\S]*?\n}\n/)[0];
const modelCanUseToolsCode = backgroundCode.match(/async function modelCanUseTools\([\s\S]*?\n}\n/)[0];

const testFunctionsCode = `
${processTextChunkCode}
${getLastConsecutiveUserRecordsCode}
${replaceCommandPlaceholdersCode}
${getLineNumberCode}
${isMessagePersistableCode}
${sanitizeAssistantMessageForHistoryCode}
${modelCanThinkCode}
${modelCanUseToolsCode}

return { processTextChunk, getLastConsecutiveUserRecords, replaceCommandPlaceholders, getLineNumber, isMessagePersistable, sanitizeAssistantMessageForHistory, modelCanThink, modelCanUseTools };
`;

const executeTestFunctions = new Function(testFunctionsCode);

let processTextChunk, getLastConsecutiveUserRecords, replaceCommandPlaceholders, getLineNumber, isMessagePersistable, sanitizeAssistantMessageForHistory, modelCanThink, modelCanUseTools;

describe('background.js', () => {
    beforeEach(() => {
        const exports = executeTestFunctions();
        processTextChunk = exports.processTextChunk;
        getLastConsecutiveUserRecords = exports.getLastConsecutiveUserRecords;
        replaceCommandPlaceholders = exports.replaceCommandPlaceholders;
        getLineNumber = exports.getLineNumber;
        isMessagePersistable = exports.isMessagePersistable;
        sanitizeAssistantMessageForHistory = exports.sanitizeAssistantMessageForHistory;
        modelCanThink = exports.modelCanThink;
        modelCanUseTools = exports.modelCanUseTools;
    });

    describe('processTextChunk', () => {
        it('wraps multiple JSON objects in array', () => {
            const chunk = '{"model":"test"}\n{"model":"test2"}';
            const result = processTextChunk(chunk);

            expect(result).toBe('[{"model":"test"},\n{"model":"test2"}]');
        });

        it('removes data: prefix', () => {
            const chunk = 'data: {"test":"value"}';
            const result = processTextChunk(chunk);

            expect(result).toBe('{"test":"value"}');
        });

        it('removes data: [DONE] suffix', () => {
            const chunk = '{"test":"value"}\ndata: [DONE]';
            const result = processTextChunk(chunk);

            expect(result).toBe('{"test":"value"}');
        });

        it('wraps multiple data: prefixed objects', () => {
            const chunk = 'data: {"a":1}\ndata: {"b":2}';
            const result = processTextChunk(chunk);

            expect(result).toBe('[{"a":1},{"b":2}]');
        });

        it('returns unchanged for simple text', () => {
            const chunk = '{"simple":"json"}';
            const result = processTextChunk(chunk);

            expect(result).toBe('{"simple":"json"}');
        });
    });

    describe('getLastConsecutiveUserRecords', () => {
        it('returns empty string for empty array', () => {
            const result = getLastConsecutiveUserRecords([]);

            expect(result).toBe('');
        });

        it('returns empty string when last message not user', () => {
            const messages = [
                { role: 'user', content: 'Hello' },
                { role: 'assistant', content: 'Hi' }
            ];
            const result = getLastConsecutiveUserRecords(messages);

            expect(result).toBe('');
        });

        it('returns last user message', () => {
            const messages = [
                { role: 'user', content: 'Hello' }
            ];
            const result = getLastConsecutiveUserRecords(messages);

            expect(result).toBe('Hello');
        });

        it('returns multiple consecutive user messages', () => {
            const messages = [
                { role: 'assistant', content: 'Hi' },
                { role: 'user', content: 'First' },
                { role: 'user', content: 'Second' },
                { role: 'user', content: 'Third' }
            ];
            const result = getLastConsecutiveUserRecords(messages);

            expect(result).toBe('First\nSecond\nThird');
        });

        it('stops at first non-user message', () => {
            const messages = [
                { role: 'user', content: 'Before' },
                { role: 'assistant', content: 'Middle' },
                { role: 'user', content: 'After1' },
                { role: 'user', content: 'After2' }
            ];
            const result = getLastConsecutiveUserRecords(messages);

            expect(result).toBe('After1\nAfter2');
        });

        it('handles messages with no content', () => {
            const messages = [
                { role: 'user', content: '' },
                { role: 'user', content: 'Text' }
            ];
            const result = getLastConsecutiveUserRecords(messages);

            expect(result).toBe('\nText');
        });
    });

    describe('replaceCommandPlaceholders', () => {
        it('replaces @{{page}} placeholder', () => {
            const input = 'Tell me about @{{page}} content';
            const result = replaceCommandPlaceholders(input);

            expect(result).toBe('Tell me about [see page content attachment] content');
        });

        it('replaces @{{now}} placeholder', () => {
            const input = 'What is @{{now}}?';
            const result = replaceCommandPlaceholders(input);

            expect(result).toBe('What is [see timestamp attachment]?');
        });

        it('replaces @{{today}} placeholder', () => {
            const input = 'Date: @{{today}}';
            const result = replaceCommandPlaceholders(input);

            expect(result).toBe('Date: [see current date attachment]');
        });

        it('replaces @{{time}} placeholder', () => {
            const input = 'Time: @{{time}}';
            const result = replaceCommandPlaceholders(input);

            expect(result).toBe('Time: [see current time attachment]');
        });

        it('replaces multiple placeholders', () => {
            const input = '@{{page}} @{{now}} @{{today}} @{{time}}';
            const result = replaceCommandPlaceholders(input);

            expect(result).toBe('[see page content attachment] [see timestamp attachment] [see current date attachment] [see current time attachment]');
        });

        it('handles text without placeholders', () => {
            const input = 'Normal text without placeholders';
            const result = replaceCommandPlaceholders(input);

            expect(result).toBe('Normal text without placeholders');
        });

        it('replaces multiple occurrences of same placeholder', () => {
            const input = '@{{page}} and @{{page}} again';
            const result = replaceCommandPlaceholders(input);

            expect(result).toBe('[see page content attachment] and [see page content attachment] again');
        });
    });

    describe('sanitizeAssistantMessageForHistory', () => {
        it('removes thinking field from message', () => {
            const message = {
                role: 'assistant',
                content: 'Response content',
                thinking: 'Internal reasoning'
            };

            const result = sanitizeAssistantMessageForHistory(message);

            expect(result).toEqual({
                role: 'assistant',
                content: 'Response content'
            });
            expect(result.thinking).toBeUndefined();
        });

        it('preserves content and tool_calls', () => {
            const message = {
                role: 'assistant',
                content: 'Response',
                thinking: 'Thinking',
                tool_calls: [{ id: '1', function: { name: 'test' } }]
            };

            const result = sanitizeAssistantMessageForHistory(message);

            expect(result.content).toBe('Response');
            expect(result.tool_calls).toHaveLength(1);
            expect(result.thinking).toBeUndefined();
        });

        it('returns null when message has only thinking', () => {
            const message = {
                role: 'assistant',
                thinking: 'Only thinking, no content'
            };

            const result = sanitizeAssistantMessageForHistory(message);

            expect(result).toBeNull();
        });

        it('returns message when it has content', () => {
            const message = {
                role: 'assistant',
                content: 'Valid content'
            };

            const result = sanitizeAssistantMessageForHistory(message);

            expect(result).toEqual({
                role: 'assistant',
                content: 'Valid content'
            });
        });

        it('returns message when it has tool_calls', () => {
            const message = {
                role: 'assistant',
                tool_calls: [{ id: '1', function: { name: 'test' } }]
            };

            const result = sanitizeAssistantMessageForHistory(message);

            expect(result.tool_calls).toHaveLength(1);
        });

        it('returns null when content is empty string', () => {
            const message = {
                role: 'assistant',
                content: '',
                thinking: 'Some thinking'
            };

            const result = sanitizeAssistantMessageForHistory(message);

            expect(result).toBeNull();
        });

        it('returns null when content is whitespace only', () => {
            const message = {
                role: 'assistant',
                content: '   \n  \t  ',
                thinking: 'Some thinking'
            };

            const result = sanitizeAssistantMessageForHistory(message);

            expect(result).toBeNull();
        });

        it('handles empty message object', () => {
            const message = {};

            const result = sanitizeAssistantMessageForHistory(message);

            expect(result).toBeNull();
        });

        it('does not mutate original message', () => {
            const message = {
                role: 'assistant',
                content: 'Content',
                thinking: 'Thinking'
            };
            const originalThinking = message.thinking;

            sanitizeAssistantMessageForHistory(message);

            expect(message.thinking).toBe(originalThinking);
        });
    });

    describe('modelCanThink', () => {
        beforeEach(() => {
            global.getModelInfo = vi.fn();
            global.console = {
                error: vi.fn()
            };
            global.manifest = { name: 'Test' };
        });

        it('returns true when model has thinking capability', async () => {
            global.getModelInfo.mockResolvedValue({
                capabilities: ['completion', 'thinking', 'tools']
            });

            const result = await modelCanThink('test-model');

            expect(result).toBe(true);
            expect(global.getModelInfo).toHaveBeenCalledWith('test-model');
        });

        it('returns false when model does not have thinking capability', async () => {
            global.getModelInfo.mockResolvedValue({
                capabilities: ['completion', 'tools']
            });

            const result = await modelCanThink('test-model');

            expect(result).toBe(false);
        });

        it('handles case-insensitive capability check', async () => {
            global.getModelInfo.mockResolvedValue({
                capabilities: ['THINKING']
            });

            const result = await modelCanThink('test-model');

            expect(result).toBe(true);
        });

        it('returns false when modelName is empty', async () => {
            const result = await modelCanThink('');

            expect(result).toBe(false);
            expect(global.getModelInfo).not.toHaveBeenCalled();
        });

        it('returns false when modelName is null', async () => {
            const result = await modelCanThink(null);

            expect(result).toBe(false);
        });

        it('returns false when getModelInfo returns error', async () => {
            global.getModelInfo.mockResolvedValue({
                error: 'Model not found'
            });

            const result = await modelCanThink('invalid-model');

            expect(result).toBe(false);
        });

        it('returns false when getModelInfo throws error', async () => {
            global.getModelInfo.mockRejectedValue(new Error('Network error'));

            const result = await modelCanThink('test-model');

            expect(result).toBe(false);
            expect(global.console.error).toHaveBeenCalled();
        });

        it('returns false when capabilities is undefined', async () => {
            global.getModelInfo.mockResolvedValue({});

            const result = await modelCanThink('test-model');

            expect(result).toBe(false);
        });

        it('returns false when capabilities is empty array', async () => {
            global.getModelInfo.mockResolvedValue({
                capabilities: []
            });

            const result = await modelCanThink('test-model');

            expect(result).toBe(false);
        });
    });

    describe('modelCanUseTools', () => {
        beforeEach(() => {
            global.getModelInfo = vi.fn();
            global.dumpInFrontConsole = vi.fn();
            global.updateUIStatusBar = vi.fn();
            global.console = {
                error: vi.fn()
            };
            global.manifest = { name: 'Test' };
        });

        it('returns true when model has tools capability', async () => {
            global.getModelInfo.mockResolvedValue({
                capabilities: ['completion', 'tools']
            });

            const result = await modelCanUseTools('test-model', { id: 123 });

            expect(result).toBe(true);
            expect(global.getModelInfo).toHaveBeenCalledWith('test-model');
        });

        it('returns false when model does not have tools capability', async () => {
            global.getModelInfo.mockResolvedValue({
                capabilities: ['completion']
            });

            const result = await modelCanUseTools('test-model', { id: 123 });

            expect(result).toBe(false);
        });

        it('handles case-insensitive capability check', async () => {
            global.getModelInfo.mockResolvedValue({
                capabilities: ['TOOLS']
            });

            const result = await modelCanUseTools('test-model', { id: 123 });

            expect(result).toBe(true);
        });

        it('returns false when modelName is empty', async () => {
            const result = await modelCanUseTools('', { id: 123 });

            expect(result).toBe(false);
            expect(global.getModelInfo).not.toHaveBeenCalled();
        });

        it('returns false when getModelInfo returns error', async () => {
            global.getModelInfo.mockResolvedValue({
                error: 'Model not found'
            });

            const result = await modelCanUseTools('invalid-model', { id: 123 });

            expect(result).toBe(false);
        });

        it('logs to console when model supports tools', async () => {
            global.getModelInfo.mockResolvedValue({
                capabilities: ['tools']
            });

            await modelCanUseTools('test-model', { id: 123 });

            expect(global.dumpInFrontConsole).toHaveBeenCalled();
            expect(global.updateUIStatusBar).toHaveBeenCalled();
        });

        it('logs to console when model does not support tools', async () => {
            global.getModelInfo.mockResolvedValue({
                capabilities: []
            });

            await modelCanUseTools('test-model', { id: 123 });

            expect(global.dumpInFrontConsole).toHaveBeenCalled();
            expect(global.updateUIStatusBar).toHaveBeenCalled();
        });

        it('returns false when getModelInfo throws error', async () => {
            global.getModelInfo.mockRejectedValue(new Error('Network error'));

            const result = await modelCanUseTools('test-model', { id: 123 });

            expect(result).toBe(false);
            expect(global.console.error).toHaveBeenCalled();
        });
    });
});
