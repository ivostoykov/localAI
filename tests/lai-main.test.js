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
const laiMainExports = '; return { laiExtractDataFromResponse, composeStreamingPreviewText, appendStreamChunkToRecipient, resetStreamTracking, clearStreamingRecipient, finaliseStreamRecipient, isMessagePersistable, setMarkdownSource, getMarkdownSource, copyChatElementContent, copyChatElementContentAsMarkdown, addInputCardToUIChatHistory, laiShowCopyHint };';
const executeLaiMainCode = new Function('document', 'window', 'manifest', 'chrome', 'isMessagePersistable',
    isMessagePersistableCode + '\nconst checkExtensionState = () => true;\n' + laiMainCode + laiMainExports
);

let laiExtractDataFromResponse, composeStreamingPreviewText, appendStreamChunkToRecipient, resetStreamTracking, clearStreamingRecipient, finaliseStreamRecipient, isMessagePersistable;
let setMarkdownSource, getMarkdownSource, copyChatElementContent, copyChatElementContentAsMarkdown, addInputCardToUIChatHistory, laiShowCopyHint;

describe('lai-main.js', () => {
    beforeEach(() => {
        // Mock getLineNumber
        global.getLineNumber = () => 'test:1';

        // Mock showMessage
        global.showMessage = vi.fn();

        // Mock setModelNameLabel
        global.setModelNameLabel = vi.fn();

        // Content-script globals defined in content.js and solomd2html.js
        global.getShadowRoot = vi.fn(() => document);
        global.getSideBar = vi.fn(() => null);
        global.getOptions = vi.fn(async () => ({}));
        global.parseAndRender = vi.fn(async (markdown, element) => { element.textContent = markdown; });

        const exports = executeLaiMainCode(global.document, global.window, global.manifest, global.chrome, global.isMessagePersistable);
        laiExtractDataFromResponse = exports.laiExtractDataFromResponse;
        composeStreamingPreviewText = exports.composeStreamingPreviewText;
        appendStreamChunkToRecipient = exports.appendStreamChunkToRecipient;
        resetStreamTracking = exports.resetStreamTracking;
        clearStreamingRecipient = exports.clearStreamingRecipient;
        finaliseStreamRecipient = exports.finaliseStreamRecipient;
        isMessagePersistable = exports.isMessagePersistable;
        setMarkdownSource = exports.setMarkdownSource;
        getMarkdownSource = exports.getMarkdownSource;
        copyChatElementContent = exports.copyChatElementContent;
        copyChatElementContentAsMarkdown = exports.copyChatElementContentAsMarkdown;
        addInputCardToUIChatHistory = exports.addInputCardToUIChatHistory;
        laiShowCopyHint = exports.laiShowCopyHint;
    });

    describe('stream preview helpers', () => {
        it('composes preview text with thinking and content blocks', () => {
            const result = composeStreamingPreviewText({
                thinking: 'Reasoning',
                content: 'Answer'
            });

            expect(result).toBe('Thinking...\nReasoning\n\nAnswer');
        });

        it('appends stream chunk text to the recipient', () => {
            const recipient = document.createElement('span');

            const result = appendStreamChunkToRecipient(recipient, {
                model: 'test-model',
                thinkingDelta: 'Thinking',
                contentDelta: 'Answer',
                rawChunk: '{"message":{"content":"Answer"}}'
            });

            expect(result).toBe('Thinking...\nThinking\n\nAnswer');
            expect(recipient.textContent).toBe(result);
            expect(recipient.classList.contains('lai-stream-live')).toBe(true);
            expect(recipient._laiRawResponse).toContain('"content":"Answer"');
            expect(global.setModelNameLabel).toHaveBeenCalledWith('test-model');
        });

        it('clears temporary stream tracking without discarding raw debug data', () => {
            const recipient = document.createElement('span');
            recipient._laiStreamThinking = 'Thinking';
            recipient._laiStreamContent = 'Answer';
            recipient._laiRawResponse = '{"message":{"content":"Answer"}}';
            recipient.dataset.status = 'streaming';
            recipient.classList.add('lai-stream-live');

            resetStreamTracking(recipient);

            expect(recipient._laiStreamThinking).toBeUndefined();
            expect(recipient._laiStreamContent).toBeUndefined();
            expect(recipient._laiRawResponse).toContain('"content":"Answer"');
            expect(recipient.dataset.status).toBeUndefined();
            expect(recipient.classList.contains('lai-stream-live')).toBe(false);
        });

        it('removes live preview text when the final streamed response has no renderable content', async () => {
            const recipient = document.createElement('span');
            recipient.textContent = 'Thinking...\nPlanning a tool call';
            recipient._laiStreamThinking = 'Planning a tool call';
            recipient.dataset.status = 'streaming';
            recipient.classList.add('lai-stream-live');

            await finaliseStreamRecipient(recipient, {
                response: JSON.stringify({
                    model: 'thinking-model',
                    message: {
                        role: 'assistant',
                        content: '',
                        thinking: 'Planning a tool call'
                    }
                })
            });

            expect(recipient.textContent).toBe('');
            expect(recipient.dataset.status).toBeUndefined();
            expect(recipient.classList.contains('lai-stream-live')).toBe(false);
        });

        it('exposes the last raw response through the console helper', () => {
            document.body.innerHTML = `
                <div id="shadowRoot">
                    <div class="lai-ai-input">
                        <span class="lai-input-text"></span>
                    </div>
                </div>
            `;

            const recipient = document.querySelector('.lai-input-text');
            recipient._laiRawResponse = '{"message":{"content":"Answer"}}';

            expect(globalThis.localAIHelpers.getLastRawResponse()).toContain('"content":"Answer"');
            expect(globalThis.localAIHelpers.dumpLastRawResponse()).toContain('"content":"Answer"');
        });
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

    describe('stream finalisation and Markdown source', () => {
        const finalResponse = (message) => ({ response: JSON.stringify({ model: 'm', message: { role: 'assistant', ...message } }) });

        it('keeps a valid thinking-only final response unrendered even when thinking was streamed', async () => {
            const recipient = document.createElement('span');
            recipient._laiStreamThinking = 'Planning a tool call';

            await finaliseStreamRecipient(recipient, finalResponse({ content: '', thinking: 'Planning a tool call' }));

            expect(global.parseAndRender).not.toHaveBeenCalled();
            expect(recipient.textContent).toBe('');
            expect(getMarkdownSource(recipient)).toBe('');
        });

        it('records the assistant Markdown without the synthetic thinking wrapper', async () => {
            const recipient = document.createElement('span');
            const content = '## Result\n\nUse `<think>` tags like this:\n\n```html\n<think>example</think>\n```';

            await finaliseStreamRecipient(recipient, finalResponse({ content, thinking: 'Reasoning' }));

            expect(global.parseAndRender.mock.calls[0][0]).toBe(`<think>\nReasoning\n</think>\n\n${content}`);
            expect(recipient._laiMarkdownSource).toBe(content);
        });

        it('keeps partial answer content after an abort without a final response', async () => {
            const recipient = document.createElement('span');
            recipient._laiStreamThinking = 'Reasoning';
            recipient._laiStreamContent = '**Partial** answer';

            await finaliseStreamRecipient(recipient, { action: 'streamAbort' });

            expect(global.parseAndRender.mock.calls[0][0]).toBe('<think>\nReasoning\n</think>\n\n**Partial** answer');
            expect(recipient._laiMarkdownSource).toBe('**Partial** answer');
            expect(global.showMessage).not.toHaveBeenCalled();
        });

        it.each([
            ['a message without content or thinking', { message: { role: 'assistant' } }],
            ['array content', { message: { role: 'assistant', content: ['Final'] } }],
            ['non-string thinking', { message: { role: 'assistant', content: '', thinking: { text: 'x' } } }],
            ['null content', { message: { role: 'assistant', content: null } }],
            ['non-array tool calls', { message: { role: 'assistant', content: 'x', tool_calls: 'browse_url' } }],
            ['an array message', { message: [] }],
            ['no message', { model: 'm' }]
        ])('keeps the streamed answer when the final response has %s', async (label, finalBody) => {
            const recipient = document.createElement('span');
            recipient._laiStreamContent = '**Partial** answer';

            await finaliseStreamRecipient(recipient, { response: JSON.stringify(finalBody) });

            expect(global.parseAndRender.mock.calls[0][0]).toBe('**Partial** answer');
            expect(recipient._laiMarkdownSource).toBe('**Partial** answer');
        });

        it('falls back to streamed content for a malformed final response', async () => {
            const recipient = document.createElement('span');
            recipient._laiStreamContent = '- item';

            await finaliseStreamRecipient(recipient, { response: '{not json' });

            expect(global.parseAndRender.mock.calls[0][0]).toBe('- item');
            expect(recipient._laiMarkdownSource).toBe('- item');
        });
    });

    describe('stream abort cleanup', () => {
        const finalResponse = (message) => ({ response: JSON.stringify({ model: 'm', message: { role: 'assistant', ...message } }) });
        const createRecipient = () => {
            if (!document.getElementById('laiAbort')) {
                document.body.innerHTML = '<button id="laiAbort"></button><textarea id="laiUserInput"></textarea><div id="laiChatMessageList"></div>';
            }
            const recipient = document.createElement('span');
            document.getElementById('laiChatMessageList').appendChild(recipient);
            return recipient;
        };

        it('marks only the streaming reply when streamAbort finalises it', async () => {
            document.body.innerHTML = '';
            const first = createRecipient();
            global.parseAndRender.mockImplementationOnce(async (markdown, element) => {
                element.dispatchEvent(new window.CustomEvent('renderComplete', { bubbles: true }));
            });
            await finaliseStreamRecipient(first, finalResponse({ content: 'First' }));

            const second = createRecipient();
            second._laiStreamContent = 'Partial';
            document.getElementById('laiAbort').click();
            await finaliseStreamRecipient(second, { action: 'streamAbort' });

            expect(first.querySelector('.lai-aborted-text')).toBeNull();
            expect(second.querySelectorAll('.lai-aborted-text')).toHaveLength(1);
        });

        it('marks an aborted reply with no streamed content once', async () => {
            document.body.innerHTML = '';
            const recipient = createRecipient();

            await finaliseStreamRecipient(recipient, { action: 'streamAbort' });

            expect(recipient.querySelectorAll('.lai-aborted-text')).toHaveLength(1);
        });

        it('removes the abort listener when rendering fails', async () => {
            document.body.innerHTML = '';
            const recipient = createRecipient();
            global.parseAndRender.mockRejectedValueOnce(new Error('render failed'));

            await expect(finaliseStreamRecipient(recipient, finalResponse({ content: 'Answer' }))).rejects.toThrow('render failed');
            document.getElementById('laiAbort').click();

            expect(recipient.querySelector('.lai-aborted-text')).toBeNull();
        });
    });

    describe('Copy as Markdown', () => {
        let writeText;

        const buildCard = () => {
            document.body.innerHTML = `
                <div class="lai-ai-input">
                    <span class="lai-input-text"><h2>Title</h2><p><strong>bold</strong> text</p></span>
                    <span class="lai-chat-item-button" data-type="copy-md"><img></span>
                </div>`;
            const element = document.querySelector('.lai-input-text');
            Object.defineProperty(element, 'innerText', { value: 'Title\nbold text', configurable: true });
            return { element, event: { target: document.querySelector('img'), clientX: 0 } };
        };

        beforeEach(() => {
            writeText = vi.fn(async () => undefined);
            Object.defineProperty(global.navigator, 'clipboard', { value: { writeText }, configurable: true });
        });

        it('copies the recorded Markdown source with debug data absent', async () => {
            const { element, event } = buildCard();
            setMarkdownSource(element, '## Title\n\n**bold** text');

            await copyChatElementContentAsMarkdown(event, 'ai');

            expect(writeText).toHaveBeenCalledWith('## Title\n\n**bold** text');
        });

        it('uses raw debug chunks when no source was recorded', async () => {
            const { element, event } = buildCard();
            element._laiRawResponse = '{"message":{"content":"## Ti"}}\n{"message":{"content":"tle"}}\n';

            await copyChatElementContentAsMarkdown(event, 'ai');

            expect(writeText).toHaveBeenCalledWith('## Title');
        });

        it('leaves the clipboard untouched and warns when no Markdown is available', async () => {
            const { event } = buildCard();

            await copyChatElementContentAsMarkdown(event, 'ai');

            expect(writeText).not.toHaveBeenCalled();
            expect(global.showMessage).toHaveBeenCalledWith(expect.stringMatching(/Markdown source is not available/), 'warning');
        });

        it('clears an empty source instead of storing it', () => {
            const element = document.createElement('span');
            setMarkdownSource(element, 'text');
            setMarkdownSource(element, '  ');
            expect(element._laiMarkdownSource).toBeUndefined();
        });

        it('leaves the existing Copy action on rendered text', async () => {
            const { element, event } = buildCard();
            setMarkdownSource(element, '## Title');

            await copyChatElementContent(event, 'ai');

            expect(writeText).toHaveBeenCalledWith('Title\nbold text');
        });
    });

    describe('reply action accessibility', () => {
        beforeEach(() => {
            global.chrome.runtime.id = 'test-extension';
            global.chrome.runtime.getURL = path => `chrome-extension://test/${path}`;
            document.body.innerHTML = '<div id="laiChatMessageList"></div><div id="laiCopyHint"></div>';
        });

        it('renders named button controls with decorative icons for user and AI cards', async () => {
            await addInputCardToUIChatHistory('User request', 'user');
            await addInputCardToUIChatHistory('AI reply', 'ai');

            const userButtons = document.querySelectorAll('.lai-user-input button[type="button"]');
            const aiButtons = document.querySelectorAll('.lai-ai-input button[type="button"]');

            expect(userButtons).toHaveLength(6);
            expect(aiButtons).toHaveLength(5);
            expect([...userButtons, ...aiButtons].every(button => button.getAttribute('aria-label'))).toBe(true);
            expect([...userButtons, ...aiButtons].every(button => button.querySelector('img[alt=""]'))).toBe(true);
            expect(document.querySelector('.lai-ai-input [data-type="copy-md"]')).not.toBeNull();
        });

        it('reveals the toolbar when an action receives focus and hides it after focus leaves the card', async () => {
            await addInputCardToUIChatHistory('AI reply', 'ai');
            const card = document.querySelector('.lai-ai-input');
            const toolbar = card.querySelector('.lai-action-icons');
            const button = toolbar.querySelector('button');
            const outside = document.createElement('button');
            document.body.appendChild(outside);

            expect(toolbar.classList.contains('invisible')).toBe(false);
            expect(toolbar.classList.contains('lai-action-icons-hidden')).toBe(true);

            button.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
            expect(toolbar.classList.contains('lai-action-icons-hidden')).toBe(false);

            button.focus();
            card.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: true }));
            expect(toolbar.classList.contains('lai-action-icons-hidden')).toBe(false);

            button.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
            expect(toolbar.classList.contains('lai-action-icons-hidden')).toBe(true);
        });

        it('dispatches Copy from both the icon and its button', async () => {
            const writeText = vi.fn(async () => undefined);
            Object.defineProperty(global.navigator, 'clipboard', { value: { writeText }, configurable: true });
            await addInputCardToUIChatHistory('AI reply', 'ai');
            const text = document.querySelector('.lai-ai-input .lai-input-text');
            Object.defineProperty(text, 'innerText', { value: 'AI reply', configurable: true });
            const button = document.querySelector('.lai-ai-input [data-type="copy"]');

            button.querySelector('img').click();
            button.click();
            await Promise.resolve();

            expect(writeText).toHaveBeenCalledTimes(2);
            expect(writeText).toHaveBeenNthCalledWith(1, 'AI reply');
            expect(writeText).toHaveBeenNthCalledWith(2, 'AI reply');
        });

        it('positions the copy hint from the button for keyboard activation', () => {
            const hint = document.getElementById('laiCopyHint');
            const button = document.createElement('button');
            button.className = 'lai-chat-item-button';
            button.getBoundingClientRect = () => ({ left: 40, width: 20, bottom: 80 });
            document.body.appendChild(button);

            laiShowCopyHint({ target: button, detail: 0, clientX: 0, clientY: 0 });

            expect(hint.style.left).toBe('50px');
            expect(hint.style.top).toBe('80px');
        });
    });
});

describe('queryAI session identity (#29)', () => {
    const executeQueryAI = new Function('document', 'window', 'manifest', 'chrome', 'isMessagePersistable',
        isMessagePersistableCode + '\n' + laiMainCode + '; return { queryAI };'
    );
    let queryAI;
    let sendMessage;

    beforeEach(() => {
        global.getLineNumber = () => 'test:1';
        global.showMessage = vi.fn();
        global.getShadowRoot = vi.fn(() => document);
        global.getOptions = vi.fn(async () => ({ aiUrl: 'http://localhost:11434/api/chat' }));
        global.checkExtensionState = vi.fn(() => true);
        global.getModelModifiers = vi.fn(() => null);
        global.getCurrentSystemInstructions = vi.fn(() => '');
        global.updateStatusBar = vi.fn();
        global.resetStatusbar = vi.fn();
        global.getSideBar = vi.fn(() => document.body);
        sendMessage = vi.fn(async () => ({ status: 'success' }));
        const chrome = { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } };
        ({ queryAI } = executeQueryAI(global.document, global.window, global.manifest, chrome, global.isMessagePersistable));
    });

    it('sends the session id owned by this sidebar with the prompt', async () => {
        global.getOrCreateActiveSessionId = vi.fn(async () => 'sidebar-session');

        await queryAI('Hello');

        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'fetchData', sessionId: 'sidebar-session' }));
    });

    it('does not send a prompt when no session can be established', async () => {
        global.getOrCreateActiveSessionId = vi.fn(async () => null);

        await queryAI('Hello');

        expect(sendMessage).not.toHaveBeenCalled();
        expect(global.showMessage).toHaveBeenCalledWith(expect.stringContaining('reload the page'), 'error');
    });
});

describe('reconcileActiveSessionWithStorage (#29)', () => {
    const executeReconcile = new Function('document', 'window', 'manifest', 'chrome', 'isMessagePersistable',
        isMessagePersistableCode + '\n' + laiMainCode + '; return { reconcileActiveSessionWithStorage };'
    );
    let reconcileActiveSessionWithStorage;
    let activeId;
    const key = () => global.allSessionsStorageKey;

    beforeEach(() => {
        global.getLineNumber = () => 'test:1';
        global.showMessage = vi.fn();
        global.getShadowRoot = vi.fn(() => document);
        document.body.innerHTML = '<div id="laiChatMessageList"><div class="lai-chat-history">restored turn</div></div>' +
            '<div id="attachContainer" class="attachment-container active"><span class="attachment">job-ad.txt</span></div>';
        activeId = 'restored-session';
        global.getActiveSessionId = vi.fn(async () => activeId);
        global.deleteActiveSessionId = vi.fn(async () => { activeId = null; });
        const chrome = { runtime: { sendMessage: vi.fn(), onMessage: { addListener: vi.fn() } } };
        ({ reconcileActiveSessionWithStorage } = executeReconcile(global.document, global.window, global.manifest, chrome, global.isMessagePersistable));
    });

    it('unbinds and clears the panel when its restored session is deleted elsewhere', async () => {
        const changes = { [key()]: { oldValue: [{ id: 'restored-session' }, { id: 'other' }], newValue: [{ id: 'other' }] } };

        expect(await reconcileActiveSessionWithStorage(changes, 'local')).toBe(true);

        expect(activeId).toBeNull();
        expect(document.getElementById('laiChatMessageList').children).toHaveLength(0);
        expect(document.getElementById('attachContainer').children).toHaveLength(0);
        expect(document.getElementById('attachContainer').classList.contains('active')).toBe(false);
        expect(global.showMessage).toHaveBeenCalledWith(expect.stringContaining('deleted'), 'info');
    });

    it('reacts to all sessions being cleared', async () => {
        const changes = { [key()]: { oldValue: [{ id: 'restored-session' }] } };

        expect(await reconcileActiveSessionWithStorage(changes, 'local')).toBe(true);
        expect(activeId).toBeNull();
        expect(document.getElementById('attachContainer').children).toHaveLength(0);
        expect(document.getElementById('attachContainer').classList.contains('active')).toBe(false);
    });

    it('keeps the panel when its session still exists or was never stored yet', async () => {
        const stillThere = { [key()]: { oldValue: [{ id: 'restored-session' }], newValue: [{ id: 'restored-session' }, { id: 'new' }] } };
        const notYetStored = { [key()]: { oldValue: [{ id: 'other' }], newValue: [] } };

        expect(await reconcileActiveSessionWithStorage(stillThere, 'local')).toBe(false);
        expect(await reconcileActiveSessionWithStorage(notYetStored, 'local')).toBe(false);
        expect(await reconcileActiveSessionWithStorage({ unrelated: {} }, 'local')).toBe(false);
        expect(await reconcileActiveSessionWithStorage(stillThere, 'sync')).toBe(false);

        expect(activeId).toBe('restored-session');
        expect(document.getElementById('laiChatMessageList').children).toHaveLength(1);
        expect(document.getElementById('attachContainer').children).toHaveLength(1);
        expect(document.getElementById('attachContainer').classList.contains('active')).toBe(true);
    });
});
