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

const utilsCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/utils.js'),
    'utf-8'
);

// Extract only the pure functions we want to test
const processTextChunkCode = backgroundCode.match(/function processTextChunk\([\s\S]*?\n}\n/)[0];
const getLastConsecutiveUserRecordsCode = backgroundCode.match(/function getLastConsecutiveUserRecords\([\s\S]*?\n}\n/)[0];
const replaceCommandPlaceholdersCode = backgroundCode.match(/function replaceCommandPlaceholders\([\s\S]*?\n}\n/)[0];
const getLineNumberCode = 'function getLineNumber() { return "test:1"; }';
const isMessagePersistableCode = utilsCode.match(/function isMessagePersistable\([\s\S]*?\n}\n/)[0];
const sanitizeAssistantMessageForHistoryCode = backgroundCode.match(/function sanitizeAssistantMessageForHistory\([\s\S]*?\n}\n/)[0];
const normaliseStreamLineCode = backgroundCode.match(/function normaliseStreamLine\([\s\S]*?\n}\n/)[0];
const mergeStreamChunkBodyCode = backgroundCode.match(/function mergeStreamChunkBody\([\s\S]*?\n}\n/)[0];
const getStreamChunkUiPayloadCode = backgroundCode.match(/function getStreamChunkUiPayload\([\s\S]*?\n}\n/)[0];
const parsePositiveIntegerCode = backgroundCode.match(/function parsePositiveInteger\([\s\S]*?\n}\n/)[0];
const getAutomaticContextWindowCode = backgroundCode.match(/async function getAutomaticContextWindow\([\s\S]*?\n}\n/)[0];
const applyAutomaticModelOptionsCode = backgroundCode.match(/async function applyAutomaticModelOptions\([\s\S]*?\n}\n/)[0];
const handleResponseCode = backgroundCode.match(/async function handleResponse\([\s\S]*?\n}\n/)[0];
const getVisibleSessionMessagesCode = backgroundCode.match(/function getVisibleSessionMessages\([\s\S]*?\n}\n/)[0];
const generateAndUpdateSessionTitleCode = backgroundCode.match(/async function generateAndUpdateSessionTitle\([\s\S]*?\n}\n/)[0];
const normaliseGeneratedTitleCode = backgroundCode.match(/function normaliseGeneratedTitle\([\s\S]*?\n}\n/)[0];
const resolveModelNameForRequestCode = backgroundCode.match(/async function resolveModelNameForRequest\([\s\S]*?\n}\n/)[0];
const modelCanThinkCode = backgroundCode.match(/async function modelCanThink\([\s\S]*?\n}\n/)[0];
const modelCanUseToolsCode = backgroundCode.match(/async function modelCanUseTools\([\s\S]*?\n}\n/)[0];

const testFunctionsCode = `
${processTextChunkCode}
${getLastConsecutiveUserRecordsCode}
${replaceCommandPlaceholdersCode}
${getLineNumberCode}
${isMessagePersistableCode}
${sanitizeAssistantMessageForHistoryCode}
${normaliseStreamLineCode}
${mergeStreamChunkBodyCode}
${getStreamChunkUiPayloadCode}
${parsePositiveIntegerCode}
${getAutomaticContextWindowCode}
${applyAutomaticModelOptionsCode}
${handleResponseCode}
${getVisibleSessionMessagesCode}
${generateAndUpdateSessionTitleCode}
${normaliseGeneratedTitleCode}
${resolveModelNameForRequestCode}
${modelCanThinkCode}
${modelCanUseToolsCode}

return { processTextChunk, getLastConsecutiveUserRecords, replaceCommandPlaceholders, getLineNumber, isMessagePersistable, sanitizeAssistantMessageForHistory, normaliseStreamLine, mergeStreamChunkBody, getStreamChunkUiPayload, parsePositiveInteger, getAutomaticContextWindow, applyAutomaticModelOptions, handleResponse, getVisibleSessionMessages, generateAndUpdateSessionTitle, normaliseGeneratedTitle, resolveModelNameForRequest, modelCanThink, modelCanUseTools };
`;

const executeTestFunctions = new Function(testFunctionsCode);

let processTextChunk, getLastConsecutiveUserRecords, replaceCommandPlaceholders, getLineNumber, isMessagePersistable, sanitizeAssistantMessageForHistory, normaliseStreamLine, mergeStreamChunkBody, getStreamChunkUiPayload, parsePositiveInteger, getAutomaticContextWindow, applyAutomaticModelOptions, handleResponse, getVisibleSessionMessages, generateAndUpdateSessionTitle, normaliseGeneratedTitle, resolveModelNameForRequest, modelCanThink, modelCanUseTools;

describe('background.js', () => {
    beforeEach(() => {
        const exports = executeTestFunctions();
        processTextChunk = exports.processTextChunk;
        getLastConsecutiveUserRecords = exports.getLastConsecutiveUserRecords;
        replaceCommandPlaceholders = exports.replaceCommandPlaceholders;
        getLineNumber = exports.getLineNumber;
        isMessagePersistable = exports.isMessagePersistable;
        sanitizeAssistantMessageForHistory = exports.sanitizeAssistantMessageForHistory;
        normaliseStreamLine = exports.normaliseStreamLine;
        mergeStreamChunkBody = exports.mergeStreamChunkBody;
        getStreamChunkUiPayload = exports.getStreamChunkUiPayload;
        parsePositiveInteger = exports.parsePositiveInteger;
        getAutomaticContextWindow = exports.getAutomaticContextWindow;
        applyAutomaticModelOptions = exports.applyAutomaticModelOptions;
        handleResponse = exports.handleResponse;
        getVisibleSessionMessages = exports.getVisibleSessionMessages;
        generateAndUpdateSessionTitle = exports.generateAndUpdateSessionTitle;
        normaliseGeneratedTitle = exports.normaliseGeneratedTitle;
        resolveModelNameForRequest = exports.resolveModelNameForRequest;
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

    describe('getVisibleSessionMessages', () => {
        it('keeps visible user and assistant messages only', () => {
            const result = getVisibleSessionMessages([
                { role: 'system', content: 'System instructions' },
                { role: 'user', content: '[PAGE CONTENT]:\nPage text' },
                { role: 'user', content: '[ATTACHMENT SNIPPET]:\nSelected text' },
                { role: 'user', content: 'User prompt' },
                { role: 'assistant', content: 'Assistant reply' },
                { role: 'assistant', content: 'Tool request', tool_calls: [{ function: { name: 'tool' } }] },
                { role: 'tool', content: 'Tool result' }
            ]);

            expect(result).toEqual([
                { role: 'user', content: 'User prompt' },
                { role: 'assistant', content: 'Assistant reply' }
            ]);
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

    describe('stream helpers', () => {
        it('normalises data-prefixed lines and skips done markers', () => {
            expect(normaliseStreamLine('data: {"a":1}')).toBe('{"a":1}');
            expect(normaliseStreamLine('data: [DONE]')).toBe('');
            expect(normaliseStreamLine('   ')).toBe('');
        });

        it('merges streamed content and thinking into one body', () => {
            const merged = mergeStreamChunkBody({}, {
                model: 'phi4:latest',
                message: {
                    role: 'assistant',
                    content: 'Hello',
                    thinking: 'Thinking'
                },
                done: false
            });

            const mergedAgain = mergeStreamChunkBody(merged, {
                message: {
                    content: ' world',
                    thinking: ' more'
                },
                done: true,
                done_reason: 'stop'
            });

            expect(mergedAgain.model).toBe('phi4:latest');
            expect(mergedAgain.message.content).toBe('Hello world');
            expect(mergedAgain.message.thinking).toBe('Thinking more');
            expect(mergedAgain.done).toBe(true);
            expect(mergedAgain.done_reason).toBe('stop');
        });

        it('builds UI payload from streamed chunk deltas', () => {
            const payload = getStreamChunkUiPayload({
                model: 'phi4:latest',
                message: {
                    content: 'Hi',
                    thinking: 'Let me think'
                }
            }, '{"model":"phi4:latest"}');

            expect(payload).toEqual({
                model: 'phi4:latest',
                contentDelta: 'Hi',
                thinkingDelta: 'Let me think',
                rawChunk: '{"model":"phi4:latest"}'
            });
        });
    });

    describe('parsePositiveInteger', () => {
        it('returns a positive integer for integer input', () => {
            expect(parsePositiveInteger(4096)).toBe(4096);
        });

        it('floors decimal input', () => {
            expect(parsePositiveInteger('4096.9')).toBe(4096);
        });

        it('returns null for empty or invalid input', () => {
            expect(parsePositiveInteger('')).toBe(null);
            expect(parsePositiveInteger('abc')).toBe(null);
            expect(parsePositiveInteger(0)).toBe(null);
        });
    });

    describe('getAutomaticContextWindow', () => {
        beforeEach(() => {
            global.getModelInfo = vi.fn();
            global.console = {
                error: vi.fn()
            };
            global.manifest = { name: 'Test' };
        });

        it('returns local model context window when available', async () => {
            global.getModelInfo.mockResolvedValue({
                source: 'local',
                contextWindow: 8192
            });

            const result = await getAutomaticContextWindow('phi4:latest');

            expect(result).toBe(8192);
        });

        it('returns null for cloud models', async () => {
            global.getModelInfo.mockResolvedValue({
                source: 'cloud',
                contextWindow: 131072
            });

            const result = await getAutomaticContextWindow('gpt-oss:120b-cloud');

            expect(result).toBe(null);
        });

        it('returns null when model info is missing or invalid', async () => {
            global.getModelInfo.mockResolvedValue({
                source: 'local',
                contextWindow: 0
            });

            const result = await getAutomaticContextWindow('broken-model');

            expect(result).toBe(null);
        });
    });

    describe('applyAutomaticModelOptions', () => {
        beforeEach(() => {
            global.getModelInfo = vi.fn();
            global.console = {
                error: vi.fn()
            };
            global.manifest = { name: 'Test' };
        });

        it('preserves explicitly provided num_ctx', async () => {
            const requestData = {
                options: {
                    num_ctx: '2048',
                    temperature: 0.2
                }
            };

            const result = await applyAutomaticModelOptions(requestData, 'phi4:latest');

            expect(result.options.num_ctx).toBe(2048);
            expect(global.getModelInfo).not.toHaveBeenCalled();
        });

        it('injects automatic num_ctx for local models when absent', async () => {
            global.getModelInfo.mockResolvedValue({
                source: 'local',
                contextWindow: 32768
            });
            const requestData = {
                options: {
                    temperature: 0.2
                }
            };

            const result = await applyAutomaticModelOptions(requestData, 'phi4:latest');

            expect(result.options.num_ctx).toBe(32768);
            expect(result.options.temperature).toBe(0.2);
        });

        it('does not inject num_ctx for cloud models', async () => {
            global.getModelInfo.mockResolvedValue({
                source: 'cloud',
                contextWindow: 131072
            });
            const requestData = {
                options: {
                    temperature: 0.2
                }
            };

            const result = await applyAutomaticModelOptions(requestData, 'gpt-oss:120b-cloud');

            expect(result.options.num_ctx).toBeUndefined();
            expect(result.options.temperature).toBe(0.2);
        });

        it('leaves request data unchanged when no options are resolved', async () => {
            global.getModelInfo.mockResolvedValue({
                source: 'local',
                contextWindow: null
            });
            const requestData = {};

            const result = await applyAutomaticModelOptions(requestData, 'phi4:latest');

            expect(result.options).toBeUndefined();
        });
    });

    describe('handleResponse', () => {
        beforeEach(() => {
            global.chrome = {
                runtime: {
                    lastError: null
                },
                tabs: {
                    sendMessage: vi.fn().mockResolvedValue(undefined)
                }
            };
            global.showUIMessage = vi.fn();
            global.console = {
                debug: vi.fn(),
                error: vi.fn()
            };
            global.manifest = { name: 'Test' };
        });

        it('sends a single streamEnd message with the final response payload', async () => {
            await handleResponse({ message: { content: 'Hello' } }, 123);

            expect(global.chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
            expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(123, {
                action: 'streamEnd',
                response: JSON.stringify({ message: { content: 'Hello' } })
            });
        });

        it('sends an empty streamEnd message when no response data exists', async () => {
            await handleResponse('', 123);

            expect(global.chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
            expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(123, {
                action: 'streamEnd'
            });
        });
    });

    describe('normaliseGeneratedTitle', () => {
        it('keeps a plain short title', () => {
            expect(normaliseGeneratedTitle('Browser session summary')).toBe('Browser session summary');
        });

        it('strips labels, punctuation, and extra words', () => {
            expect(normaliseGeneratedTitle('Title: Review the model-picker, please.')).toBe('Review the model-picker please');
        });

        it('uses the first non-empty line only', () => {
            expect(normaliseGeneratedTitle('\nModel list refresh\nExtra explanation')).toBe('Model list refresh');
        });
    });

    describe('generateAndUpdateSessionTitle', () => {
        beforeEach(() => {
            global.console = {
                error: vi.fn()
            };
        });

        it('updates the requested session by id', async () => {
            let sessions = [
                {
                    id: 'session-1',
                    title: 'New session',
                    messages: [{ role: 'user', content: 'First prompt' }]
                },
                {
                    id: 'session-2',
                    title: 'Current session',
                    messages: [{ role: 'user', content: 'Other prompt' }]
                }
            ];
            global.generateSessionTitle = vi.fn(async () => 'Generated topic');
            global.getAllSessions = vi.fn(async () => sessions);
            global.setAllSessions = vi.fn(async updatedSessions => {
                sessions = updatedSessions;
                return true;
            });
            global.getActiveSession = vi.fn();

            const result = await generateAndUpdateSessionTitle('First prompt', 'session-1', { id: 123 });

            expect(result).toBe(true);
            expect(global.generateSessionTitle).toHaveBeenCalledWith('First prompt', { id: 123 });
            expect(global.getActiveSession).not.toHaveBeenCalled();
            expect(sessions[0]).toMatchObject({
                id: 'session-1',
                title: 'Generated topic',
                titleGenerated: true
            });
            expect(sessions[1].title).toBe('Current session');
        });

        it('does not overwrite a session that was manually renamed while the title was generated', async () => {
            const sessions = [
                {
                    id: 'session-1',
                    title: 'Manual title',
                    titleManual: true,
                    messages: [{ role: 'user', content: 'First prompt' }]
                }
            ];
            global.generateSessionTitle = vi.fn(async () => 'Generated topic');
            global.getAllSessions = vi.fn(async () => sessions);
            global.setAllSessions = vi.fn(async () => true);

            const result = await generateAndUpdateSessionTitle('First prompt', 'session-1', { id: 123 });

            expect(result).toBe(false);
            expect(global.setAllSessions).not.toHaveBeenCalled();
            expect(sessions[0].title).toBe('Manual title');
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

    describe('resolveModelNameForRequest', () => {
        beforeEach(() => {
            global.getModelInfo = vi.fn();
            global.dumpInFrontConsole = vi.fn();
            global.console = {
                debug: vi.fn(),
                error: vi.fn()
            };
            global.manifest = { name: 'Test' };
        });

        it('returns the resolved model name when an alias was mapped', async () => {
            global.getModelInfo.mockResolvedValue({
                resolvedModelName: 'deepseek-v3.1:671b:cloud'
            });

            const result = await resolveModelNameForRequest('deepseek-v3.1:671b', false, { id: 123 });

            expect(result).toBe('deepseek-v3.1:671b:cloud');
            expect(global.dumpInFrontConsole).toHaveBeenCalled();
        });

        it('throws when model info resolution fails', async () => {
            global.getModelInfo.mockResolvedValue({
                error: 'Model not found'
            });

            await expect(resolveModelNameForRequest('missing-model')).rejects.toThrow('Model not found');
        });
    });
});
