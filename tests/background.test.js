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
const getLineNumberCode = backgroundCode.match(/function getLineNumber\([\s\S]*?\n}\n/)[0];

const testFunctionsCode = `
${processTextChunkCode}
${getLastConsecutiveUserRecordsCode}
${replaceCommandPlaceholdersCode}
${getLineNumberCode}

return { processTextChunk, getLastConsecutiveUserRecords, replaceCommandPlaceholders, getLineNumber };
`;

const executeTestFunctions = new Function(testFunctionsCode);

let processTextChunk, getLastConsecutiveUserRecords, replaceCommandPlaceholders, getLineNumber;

describe('background.js', () => {
    beforeEach(() => {
        const exports = executeTestFunctions();
        processTextChunk = exports.processTextChunk;
        getLastConsecutiveUserRecords = exports.getLastConsecutiveUserRecords;
        replaceCommandPlaceholders = exports.replaceCommandPlaceholders;
        getLineNumber = exports.getLineNumber;
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

    describe('getLineNumber', () => {
        it('returns line number information', () => {
            const lineNumber = getLineNumber();

            expect(lineNumber).toBeDefined();
            expect(typeof lineNumber).toBe('string');
        });

        it('returns "Unknown" when stack unavailable', () => {
            const originalError = Error;
            global.Error = class extends originalError {
                constructor() {
                    super();
                    this.stack = '';
                }
            };

            const lineNumber = getLineNumber();
            expect(lineNumber).toBe('Unknown');

            global.Error = originalError;
        });
    });
});
