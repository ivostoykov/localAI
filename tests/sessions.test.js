import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from '@webext-core/fake-browser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionsCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/sessions.js'),
    'utf-8'
);

// Execute sessions.js code in global scope
const executeSessionsCode = new Function('chrome', 'manifest', 'getLineNumber', 'allSessionsStorageKey', 'activeSessionIdStorageKey', 'storageUserCommandsKey', 'storageOptionKey', 'activePageStorageKey', 'aiUserCommands', sessionsCode + '; return { createNewSession, deleteSession, deleteActiveSession, deleteSessionById, deleteActiveSessionId, getSession, getActiveSession, getActiveSessionById, getAllSessions, setAllSessions, setActiveSessionId, getActiveSessionId, setActiveSession, getAiUserCommands, setAiUserCommands, getOptions, setOptions, deleteSessionMemory, clearAllMemory };');

let funcs;

describe('sessions.js', () => {
    beforeEach(async () => {
        await fakeBrowser.storage.local.clear();
        await fakeBrowser.storage.sync.clear();

        // Initialize aiUserCommands
        global.aiUserCommands = [];

        // Execute sessions code with chrome API
        funcs = executeSessionsCode(
            global.chrome,
            global.manifest,
            global.getLineNumber,
            global.allSessionsStorageKey,
            global.activeSessionIdStorageKey,
            global.storageUserCommandsKey,
            global.storageOptionKey,
            global.activePageStorageKey,
            global.aiUserCommands
        );
    });

    describe('createNewSession', () => {
        it('creates session with default title', async () => {
            const session = await funcs.createNewSession();

            expect(session.id).toBeDefined();
            expect(session.title).toContain('Session');
            expect(session.messages).toEqual([]);
            expect(session.model).toBeDefined();
        });

        it('creates session with custom title', async () => {
            const session = await funcs.createNewSession('My Custom Session Title');

            expect(session.title).toBe('My Custom Session Title');
        });

        it('stores session in storage', async () => {
            const session = await funcs.createNewSession();
            const result = await fakeBrowser.storage.local.get(allSessionsStorageKey);

            expect(result[allSessionsStorageKey]).toHaveLength(1);
            expect(result[allSessionsStorageKey][0].id).toBe(session.id);
        });

        it('sets created session as active', async () => {
            const session = await funcs.createNewSession();
            const result = await fakeBrowser.storage.local.get(activeSessionIdStorageKey);

            expect(result[activeSessionIdStorageKey]).toBe(session.id);
        });

        it('handles errors gracefully', async () => {
            await fakeBrowser.storage.sync.set({ [storageOptionKey]: null });

            const session = await funcs.createNewSession('Test');

            expect(session.id).toBeDefined();
            expect(session.model).toBe('unknown');
        });
    });

    describe('getSession', () => {
        it('retrieves session by ID', async () => {
            const created = await funcs.createNewSession('Test Session');
            const retrieved = await funcs.getSession(created.id, false);

            expect(retrieved.id).toBe(created.id);
            expect(retrieved.title).toBe('Test Session');
        });

        it('returns active session when no ID provided', async () => {
            const session = await funcs.createNewSession('Active');
            const retrieved = await funcs.getSession();

            expect(retrieved.id).toBe(session.id);
        });

        it('creates new session if none exists and createIfMissing true', async () => {
            const session = await funcs.getSession();

            expect(session).toBeDefined();
            expect(session.id).toBeDefined();
        });

        it('returns null if no session exists and createIfMissing false', async () => {
            const session = await funcs.getSession(null, false);

            expect(session).toBeNull();
        });
    });

    describe('getActiveSession', () => {
        it('returns active session', async () => {
            const created = await funcs.createNewSession('Active');
            const active = await funcs.getActiveSession();

            expect(active.id).toBe(created.id);
        });
    });

    describe('getActiveSessionById', () => {
        it('retrieves specific session without creating', async () => {
            const session = await funcs.createNewSession('Test');
            const retrieved = await funcs.getActiveSessionById(session.id);

            expect(retrieved.id).toBe(session.id);
        });

        it('returns null for non-existent session', async () => {
            const retrieved = await funcs.getActiveSessionById('non-existent-id');

            expect(retrieved).toBeNull();
        });
    });

    describe('deleteSession', () => {
        it('deletes session by ID', async () => {
            const session = await funcs.createNewSession('To Delete');
            await funcs.deleteSession(session.id);
            const result = await fakeBrowser.storage.local.get(allSessionsStorageKey);

            expect(result[allSessionsStorageKey] || []).toHaveLength(0);
        });

        it('deletes active session when no ID provided', async () => {
            await funcs.createNewSession('Active To Delete');
            await funcs.deleteSession();
            const result = await fakeBrowser.storage.local.get(allSessionsStorageKey);

            expect(result[allSessionsStorageKey] || []).toHaveLength(0);
        });

        it('clears active session ID if deleted session was active', async () => {
            const session = await funcs.createNewSession('Active');
            await funcs.deleteSession(session.id);
            const result = await fakeBrowser.storage.local.get(activeSessionIdStorageKey);

            expect(result[activeSessionIdStorageKey]).toBeUndefined();
        });

        it('preserves active session ID if different session deleted', async () => {
            const session1 = await funcs.createNewSession('Session 1');
            const session2 = await funcs.createNewSession('Session 2');
            await funcs.deleteSession(session1.id);
            const result = await fakeBrowser.storage.local.get(activeSessionIdStorageKey);

            expect(result[activeSessionIdStorageKey]).toBe(session2.id);
        });

        it('calls deleteSessionMemory', async () => {
            const sendMessageSpy = vi.spyOn(fakeBrowser.runtime, 'sendMessage');
            const session = await funcs.createNewSession('Test');

            await funcs.deleteSession(session.id);

            expect(sendMessageSpy).toHaveBeenCalledWith({
                action: 'deleteSessionMemory',
                sessionId: session.id
            });
        });
    });

    describe('deleteActiveSession', () => {
        it('deletes active session', async () => {
            await funcs.createNewSession('Active');
            await funcs.deleteActiveSession();
            const result = await fakeBrowser.storage.local.get(allSessionsStorageKey);

            expect(result[allSessionsStorageKey] || []).toHaveLength(0);
        });
    });

    describe('deleteSessionById', () => {
        it('deletes specific session', async () => {
            const session = await funcs.createNewSession('Test');
            await funcs.deleteSessionById(session.id);
            const result = await fakeBrowser.storage.local.get(allSessionsStorageKey);

            expect(result[allSessionsStorageKey] || []).toHaveLength(0);
        });
    });

    describe('getAllSessions', () => {
        it('returns all sessions', async () => {
            await funcs.createNewSession('Session 1');
            await funcs.createNewSession('Session 2');
            const sessions = await funcs.getAllSessions();

            expect(sessions).toHaveLength(2);
        });

        it('returns empty array when no sessions', async () => {
            const sessions = await funcs.getAllSessions();

            expect(sessions).toEqual([]);
        });
    });

    describe('setActiveSession', () => {
        it('updates existing session', async () => {
            const session = await funcs.createNewSession('Original');
            session.title = 'Updated';
            session.messages = [{ role: 'user', content: 'Hello' }];
            await funcs.setActiveSession(session);
            const retrieved = await funcs.getSession(session.id, false);

            expect(retrieved.title).toBe('Updated');
            expect(retrieved.messages).toHaveLength(1);
        });

        it('filters out empty sessions when saving', async () => {
            const session1 = await funcs.createNewSession('Session 1');
            session1.messages = [{ role: 'user', content: 'Message' }];

            const session2 = await funcs.createNewSession('Session 2');
            // session2 has empty messages, so when we save session1, session2 gets filtered out
            await funcs.setActiveSession(session1);

            const sessions = await funcs.getAllSessions();

            expect(sessions).toHaveLength(1);
            expect(sessions[0].id).toBe(session1.id);
        });

        it('skips save of empty session', async () => {
            const session = await funcs.createNewSession('Empty');
            session.messages = [];

            const consoleSpy = vi.spyOn(console, 'debug');
            await funcs.setActiveSession(session);

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Skipping save of empty session')
            );
        });

        it('throws error if session has no ID', async () => {
            const consoleSpy = vi.spyOn(console, 'error');
            await funcs.setActiveSession({ messages: [] });

            expect(consoleSpy).toHaveBeenCalled();
        });

        it('throws error if session not found', async () => {
            const consoleSpy = vi.spyOn(console, 'error');
            await funcs.setActiveSession({ id: 'non-existent', messages: ['test'] });

            expect(consoleSpy).toHaveBeenCalled();
        });
    });

    describe('getOptions', () => {
        it('returns stored options', async () => {
            const testOptions = { aiModel: 'gpt-4', temperature: 0.7 };
            await fakeBrowser.storage.sync.set({ [storageOptionKey]: testOptions });
            const options = await funcs.getOptions();

            expect(options.aiModel).toBe('gpt-4');
            expect(options.temperature).toBe(0.7);
        });

        it('returns default options if no options stored', async () => {
            const options = await funcs.getOptions();

            expect(options).toMatchObject({
                openPanelOnLoad: false,
                aiUrl: '',
                aiModel: '',
                closeOnClickOut: true,
                closeOnCopy: false,
                closeOnSendTo: true,
                showEmbeddedButton: false,
                loadHistoryOnStart: false,
                systemInstructions: 'You are a helpful assistant.',
                personalInfo: '',
                debug: false
            });
        });
    });

    describe('setOptions', () => {
        it('stores options', async () => {
            const options = { aiModel: 'claude', temperature: 0.5 };
            await funcs.setOptions(options);
            const result = await fakeBrowser.storage.sync.get(storageOptionKey);

            expect(result[storageOptionKey]).toEqual(options);
        });
    });

    // REMOVED: getActiveSessionPageData, setActiveSessionPageData, removeActiveSessionPageData tests
    // These functions were deprecated in Phase 5 (page content now fetched on-demand)

    describe('getAiUserCommands', () => {
        it('returns stored commands', async () => {
            const commands = ['command1', 'command2'];
            await fakeBrowser.storage.local.set({ [storageUserCommandsKey]: commands });
            const result = await funcs.getAiUserCommands();

            expect(result).toEqual(commands);
        });

        it('returns empty array if no commands stored', async () => {
            const result = await funcs.getAiUserCommands();

            expect(result).toEqual([]);
        });
    });

    describe('clearAllMemory', () => {
        it('sends clearAllMemory message', async () => {
            const sendMessageSpy = vi.spyOn(fakeBrowser.runtime, 'sendMessage');
            await funcs.clearAllMemory();

            expect(sendMessageSpy).toHaveBeenCalledWith({ action: 'clearAllMemory' });
        });
    });

    describe('deleteSessionMemory', () => {
        it('sends deleteSessionMemory message with session ID', async () => {
            const sendMessageSpy = vi.spyOn(fakeBrowser.runtime, 'sendMessage');
            await funcs.deleteSessionMemory('test-session-id');

            expect(sendMessageSpy).toHaveBeenCalledWith({
                action: 'deleteSessionMemory',
                sessionId: 'test-session-id'
            });
        });
    });
});
