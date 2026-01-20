import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const memoryCode = fs.readFileSync(
    path.join(__dirname, '../src/background-memory.js'),
    'utf-8'
);

const executeMemoryCode = new Function('indexedDB', 'manifest', memoryCode + '; return { BackgroundMemory, backgroundMemory, STORES };');

let BackgroundMemory, backgroundMemory, STORES;

describe('background-memory.js', () => {
    beforeEach(async () => {
        const exports = executeMemoryCode(global.indexedDB, global.manifest);
        BackgroundMemory = exports.BackgroundMemory;
        backgroundMemory = new exports.BackgroundMemory();
        STORES = exports.STORES;

        await backgroundMemory.init();
    });

    describe('init', () => {
        it('initialises IndexedDB', async () => {
            const memory = new BackgroundMemory();
            await memory.init();

            expect(memory.db).toBeDefined();
        });

        it('creates required object stores', async () => {
            expect(backgroundMemory.db.objectStoreNames.contains(STORES.CONVERSATIONS)).toBe(true);
            expect(backgroundMemory.db.objectStoreNames.contains(STORES.CONTEXT)).toBe(true);
            expect(backgroundMemory.db.objectStoreNames.contains(STORES.SESSIONS)).toBe(true);
        });

        it('returns same db instance on multiple calls', async () => {
            const memory = new BackgroundMemory();
            const db1 = await memory.init();
            const db2 = await memory.init();

            expect(db1).toBe(db2);
        });
    });

    describe('storeTurn', () => {
        it('stores conversation turn', async () => {
            await backgroundMemory.storeTurn('session-1', 1, 'Hello', 'Hi there');

            const transaction = backgroundMemory.db.transaction([STORES.CONVERSATIONS], 'readonly');
            const store = transaction.objectStore(STORES.CONVERSATIONS);
            const index = store.index('sessionId');
            const request = index.getAll('session-1');

            const turns = await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            expect(turns).toHaveLength(1);
            expect(turns[0].sessionId).toBe('session-1');
            expect(turns[0].turnNumber).toBe(1);
            expect(turns[0].userMessage).toBe('Hello');
            expect(turns[0].assistantResponse).toBe('Hi there');
        });

        it('estimates tokens', async () => {
            await backgroundMemory.storeTurn('session-1', 1, 'Hello world', 'Hi there friend');

            const turns = await backgroundMemory.getRecentTurns('session-1', 1);

            expect(turns[0].tokens).toBeGreaterThan(0);
        });
    });

    describe('storeContext', () => {
        it('stores page content', async () => {
            await backgroundMemory.storeContext('session-1', 'Page content here', []);

            const context = await backgroundMemory.getContext('session-1');

            expect(context.sessionId).toBe('session-1');
            expect(context.pageContent).toBe('Page content here');
            expect(context.pageSummary).toBeDefined();
        });

        it('stores attachments', async () => {
            const attachments = [
                { type: 'image', filename: 'test.png', content: 'image data' }
            ];

            await backgroundMemory.storeContext('session-1', null, attachments);

            const context = await backgroundMemory.getContext('session-1');

            expect(context.attachments).toHaveLength(1);
            expect(context.attachmentSummaries).toHaveLength(1);
        });
    });

    describe('getRecentTurns', () => {
        it('retrieves recent turns', async () => {
            await backgroundMemory.storeTurn('session-1', 1, 'Message 1', 'Response 1');
            await backgroundMemory.storeTurn('session-1', 2, 'Message 2', 'Response 2');
            await backgroundMemory.storeTurn('session-1', 3, 'Message 3', 'Response 3');

            const turns = await backgroundMemory.getRecentTurns('session-1', 2);

            expect(turns).toHaveLength(2);
            expect(turns[0].turnNumber).toBe(2);
            expect(turns[1].turnNumber).toBe(3);
        });
    });

    describe('getContext', () => {
        it('retrieves stored context', async () => {
            await backgroundMemory.storeContext('session-1', 'Page content', []);

            const context = await backgroundMemory.getContext('session-1');

            expect(context.pageContent).toBe('Page content');
        });

        it('returns undefined for non-existent session', async () => {
            const context = await backgroundMemory.getContext('non-existent');

            expect(context).toBeUndefined();
        });
    });

    describe('getTurnSummaries', () => {
        it('returns summaries excluding recent turns', async () => {
            // Create a fresh instance to avoid interference from other tests
            const memory = new BackgroundMemory();
            await memory.init();

            await memory.storeTurn('session-test', 1, 'Turn 1', 'Response 1');
            await memory.storeTurn('session-test', 2, 'Turn 2', 'Response 2');
            await memory.storeTurn('session-test', 3, 'Turn 3', 'Response 3');
            await memory.storeTurn('session-test', 4, 'Turn 4', 'Response 4');

            const summaries = await memory.getTurnSummaries('session-test', 2);

            expect(summaries).toHaveLength(2);
        });
    });

    describe('buildOptimisedContext', () => {
        it('builds context for turn 1', async () => {
            const context = await backgroundMemory.buildOptimisedContext(
                'session-1',
                'Hello',
                1,
                'System instructions',
                'Page content',
                []
            );

            expect(context).toBeDefined();
            expect(context.some(msg => msg.content === 'System instructions')).toBe(true);
            expect(context.some(msg => msg.content.includes('PAGE CONTENT'))).toBe(true);
            expect(context[context.length - 1].content).toBe('Hello');
        });

        it('includes recent turns', async () => {
            const memory = new BackgroundMemory();
            await memory.init();

            await memory.storeTurn('session-ctx', 1, 'First message', 'First response');

            const context = await memory.buildOptimisedContext(
                'session-ctx',
                'Second message',
                2,
                null,
                null,
                []
            );

            expect(context.some(msg => msg.content === 'First message')).toBe(true);
            expect(context.some(msg => msg.content === 'First response')).toBe(true);
        });
    });

    describe('deleteSession', () => {
        it('deletes all session data', async () => {
            await backgroundMemory.storeTurn('session-1', 1, 'Message', 'Response');
            await backgroundMemory.storeContext('session-1', 'Page', []);

            await backgroundMemory.deleteSession('session-1');

            const turns = await backgroundMemory.getRecentTurns('session-1', 10);
            const context = await backgroundMemory.getContext('session-1');

            expect(turns).toHaveLength(0);
            expect(context).toBeUndefined();
        });
    });

    describe('clearAll', () => {
        it('clears all stores', async () => {
            await backgroundMemory.storeTurn('session-1', 1, 'Message', 'Response');
            await backgroundMemory.storeContext('session-1', 'Page', []);

            await backgroundMemory.clearAll();

            const turns = await backgroundMemory.getRecentTurns('session-1', 10);
            const context = await backgroundMemory.getContext('session-1');

            expect(turns).toHaveLength(0);
            expect(context).toBeUndefined();
        });
    });

    describe('helper methods', () => {
        it('generates quick summary', () => {
            const summary = backgroundMemory.generateQuickSummary(
                'This is a user message',
                'This is an assistant response'
            );

            expect(summary).toContain('This is a user message');
            expect(summary).toContain('This is an assistant response');
        });

        it('extracts page summary', () => {
            const pageContent = '## Heading 1\n\nFirst paragraph with content.\n\n## Heading 2\n\nSecond paragraph.';
            const summary = backgroundMemory.extractPageSummary(pageContent);

            expect(summary).toContain('Heading');
            expect(summary.length).toBeLessThanOrEqual(300);
        });

        it('extracts attachment summary', () => {
            const attachment = {
                type: 'code',
                filename: 'test.js',
                content: 'const test = "hello world";'
            };

            const summary = backgroundMemory.extractAttachmentSummary(attachment);

            expect(summary).toContain('code');
            expect(summary).toContain('test.js');
        });

        it('estimates tokens', () => {
            const tokens = backgroundMemory.estimateTokens('Hello world this is a test');

            expect(tokens).toBeGreaterThan(0);
            expect(tokens).toBeLessThanOrEqual(10);
        });

        it('truncates text to token limit', () => {
            const longText = 'word '.repeat(200);
            const truncated = backgroundMemory.truncateToTokens(longText, 50);

            // Should be truncated + '...' (3 chars)
            expect(truncated.length).toBeLessThanOrEqual(50 * 4 + 3);
            expect(truncated).toContain('...');
        });

        it('does not truncate short text', () => {
            const shortText = 'Hello world';
            const result = backgroundMemory.truncateToTokens(shortText, 50);

            expect(result).toBe(shortText);
        });
    });
});
