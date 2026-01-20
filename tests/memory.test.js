import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const memoryCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/memory.js'),
    'utf-8'
);

const executeMemoryCode = new Function('indexedDB', memoryCode + '; return { ConversationMemory, conversationMemory, STORES };');

let ConversationMemory, conversationMemory, STORES;

describe('memory.js', () => {
    beforeEach(async () => {
        const exports = executeMemoryCode(global.indexedDB);
        ConversationMemory = exports.ConversationMemory;
        conversationMemory = new exports.ConversationMemory();
        STORES = exports.STORES;

        await conversationMemory.init();
    });

    describe('init', () => {
        it('initialises IndexedDB', async () => {
            const memory = new ConversationMemory();
            await memory.init();

            expect(memory.db).toBeDefined();
        });

        it('creates required object stores', async () => {
            expect(conversationMemory.db.objectStoreNames.contains(STORES.CONVERSATIONS)).toBe(true);
            expect(conversationMemory.db.objectStoreNames.contains(STORES.CONTEXT)).toBe(true);
            expect(conversationMemory.db.objectStoreNames.contains(STORES.SESSIONS)).toBe(true);
        });

        it('returns same db instance on multiple calls', async () => {
            const memory = new ConversationMemory();
            const db1 = await memory.init();
            const db2 = await memory.init();

            expect(db1).toStrictEqual(db2);
        });
    });

    describe('storeTurn', () => {
        it('stores conversation turn', async () => {
            await conversationMemory.storeTurn('session-1', 1, 'Hello', 'Hi there');

            const transaction = conversationMemory.db.transaction([STORES.CONVERSATIONS], 'readonly');
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
            await conversationMemory.storeTurn('session-1', 1, 'Hello world', 'Hi there friend');

            const turns = await conversationMemory.getRecentTurns('session-1', 1);

            expect(turns[0].tokens).toBeGreaterThan(0);
        });

        it('generates summary', async () => {
            await conversationMemory.storeTurn('session-summary', 1, 'Test message', 'Test response');

            const turns = await conversationMemory.getRecentTurns('session-summary', 1);

            expect(turns[0].summary).toBeDefined();
            expect(turns[0].summary).toContain('Test message');
            expect(turns[0].summary).toContain('Test response');
        });
    });

    describe('storeContext', () => {
        it('stores page content', async () => {
            await conversationMemory.storeContext('session-1', 'Page content here', []);

            const context = await conversationMemory.getContext('session-1');

            expect(context.sessionId).toBe('session-1');
            expect(context.pageContent).toBe('Page content here');
            expect(context.pageSummary).toBeDefined();
        });

        it('stores attachments', async () => {
            const attachments = [
                { type: 'image', filename: 'test.png', content: 'image data' }
            ];

            await conversationMemory.storeContext('session-1', null, attachments);

            const context = await conversationMemory.getContext('session-1');

            expect(context.attachments).toHaveLength(1);
            expect(context.attachmentSummaries).toHaveLength(1);
        });

        it('handles null page content', async () => {
            await conversationMemory.storeContext('session-1', null, []);

            const context = await conversationMemory.getContext('session-1');

            expect(context.pageContent).toBeNull();
            expect(context.pageSummary).toBeNull();
        });
    });

    describe('getRecentTurns', () => {
        it('retrieves recent turns', async () => {
            await conversationMemory.storeTurn('session-1', 1, 'Message 1', 'Response 1');
            await conversationMemory.storeTurn('session-1', 2, 'Message 2', 'Response 2');
            await conversationMemory.storeTurn('session-1', 3, 'Message 3', 'Response 3');

            const turns = await conversationMemory.getRecentTurns('session-1', 2);

            expect(turns).toHaveLength(2);
            expect(turns[0].turnNumber).toBe(2);
            expect(turns[1].turnNumber).toBe(3);
        });

        it('returns in chronological order', async () => {
            await conversationMemory.storeTurn('session-chrono', 1, 'First', 'Response 1');
            await conversationMemory.storeTurn('session-chrono', 2, 'Second', 'Response 2');

            const turns = await conversationMemory.getRecentTurns('session-chrono', 2);

            expect(turns[0].userMessage).toBe('First');
            expect(turns[1].userMessage).toBe('Second');
        });
    });

    describe('getContext', () => {
        it('retrieves stored context', async () => {
            await conversationMemory.storeContext('session-1', 'Page content', []);

            const context = await conversationMemory.getContext('session-1');

            expect(context.pageContent).toBe('Page content');
        });

        it('returns undefined for non-existent session', async () => {
            const context = await conversationMemory.getContext('non-existent');

            expect(context).toBeUndefined();
        });
    });

    describe('getTurnSummaries', () => {
        it('returns summaries excluding recent turns', async () => {
            const memory = new ConversationMemory();
            await memory.init();

            await memory.storeTurn('session-test', 1, 'Turn 1', 'Response 1');
            await memory.storeTurn('session-test', 2, 'Turn 2', 'Response 2');
            await memory.storeTurn('session-test', 3, 'Turn 3', 'Response 3');
            await memory.storeTurn('session-test', 4, 'Turn 4', 'Response 4');

            const summaries = await memory.getTurnSummaries('session-test', 2);

            expect(summaries).toHaveLength(2);
        });

        it('returns summaries in chronological order', async () => {
            const memory = new ConversationMemory();
            await memory.init();

            await memory.storeTurn('session-order', 1, 'First', 'Response 1');
            await memory.storeTurn('session-order', 2, 'Second', 'Response 2');
            await memory.storeTurn('session-order', 3, 'Third', 'Response 3');

            const summaries = await memory.getTurnSummaries('session-order', 1);

            expect(summaries[0]).toContain('First');
            expect(summaries[1]).toContain('Second');
        });
    });

    describe('buildOptimisedContext', () => {
        it('builds context for turn 1', async () => {
            const context = await conversationMemory.buildOptimisedContext(
                'session-1',
                'Hello',
                1,
                'System instructions'
            );

            expect(context).toBeDefined();
            expect(context.some(msg => msg.content === 'System instructions')).toBe(true);
            expect(context[context.length - 1].content).toBe('Hello');
        });

        it('includes page content on turn 1', async () => {
            await conversationMemory.storeContext('session-ctx', 'Page content here', []);

            const context = await conversationMemory.buildOptimisedContext(
                'session-ctx',
                'Question',
                1,
                null
            );

            expect(context.some(msg => msg.content.includes('PAGE CONTENT'))).toBe(true);
            expect(context.some(msg => msg.content.includes('Page content here'))).toBe(true);
        });

        it('includes page summary on later turns', async () => {
            await conversationMemory.storeContext('session-summary', '## Heading\n\nContent here', []);

            const context = await conversationMemory.buildOptimisedContext(
                'session-summary',
                'Question',
                2,
                null
            );

            expect(context.some(msg => msg.content.includes('PAGE SUMMARY'))).toBe(true);
        });

        it('includes page content when @{{page}} mentioned', async () => {
            await conversationMemory.storeContext('session-page', 'Full page content', []);

            const context = await conversationMemory.buildOptimisedContext(
                'session-page',
                'Tell me about @{{page}}',
                5,
                null
            );

            expect(context.some(msg => msg.content.includes('Full page content'))).toBe(true);
        });

        it('includes recent turns', async () => {
            const memory = new ConversationMemory();
            await memory.init();

            await memory.storeTurn('session-recent', 1, 'First message', 'First response');

            const context = await memory.buildOptimisedContext(
                'session-recent',
                'Second message',
                2,
                null
            );

            expect(context.some(msg => msg.content === 'First message')).toBe(true);
            expect(context.some(msg => msg.content === 'First response')).toBe(true);
        });

        it('includes full attachments on early turns', async () => {
            const attachments = [
                { type: 'code', filename: 'test.js', content: 'const x = 1;' }
            ];
            await conversationMemory.storeContext('session-att', null, attachments);

            const context = await conversationMemory.buildOptimisedContext(
                'session-att',
                'Question',
                1,
                null
            );

            expect(context.some(msg => msg.content.includes('const x = 1;'))).toBe(true);
        });

        it('includes attachment summaries on later turns', async () => {
            const attachments = [
                { type: 'code', filename: 'test.js', content: 'const x = 1;' }
            ];
            await conversationMemory.storeContext('session-att-summary', null, attachments);

            const context = await conversationMemory.buildOptimisedContext(
                'session-att-summary',
                'Question',
                5,
                null
            );

            expect(context.some(msg => msg.content.includes('ATTACHMENTS'))).toBe(true);
            expect(context.some(msg => msg.content.includes('test.js'))).toBe(true);
        });

        it('includes history summaries after turn 3', async () => {
            const memory = new ConversationMemory();
            await memory.init();

            await memory.storeTurn('session-history', 1, 'Turn 1', 'Response 1');
            await memory.storeTurn('session-history', 2, 'Turn 2', 'Response 2');
            await memory.storeTurn('session-history', 3, 'Turn 3', 'Response 3');
            await memory.storeTurn('session-history', 4, 'Turn 4', 'Response 4');

            const context = await memory.buildOptimisedContext(
                'session-history',
                'Question',
                5,
                null
            );

            expect(context.some(msg => msg.content.includes('HISTORY'))).toBe(true);
        });
    });

    describe('deleteSession', () => {
        it('deletes all session data', async () => {
            await conversationMemory.storeTurn('session-1', 1, 'Message', 'Response');
            await conversationMemory.storeContext('session-1', 'Page', []);

            await conversationMemory.deleteSession('session-1');

            const turns = await conversationMemory.getRecentTurns('session-1', 10);
            const context = await conversationMemory.getContext('session-1');

            expect(turns).toHaveLength(0);
            expect(context).toBeUndefined();
        });
    });

    describe('pruneOldSessions', () => {
        it('deletes old sessions', async () => {
            // Create session metadata with old lastAccessed
            const oldTimestamp = Date.now() - (31 * 24 * 60 * 60 * 1000); // 31 days ago

            await conversationMemory.put(STORES.SESSIONS, {
                sessionId: 'old-session',
                lastAccessed: oldTimestamp
            });

            await conversationMemory.storeTurn('old-session', 1, 'Message', 'Response');

            await conversationMemory.pruneOldSessions(30);

            const turns = await conversationMemory.getRecentTurns('old-session', 10);
            expect(turns).toHaveLength(0);
        });

        it('keeps recent sessions', async () => {
            const recentTimestamp = Date.now() - (10 * 24 * 60 * 60 * 1000); // 10 days ago

            await conversationMemory.put(STORES.SESSIONS, {
                sessionId: 'recent-session',
                lastAccessed: recentTimestamp
            });

            await conversationMemory.storeTurn('recent-session', 1, 'Message', 'Response');

            await conversationMemory.pruneOldSessions(30);

            const turns = await conversationMemory.getRecentTurns('recent-session', 10);
            expect(turns).toHaveLength(1);
        });
    });

    describe('helper methods', () => {
        it('generates quick summary', () => {
            const summary = conversationMemory.generateQuickSummary(
                'This is a user message',
                'This is an assistant response'
            );

            expect(summary).toContain('This is a user message');
            expect(summary).toContain('This is an assistant response');
        });

        it('extracts page summary', () => {
            const pageContent = '## Heading 1\n\nFirst paragraph with content.\n\n## Heading 2\n\nSecond paragraph.';
            const summary = conversationMemory.extractPageSummary(pageContent);

            expect(summary).toContain('Heading');
            expect(summary.length).toBeLessThanOrEqual(300);
        });

        it('extracts attachment summary', () => {
            const attachment = {
                type: 'code',
                filename: 'test.js',
                content: 'const test = "hello world";'
            };

            const summary = conversationMemory.extractAttachmentSummary(attachment);

            expect(summary).toContain('code');
            expect(summary).toContain('test.js');
        });

        it('estimates tokens', () => {
            const tokens = conversationMemory.estimateTokens('Hello world this is a test');

            expect(tokens).toBeGreaterThan(0);
            expect(tokens).toBeLessThanOrEqual(10);
        });

        it('truncates text to token limit', () => {
            const longText = 'word '.repeat(200);
            const truncated = conversationMemory.truncateToTokens(longText, 50);

            expect(truncated.length).toBeLessThanOrEqual(50 * 4 + 3);
            expect(truncated).toContain('...');
        });

        it('does not truncate short text', () => {
            const shortText = 'Hello world';
            const result = conversationMemory.truncateToTokens(shortText, 50);

            expect(result).toBe(shortText);
        });
    });

    describe('generic IndexedDB operations', () => {
        it('get retrieves data', async () => {
            await conversationMemory.put(STORES.CONTEXT, {
                sessionId: 'test-get',
                pageContent: 'Test content'
            });

            const result = await conversationMemory.get(STORES.CONTEXT, 'test-get');

            expect(result.pageContent).toBe('Test content');
        });

        it('put stores data', async () => {
            const result = await conversationMemory.put(STORES.CONTEXT, {
                sessionId: 'test-put',
                pageContent: 'New content'
            });

            const retrieved = await conversationMemory.get(STORES.CONTEXT, 'test-put');
            expect(retrieved.pageContent).toBe('New content');
        });

        it('delete removes data', async () => {
            await conversationMemory.put(STORES.CONTEXT, {
                sessionId: 'test-delete',
                pageContent: 'Content'
            });

            await conversationMemory.delete(STORES.CONTEXT, 'test-delete');

            const result = await conversationMemory.get(STORES.CONTEXT, 'test-delete');
            expect(result).toBeUndefined();
        });

        it('query retrieves by index', async () => {
            await conversationMemory.storeTurn('query-test', 1, 'Message 1', 'Response 1');
            await conversationMemory.storeTurn('query-test', 2, 'Message 2', 'Response 2');

            const results = await conversationMemory.query(STORES.CONVERSATIONS, 'sessionId', 'query-test');

            expect(results).toHaveLength(2);
        });

        it('getAll retrieves all records', async () => {
            await conversationMemory.put(STORES.CONTEXT, { sessionId: 'ctx-1', pageContent: 'A' });
            await conversationMemory.put(STORES.CONTEXT, { sessionId: 'ctx-2', pageContent: 'B' });

            const results = await conversationMemory.getAll(STORES.CONTEXT);

            expect(results.length).toBeGreaterThanOrEqual(2);
        });
    });
});
