import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '../src/jslib/draft-store.js'), 'utf8');
const { createDraftStore, removeDraftsForTab } = new Function(`${source}; return { createDraftStore, removeDraftsForTab };`)();

function createStorage(entries = {}) {
    return {
        entries,
        set: vi.fn(async values => Object.assign(entries, values)),
        get: vi.fn(async keys => {
            if (keys == null) { return { ...entries }; }
            return Object.fromEntries([].concat(keys).filter(key => key in entries).map(key => [key, entries[key]]));
        }),
        remove: vi.fn(async keys => [].concat(keys).forEach(key => delete entries[key]))
    };
}

function createClock() {
    let current = 0;
    let nextId = 1;
    const jobs = new Map();

    return {
        now: () => current,
        setTimeout(fn, delay) {
            const id = nextId++;
            jobs.set(id, { at: current + delay, fn });
            return id;
        },
        clearTimeout(id) {
            jobs.delete(id);
        },
        advance(ms) {
            const target = current + ms;
            for (; ;) {
                const due = [...jobs.entries()]
                    .filter(([, job]) => job.at <= target)
                    .sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) { break; }
                jobs.delete(due[0]);
                current = due[1].at;
                due[1].fn();
            }
            current = target;
        }
    };
}

function createStore({ entries = {}, tabId = 7, sessionId = 'session-1', debounceMs = 300 } = {}) {
    const storage = createStorage(entries);
    const clock = createClock();
    const store = createDraftStore({
        storage,
        tabId,
        sessionId,
        debounceMs,
        setTimeoutImpl: clock.setTimeout,
        clearTimeoutImpl: clock.clearTimeout
    });
    return { store, storage, clock, key: `sidebarDraft:${tabId}:${sessionId}` };
}

describe('createDraftStore', () => {
    it('saves the latest text once the debounce elapses', () => {
        const { store, storage, clock, key } = createStore();

        store.save('a');
        store.save('ab');
        clock.advance(299);
        expect(storage.set).not.toHaveBeenCalled();

        clock.advance(1);
        expect(storage.set).toHaveBeenCalledTimes(1);
        expect(storage.entries[key]).toBe('ab');
    });

    it('removes the key when the draft is empty', () => {
        const { store, storage, clock, key } = createStore({ entries: { 'sidebarDraft:7:session-1': 'old' } });

        store.save('');
        clock.advance(300);

        expect(storage.remove).toHaveBeenCalledWith(key);
        expect(storage.entries[key]).toBeUndefined();
    });

    it('treats a whitespace-only draft as empty', () => {
        const { store, storage, clock, key } = createStore({ entries: { 'sidebarDraft:7:session-1': 'old' } });

        store.save('   \n\t');
        clock.advance(300);

        expect(storage.remove).toHaveBeenCalledWith(key);
        expect(storage.entries[key]).toBeUndefined();
    });

    it('loads a stored draft and returns null for a missing one', async () => {
        const { store } = createStore({ entries: { 'sidebarDraft:7:session-1': 'hello' } });
        await expect(store.load()).resolves.toBe('hello');

        const empty = createStore({ sessionId: 'session-2' });
        await expect(empty.store.load()).resolves.toBeNull();
    });

    it('clears the draft immediately and cancels a pending save', async () => {
        const { store, storage, clock } = createStore();

        store.save('pending');
        await store.clear();
        clock.advance(300);

        expect(storage.remove).toHaveBeenCalledWith('sidebarDraft:7:session-1');
        expect(storage.set).not.toHaveBeenCalled();
    });

    it('flushes a pending draft immediately and cancels the debounce', async () => {
        const { store, storage, clock, key } = createStore();

        store.save('now');
        await store.flush();

        expect(storage.set).toHaveBeenCalledTimes(1);
        expect(storage.entries[key]).toBe('now');
        clock.advance(300);
        expect(storage.set).toHaveBeenCalledTimes(1);
    });

    it('flushes nothing when no draft is pending', async () => {
        const { store, storage } = createStore();

        await store.flush();

        expect(storage.set).not.toHaveBeenCalled();
    });

    it('does nothing without a tab or session', () => {
        const storage = createStorage();
        const clock = createClock();
        const store = createDraftStore({
            storage,
            tabId: null,
            sessionId: 'session-1',
            setTimeoutImpl: clock.setTimeout,
            clearTimeoutImpl: clock.clearTimeout
        });

        store.save('text');
        clock.advance(1000);

        expect(storage.set).not.toHaveBeenCalled();
        expect(storage.remove).not.toHaveBeenCalled();
    });
});

describe('removeDraftsForTab', () => {
    it('removes every draft of the tab and nothing else', async () => {
        const storage = createStorage({
            'sidebarDraft:1:one': 'a',
            'sidebarDraft:1:two': 'b',
            'sidebarDraft:10:one': 'c',
            'laiTabState:1': { tabId: 1 }
        });

        await removeDraftsForTab(storage, 1);

        expect(storage.remove).toHaveBeenCalledWith(['sidebarDraft:1:one', 'sidebarDraft:1:two']);
        expect(storage.entries['sidebarDraft:10:one']).toBe('c');
        expect(storage.entries['laiTabState:1']).toBeDefined();
    });

    it('does not call remove when the tab has no drafts', async () => {
        const storage = createStorage({ 'sidebarDraft:2:one': 'a' });

        await removeDraftsForTab(storage, 1);

        expect(storage.remove).not.toHaveBeenCalled();
    });
});
