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
    isMessagePersistableCode + '\n' + laiMainCode + '; return { laiExtractDataFromResponse, composeStreamingPreviewText, appendStreamChunkToRecipient, resetStreamTracking, clearStreamingRecipient, finaliseStreamRecipient, isMessagePersistable, setMarkdownSource, getMarkdownSource, copyChatElementContent, copyChatElementContentAsMarkdown, showNavigationConsent, dismissNavigationConsent, isNavigationConsentPending };'
);

let laiExtractDataFromResponse, composeStreamingPreviewText, appendStreamChunkToRecipient, resetStreamTracking, clearStreamingRecipient, finaliseStreamRecipient, isMessagePersistable;
let setMarkdownSource, getMarkdownSource, copyChatElementContent, copyChatElementContentAsMarkdown, showNavigationConsent, dismissNavigationConsent, isNavigationConsentPending;

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
        showNavigationConsent = exports.showNavigationConsent;
        dismissNavigationConsent = exports.dismissNavigationConsent;
        isNavigationConsentPending = exports.isNavigationConsentPending;
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

        it('falls back to streamed content for a malformed final response', async () => {
            const recipient = document.createElement('span');
            recipient._laiStreamContent = '- item';

            await finaliseStreamRecipient(recipient, { response: '{not json' });

            expect(global.parseAndRender.mock.calls[0][0]).toBe('- item');
            expect(recipient._laiMarkdownSource).toBe('- item');
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

    describe('navigation consent dialogue', () => {
        let root;

        const press = (target, key) => target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        const openDialogue = (requestId = 'req-1') => {
            const promise = showNavigationConsent({ requestId, url: 'https://example.com/jobs/1' });
            return { promise, dialogue: () => root.querySelector('.lai-navigation-consent') };
        };

        beforeEach(() => {
            document.body.innerHTML = '<div id="root"><div id="laiSidebar" class="active"></div><div id="laiMainButton"></div><div id="laiChatMessageList"></div></div>';
            root = document.getElementById('root');
            global.getShadowRoot = vi.fn(() => ({
                getElementById: (id) => root.querySelector(`#${id}`)
            }));
        });

        it('shows the destination and explains that Allow persists, with allow once focused', async () => {
            const { dialogue } = openDialogue();
            await Promise.resolve();

            expect(dialogue().textContent).toContain('https://example.com/jobs/1');
            expect(dialogue().textContent).toMatch(/"Allow" also turns on "Allow navigation"/);
            expect([...dialogue().querySelectorAll('button')].map(b => b.textContent)).toEqual(['Allow', 'Allow only this time', 'Cancel']);
            expect(document.activeElement?.dataset?.choice).toBe('once');
            expect(isNavigationConsentPending()).toBe(true);
        });

        it.each([
            ['allow'], ['once'], ['cancel']
        ])('resolves %s from its button and removes the dialogue', async (choice) => {
            const { promise, dialogue } = openDialogue();
            await Promise.resolve();
            dialogue().querySelector(`button[data-choice="${choice}"]`).click();

            await expect(promise).resolves.toEqual({ choice });
            expect(dialogue()).toBeNull();
            expect(isNavigationConsentPending()).toBe(false);
        });

        it('Enter outside a button defaults to allow once', async () => {
            const { promise, dialogue } = openDialogue();
            await Promise.resolve();
            press(dialogue().querySelector('code'), 'Enter');
            await expect(promise).resolves.toEqual({ choice: 'once' });
        });

        it('Enter on an explicitly focused button is left to the button', async () => {
            const { promise, dialogue } = openDialogue();
            await Promise.resolve();
            const cancel = dialogue().querySelector('button[data-choice="cancel"]');
            cancel.focus();
            const event = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
            cancel.dispatchEvent(event);

            expect(event.defaultPrevented).toBe(false);
            expect(isNavigationConsentPending()).toBe(true);
            cancel.click();
            await expect(promise).resolves.toEqual({ choice: 'cancel' });
        });

        it('Escape cancels', async () => {
            const { promise, dialogue } = openDialogue();
            await Promise.resolve();
            press(dialogue(), 'Escape');
            await expect(promise).resolves.toEqual({ choice: 'cancel' });
        });

        it('background dismissal cancels the matching dialogue', async () => {
            const { promise, dialogue } = openDialogue('req-9');
            await Promise.resolve();
            dismissNavigationConsent('other');
            expect(dialogue()).not.toBeNull();
            dismissNavigationConsent('req-9');
            await expect(promise).resolves.toEqual({ choice: 'cancel' });
        });

        it('opens a closed sidebar so the question is visible', async () => {
            root.querySelector('#laiSidebar').classList.remove('active');
            const { dialogue } = openDialogue();
            await vi.waitFor(() => expect(dialogue()).not.toBeNull());
            expect(root.querySelector('#laiSidebar').classList.contains('active')).toBe(true);
        });

        it('reports an unavailable UI without rendering anything', async () => {
            global.getShadowRoot = vi.fn(() => null);
            await expect(showNavigationConsent({ url: 'https://example.com/' })).resolves.toEqual({ choice: 'unavailable' });
        });
    });
});
