import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const laiMainCode = fs.readFileSync(
    path.join(__dirname, '../src/lai-main.js'),
    'utf-8'
);

const tabStateCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/tab-state.js'),
    'utf-8'
);

const utilsCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/utils.js'),
    'utf-8'
);

const ribbonCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/ribbon.js'),
    'utf-8'
);
const contentCleanerCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/content-cleaner.js'),
    'utf-8'
);

// Setup DOM environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = dom.window;
global.sidebarChannel = { request: async (action, payload) => action === "readPage" ? global.getEnhancedPageContent() : payload };
global.manifest = {
    name: 'Local AI helper',
    version: '1.29.17'
};
global.hideSessionDeleteConfirm = vi.fn();

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
const laiMainExports = '; return { laiExtractDataFromResponse, composeStreamingPreviewText, appendStreamChunkToRecipient, resetStreamTracking, clearStreamingRecipient, finaliseStreamRecipient, messageProcessor, setActiveStreamRequestId: value => activeStreamRequestId = value, getActiveStreamRequestId: () => activeStreamRequestId, setActiveStreamSeq: value => activeStreamSeq = value, getActiveStreamSeq: () => activeStreamSeq, isMessagePersistable, setMarkdownSource, getMarkdownSource, copyChatElementContent, copyChatElementContentAsMarkdown, addInputCardToUIChatHistory, laiShowCopyHint, restoreTabSessionFromBackground, laiAbortRequest, laiSwapSidebarWithButton, openSidebarPanelIfClosed, reportTabBinding, fetchTabStartupState, acknowledgeTabRequestSnapshot, getStreamResyncInFlight: () => streamResyncInFlight, checkCommandHandler, getSelectionText, showAttachment, userInputFocused, userInputBlurred };';
const frameCode = fs.readFileSync('src/sidebar-frame.js', 'utf8');
const viewCode = frameCode.slice(frameCode.indexOf('async function applySidebarState'), frameCode.indexOf('function showSidebarConnectionFailure'));
const executeLaiMainCode = new Function('document', 'window', 'manifest', 'chrome', 'getLineNumber', 'isMessagePersistable',
    tabStateCode + '\nlet userScrolled = false;\nconst stopSidebarSpeech = () => {};\n' + isMessagePersistableCode + '\nconst checkExtensionState = () => true;\n' + contentCleanerCode + '\n' + laiMainCode + '\nlet sidebarVisibility; let sidebarDraft;\n' + viewCode + laiMainExports
);

let laiExtractDataFromResponse, composeStreamingPreviewText, appendStreamChunkToRecipient, resetStreamTracking, clearStreamingRecipient, finaliseStreamRecipient, messageProcessor, setActiveStreamRequestId, getActiveStreamRequestId, isMessagePersistable;
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

        const exports = executeLaiMainCode(global.document, global.window, global.manifest, global.chrome, global.getLineNumber, global.isMessagePersistable);
        laiExtractDataFromResponse = exports.laiExtractDataFromResponse;
        composeStreamingPreviewText = exports.composeStreamingPreviewText;
        appendStreamChunkToRecipient = exports.appendStreamChunkToRecipient;
        resetStreamTracking = exports.resetStreamTracking;
        clearStreamingRecipient = exports.clearStreamingRecipient;
        finaliseStreamRecipient = exports.finaliseStreamRecipient;
        messageProcessor = exports.messageProcessor;
        setActiveStreamRequestId = exports.setActiveStreamRequestId;
        getActiveStreamRequestId = exports.getActiveStreamRequestId;
        isMessagePersistable = exports.isMessagePersistable;
        setMarkdownSource = exports.setMarkdownSource;
        getMarkdownSource = exports.getMarkdownSource;
        copyChatElementContent = exports.copyChatElementContent;
        copyChatElementContentAsMarkdown = exports.copyChatElementContentAsMarkdown;
        addInputCardToUIChatHistory = exports.addInputCardToUIChatHistory;
        laiShowCopyHint = exports.laiShowCopyHint;
    });

    describe('stream scroll following', () => {
        let chatList, recipient, scrollHeight, clientHeight, scrollChatHistoryContainer, getUserScrolled;
        let sidebar, sidebarCode, frames, onResize;

        function flushFrame() {
            for (const callback of frames.splice(0)) { callback(0); }
        }

        function addCard(text, type, top, height = 90) {
            return sidebarCode.addInputCardToUIChatHistory(text, type).then(content => {
                const card = content.parentElement;
                card.getBoundingClientRect = vi.fn(() => ({ top: 30 + top - chatList.scrollTop }));
                card.querySelector('.lai-input-text').getBoundingClientRect = vi.fn(() => ({ height }));
                card.querySelector('.lai-input-label > span').getBoundingClientRect = () => ({ height: 18 });
                return card;
            });
        }

        beforeEach(async () => {
            sidebar = document.createElement('section').attachShadow({ mode: 'open' });
            frames = [];
            Object.defineProperty(window, 'requestAnimationFrame', {
                configurable: true,
                value: callback => frames.push(callback)
            });
            sidebar.innerHTML = '<div id="feedbackMessage"></div><textarea id="laiUserInput"></textarea>' +
                '<div class="lai-user-area"></div><div class="lai-resize-handle"></div>' +
                '<div id="laiChatMessageList"><span></span></div>';
            chatList = sidebar.querySelector('#laiChatMessageList');
            recipient = chatList.firstElementChild;
            scrollHeight = 500;
            clientHeight = 100;
            let scrollTop = 400;
            chatList.getBoundingClientRect = () => ({ top: 28 });
            chatList.style.setProperty('--lai-chat-scroll-button-size', '24px');
            Object.defineProperty(chatList, 'clientTop', { value: 2 });
            Object.defineProperties(chatList, {
                clientHeight: { get: () => clientHeight },
                scrollHeight: { get: () => scrollHeight },
                scrollTop: {
                    get: () => scrollTop,
                    set: value => { scrollTop = Math.max(0, Math.min(value, scrollHeight - chatList.clientHeight)); }
                }
            });

            const stubs = {
                getOptions: async () => ({}),
                getRootElement: () => sidebar,
                getShadowRoot: () => sidebar,
                getRibbon: () => sidebar,
                getLineNumber: () => 'test:1',
                chrome: { runtime: { id: 'test', getURL: path => path } },
                checkExtensionState: () => true,
                ResizeObserver: class {
                    constructor(callback) { onResize = callback; }
                    observe() {}
                },
                ...Object.fromEntries([
                    'closeAllDropDownRibbonMenus', 'closeQuickPromptListMenu', 'userInputClicked',
                    'userInputBlurred', 'showUserInputRibbon', 'hideUserInputRibbon',
                    'onUserInputDragEnter', 'onUserInputDragLeave', 'initRibbon',
                    'hidePopups', 'laiSetImg', 'setModelNameLabel', 'buildMenuDropdowns',
                    'debugBtnInit', 'pageFilterBtnInit', 'resetStatusbar'
                ].map(name => [name, vi.fn()]))
            };
            const loadSidebar = new Function('document', 'manifest', ...Object.keys(stubs),
                'let userScrolled = false;\n' + laiMainCode +
                '; return { initSidebar, scrollChatHistoryContainer, getParseAndRenderOptions, addInputCardToUIChatHistory, appendStreamChunkToRecipient, getUserScrolled: () => userScrolled };'
            );
            sidebarCode = loadSidebar(document, global.manifest, ...Object.values(stubs));
            await sidebarCode.initSidebar(Date.now() + 1000);
            sidebarCode.getParseAndRenderOptions(recipient);
            ({ scrollChatHistoryContainer, getUserScrolled } = sidebarCode);
        });

        afterEach(() => {
            delete window.requestAnimationFrame;
        });

        function userScrollTo(top) {
            chatList.scrollTop = top;
            chatList.dispatchEvent(new window.Event('scroll'));
        }

        it('detects upward scrolling after a programmatic scroll that did not move the list', () => {
            scrollChatHistoryContainer();
            userScrollTo(250);

            expect(getUserScrolled()).toBe(true);
            scrollHeight = 600;
            scrollChatHistoryContainer();
            expect(chatList.scrollTop).toBe(250);
        });

        it('keeps following when content grows before a programmatic scroll event arrives', () => {
            scrollHeight = 600;
            scrollChatHistoryContainer();
            scrollHeight = 700;
            chatList.dispatchEvent(new window.Event('scroll'));

            expect(getUserScrolled()).toBe(false);
            scrollChatHistoryContainer();
            expect(chatList.scrollTop).toBe(600);
        });

        it('resumes following when the reader scrolls within 10 pixels of the bottom', () => {
            userScrollTo(250);
            expect(getUserScrolled()).toBe(true);

            userScrollTo(390);
            expect(getUserScrolled()).toBe(false);
            scrollHeight = 600;
            scrollChatHistoryContainer();
            expect(chatList.scrollTop).toBe(500);
        });

        it('coalesces append, scroll and resize updates and marks only clipped cards', async () => {
            const prompt = await addCard('Question', 'user', 20);
            const answer = await addCard('Answer', 'ai', 200);
            const nextPrompt = await addCard('Next question', 'user', 300);
            userScrollTo(200);
            onResize();

            expect(frames).toHaveLength(1);
            flushFrame();
            expect(chatList.classList.contains('lai-chat-can-scroll-down')).toBe(true);
            expect(prompt.classList.contains('lai-chat-start-clipped')).toBe(true);
            expect(answer.classList.contains('lai-chat-start-clipped')).toBe(false);
            expect(nextPrompt.classList.contains('lai-chat-start-clipped')).toBe(false);

            clientHeight = 300;
            onResize();
            flushFrame();
            expect(chatList.classList.contains('lai-chat-can-scroll-down')).toBe(false);

            sidebarCode.appendStreamChunkToRecipient(answer.querySelector('.lai-input-text'), { contentDelta: 'More text' });
            scrollHeight += 20;
            expect(frames).toHaveLength(1);
            flushFrame();
            expect(chatList.classList.contains('lai-chat-can-scroll-down')).toBe(true);

            userScrollTo(20);
            flushFrame();
            expect(prompt.classList.contains('lai-chat-start-clipped')).toBe(false);
        });

        it('qualifies cards by text height and remeasures them only when needed', async () => {
            const short = await addCard('One line', 'user', 20, 28);
            const tall = await addCard('Long answer', 'ai', 200, 66);
            const tallText = tall.querySelector('.lai-input-text');
            flushFrame();

            expect(short.classList.contains('lai-chat-tall')).toBe(false);
            expect(tall.classList.contains('lai-chat-tall')).toBe(true);

            tallText.getBoundingClientRect.mockClear().mockReturnValue({ height: 65 });
            userScrollTo(225);
            flushFrame();
            expect(tallText.getBoundingClientRect).not.toHaveBeenCalled();
            expect(tall.classList.contains('lai-chat-tall')).toBe(true);
            expect(tall.classList.contains('lai-chat-start-clipped')).toBe(true);
            expect(chatList.classList.contains('lai-chat-can-scroll-down')).toBe(true);

            onResize();
            flushFrame();
            expect(tall.classList.contains('lai-chat-tall')).toBe(false);
        });

        it('updates a streaming card as it grows and when final or restored Markdown renders', async () => {
            const card = await addCard('One line', 'ai', 200, 28);
            const text = card.querySelector('.lai-input-text');
            flushFrame();
            expect(card.classList.contains('lai-chat-tall')).toBe(false);

            text.getBoundingClientRect.mockReturnValue({ height: 80 });
            sidebarCode.appendStreamChunkToRecipient(text, { contentDelta: 'More text' });
            flushFrame();
            expect(card.classList.contains('lai-chat-tall')).toBe(true);

            text.getBoundingClientRect.mockReturnValue({ height: 28 });
            text.dispatchEvent(new window.Event('renderComplete', { bubbles: true }));
            flushFrame();
            expect(card.classList.contains('lai-chat-tall')).toBe(false);

            text.getBoundingClientRect.mockReturnValue({ height: 80 });
            text.dispatchEvent(new window.Event('renderComplete', { bubbles: true }));
            flushFrame();
            expect(card.classList.contains('lai-chat-tall')).toBe(true);
        });

        it('scrolls to the selected card and to the end, changing stream follow mode', async () => {
            const prompt = await addCard('Question', 'user', 50);
            const answer = await addCard('Answer', 'ai', 395);
            flushFrame();

            answer.querySelector('.lai-chat-scroll-up img').click();
            expect(chatList.scrollTop).toBe(395);
            chatList.dispatchEvent(new window.Event('scroll'));
            expect(getUserScrolled()).toBe(true);
            scrollHeight = 600;
            scrollChatHistoryContainer();
            expect(chatList.scrollTop).toBe(395);

            prompt.querySelector('.lai-chat-scroll-down').click();
            expect(chatList.scrollTop).toBe(500);
            expect(getUserScrolled()).toBe(false);
            scrollHeight = 650;
            scrollChatHistoryContainer();
            expect(chatList.scrollTop).toBe(550);
            flushFrame();
            expect(chatList.classList.contains('lai-chat-can-scroll-down')).toBe(false);
        });

        it('moves only the clipped User toolbar past the label', async () => {
            const prompt = await addCard('Question', 'user', 20);
            const answer = await addCard('Answer', 'ai', 35);
            const promptToolbar = prompt.querySelector('.lai-action-icons');
            const answerToolbar = answer.querySelector('.lai-action-icons');
            prompt.querySelector('.lai-input-label').getBoundingClientRect = () => ({ left: 24, right: 71, width: 47 });

            flushFrame();
            prompt.dispatchEvent(new window.MouseEvent('mouseenter'));
            userScrollTo(200);
            expect(promptToolbar.style.position).toBe('fixed');
            expect(promptToolbar.style.left).toBe('71px');
            expect(promptToolbar.style.top).toBe('28px');

            userScrollTo(0);
            expect(promptToolbar.style.position).toBe('absolute');
            expect(promptToolbar.style.left).toBe('');

            prompt.dispatchEvent(new window.MouseEvent('mouseleave'));
            answer.dispatchEvent(new window.MouseEvent('mouseenter'));
            userScrollTo(200);
            expect(answerToolbar.style.position).toBe('fixed');
            expect(answerToolbar.style.left).toBe('');
        });

        it('keeps the reader’s position when rendering completes', () => {
            userScrollTo(250);
            expect(getUserScrolled()).toBe(true);

            scrollHeight = 600;
            recipient.dispatchEvent(new window.Event('renderComplete'));
            expect(chatList.scrollTop).toBe(250);
        });
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

    describe('stream request identity', () => {
        it.each(['streamData', 'streamEnd', 'streamAbort', 'streamError'])('ignores foreign and missing %s messages', async (action) => {
            setActiveStreamRequestId('own');
            const before = document.body.innerHTML;
            await expect(messageProcessor({ action, requestId: 'other' }, {})).resolves.toEqual({ requestId: null });
            await expect(messageProcessor({ action }, {})).resolves.toEqual({ requestId: null });
            expect(document.body.innerHTML).toBe(before);
        });

        it.each(['streamEnd', 'streamAbort', 'streamError'])('acknowledges and clears its own %s terminal message', async (action) => {
            document.body.innerHTML = '<div class="lai-ai-input"><span class="lai-input-text" id="laiActiveAiInput"></span></div><textarea id="laiUserInput"></textarea><button id="laiAbort"></button>';
            document.body.classList.add('active');
            global.getSideBar = vi.fn(() => document.body);
            setActiveStreamRequestId('own');
            await expect(messageProcessor({ action, requestId: 'own', response: JSON.stringify({ message: { content: '' } }) }, {})).resolves.toEqual({ requestId: 'own' });
            expect(getActiveStreamRequestId()).toBeNull();
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


    describe('answer-only clipboard (#95)', () => {
        let writeText;
        let element;
        let event;

        beforeEach(() => {
            document.body.innerHTML = '<div class="lai-ai-input"><span class="lai-input-text"></span><button class="lai-chat-item-button"></button></div><div id="laiCopyHint"></div>';
            element = document.querySelector('.lai-input-text');
            event = { target: document.querySelector('button'), clientX: 0, clientY: 0 };
            writeText = vi.fn(async () => undefined);
            Object.defineProperty(global.navigator, 'clipboard', { value: { writeText }, configurable: true });
            const visibleText = node => {
                if (node.nodeType === window.Node.TEXT_NODE) return node.textContent;
                if (node.style?.display === 'none') return '';
                return Array.from(node.childNodes, visibleText).join('');
            };
            Object.defineProperty(element, 'innerText', { get: () => visibleText(element), configurable: true });
        });

        it.each([true, false])('excludes reasoning with open=%s and restores all inline displays', async open => {
            element.innerHTML = `<details class="think-block" ${open ? 'open' : ''}><summary>Thought</summary>Secret</details><p>Answer</p><details class="think-block" style="display: block !important"><summary>Thought</summary>More reasoning</details>`;
            const blocks = [...element.querySelectorAll('.think-block')];
            await copyChatElementContent(event, 'ai');
            expect(writeText).toHaveBeenCalledWith('Answer');
            expect(blocks.map(block => block.style.display)).toEqual(['', 'block']);
            expect(blocks[1].style.getPropertyPriority('display')).toBe('important');
            expect(blocks[0].open).toBe(open);
        });

        it('preserves line breaks and code without reasoning', async () => {
            element.innerHTML = '<p>Answer\nsecond line</p>\n<pre><code>const x = 1;\nrun(x);</code></pre>';
            await copyChatElementContent(event, 'ai');
            expect(writeText).toHaveBeenCalledWith('Answer\nsecond line\nconst x = 1;\nrun(x);');
        });

        it('copies a restored answer rendered from saved Markdown', async () => {
            const solomdCode = fs.readFileSync(path.join(__dirname, '../src/jslib/solomd2html.js'), 'utf-8');
            const parseAndRender = new Function('document', 'DocumentFragment', 'CustomEvent', 'Node', 'navigator', solomdCode + '; return parseAndRender;')(
                document, window.DocumentFragment, window.CustomEvent, window.Node, global.navigator
            );
            const markdown = '<think>\nPrivate reasoning\n</think>\n\n**Saved answer**';
            await parseAndRender(markdown, element, { streamReply: false });
            setMarkdownSource(element, markdown);
            expect(element.querySelector('.think-block')).not.toBeNull();
            await copyChatElementContent(event, 'ai');
            expect(writeText.mock.calls[0][0].trim()).toBe('Saved answer');
            expect(element.querySelector('.think-block').style.display).toBe('');
            expect(getMarkdownSource(element)).toBe(markdown);
        });

        it('restores displays even if reading innerText throws', async () => {
            element.innerHTML = '<details class="think-block" style="display: block">Reasoning</details>';
            Object.defineProperty(element, 'innerText', { get: () => { throw new Error('layout failed'); }, configurable: true });
            await expect(copyChatElementContent(event, 'ai')).rejects.toThrow('layout failed');
            expect(element.firstElementChild.style.display).toBe('block');
            expect(writeText).not.toHaveBeenCalled();
        });

        it('leaves user copy unchanged, including reasoning-shaped markup', async () => {
            element.parentElement.className = 'lai-user-input';
            element.innerHTML = '<details class="think-block"><summary>Thought</summary>User text</details>\nPrompt';
            await copyChatElementContent(event, 'user');
            expect(writeText).toHaveBeenCalledWith('ThoughtUser text\nPrompt');
        });

        it.each(['copy', 'copy-md'])('warns without writing for reasoning-only %s', async action => {
            element.innerHTML = '<details class="think-block"><summary>Thought</summary>Private reasoning</details>  ';
            setMarkdownSource(element, '<think>Private reasoning</think>  ');
            const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
            try {
                await (action === 'copy' ? copyChatElementContent : copyChatElementContentAsMarkdown)(event, 'ai');
                expect(writeText).not.toHaveBeenCalled();
                expect(global.showMessage).toHaveBeenCalledWith('Nothing to copy: this response contains only reasoning.', 'warning');
                expect(debug).toHaveBeenCalledWith(expect.stringMatching(/^>>> Local AI helper - \[test:1\] - Nothing to copy/));
            } finally {
                debug.mockRestore();
            }
        });

        it.each([
            ['<THINK>First\nreason</THINK>## Answer\n\n```js\nrun();\n```<think>Second reason</think>', '## Answer\n\n```js\nrun();\n```'],
            ['## Answer\n\n**Keep this**\n<think>Unfinished\nreasoning', '## Answer\n\n**Keep this**']
        ])('strips inline reasoning from Markdown without changing the stored source', async (source, answer) => {
            setMarkdownSource(element, source);
            await copyChatElementContentAsMarkdown(event, 'ai');
            expect(writeText).toHaveBeenCalledWith(answer);
            expect(getMarkdownSource(element)).toBe(source);
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

            const userButtons = document.querySelectorAll('.lai-user-input .lai-action-icons button[type="button"]');
            const aiButtons = document.querySelectorAll('.lai-ai-input .lai-action-icons button[type="button"]');

            expect(userButtons).toHaveLength(5);
            expect(aiButtons).toHaveLength(4);
            expect([...userButtons, ...aiButtons].every(button => button.getAttribute('aria-label'))).toBe(true);
            expect([...userButtons, ...aiButtons].every(button => button.querySelector('img[alt=""]'))).toBe(true);
            expect(document.querySelector('.lai-ai-input [data-type="copy-md"]')).not.toBeNull();
            expect(document.querySelector('[data-type="insert"]')).toBeNull();
            expect([...aiButtons].map(button => button.dataset.type)).toEqual(['copy', 'copy-md', 'increase', 'decrease']);
            expect([...userButtons].map(button => button.dataset.type)).toEqual(['copy', 'increase', 'decrease', 'edit', 'add']);
        });

        it('removes short-card arrows from layout and shows eligible tall-card arrows', async () => {
            const stylesheet = document.createElement('style');
            stylesheet.textContent = fs.readFileSync(path.join(__dirname, '../src/css/sidebar.css'), 'utf-8');
            document.head.appendChild(stylesheet);
            try {
                const list = document.getElementById('laiChatMessageList');
                list.classList.add('lai-chat-message-list', 'lai-chat-can-scroll-down');
                const text = await addInputCardToUIChatHistory('AI reply', 'ai');
                const card = text.parentElement;
                card.classList.add('lai-chat-start-clipped');
                const buttons = [...card.querySelectorAll('.lai-chat-scroll-button')];

                expect(buttons.map(button => window.getComputedStyle(button).display)).toEqual(['none', 'none']);
                card.classList.add('lai-chat-tall');
                expect(buttons.map(button => window.getComputedStyle(button).display)).toEqual(['grid', 'grid']);
                expect(buttons.map(button => window.getComputedStyle(button).visibility)).toEqual(['visible', 'visible']);

                list.classList.remove('lai-chat-can-scroll-down');
                card.classList.remove('lai-chat-start-clipped');
                expect(buttons.map(button => window.getComputedStyle(button).visibility)).toEqual(['hidden', 'hidden']);
            } finally {
                stylesheet.remove();
            }
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

            button.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
            expect(toolbar.classList.contains('lai-action-icons-hidden')).toBe(true);
        });

        it('hides pointer-focused controls on mouse leave but keeps keyboard-focused controls visible', async () => {
            await addInputCardToUIChatHistory('AI reply', 'ai');
            const card = document.querySelector('.lai-ai-input');
            const toolbar = card.querySelector('.lai-action-icons');
            const button = toolbar.querySelector('button');

            button.matches = vi.fn(() => false);
            button.focus();
            card.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: true }));
            expect(toolbar.classList.contains('lai-action-icons-hidden')).toBe(true);

            button.matches = vi.fn(selector => selector === ':focus-visible');
            button.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
            card.dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: true }));
            expect(toolbar.classList.contains('lai-action-icons-hidden')).toBe(false);
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

        it('copies only the message content from a card with scroll arrows', async () => {
            const writeText = vi.fn(async () => undefined);
            Object.defineProperty(global.navigator, 'clipboard', { value: { writeText }, configurable: true });
            const text = await addInputCardToUIChatHistory('AI reply', 'ai');
            Object.defineProperty(text, 'innerText', { value: 'AI reply', configurable: true });
            setMarkdownSource(text, '**AI reply**');
            const card = text.parentElement;

            card.querySelector('[data-type="copy"]').click();
            card.querySelector('[data-type="copy-md"]').click();
            await Promise.resolve();

            expect(writeText.mock.calls).toEqual([['AI reply'], ['**AI reply**']]);
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

        it('keeps the keyboard copy hint anchored when the event target is retargeted after copying', async () => {
            const button = document.createElement('button');
            button.className = 'lai-chat-item-button';
            button.getBoundingClientRect = () => ({ left: 40, width: 20, bottom: 80 });
            const card = document.createElement('div');
            card.className = 'lai-ai-input';
            const text = document.createElement('span');
            text.className = 'lai-input-text';
            Object.defineProperty(text, 'innerText', { value: 'AI reply', configurable: true });
            card.append(text, button);
            document.getElementById('laiChatMessageList').appendChild(card);

            let target = button;
            Object.defineProperty(global.navigator, 'clipboard', {
                value: { writeText: vi.fn(async () => { target = document.createElement('local-ai'); }) },
                configurable: true
            });
            const event = {
                get target() { return target; },
                detail: 0,
                clientX: 0,
                clientY: 0
            };

            await copyChatElementContent(event, 'ai');

            expect(document.getElementById('laiCopyHint').style.left).toBe('50px');
            expect(document.getElementById('laiCopyHint').style.top).toBe('80px');
        });
    });
});

describe('queryAI session identity (#29)', () => {
    const executeQueryAI = new Function('document', 'window', 'manifest', 'chrome', 'getLineNumber', 'isMessagePersistable',
        tabStateCode + '\n' + isMessagePersistableCode + '\n' + laiMainCode + '; return { queryAI };'
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
        document.body.classList.add('active');
        sendMessage = vi.fn(async () => ({ status: 'success' }));
        const chrome = { runtime: { sendMessage, onMessage: { addListener: vi.fn() } } };
        ({ queryAI } = executeQueryAI(global.document, global.window, global.manifest, chrome, global.getLineNumber, global.isMessagePersistable));
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
    const executeReconcile = new Function('document', 'window', 'manifest', 'chrome', 'getLineNumber', 'isMessagePersistable',
        tabStateCode + '\n' + isMessagePersistableCode + '\n' + laiMainCode + '; return { reconcileActiveSessionWithStorage };'
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
        ({ reconcileActiveSessionWithStorage } = executeReconcile(global.document, global.window, global.manifest, chrome, global.getLineNumber, global.isMessagePersistable));
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

describe('tab session restoration (#40)', () => {
    let restoreTabSessionFromBackground, messageProcessor, addInputCardToUIChatHistory, laiAbortRequest;
    let setActiveStreamRequestId, getActiveStreamRequestId, setActiveStreamSeq, getActiveStreamSeq, getStreamResyncInFlight;
    let sendMessage;
    let setActiveSessionId, getActiveSessionById, renderSessionHistoryMessages;
    let renderedSessions;
    let laiSwapSidebarWithButton, openSidebarPanelIfClosed;

    const seedSidebar = () => {
        document.body.innerHTML = `
            <div id="laiSidebar"><div class="statusbar"><span class="notification">Receiving and processing data...</span></div></div>
            <button id="laiMainButton"></button>
            <div id="laiChatMessageList"></div>
            <textarea id="laiUserInput"></textarea>
            <button id="laiAbort" class="invisible"></button>`;
    };

    const restore = () => restoreTabSessionFromBackground();

    beforeEach(() => {
        global.getLineNumber = () => 'test:1';
        global.showMessage = vi.fn();
        global.setModelNameLabel = vi.fn();
        global.getShadowRoot = vi.fn(() => document);
        global.getSideBar = vi.fn(() => document.getElementById('laiSidebar'));
        global.getOptions = vi.fn(async () => ({}));
        global.parseAndRender = vi.fn(async (markdown, element) => { element.textContent = markdown; });
        global.updateStatusBar = vi.fn();
        global.resetStatusbar = vi.fn();
        global.scrollChatHistoryContainer = undefined;
        global.chrome.runtime.getURL = path => `chrome-extension://test/${path}`;

        seedSidebar();
        renderedSessions = [];
        let boundSessionId = null;
        setActiveSessionId = vi.fn(async sessionId => { boundSessionId = sessionId; });
        global.getActiveSessionId = vi.fn(async () => boundSessionId);
        global.deleteActiveSessionId = vi.fn(async () => { boundSessionId = null; });
        getActiveSessionById = vi.fn(async sessionId => ({ id: sessionId, title: 'Bound', messages: [
            { role: 'user', content: 'question' },
            { role: 'assistant', content: 'answer' }
        ] }));
        renderSessionHistoryMessages = vi.fn(async session => {
            renderedSessions.push(session);
            const list = document.getElementById('laiChatMessageList');
            list.replaceChildren(...session.messages.map(message => {
                const card = document.createElement('div');
                card.className = message.role === 'assistant' ? 'lai-chat-history restored-ai' : 'lai-chat-history restored-user';
                card.textContent = message.content;
                return card;
            }));
        });
        global.setActiveSessionId = setActiveSessionId;
        global.getActiveSessionById = getActiveSessionById;
        global.renderSessionHistoryMessages = renderSessionHistoryMessages;

        sendMessage = vi.fn(async () => null);
        global.chrome.runtime.sendMessage = sendMessage;

        const exports = executeLaiMainCode(global.document, global.window, global.manifest, global.chrome, global.getLineNumber, global.isMessagePersistable);
        restoreTabSessionFromBackground = exports.restoreTabSessionFromBackground;
        messageProcessor = exports.messageProcessor;
        addInputCardToUIChatHistory = exports.addInputCardToUIChatHistory;
        laiAbortRequest = exports.laiAbortRequest;
        setActiveStreamRequestId = exports.setActiveStreamRequestId;
        getActiveStreamRequestId = exports.getActiveStreamRequestId;
        setActiveStreamSeq = exports.setActiveStreamSeq;
        getActiveStreamSeq = exports.getActiveStreamSeq;
        getStreamResyncInFlight = exports.getStreamResyncInFlight;
        laiSwapSidebarWithButton = exports.laiSwapSidebarWithButton;
        openSidebarPanelIfClosed = exports.openSidebarPanelIfClosed;
    });

    const replyToTabState = replies => sendMessage.mockImplementation(async message => {
        if (message?.action === 'getTabState') { return replies.shift() ?? null; }
        if (message?.action === 'updateTabState') { return { ok: true }; }
        return { result: true };
    });

    const sentMessages = action => sendMessage.mock.calls.filter(call => call[0]?.action === action).map(call => call[0]);

    const assistantRecipient = () => document.querySelector('.lai-ai-input .lai-input-text');

    const streamingSnapshot = (overrides = {}) => ({
        requestId: 'r1', status: 'streaming', content: 'Hello ', thinking: '', seq: 3, model: 'm', ...overrides
    });

    const binding = (overrides = {}) => ({ tabId: 1, sessionId: 's1', panelOpen: true, updatedAt: 1, ...overrides });

    it('restores the bound session, renders its history and reopens an open panel', async () => {
        replyToTabState([{ tab: binding(), request: null }]);

        await restore();

        expect(setActiveSessionId).toHaveBeenCalledWith('s1');
        expect(renderedSessions).toHaveLength(1);
        expect(document.getElementById('laiSidebar').classList.contains('active')).toBe(true);
        expect(sentMessages('updateTabState').filter(message => 'sessionId' in message)).toEqual([expect.objectContaining({ sessionId: 's1' })]);
    });

    it('binds a closed panel without rendering history until it opens', async () => {
        replyToTabState([{ tab: binding({ panelOpen: false }), request: null }]);

        await restore();

        expect(setActiveSessionId).toHaveBeenCalledWith('s1');
        expect(renderedSessions).toHaveLength(0);
        expect(document.getElementById('laiSidebar').classList.contains('active')).toBe(false);

        replyToTabState([{ tab: binding(), request: null }]);
        await laiSwapSidebarWithButton();
        const list = document.getElementById('laiChatMessageList');
        expect(list.textContent).toBe('questionanswer');

        await laiSwapSidebarWithButton(true);
        expect(list.textContent).toBe('');
    });

    it('restores the stored answer when a stream completes with the panel closed', async () => {
        replyToTabState([
            { tab: binding(), request: streamingSnapshot() },
            { tab: binding(), request: streamingSnapshot() }
        ]);
        await restore();
        expect(assistantRecipient().textContent).toContain('Hello ');

        await laiSwapSidebarWithButton(true);
        expect(document.getElementById('laiChatMessageList').textContent).toBe('');
        expect(await messageProcessor({ action: 'streamEnd', requestId: 'r1' }))
            .toEqual({ requestId: null });

        getActiveSessionById.mockResolvedValue({ id: 's1', messages: [{ role: 'assistant', content: 'Hello world' }] });
        replyToTabState([{ tab: binding(), request: streamingSnapshot({ status: 'complete' }) }]);
        await laiSwapSidebarWithButton();
        expect(renderedSessions.at(-1).messages).toEqual([{ role: 'assistant', content: 'Hello world' }]);
        expect(document.querySelector('.restored-ai').textContent).toBe('Hello world');
        expect(getActiveStreamRequestId()).toBeNull();
    });

    it('starts empty without a binding and clears a binding whose session is gone', async () => {
        replyToTabState([{ tab: null, request: null }]);
        await restore();
        expect(setActiveSessionId).not.toHaveBeenCalled();
        expect(renderedSessions).toHaveLength(0);

        getActiveSessionById.mockResolvedValue(null);
        replyToTabState([{ tab: binding(), request: null }]);
        await restore();

        expect(sentMessages('updateTabState')).toEqual([expect.objectContaining({ sessionId: null })]);
        expect(renderedSessions).toHaveLength(0);
        expect(document.getElementById('laiSidebar').classList.contains('active')).toBe(false);
    });

    it('adopts a live stream once and appends later chunks in order', async () => {
        replyToTabState([
            { tab: binding(), request: streamingSnapshot() },
            { tab: binding(), request: streamingSnapshot() }
        ]);

        await restore();

        expect(document.querySelectorAll('.lai-ai-input')).toHaveLength(1);
        expect(assistantRecipient().textContent).toContain('Hello ');
        expect(getActiveStreamRequestId()).toBe('r1');
        expect(getActiveStreamSeq()).toBe(3);
        expect(document.getElementById('laiAbort').classList.contains('invisible')).toBe(false);
        expect(document.getElementById('laiUserInput').classList.contains('invisible')).toBe(true);

        await messageProcessor({ action: 'streamData', requestId: 'r1', seq: 4, contentDelta: 'world', thinkingDelta: '', model: 'm' });
        await messageProcessor({ action: 'streamData', requestId: 'r1', seq: 5, contentDelta: '!', thinkingDelta: '', model: 'm' });

        expect(assistantRecipient().textContent).toContain('Hello world!');
        expect(getActiveStreamSeq()).toBe(5);
    });

    it('ignores duplicate sequence numbers without dropping raw debug chunks', async () => {
        document.getElementById('laiSidebar').classList.add('active');
        setActiveStreamRequestId('r1');
        setActiveStreamSeq(3);
        await addInputCardToUIChatHistory('', 'ai');

        await messageProcessor({ action: 'streamData', requestId: 'r1', seq: 3, contentDelta: 'Hello ', thinkingDelta: '', rawChunk: 'raw 1' });

        expect(assistantRecipient().textContent).not.toContain('Hello');
        expect(assistantRecipient()._laiRawResponse).toContain('raw 1');
    });

    it('treats debug-only chunks as duplicates that do not create sequence gaps', async () => {
        document.getElementById('laiSidebar').classList.add('active');
        setActiveStreamRequestId('r1');
        setActiveStreamSeq(0);
        await addInputCardToUIChatHistory('', 'ai');

        await messageProcessor({ action: 'streamData', requestId: 'r1', seq: 0, contentDelta: '', thinkingDelta: '', rawChunk: 'raw 1' });
        await messageProcessor({ action: 'streamData', requestId: 'r1', seq: 0, contentDelta: '', thinkingDelta: '', rawChunk: 'raw 2' });
        await messageProcessor({ action: 'streamData', requestId: 'r1', seq: 1, contentDelta: 'Hi', thinkingDelta: '' });

        expect(getStreamResyncInFlight()).toBe(false);
        expect(assistantRecipient()._laiRawResponse).toContain('raw 2');
        expect(assistantRecipient().textContent).toContain('Hi');
        expect(getActiveStreamSeq()).toBe(1);
    });

    it('re-requests the snapshot on a sequence gap and re-renders from it', async () => {
        replyToTabState([
            { tab: binding(), request: streamingSnapshot() },
            { tab: binding(), request: streamingSnapshot() },
            { tab: binding(), request: streamingSnapshot({ content: 'Hello world and more', seq: 6 }) }
        ]);

        await restore();
        await messageProcessor({ action: 'streamData', requestId: 'r1', seq: 6, contentDelta: 'skipped', thinkingDelta: '' });

        expect(sentMessages('getTabState')).toHaveLength(3);
        expect(assistantRecipient().textContent).toContain('Hello world and more');
        expect(assistantRecipient().textContent).not.toContain('skipped');
        expect(getActiveStreamSeq()).toBe(6);

        await messageProcessor({ action: 'streamData', requestId: 'r1', seq: 7, contentDelta: '!', thinkingDelta: '' });
        expect(assistantRecipient().textContent).toContain('Hello world and more!');
    });

    it('drops chunks that arrive while a gap resync is in flight', async () => {
        let resolveResync;
        replyToTabState([
            { tab: binding(), request: streamingSnapshot() },
            { tab: binding(), request: streamingSnapshot() }
        ]);
        await restore();

        sendMessage.mockImplementation(async message => {
            if (message?.action === 'getTabState') {
                return new Promise(resolve => { resolveResync = () => resolve({ tab: binding(), request: streamingSnapshot({ status: 'complete', content: 'Final answer', seq: 8 }) }); });
            }
            return { result: true };
        });

        const gapHandled = messageProcessor({ action: 'streamData', requestId: 'r1', seq: 6, contentDelta: 'gap', thinkingDelta: '' });
        await Promise.resolve();
        expect(getStreamResyncInFlight()).toBe(true);

        const duringFlightText = assistantRecipient().textContent;
        await messageProcessor({ action: 'streamData', requestId: 'r1', seq: 6, contentDelta: 'dropped', thinkingDelta: '' });
        expect(assistantRecipient().textContent).toBe(duringFlightText);

        resolveResync();
        await gapHandled;

        expect(getStreamResyncInFlight()).toBe(false);
        expect(renderedSessions).toHaveLength(2);
        expect(getActiveStreamRequestId()).toBeNull();
        expect(sentMessages('removeStreamRequestState')).toEqual([expect.objectContaining({ requestId: 'r1' })]);
    });

    it('finalises a request that completes between the initial and the fresh snapshot', async () => {
        replyToTabState([
            { tab: binding(), request: streamingSnapshot() },
            { tab: binding(), request: streamingSnapshot({ status: 'complete', content: 'Full answer', seq: 8 }) }
        ]);

        await restore();

        expect(document.querySelectorAll('.lai-ai-input')).toHaveLength(0);
        expect(renderedSessions).toHaveLength(2);
        expect(getActiveStreamRequestId()).toBeNull();
        expect(document.getElementById('laiAbort').classList.contains('invisible')).toBe(true);
        expect(document.getElementById('laiUserInput').classList.contains('invisible')).toBe(false);
        expect(sentMessages('removeStreamRequestState')).toEqual([expect.objectContaining({ requestId: 'r1' })]);
    });

    it('renders history without a duplicate card when the request completed while loading', async () => {
        replyToTabState([{ tab: binding(), request: streamingSnapshot({ status: 'complete', requestId: 'r9', content: 'saved answer' }) }]);

        await restore();

        expect(document.querySelectorAll('.lai-chat-history')).toHaveLength(2);
        expect(document.querySelectorAll('.lai-ai-input')).toHaveLength(0);
        expect(sentMessages('removeStreamRequestState')).toEqual([expect.objectContaining({ requestId: 'r9' })]);
        expect(getActiveStreamRequestId()).toBeNull();
    });

    it('shows the partial text with the abort marker for a request aborted while loading', async () => {
        replyToTabState([{ tab: binding(), request: streamingSnapshot({ status: 'aborted', requestId: 'r8', content: 'partial text' }) }]);

        await restore();

        expect(document.querySelectorAll('.lai-ai-input')).toHaveLength(1);
        expect(assistantRecipient().textContent).toContain('partial text');
        expect(document.querySelector('.lai-aborted-text')?.textContent).toBe('... Aborted');
        expect(sentMessages('removeStreamRequestState')).toEqual([expect.objectContaining({ requestId: 'r8' })]);
    });

    it('shows the stored error for a request that failed while loading', async () => {
        replyToTabState([{ tab: binding(), request: streamingSnapshot({ status: 'error', requestId: 'r7', error: 'model offline', content: 'partial' }) }]);

        await restore();

        expect(document.querySelectorAll('.lai-ai-input')).toHaveLength(1);
        expect(assistantRecipient().textContent).toContain('partial');
        expect(global.showMessage).toHaveBeenCalledWith('model offline', 'error');
        expect(sentMessages('removeStreamRequestState')).toEqual([expect.objectContaining({ requestId: 'r7' })]);
    });

    it('cancels an adopted request through abortFetch', async () => {
        replyToTabState([
            { tab: binding(), request: streamingSnapshot() },
            { tab: binding(), request: streamingSnapshot() }
        ]);
        await restore();

        await laiAbortRequest();

        expect(sentMessages('abortFetch')).toEqual([{ action: 'abortFetch' }]);
        expect(document.getElementById('laiAbort').classList.contains('invisible')).toBe(true);
        expect(document.getElementById('laiUserInput').classList.contains('invisible')).toBe(false);
    });

    it('logs an ignored foreign stream request once per request id', async () => {
        setActiveStreamRequestId('own');
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        try {
            await messageProcessor({ action: 'streamData', requestId: 'foreign', seq: 1, contentDelta: 'x' });
            await messageProcessor({ action: 'streamData', requestId: 'foreign', seq: 2, contentDelta: 'y' });
            await messageProcessor({ action: 'streamData', requestId: 'other-foreign', seq: 1, contentDelta: 'z' });

            const ignoredLogs = debugSpy.mock.calls.filter(call => `${call[0]}`.includes('Ignoring stream message'));
            expect(ignoredLogs).toHaveLength(2);
            expect(ignoredLogs.filter(call => call[1]?.requestId === 'foreign')).toHaveLength(1);
        } finally {
            debugSpy.mockRestore();
        }
    });
    const expectControlsReset = () => {
        expect(document.getElementById('laiAbort').classList.contains('invisible')).toBe(true);
        expect(document.getElementById('laiUserInput').classList.contains('invisible')).toBe(false);
        expect(document.querySelector('#laiSidebar .notification').textContent).toBe('Ready.');
    };

    it('leaves a card finalised during a gap resync untouched when the stale snapshot arrives', async () => {
        let resolveResync;
        replyToTabState([
            { tab: binding(), request: streamingSnapshot() },
            { tab: binding(), request: streamingSnapshot() }
        ]);
        await restore();

        sendMessage.mockImplementation(async message => {
            if (message?.action === 'getTabState') {
                return new Promise(resolve => { resolveResync = () => resolve({ tab: binding(), request: streamingSnapshot({ content: 'stale partial', seq: 5 }) }); });
            }
            return { result: true };
        });

        const gapHandled = messageProcessor({ action: 'streamData', requestId: 'r1', seq: 6, contentDelta: 'gap', thinkingDelta: '' });
        await Promise.resolve();
        await messageProcessor({ action: 'streamEnd', requestId: 'r1', response: JSON.stringify({ message: { role: 'assistant', content: 'Final answer' } }) });
        const finalText = assistantRecipient().textContent;

        resolveResync();
        await gapHandled;

        expect(finalText).toContain('Final answer');
        expect(assistantRecipient().textContent).toBe(finalText);
        expect(document.querySelector('.lai-aborted-text')).toBeNull();
        expect(global.showMessage).not.toHaveBeenCalledWith(expect.anything(), 'error');
        expect(sentMessages('removeStreamRequestState')).toHaveLength(0);
        expect(getActiveStreamRequestId()).toBeNull();
    });

    it('re-renders the saved history instead of leaving an empty card when the fresh snapshot is gone', async () => {
        replyToTabState([
            { tab: binding(), request: streamingSnapshot() },
            { tab: binding(), request: null }
        ]);

        await restore();

        expect(document.querySelectorAll('.lai-ai-input')).toHaveLength(0);
        expect(renderedSessions).toHaveLength(2);
        expect(getActiveStreamRequestId()).toBeNull();
        expectControlsReset();
    });

    it('renders a completed gap resync from the saved session, not from the accumulated snapshot', async () => {
        replyToTabState([
            { tab: binding(), request: streamingSnapshot() },
            { tab: binding(), request: streamingSnapshot() },
            { tab: binding(), request: streamingSnapshot({ status: 'complete', content: 'tool round text plus final', seq: 9 }) }
        ]);
        await restore();

        await messageProcessor({ action: 'streamData', requestId: 'r1', seq: 7, contentDelta: 'gap', thinkingDelta: '' });

        expect(renderedSessions).toHaveLength(2);
        expect(document.getElementById('laiChatMessageList').textContent).not.toContain('tool round text plus final');
        expectControlsReset();
    });

    it.each(['aborted', 'error'])('resets the controls after presenting a request that ended as %s while loading', async (status) => {
        document.getElementById('laiAbort').classList.remove('invisible');
        document.getElementById('laiUserInput').classList.add('invisible');
        replyToTabState([{ tab: binding(), request: streamingSnapshot({ status, requestId: 'r7', content: 'partial', error: status === 'error' ? 'model failed' : undefined }) }]);

        await restore();

        expectControlsReset();
        expect(sentMessages('removeStreamRequestState')).toEqual([expect.objectContaining({ requestId: 'r7' })]);
    });

    it('resets controls left over by a frozen instance whose request has already ended', async () => {
        document.getElementById('laiAbort').classList.remove('invisible');
        document.getElementById('laiUserInput').classList.add('invisible');
        replyToTabState([{ tab: binding(), request: null }]);

        await restore();

        expectControlsReset();
    });

    it('keeps the Abort control for a frozen instance whose request is still streaming', async () => {
        document.getElementById('laiAbort').classList.remove('invisible');
        document.getElementById('laiUserInput').classList.add('invisible');
        replyToTabState([
            { tab: binding(), request: streamingSnapshot() },
            { tab: binding(), request: streamingSnapshot() }
        ]);

        await restore();

        expect(document.getElementById('laiAbort').classList.contains('invisible')).toBe(false);
        expect(document.getElementById('laiUserInput').classList.contains('invisible')).toBe(true);
        expect(getActiveStreamRequestId()).toBe('r1');
    });

    it('unbinds a stale instance when the tab no longer has a bound session', async () => {
        replyToTabState([
            { tab: binding(), request: null },
            { tab: binding({ sessionId: null }), request: null }
        ]);
        await restore();
        expect(document.querySelectorAll('.lai-chat-history')).toHaveLength(2);

        await restore();

        expect(global.deleteActiveSessionId).toHaveBeenCalled();
        expect(await global.getActiveSessionId()).toBeNull();
        expect(document.querySelectorAll('.lai-chat-history')).toHaveLength(0);
        expectControlsReset();
    });

    it('unbinds a stale instance and clears the binding when its session was deleted', async () => {
        replyToTabState([
            { tab: binding(), request: null },
            { tab: binding(), request: null }
        ]);
        await restore();
        getActiveSessionById.mockResolvedValueOnce(null);

        await restore();

        expect(sentMessages('updateTabState')).toContainEqual(expect.objectContaining({ sessionId: null }));
        expect(await global.getActiveSessionId()).toBeNull();
        expect(document.querySelectorAll('.lai-chat-history')).toHaveLength(0);
    });

    it('does not clear a fresh panel that never had a session', async () => {
        document.getElementById('laiChatMessageList').innerHTML = '<div class="keep"></div>';
        replyToTabState([{ tab: null, request: null }]);

        await restore();

        expect(document.querySelector('#laiChatMessageList .keep')).not.toBeNull();
    });

    it('ends open when two callers open the panel concurrently', async () => {
        replyToTabState([]);
        const pendingOptions = [];
        global.getOptions = vi.fn(() => new Promise(resolve => { pendingOptions.push(() => resolve({})); }));

        const first = openSidebarPanelIfClosed();
        const second = laiSwapSidebarWithButton();
        await Promise.resolve();
        global.getOptions = vi.fn(async () => ({}));
        pendingOptions.forEach(release => release());
        await Promise.all([first, second]);

        expect(document.getElementById('laiSidebar').classList.contains('active')).toBe(true);
    });

    it('restores a selected element attached while closed without duplicating the icon', async () => {
        document.body.insertAdjacentHTML('beforeend', '<div id="attachContainer"></div>');
        const attachment = { id: 'selected', type: 'snippet', content: 'Selected paragraph' };
        let storedSession = { id: 's1', messages: [], attachments: [] };
        const binding = { tab: { sessionId: 's1', panelOpen: false }, request: null };
        global.addAttachment = vi.fn(async item => {
            storedSession = { ...storedSession, attachments: [item] };
        });
        getActiveSessionById.mockImplementation(async () => storedSession);
        replyToTabState([binding, binding]);

        await messageProcessor({ action: 'attachElement', content: attachment.content });
        document.getElementById('attachContainer').replaceChildren();
        await laiSwapSidebarWithButton();
        await laiSwapSidebarWithButton(true);
        await laiSwapSidebarWithButton();

        expect(global.addAttachment).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ type: 'snippet', content: expect.stringContaining(attachment.content) })
        );
        expect(document.querySelectorAll('#attachContainer img.attached')).toHaveLength(1);
        expect(document.querySelector('#attachContainer img.attached').title).toContain(attachment.content);
    });

    it('reports the panel state on every open and close', async () => {
        replyToTabState([]);

        await laiSwapSidebarWithButton();
        await laiSwapSidebarWithButton(true);

        expect(sentMessages('updateTabState')).toEqual([
            expect.objectContaining({ panelOpen: true }),
            expect.objectContaining({ panelOpen: false })
        ]);
    });
});

describe('sidebar session catch-up on focus (#61)', () => {
    const isRenderableSessionMessageCode = ribbonCode.match(/function isRenderableSessionMessage\([\s\S]*?\n}\n/)[0];
    const renderSessionHistoryMessageCode = ribbonCode.match(/async function renderSessionHistoryMessage\([\s\S]*?\n}\n/)[0];
    const renderSessionHistoryMessagesCode = ribbonCode.match(/async function renderSessionHistoryMessages\([\s\S]*?\n}\n/)[0];

    const executeCatchUp = new Function('document', 'window', 'manifest', 'chrome', 'getLineNumber', 'isMessagePersistable',
        tabStateCode + '\nlet userScrolled = false;\nconst stopSidebarSpeech = () => {};\n' + isMessagePersistableCode + '\nconst checkExtensionState = () => true;\n' +
        isRenderableSessionMessageCode + '\n' + renderSessionHistoryMessageCode + '\n' + renderSessionHistoryMessagesCode + '\n' +
        laiMainCode + '\nlet sidebarVisibility, sidebarDraft;\n' + viewCode + '; return { applySidebarState, getUserScrolled: () => userScrolled, restoreTabSessionFromBackground, setUserScrolled: value => userScrolled = value, catchUpActiveSessionFromStorage, renderSessionHistoryMessages, renderUserPromptCard, addInputCardToUIChatHistory, setMarkdownSource, getMarkdownSource, findElementHistoryIndex, setActiveStreamRequestId: value => activeStreamRequestId = value, getActiveStreamRequestId: () => activeStreamRequestId };'
    );

    let applySidebarState, getUserScrolled, restoreTabSessionFromBackground, setUserScrolled;
    let catchUpActiveSessionFromStorage, renderSessionHistoryMessages, renderUserPromptCard, addInputCardToUIChatHistory;
    let setMarkdownSource, getMarkdownSource, findElementHistoryIndex, setActiveStreamRequestId, getActiveStreamRequestId;
    let storedSessions;
    let activeSessionId;

    const seedChat = () => {
        document.body.innerHTML = `
            <div id="laiChatMessageList"></div>
            <textarea id="laiUserInput"></textarea>
            <button id="laiAbort" class="invisible"></button>`;
    };

    const cards = () => Array.from(document.querySelectorAll('#laiChatMessageList .lai-chat-history'));
    const separators = () => Array.from(document.querySelectorAll('#laiChatMessageList .lai-session-catch-up-separator'));
    const sessionWith = messages => ({ id: 's1', title: 'Bound', messages });
    const chatListHtml = () => document.getElementById('laiChatMessageList').innerHTML;

    beforeEach(() => {
        global.getLineNumber = () => 'test:1';
        global.showMessage = vi.fn();
        global.setModelNameLabel = vi.fn();
        global.hideSessionDeleteConfirm = vi.fn();
        global.getShadowRoot = vi.fn(() => document);
        global.getSideBar = vi.fn(() => null);
        global.getOptions = vi.fn(async () => ({}));
        global.parseAndRender = vi.fn(async (markdown, element) => { element.textContent = markdown; });
        global.chrome.runtime.getURL = path => `chrome-extension://test/${path}`;

        seedChat();
        document.body.classList.add('active');
        global.getSideBar = vi.fn(() => document.body);
        activeSessionId = 's1';
        global.getActiveSessionId = vi.fn(async () => activeSessionId);
        storedSessions = {};
        global.getActiveSessionById = vi.fn(async id => storedSessions[id] ?? null);

        ({
            applySidebarState, getUserScrolled, restoreTabSessionFromBackground, setUserScrolled, catchUpActiveSessionFromStorage, renderSessionHistoryMessages, renderUserPromptCard,
            addInputCardToUIChatHistory, setMarkdownSource, getMarkdownSource, findElementHistoryIndex,
            setActiveStreamRequestId, getActiveStreamRequestId
        } = executeCatchUp(global.document, global.window, global.manifest, global.chrome, global.getLineNumber, undefined));
    });

    describe('opening and reconnecting the sidebar', () => {
        const messages = [
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'first answer' }
        ];
        const messageList = () => document.getElementById('laiChatMessageList');
        const reconnect = async (sessionId = 's1', request = null) => {
            global.chrome.runtime.sendMessage = vi.fn(async message =>
                message.action === 'getTabState' ? { tab: { sessionId, panelOpen: true }, request } : null
            );
            await restoreTabSessionFromBackground({ reconnect: true });
        };

        beforeEach(async () => {
            global.setActiveSessionId = vi.fn(async id => { activeSessionId = id; });
            global.resetStatusbar = vi.fn();
            global.updateStatusBar = vi.fn();
            storedSessions.s1 = sessionWith(messages);
            Object.defineProperty(messageList(), 'scrollHeight', { value: 500 });
            await renderSessionHistoryMessages(storedSessions.s1);
            messageList().scrollTop = 150;
            setUserScrolled(true);
        });

        it('scrolls to the bottom after closing and reopening the same session', async () => {
            global.chrome.runtime.sendMessage = vi.fn(async message =>
                message.action === 'getTabState' ? { tab: { sessionId: 's1', panelOpen: true } } : null
            );

            await applySidebarState({ open: false });
            const scrolledAfterClose = getUserScrolled();
            expect(global.hideSessionDeleteConfirm).toHaveBeenCalled();
            // JSDOM does not reset the scroll offset when the list is emptied.
            messageList().scrollTop = 0;
            await applySidebarState({ open: true });

            expect(messageList().scrollTop).toBe(500);
            expect(scrolledAfterClose).toBe(false);
            expect(getUserScrolled()).toBe(false);
        });

        it('restores both author labels with named scroll buttons', () => {
            expect(cards()).toHaveLength(2);
            expect(cards().map(card => card.querySelector('.lai-input-label').textContent.trim())).toEqual(['User:', 'AI:']);
            for (const card of cards()) {
                const buttons = [...card.querySelectorAll('.lai-input-label button[type="button"]')];
                expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([
                    'Scroll to the end', 'Scroll to the start of this message'
                ]);
                expect(buttons.every(button => button.title === button.getAttribute('aria-label'))).toBe(true);
                expect(buttons.every(button => button.querySelector('img[alt=""]'))).toBe(true);
            }
        });

        it('keeps the existing cards and scroll position for identical turns', async () => {
            const [prompt, reply] = cards();

            await reconnect();

            expect(cards()[0] === prompt).toBe(true);
            expect(cards()[1] === reply).toBe(true);
            expect(messageList().scrollTop).toBe(150);
        });

        it('appends newly saved turns and preserves the reading position', async () => {
            const [prompt, reply] = cards();
            storedSessions.s1 = sessionWith([...messages, { role: 'user', content: 'next question' }]);

            await reconnect();

            expect(cards()).toHaveLength(3);
            expect(cards()[0] === prompt).toBe(true);
            expect(cards()[1] === reply).toBe(true);
            expect(cards()[2].textContent).toContain('next question');
            expect(messageList().scrollTop).toBe(150);
        });

        it('replaces cards and scrolls to the bottom for a different session with identical turns', async () => {
            const [prompt] = cards();
            storedSessions.s2 = { id: 's2', messages };

            await reconnect('s2');

            expect(cards()).toHaveLength(2);
            expect(cards()[0] === prompt).toBe(false);
            expect(activeSessionId).toBe('s2');
            expect(messageList().scrollTop).toBe(500);
        });

        it('replaces mismatched turns without moving the reader', async () => {
            const [, reply] = cards();
            storedSessions.s1 = sessionWith([messages[0], { role: 'assistant', content: 'updated answer' }]);

            await reconnect();

            expect(cards()[1] === reply).toBe(false);
            expect(cards()[1].textContent).toContain('updated answer');
            expect(messageList().scrollTop).toBe(150);
        });

        it('adopts a live snapshot in the existing reply card without duplicating it', async () => {
            await addInputCardToUIChatHistory('', 'ai');
            const pendingReply = cards().at(-1);
            messageList().scrollTop = 150;
            setActiveStreamRequestId('r1');

            await reconnect('s1', { requestId: 'r1', status: 'streaming', content: 'Resumed', seq: 4 });

            expect(cards()).toHaveLength(3);
            expect(cards().at(-1) === pendingReply).toBe(true);
            expect(pendingReply.textContent).toContain('Resumed');
            expect(getActiveStreamRequestId()).toBe('r1');
            expect(messageList().scrollTop).toBe(150);
        });
    });

    it('does not read or render newly stored turns while the panel is closed', async () => {
        document.body.classList.remove('active');
        storedSessions.s1 = sessionWith([{ role: 'assistant', content: 'Hidden while closed' }]);

        await catchUpActiveSessionFromStorage();

        expect(global.getActiveSessionById).not.toHaveBeenCalled();
        expect(cards()).toHaveLength(0);
    });

    it('changes nothing when the saved session has no new turns', async () => {
        storedSessions.s1 = sessionWith([
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'first answer' }
        ]);
        await renderSessionHistoryMessages(storedSessions.s1);
        const htmlBefore = chatListHtml();

        await catchUpActiveSessionFromStorage();

        expect(chatListHtml()).toBe(htmlBefore);
        expect(separators()).toHaveLength(0);
    });

    it('appends only the missing turns under one separator with their original message indices', async () => {
        storedSessions.s1 = sessionWith([
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'first answer' }
        ]);
        await renderSessionHistoryMessages(storedSessions.s1);
        const shownBefore = cards();

        storedSessions.s1 = sessionWith([
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'first answer' },
            { role: 'tool', tool_name: 'browse_url', content: 'tool output' },
            { role: 'user', content: 'second question' },
            { role: 'assistant', content: 'second answer' }
        ]);
        await catchUpActiveSessionFromStorage();

        const shownAfter = cards();
        expect(shownAfter).toHaveLength(4);
        expect(shownAfter[0]).toBe(shownBefore[0]);
        expect(shownAfter[1]).toBe(shownBefore[1]);

        expect(separators()).toHaveLength(1);
        const separator = separators()[0];
        expect(separator.getAttribute('role')).toBe('separator');
        expect(separator.textContent).toBe('Added from another tab');

        const appendedUser = shownAfter[2];
        expect(appendedUser.classList.contains('lai-user-input')).toBe(true);
        expect(appendedUser.querySelector('[data-type="edit"]').dataset.index).toBe('3');
        const appendedAi = shownAfter[3];
        expect(appendedAi.classList.contains('lai-ai-input')).toBe(true);
        expect(getMarkdownSource(appendedAi.querySelector('.lai-input-text'))).toBe('second answer');
    });

    it('compares a tab with only its own fresh turns equal to the saved session', async () => {
        storedSessions.s1 = sessionWith([
            { role: 'user', content: 'fresh question' },
            { role: 'assistant', content: 'fresh answer' }
        ]);
        await renderUserPromptCard('fresh question');
        const recipient = await addInputCardToUIChatHistory('', 'ai');
        setMarkdownSource(recipient, 'fresh answer');
        const shownBefore = cards();

        await catchUpActiveSessionFromStorage();

        expect(separators()).toHaveLength(0);
        expect(cards()[0]).toBe(shownBefore[0]);
        expect(cards()[1]).toBe(shownBefore[1]);
    });

    it('re-renders the whole history without a separator on a mismatch inside the common part', async () => {
        storedSessions.s1 = sessionWith([
            { role: 'user', content: 'question' },
            { role: 'assistant', content: 'answer' }
        ]);
        await renderSessionHistoryMessages(storedSessions.s1);
        const shownBefore = cards();

        storedSessions.s1 = sessionWith([
            { role: 'user', content: 'question' },
            { role: 'assistant', content: 'edited answer' }
        ]);
        await catchUpActiveSessionFromStorage();

        const shownAfter = cards();
        expect(shownAfter).toHaveLength(2);
        expect(shownAfter[0]).not.toBe(shownBefore[0]);
        expect(separators()).toHaveLength(0);
        expect(getMarkdownSource(shownAfter[1].querySelector('.lai-input-text'))).toBe('edited answer');
    });

    it('keeps local-only cards when the shown turns are longer than the saved ones', async () => {
        storedSessions.s1 = sessionWith([
            { role: 'user', content: 'question' },
            { role: 'assistant', content: 'answer' }
        ]);
        await renderSessionHistoryMessages(storedSessions.s1);
        await addInputCardToUIChatHistory('', 'ai');
        const shownBefore = cards();
        shownBefore[2].querySelector('.lai-input-text').textContent = 'partial unsaved reply';

        storedSessions.s1 = sessionWith([
            { role: 'user', content: 'question' }
        ]);
        const htmlBefore = chatListHtml();
        await catchUpActiveSessionFromStorage();

        const shownAfter = cards();
        expect(shownAfter).toHaveLength(3);
        expect(shownAfter[0]).toBe(shownBefore[0]);
        expect(shownAfter[1]).toBe(shownBefore[1]);
        expect(shownAfter[2]).toBe(shownBefore[2]);
        expect(chatListHtml()).toBe(htmlBefore);
        expect(separators()).toHaveLength(0);
    });

    it('keeps an unsaved fresh user card on focus', async () => {
        storedSessions.s1 = sessionWith([
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'first answer' }
        ]);
        await renderSessionHistoryMessages(storedSessions.s1);
        await renderUserPromptCard('prompt not saved yet');
        const shownBefore = cards();

        await catchUpActiveSessionFromStorage();

        const shownAfter = cards();
        expect(shownAfter).toHaveLength(3);
        expect(shownAfter[2]).toBe(shownBefore[2]);
        expect(separators()).toHaveLength(0);
    });

    it('appends once per new batch and never duplicates on repeated catch-ups', async () => {
        storedSessions.s1 = sessionWith([
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'first answer' }
        ]);
        await renderSessionHistoryMessages(storedSessions.s1);

        storedSessions.s1 = sessionWith([
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'first answer' },
            { role: 'user', content: 'second question' },
            { role: 'assistant', content: 'second answer' }
        ]);
        await catchUpActiveSessionFromStorage();
        expect(cards()).toHaveLength(4);
        expect(separators()).toHaveLength(1);

        await catchUpActiveSessionFromStorage();
        expect(cards()).toHaveLength(4);
        expect(separators()).toHaveLength(1);

        storedSessions.s1 = sessionWith([
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'first answer' },
            { role: 'user', content: 'second question' },
            { role: 'assistant', content: 'second answer' },
            { role: 'user', content: 'third question' },
            { role: 'assistant', content: 'third answer' }
        ]);
        await catchUpActiveSessionFromStorage();

        expect(cards()).toHaveLength(6);
        expect(separators()).toHaveLength(2);
        expect(cards()[4].querySelector('[data-type="edit"]').dataset.index).toBe('4');
    });

    it('appends once when catch-up is triggered concurrently', async () => {
        storedSessions.s1 = sessionWith([
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'first answer' }
        ]);
        await renderSessionHistoryMessages(storedSessions.s1);

        storedSessions.s1 = sessionWith([
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'first answer' },
            { role: 'user', content: 'second question' },
            { role: 'assistant', content: 'second answer' }
        ]);
        await Promise.all([catchUpActiveSessionFromStorage(), catchUpActiveSessionFromStorage()]);

        expect(cards()).toHaveLength(4);
        expect(separators()).toHaveLength(1);
    });

    it('does nothing while a reply is streaming in this tab', async () => {
        storedSessions.s1 = sessionWith([
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'first answer' }
        ]);
        await renderSessionHistoryMessages(storedSessions.s1);
        const htmlBefore = chatListHtml();

        storedSessions.s1 = sessionWith([
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'first answer' },
            { role: 'user', content: 'second question' },
            { role: 'assistant', content: 'second answer' }
        ]);
        setActiveStreamRequestId('r1');
        await catchUpActiveSessionFromStorage();

        expect(chatListHtml()).toBe(htmlBefore);
        expect(separators()).toHaveLength(0);
        expect(getActiveStreamRequestId()).toBe('r1');
    });

    it('does nothing without a bound session or when the session no longer exists', async () => {
        storedSessions.s1 = sessionWith([{ role: 'user', content: 'question' }]);
        document.getElementById('laiChatMessageList').innerHTML = '<div class="lai-chat-history keep"></div>';

        activeSessionId = null;
        await catchUpActiveSessionFromStorage();
        expect(cards()).toHaveLength(1);

        activeSessionId = 's1';
        storedSessions.s1 = null;
        await catchUpActiveSessionFromStorage();
        expect(cards()).toHaveLength(1);
        expect(separators()).toHaveLength(0);
    });

    it('does not let the separator disturb the history index lookup', async () => {
        storedSessions.s1 = sessionWith([
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'first answer' }
        ]);
        await renderSessionHistoryMessages(storedSessions.s1);

        storedSessions.s1 = sessionWith([
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'first answer' },
            { role: 'user', content: 'second question' },
            { role: 'assistant', content: 'second answer' }
        ]);
        await catchUpActiveSessionFromStorage();

        const shown = cards();
        expect(await findElementHistoryIndex(shown[2].querySelector('.lai-input-text'))).toBe(2);
        expect(await findElementHistoryIndex(shown[3].querySelector('.lai-input-text'))).toBe(3);
    });
});

describe('/session command (#64)', () => {
    let checkCommandHandler;
    let popSessionList;

    beforeEach(() => {
        global.getLineNumber = () => 'test:1';
        global.showMessage = vi.fn();
        global.getShadowRoot = vi.fn(() => document);
        popSessionList = vi.fn(async () => undefined);
        global.popSessionList = popSessionList;
        global.popUserCommandList = vi.fn();
        global.updateStatusBar = vi.fn();
        global.getActiveModel = vi.fn(() => 'test-model');
        document.body.innerHTML = '<div id="laiSuggestionBox" class="invisible"></div>';

        ({ checkCommandHandler } = executeLaiMainCode(global.document, global.window, global.manifest, global.chrome, global.getLineNumber, undefined));
    });

    it('opens the sessions dialog and reports the command as handled', async () => {
        const userInput = { value: '/session' };

        expect(await checkCommandHandler(userInput)).toBe(true);

        expect(popSessionList).toHaveBeenCalledWith(userInput);
    });

    it('does not treat the input as a command without a slash word', async () => {
        const userInput = { value: 'just a question' };

        expect(await checkCommandHandler(userInput)).toBe(false);

        expect(popSessionList).not.toHaveBeenCalled();
    });
});

describe('user prompt Markdown rendering (#41)', () => {
    const solomdCode = fs.readFileSync(
        path.join(__dirname, '../src/jslib/solomd2html.js'),
        'utf-8'
    );
    const loadParser = () => new Function(
        'document',
        'DocumentFragment',
        'CustomEvent',
        'Node',
        'navigator',
        solomdCode + '; return parseAndRender;'
    )(global.document, global.window.DocumentFragment, global.window.CustomEvent, global.window.Node, global.navigator);

    const executeUserPromptCode = new Function('document', 'window', 'manifest', 'chrome', 'getLineNumber', 'isMessagePersistable',
        tabStateCode + '\n' + isMessagePersistableCode + '\nconst checkExtensionState = () => true;\nlet aiUserCommands = [];\n' + laiMainCode +
        '; return { renderUserPromptCard, getUserPromptSource, onPromptTextAreaKeyDown, editUserInput };'
    );

    let renderUserPromptCard, getUserPromptSource, onPromptTextAreaKeyDown, editUserInput;
    let sendMessage;
    let writeText;

    const userCard = () => Array.from(document.querySelectorAll('.lai-user-input')).pop();
    const userText = () => userCard()?.querySelector('.lai-input-text');

    const submit = async (value) => {
        const textarea = document.getElementById('laiUserInput');
        textarea.value = value;
        await onPromptTextAreaKeyDown({
            key: 'Enter',
            code: 'Enter',
            shiftKey: false,
            target: textarea,
            preventDefault: () => {},
            stopPropagation: () => {},
            stopImmediatePropagation: () => {}
        });
    };

    beforeEach(() => {
        global.getLineNumber = () => 'test:1';
        global.showMessage = vi.fn();
        global.getShadowRoot = vi.fn(() => document);
        global.getSideBar = vi.fn(() => document.body);
        global.getOptions = vi.fn(async () => ({ aiUrl: 'http://localhost:11434/api/chat' }));
        global.getModelModifiers = vi.fn(() => null);
        global.getOrCreateActiveSessionId = vi.fn(async () => 'session-41');
        global.getActiveSession = vi.fn(async () => null);
        global.setActiveSession = vi.fn(async () => {});
        global.deleteActiveSession = vi.fn(async () => {});
        global.reportTabBinding = vi.fn(async () => {});
        global.parseAndRender = loadParser();
        writeText = vi.fn(async () => undefined);
        Object.defineProperty(global.navigator, 'clipboard', { value: { writeText }, configurable: true });
        sendMessage = vi.fn(async () => ({ status: 'success' }));
        global.chrome = { runtime: { sendMessage, onMessage: { addListener: vi.fn() }, getURL: path => `chrome-extension://test/${path}` } };

        document.body.innerHTML = `
            <div id="laiSidebar" class="active">
                <template id="editorTemplate">
                    <div id="userCommandEditor" class="user-command-editor">
                        <div class="help-close-btn" title="Close">✖</div>
                        <div class="row"><input type="text" id="commandName" placeholder="Enter command without spaces..."></div>
                        <div class="row"><input type="text" id="commandDescription" placeholder="Optional"></div>
                        <div class="command-row"><textarea id="commandBody" placeholder="Enter Prompt..."></textarea></div>
                        <button>Save</button>
                    </div>
                </template>
            </div>
            <div id="laiSuggestionBox" class="invisible"></div>
            <div id="laiSysIntructContainer" class="active"></div>
            <button id="laiAbort" class="invisible"></button>
            <div id="attachContainer"></div>
            <div id="panel">
                <div id="laiChatMessageList"></div>
                <textarea id="laiUserInput"></textarea>
            </div>
            <div id="laiCopyHint" class="invisible"></div>
        `;

        ({ renderUserPromptCard, getUserPromptSource, onPromptTextAreaKeyDown, editUserInput } =
            executeUserPromptCode(global.document, global.window, global.manifest, global.chrome, global.getLineNumber, global.isMessagePersistable));
    });

    it('renders the Markdown structure of a submitted prompt immediately and sends the original text to the model', async () => {
        const prompt = [
            '## Heading',
            '',
            '- one',
            '- two',
            '',
            '**bold** [link](https://example.com) `code`',
            '',
            '```js',
            'console.log("hi")',
            '```'
        ].join('\n');

        await submit(prompt);

        expect(userText().querySelector('h2').textContent).toBe('Heading');
        expect([...userText().querySelectorAll('ul li')].map(li => li.textContent)).toEqual(['one', 'two']);
        expect(userText().querySelector('p strong').textContent).toBe('bold');
        expect(userText().querySelector('p a[href="https://example.com"]').textContent).toBe('link');
        expect(userText().querySelector('p code').textContent).toBe('code');
        expect(userText().querySelector('.code-block code').textContent).toBe('console.log("hi")');
        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            action: 'fetchData',
            data: { userInput: prompt }
        }));
    });

    it('keeps plain prompts as plain text with one block line per line', async () => {
        await submit('Just a simple question');
        expect([...userText().querySelectorAll('p')].map(p => p.textContent)).toEqual(['Just a simple question']);
        expect(userText().querySelectorAll('br, ul, h1, h2, h3, pre').length).toBe(0);

        await submit('line one\nline two\nline three');
        expect([...userText().querySelectorAll('p')].map(p => p.textContent)).toEqual(['line one', 'line two', 'line three']);
    });

    it('shows embedded unsafe HTML literally without creating elements', async () => {
        await submit('<img src=x onerror=alert(1)>\n<script>alert(1)</script>\nplain <b>text</b> here');

        expect(userText().querySelectorAll('img, script, b').length).toBe(0);
        expect(userText().textContent).toContain('<img src=x onerror=alert(1)>');
        expect(userText().textContent).toContain('<script>alert(1)</script>');
        expect(userText().textContent).toContain('plain <b>text</b> here');
    });

    it('restores the byte-for-byte original prompt through Edit after a fresh submission', async () => {
        const original = '## Task\n\nExplain this  \n- **item** with trailing space  \n\nend `code`';
        await submit(original);

        await editUserInput({ target: userCard().querySelector('[data-type="edit"]') }, 'user');

        expect(document.getElementById('laiUserInput').value).toBe(original);
    });

    it('puts the original Markdown source into Add as User Command', async () => {
        const original = '## Task\n\n- **item**  \n\nend `code`';
        await submit(original);

        userCard().querySelector('[data-type="add"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

        expect(document.querySelector('#userCommandEditor #commandBody').value).toBe(original);
    });

    it('copies code-block content from a user card when its title is clicked', async () => {
        await submit('```\nsecret user code\n```');
        const pre = userText().querySelector('pre');
        const title = document.createElement('span');
        title.className = 'lai-source-title';
        pre.appendChild(title);

        title.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await Promise.resolve();

        expect(writeText).toHaveBeenCalledWith(expect.stringContaining('secret user code'));
    });

    it('returns the recorded source and falls back to the rendered text', () => {
        const withSource = document.createElement('span');
        withSource._laiMarkdownSource = '# original';
        expect(getUserPromptSource(withSource)).toBe('# original');

        const withoutSource = document.createElement('span');
        withoutSource.textContent = 'rendered text';
        expect(getUserPromptSource(withoutSource)).toBe('rendered text');
    });
});

describe('context-menu selection line breaks (#74)', () => {
    let getSelectionText, messageProcessor, chromeWithUrls;
    let liveSelection;

    const setLiveSelection = (text) => {
        liveSelection = text;
    };

    beforeEach(() => {
        liveSelection = '';
        global.getLineNumber = () => 'test:1';
        global.showMessage = vi.fn();
        global.getShadowRoot = vi.fn(() => document);
        global.getSideBar = vi.fn(() => document.getElementById('sideBar'));
        global.addAttachment = vi.fn(async () => { });
        global.updateStatusBar = vi.fn();
        global.getEnhancedPageContent = vi.fn(async () => 'page content');
        chromeWithUrls = {
            runtime: {
                sendMessage: vi.fn(),
                onMessage: { addListener: vi.fn() },
                getURL: vi.fn(() => 'img/attachment.svg')
            }
        };

        document.body.innerHTML = '<div id="sideBar" class="active"></div><div id="attachContainer"></div><textarea id="laiUserInput"></textarea>';

        const exports = executeLaiMainCode(global.document, dom.window, global.manifest, chromeWithUrls, global.getLineNumber, global.isMessagePersistable);
        getSelectionText = payload => exports.getSelectionText({ selection: liveSelection.trim() || payload.selection });
        messageProcessor = payload => exports.messageProcessor({
            ...payload, selection: liveSelection.trim() || payload.selection,
            url: 'https://localhost/', title: document.title
        });
    });

    afterEach(() => {

        document.body.innerHTML = '';
    });

    describe('getSelectionText', () => {
        it('prefers the live page selection over the background selectionText', () => {
            setLiveSelection('Sample CCAT Verbal Question\n\nChoose one answer');
            expect(getSelectionText({ selection: 'Sample CCAT Verbal Question Choose one answer' })).toBe('Sample CCAT Verbal Question\n\nChoose one answer');
        });

        it('falls back to the background selectionText when the live selection is empty', () => {
            setLiveSelection('');
            expect(getSelectionText({ selection: 'fallback\nwith line break' })).toBe('fallback\nwith line break');
        });

        it('falls back when the live selection holds only white space', () => {
            setLiveSelection(' \n\t ');
            expect(getSelectionText({ selection: 'fallback text' })).toBe('fallback text');
        });

        it('cleans the returned text through cleanSelection', () => {
            setLiveSelection('  keeps\tline breaks\n\n\nand one blank line  ');
            expect(getSelectionText({ selection: '' })).toBe('keeps line breaks\n\nand one blank line');
        });

        it('returns an empty string when both sources are empty', () => {
            setLiveSelection('');
            expect(getSelectionText({})).toBe('');
        });
    });

    describe('Send Selected (activePageSelection)', () => {
        it('stores the attachment with the live selection line breaks', async () => {
            setLiveSelection('Question line\nAnswer one\nAnswer two');
            await messageProcessor({ action: 'activePageSelection', selection: 'Question line Answer one Answer two' });

            expect(global.addAttachment).toHaveBeenCalledWith(expect.objectContaining({
                type: 'snippet',
                content: 'Question line\nAnswer one\nAnswer two',
                filename: 'Selected Text'
            }));
        });

        it('uses the background selectionText when no live selection exists', async () => {
            setLiveSelection('');
            await messageProcessor({ action: 'activePageSelection', selection: 'textarea\nselection' });

            expect(global.addAttachment).toHaveBeenCalledWith(expect.objectContaining({
                content: 'textarea\nselection'
            }));
        });

        it('does not attach anything when both selections are empty', async () => {
            setLiveSelection('');
            await messageProcessor({ action: 'activePageSelection', selection: '' });

            expect(global.addAttachment).not.toHaveBeenCalled();
            expect(global.showMessage).toHaveBeenCalledWith('Element picked up successfully.', 'info');
        });
    });

    describe('Insert Selected into Prompt (inserSelectedInPrompt)', () => {
        it('inserts the live selection rather than the background selectionText', async () => {
            const prompt = document.getElementById('laiUserInput');
            prompt.value = 'existing prompt';
            setLiveSelection('inserted line one\ninserted line two');

            await messageProcessor({ action: 'inserSelectedInPrompt', selection: 'inserted line one inserted line two' });

            expect(prompt.value).toBe('existing prompt\n```text\ninserted line one\ninserted line two\n```\n');
        });

        it('uses the live selection for an empty prompt', async () => {
            const prompt = document.getElementById('laiUserInput');
            setLiveSelection('first line\nsecond line');

            await messageProcessor({ action: 'inserSelectedInPrompt', selection: 'first line second line' });

            expect(prompt.value).toBe('```text\nfirst line\nsecond line\n```\n');
        });

        it('inserts the live selection even when the background selectionText is empty', async () => {
            const prompt = document.getElementById('laiUserInput');
            setLiveSelection('picked from the page');

            await messageProcessor({ action: 'inserSelectedInPrompt', selection: '' });

            expect(prompt.value).toBe('```text\npicked from the page\n```\n');
        });
    });

    describe('Explain Selected (explainSelection)', () => {
        it('receives the selection in its own text block', async () => {
            global.getSideBar = vi.fn(() => document.getElementById('sideBar'));
            const prompt = document.getElementById('laiUserInput');
            setLiveSelection('abbreviated snippet\nsecond line');

            await messageProcessor({ action: 'explainSelection', selection: 'abbreviated snippet second line' });

            expect(prompt.value).toBe('Explain the meaning of the selected text below. Use the attached page context only as context for its meaning.\n\n```text\nabbreviated snippet\nsecond line\n```\n');
        });

        it('attaches the page as context, never as the selection', async () => {
            document.title = 'Abbreviation guide';
            global.getSideBar = vi.fn(() => document.getElementById('sideBar'));
            setLiveSelection('CCAT');

            await messageProcessor({ action: 'explainSelection', selection: 'CCAT' });

            const attachment = global.addAttachment.mock.lastCall[0];
            expect(attachment.filename).toBe('Page context: Abbreviation guide');
            expect(attachment.content).toBe('PAGE CONTEXT START:\npage content\nPAGE CONTEXT END');
            expect(attachment.content).not.toContain('SELECTION SNIPPET');
            expect(global.addAttachment.mock.calls).toHaveLength(1);
            expect(document.getElementById('laiUserInput').value).toContain('```text\nCCAT\n```');
        });

        it('falls back to the host when the page has no title', async () => {
            document.title = '';
            global.getSideBar = vi.fn(() => document.getElementById('sideBar'));
            setLiveSelection('CCAT');

            await messageProcessor({ action: 'explainSelection', selection: 'CCAT' });

            expect(global.addAttachment.mock.lastCall[0].filename).toBe('Page context: localhost');
        });

        it('still explains the selection when page extraction fails', async () => {
            global.getSideBar = vi.fn(() => document.getElementById('sideBar'));
            const prompt = document.getElementById('laiUserInput');
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            setLiveSelection('CCAT');
            global.getEnhancedPageContent = vi.fn(async () => { throw new Error('extraction failed'); });

            await messageProcessor({ action: 'explainSelection', selection: 'CCAT' });

            expect(global.addAttachment).not.toHaveBeenCalled();
            expect(prompt.value).toContain('```text\nCCAT\n```');
            expect(prompt.value).not.toContain('attached page context');
            expect(warnSpy.mock.calls.some(args => String(args[0]).includes('explaining the selection only'))).toBe(true);
            warnSpy.mockRestore();
        });

        it('uses the background selectionText when no live selection exists', async () => {
            global.getSideBar = vi.fn(() => document.getElementById('sideBar'));
            const prompt = document.getElementById('laiUserInput');
            setLiveSelection('');

            await messageProcessor({ action: 'explainSelection', selection: 'iframe\nselection' });

            expect(prompt.value).toContain('```text\niframe\nselection\n```');
        });

        it('does not open a prompt when both selections are empty', async () => {
            global.getSideBar = vi.fn(() => document.getElementById('sideBar'));
            const prompt = document.getElementById('laiUserInput');
            setLiveSelection('');

            await messageProcessor({ action: 'explainSelection', selection: '' });

            expect(prompt.value).toBe('');
            expect(global.showMessage).toHaveBeenCalledWith('Nothing selected to explain!', 'warning');
        });
    });
});

describe('fenced insertion into the prompt (#75)', () => {
    let messageProcessor, chromeWithUrls;
    let liveSelection;
    let prompt;

    const setLiveSelection = (text) => {
        liveSelection = text;
    };

    beforeEach(() => {
        liveSelection = '';
        global.getLineNumber = () => 'test:1';
        global.showMessage = vi.fn();
        global.getShadowRoot = vi.fn(() => document);
        global.getSideBar = vi.fn(() => document.getElementById('sideBar'));
        global.addAttachment = vi.fn(async () => { });
        global.updateStatusBar = vi.fn();
        global.getEnhancedPageContent = vi.fn(async () => 'page content');
        chromeWithUrls = {
            runtime: {
                sendMessage: vi.fn(),
                onMessage: { addListener: vi.fn() },
                getURL: vi.fn(() => 'img/attachment.svg')
            }
        };

        document.body.innerHTML = '<div id="sideBar" class="active"></div><div id="attachContainer"></div><textarea id="laiUserInput"></textarea>';
        prompt = document.getElementById('laiUserInput');
        global.getSideBar = vi.fn(() => document.getElementById('sideBar'));

        const exports = executeLaiMainCode(global.document, global.window, global.manifest, chromeWithUrls, global.getLineNumber, global.isMessagePersistable);
        messageProcessor = payload => exports.messageProcessor({
            ...payload, selection: liveSelection.trim() || payload.selection,
            url: 'https://localhost/', title: document.title
        });
    });

    afterEach(() => {

        document.body.innerHTML = '';
    });

    it('wraps a multi-line selection inserted into an empty prompt in a fenced text block', async () => {
        setLiveSelection('Question line\nAnswer one\nAnswer two');

        await messageProcessor({ action: 'inserSelectedInPrompt', selection: 'Question line Answer one Answer two' });

        expect(prompt.value).toBe('```text\nQuestion line\nAnswer one\nAnswer two\n```\n');
    });

    it('places the caret at the end and keeps the focus on the input', async () => {
        setLiveSelection('some selection');

        await messageProcessor({ action: 'inserSelectedInPrompt', selection: 'some selection' });

        expect(prompt.selectionStart).toBe(prompt.value.length);
        expect(prompt.selectionEnd).toBe(prompt.value.length);
        expect(document.activeElement).toBe(prompt);
    });

    it('puts the block on a new line after existing prompt text', async () => {
        prompt.value = 'existing prompt';
        setLiveSelection('line one\nline two');

        await messageProcessor({ action: 'inserSelectedInPrompt', selection: 'line one line two' });

        expect(prompt.value).toBe('existing prompt\n```text\nline one\nline two\n```\n');
    });

    it('does not add a blank line when the prompt already ends with a newline', async () => {
        prompt.value = 'existing prompt\n';
        setLiveSelection('line one');

        await messageProcessor({ action: 'inserSelectedInPrompt', selection: 'line one' });

        expect(prompt.value).toBe('existing prompt\n```text\nline one\n```\n');
    });

    it('uses a four-backtick fence for a selection containing three backticks', async () => {
        setLiveSelection('has ``` inside\nmore');

        await messageProcessor({ action: 'inserSelectedInPrompt', selection: 'has ``` inside more' });

        expect(prompt.value).toBe('````text\nhas ``` inside\nmore\n````\n');
    });
});

describe('attachment deletion UI (#76)', () => {
    function setup(result) {
        const root = document.createElement('div');
        root.innerHTML = '<div id="attachContainer" class="active"><img data-index="a" class="attached"></div>';
        const code = ['attachmentImgClicked', 'attachmentDeleted'].map(name => laiMainCode.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n}\\n`))[0]).join('\n');
        const showMessage = vi.fn();
        const run = new Function('getShadowRoot', 'deleteAttachment', 'showMessage', 'manifest', 'getLineNumber', `${code}\nreturn attachmentImgClicked;`)(() => root, vi.fn(async () => result), showMessage, global.manifest, global.getLineNumber);
        return { root, showMessage, run };
    }
    it('hides the ribbon after the last icon is removed', async () => {
        const { root, run } = setup(true); const icon = root.querySelector('img');
        await run({ target: icon, preventDefault() {} });
        expect(root.querySelector('img')).toBeNull();
        expect(root.querySelector('#attachContainer').classList.contains('active')).toBe(false);
    });
    it('keeps the icon and shows an error when deletion fails', async () => {
        const { root, showMessage, run } = setup(false); const icon = root.querySelector('img');
        await run({ target: icon, preventDefault() {} });
        expect(root.querySelector('img')).toBe(icon);
        expect(root.querySelector('#attachContainer').classList.contains('active')).toBe(true);
        expect(showMessage).toHaveBeenCalledWith(expect.any(String), 'error');
    });
});

describe('attachment icon interaction (#77)', () => {
    let showAttachment, userInputFocused, userInputBlurred;
    let container, prompt, area;

    const addAttachmentIcon = (id = 'attach-1', content = 'job description text file') => {
        showAttachment({ id, type: 'snippet', content, filename: 'Selected Text' });
        return container.querySelector('img.attached');
    };

    beforeEach(() => {
        global.getLineNumber = () => 'test:1';
        global.showMessage = vi.fn();
        global.getShadowRoot = vi.fn(() => document);
        global.getSideBar = vi.fn(() => null);
        global.deleteAttachment = vi.fn(async () => true);
        global.getAttachments = vi.fn(async () => []);
        const chromeWithUrls = {
            runtime: {
                sendMessage: vi.fn(),
                onMessage: { addListener: vi.fn() },
                getURL: vi.fn(() => 'img/attachment.svg')
            }
        };

        document.body.innerHTML = '<div class="lai-user-area"><textarea id="laiUserInput"></textarea></div><div id="attachContainer" class="attachment-container active"></div>';
        area = document.querySelector('.lai-user-area');
        prompt = document.getElementById('laiUserInput');
        container = document.getElementById('attachContainer');

        ({ showAttachment, userInputFocused, userInputBlurred } = executeLaiMainCode(global.document, global.window, global.manifest, chromeWithUrls, global.getLineNumber, global.isMessagePersistable));
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('default-prevents mousedown on the icon so the input keeps focus', () => {
        const icon = addAttachmentIcon();
        prompt.focus();

        const mousedown = new window.MouseEvent('mousedown', { cancelable: true, bubbles: true });
        icon.dispatchEvent(mousedown);

        expect(mousedown.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(prompt);
    });

    it('marks the icon as a labelled, focusable button', () => {
        const icon = addAttachmentIcon();

        expect(icon.getAttribute('role')).toBe('button');
        expect(icon.getAttribute('tabindex')).toBe('0');
        expect(icon.getAttribute('aria-label')).toBe(`Delete attachment: ${icon.getAttribute('title')}`);
    });

    it('deletes the attachment once on Enter', async () => {
        const icon = addAttachmentIcon('attach-enter');

        icon.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(global.deleteAttachment).toHaveBeenCalledTimes(1);
        expect(global.deleteAttachment).toHaveBeenCalledWith('attach-enter');
        expect(icon.isConnected).toBe(false);
        expect(container.classList.contains('active')).toBe(false);
    });

    it('deletes the attachment once on Space', async () => {
        const icon = addAttachmentIcon('attach-space');

        icon.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', cancelable: true, bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(global.deleteAttachment).toHaveBeenCalledTimes(1);
        expect(global.deleteAttachment).toHaveBeenCalledWith('attach-space');
        expect(icon.isConnected).toBe(false);
    });

    it('keeps toggling the focused class on ordinary input focus and blur', async () => {
        await userInputFocused({ composedPath: () => [prompt, area] });
        expect(area.classList.contains('focused')).toBe(true);

        userInputBlurred({ composedPath: () => [prompt, area] });
        expect(area.classList.contains('focused')).toBe(false);
    });
});

describe('watermark links (#87)', () => {
    const rateLinkFirefoxUrlCode = laiMainCode.match(/const rateLinkFirefoxUrl = '[^']*';/)[0];
    const rateLinkChromiumUrlCode = laiMainCode.match(/const rateLinkChromiumUrl = '[^']*';/)[0];
    const starLinkUrlCode = laiMainCode.match(/const starLinkUrl = '[^']*';/)[0];
    const setWatermarkLinkHrefsCode = laiMainCode.match(/function setWatermarkLinkHrefs\([\s\S]*?\n}\n/)[0];
    const loadWatermarkLinks = () => new Function(`${rateLinkFirefoxUrlCode}
${rateLinkChromiumUrlCode}
${starLinkUrlCode}
${setWatermarkLinkHrefsCode}
return { setWatermarkLinkHrefs };`)();

    const buildShadowRoot = () => {
        const root = document.createElement('div');
        root.innerHTML = `
            <a id="laiRateLink" target="_blank" rel="noopener noreferrer"></a>
            <a id="laiStarLink" target="_blank" rel="noopener noreferrer"></a>`;
        return root;
    };

    it('links the add-on page for a gecko manifest', () => {
        const { setWatermarkLinkHrefs } = loadWatermarkLinks();
        const root = buildShadowRoot();

        setWatermarkLinkHrefs(root, { browser_specific_settings: { gecko: { id: '{a1b2c3d4-e5f6-7890-abcd-ef1234567890}' } } });

        expect(root.querySelector('#laiRateLink').getAttribute('href')).toBe('https://addons.mozilla.org/en-GB/firefox/addon/local-ai-helper/');
        expect(root.querySelector('#laiStarLink').getAttribute('href')).toBe('https://github.com/ivostoykov/localAI/');
    });

    it('links the Chrome Web Store page for a chromium manifest', () => {
        const { setWatermarkLinkHrefs } = loadWatermarkLinks();
        const root = buildShadowRoot();

        setWatermarkLinkHrefs(root, { name: 'Local AI helper' });

        expect(root.querySelector('#laiRateLink').getAttribute('href')).toBe('https://chromewebstore.google.com/detail/local-ai-helper/mplpnjanhjddepeecpmjbglbiccdhnfp');
        expect(root.querySelector('#laiStarLink').getAttribute('href')).toBe('https://github.com/ivostoykov/localAI/');
    });

    it('opens both anchors from sidebar.html in a new tab without a referrer', () => {
        const sidebarHtml = fs.readFileSync(path.join(__dirname, '../src/sidebar.html'), 'utf-8');
        for (const id of ['laiRateLink', 'laiStarLink']) {
            const anchor = sidebarHtml.match(new RegExp(`<a id="${id}"[^>]*>`));
            expect(anchor).not.toBeNull();
            expect(anchor[0]).toContain('target="_blank"');
            expect(anchor[0]).toContain('rel="noopener noreferrer"');
        }
        expect(sidebarHtml).toContain('⭐ Rate this extension');
        expect(sidebarHtml).toContain('★ Star on GitHub');
    });

    it('places the links before the chat list so messages cover them', () => {
        const sidebarHtml = fs.readFileSync(path.join(__dirname, '../src/sidebar.html'), 'utf-8');
        expect(sidebarHtml.indexOf('lai-watermark-links')).toBeLessThan(sidebarHtml.indexOf('id="laiChatMessageList"'));
    });
});

describe('recycleActiveSession (#135)', () => {
    it('clears the chat UI before starting a new session', async () => {
        const recycleCode = laiMainCode.match(/async function recycleActiveSession\([\s\S]*?\n}\n/)[0];
        const deleteActiveSession = vi.fn(async () => undefined);
        const reportTabBinding = vi.fn(async () => undefined);
        const showMessage = vi.fn();
        const clearChatHistoryUI = vi.fn();
        const createNewSessionClicked = vi.fn(async () => undefined);

        const recycleActiveSession = new Function(
            'deleteActiveSession', 'reportTabBinding', 'showMessage', 'clearChatHistoryUI',
            'createNewSessionClicked', 'getShadowRoot', 'manifest', 'getLineNumber',
            `${recycleCode}
return recycleActiveSession;`
        )(
            deleteActiveSession, reportTabBinding, showMessage, clearChatHistoryUI,
            createNewSessionClicked, () => null, global.manifest, () => 'test:1'
        );

        await recycleActiveSession({}, {});

        expect(clearChatHistoryUI).toHaveBeenCalledOnce();
        expect(createNewSessionClicked).toHaveBeenCalledOnce();
        expect(clearChatHistoryUI.mock.invocationCallOrder[0]).toBeLessThan(createNewSessionClicked.mock.invocationCallOrder[0]);
    });
});
