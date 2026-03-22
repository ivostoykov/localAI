import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const laiMainCode = fs.readFileSync(
    path.join(__dirname, '../src/lai-main.js'),
    'utf-8'
);

const utilsCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/utils.js'),
    'utf-8'
);

// Setup DOM environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = dom.window;
global.manifest = {
    name: 'Local AI helper',
    version: '1.29.17'
};

// Mock dependencies
global.chrome = {
    runtime: {
        sendMessage: vi.fn(),
        onMessage: {
            addListener: vi.fn()
        }
    }
};

// Extract isMessagePersistable from utils
const isMessagePersistableCode = utilsCode.match(/function isMessagePersistable\([\s\S]*?\n}\n/)[0];

// Extract the functions we want to test
const executeLaiMainCode = new Function('document', 'window', 'manifest', 'chrome', 'isMessagePersistable',
    isMessagePersistableCode + '\n' + laiMainCode + '; return { laiExtractDataFromResponse, isMessagePersistable };'
);

let laiExtractDataFromResponse, isMessagePersistable;

describe('lai-main.js', () => {
    beforeEach(() => {
        // Mock getLineNumber
        global.getLineNumber = () => 'test:1';

        // Mock showMessage
        global.showMessage = vi.fn();

        // Mock setModelNameLabel
        global.setModelNameLabel = vi.fn();

        const exports = executeLaiMainCode(global.document, global.window, global.manifest, global.chrome, global.isMessagePersistable);
        laiExtractDataFromResponse = exports.laiExtractDataFromResponse;
        isMessagePersistable = exports.isMessagePersistable;
    });

    describe('laiExtractDataFromResponse', () => {
        it('extracts content from response without thinking', () => {
            const response = {
                response: JSON.stringify({
                    model: 'test-model',
                    message: {
                        role: 'assistant',
                        content: 'This is the response content'
                    }
                })
            };

            const result = laiExtractDataFromResponse(response);

            expect(result).toBe('This is the response content');
            expect(global.setModelNameLabel).toHaveBeenCalledWith('test-model');
        });

        it('extracts and wraps thinking content before main content', () => {
            const response = {
                response: JSON.stringify({
                    model: 'thinking-model',
                    message: {
                        role: 'assistant',
                        content: 'Final answer here',
                        thinking: 'Let me think about this problem...'
                    }
                })
            };

            const result = laiExtractDataFromResponse(response);

            expect(result).toContain('<think>');
            expect(result).toContain('Let me think about this problem...');
            expect(result).toContain('</think>');
            expect(result).toContain('Final answer here');
            expect(result.indexOf('<think>')).toBeLessThan(result.indexOf('Final answer here'));
        });

        it('skips response with only thinking and no content (not persisted)', () => {
            const response = {
                response: JSON.stringify({
                    model: 'thinking-model',
                    message: {
                        role: 'assistant',
                        content: '',
                        thinking: 'Just thinking, no answer yet'
                    }
                })
            };

            const result = laiExtractDataFromResponse(response);

            // Thinking-only responses are not persisted in history, so should not be displayed
            expect(result).toBe('');
            expect(result).not.toContain('<think>');
            expect(result).not.toContain('Just thinking, no answer yet');
        });

        it('handles response with empty thinking', () => {
            const response = {
                response: JSON.stringify({
                    model: 'test-model',
                    message: {
                        role: 'assistant',
                        content: 'Content without thinking',
                        thinking: ''
                    }
                })
            };

            const result = laiExtractDataFromResponse(response);

            expect(result).toBe('Content without thinking');
            expect(result).not.toContain('<think>');
        });

        it('handles response with whitespace-only thinking', () => {
            const response = {
                response: JSON.stringify({
                    model: 'test-model',
                    message: {
                        role: 'assistant',
                        content: 'Content here',
                        thinking: '   \n  \t  '
                    }
                })
            };

            const result = laiExtractDataFromResponse(response);

            expect(result).toBe('Content here');
            expect(result).not.toContain('<think>');
        });

        it('handles response without thinking field', () => {
            const response = {
                response: JSON.stringify({
                    model: 'standard-model',
                    message: {
                        role: 'assistant',
                        content: 'Standard response'
                    }
                })
            };

            const result = laiExtractDataFromResponse(response);

            expect(result).toBe('Standard response');
            expect(result).not.toContain('<think>');
        });

        it('trims thinking content', () => {
            const response = {
                response: JSON.stringify({
                    model: 'thinking-model',
                    message: {
                        role: 'assistant',
                        content: 'Answer',
                        thinking: '  \n  Thinking with whitespace  \n  '
                    }
                })
            };

            const result = laiExtractDataFromResponse(response);

            expect(result).toContain('<think>\nThinking with whitespace\n</think>');
        });

        it('returns empty string for invalid JSON', () => {
            const response = {
                response: 'invalid json {'
            };

            const result = laiExtractDataFromResponse(response);

            expect(result).toBe('');
            expect(global.showMessage).toHaveBeenCalled();
        });

        it('handles response with missing message', () => {
            const response = {
                response: JSON.stringify({
                    model: 'test-model'
                })
            };

            const result = laiExtractDataFromResponse(response);

            expect(result).toBe('');
        });

        it('handles response with null content', () => {
            const response = {
                response: JSON.stringify({
                    model: 'test-model',
                    message: {
                        role: 'assistant',
                        content: null
                    }
                })
            };

            const result = laiExtractDataFromResponse(response);

            expect(result).toBe('');
        });

        it('preserves multi-line thinking content', () => {
            const multiLineThinking = `First line of thinking
Second line of thinking
Third line of thinking`;

            const response = {
                response: JSON.stringify({
                    model: 'thinking-model',
                    message: {
                        role: 'assistant',
                        content: 'Final answer',
                        thinking: multiLineThinking
                    }
                })
            };

            const result = laiExtractDataFromResponse(response);

            expect(result).toContain(multiLineThinking);
            expect(result).toContain('<think>');
            expect(result).toContain('</think>');
        });

        it('handles response with both content and thinking being empty strings', () => {
            const response = {
                response: JSON.stringify({
                    model: 'test-model',
                    message: {
                        role: 'assistant',
                        content: '',
                        thinking: ''
                    }
                })
            };

            const result = laiExtractDataFromResponse(response);

            expect(result).toBe('');
            expect(result).not.toContain('<think>');
        });

        it('skips thinking-only responses (not persisted in history)', () => {
            const response = {
                response: JSON.stringify({
                    model: 'thinking-model',
                    message: {
                        role: 'assistant',
                        content: '',
                        thinking: 'Some internal reasoning without final answer'
                    }
                })
            };

            const result = laiExtractDataFromResponse(response);

            expect(result).toBe('');
            expect(result).not.toContain('<think>');
            expect(result).not.toContain('internal reasoning');
        });

        it('includes thinking when response has tool_calls but no content', () => {
            const response = {
                response: JSON.stringify({
                    model: 'thinking-model',
                    message: {
                        role: 'assistant',
                        content: '',
                        thinking: 'Deciding which tool to use',
                        tool_calls: [{ id: '1', function: { name: 'test_tool', arguments: '{}' } }]
                    }
                })
            };

            const result = laiExtractDataFromResponse(response);

            // Tool calls are persisted, so thinking should not be shown (content is empty)
            expect(result).toBe('');
        });
    });
});
