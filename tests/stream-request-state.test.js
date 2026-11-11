import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '../src/jslib/stream-request-state.js'), 'utf8');
const loadStore = new Function('chrome', `${source}; return { StreamRequestStateStore };`);

function createStorage(entries = {}) {
    return {
        entries,
        set: vi.fn(async values => Object.assign(entries, values)),
        get: vi.fn(async () => ({ ...entries })),
        remove: vi.fn(async keys => [].concat(keys).forEach(key => delete entries[key]))
    };
}

describe('StreamRequestStateStore', () => {
    it('throttles streaming checkpoints and always writes terminal state', async () => {
        let now = 100;
        const storage = createStorage();
        const { StreamRequestStateStore } = loadStore({ storage: { session: storage } });
        const store = new StreamRequestStateStore({ storage, now: () => now });
        const state = { requestId: 'one', status: 'streaming' };
        await store.checkpoint(state, true);
        await store.checkpoint(state);
        now += 1001;
        await store.checkpoint(state);
        state.status = 'complete';
        await store.checkpoint(state, true);
        expect(storage.set).toHaveBeenCalledTimes(3);
        expect(store.lastCheckpointAt.has('one')).toBe(false);
    });

    it('removes only the closed tab state and sweeps stale orphaned streams', async () => {
        let now = 10000;
        const storage = createStorage({
            'laiStreamRequest:one': { requestId: 'one', tabId: 1, status: 'streaming', updatedAt: 0 },
            'laiStreamRequest:two': { requestId: 'two', tabId: 2, status: 'complete', updatedAt: 0 }
        });
        const { StreamRequestStateStore } = loadStore({ storage: { session: storage } });
        const store = new StreamRequestStateStore({ storage, now: () => now, retention: 1000 });
        await store.removeForTab(1);
        expect(storage.entries['laiStreamRequest:one']).toBeUndefined();
        expect(storage.entries['laiStreamRequest:two']).toBeDefined();
        await store.sweepExpired();
        expect(storage.entries['laiStreamRequest:two']).toBeUndefined();
    });

    it('does not throw when transient storage fails', async () => {
        const storage = { set: vi.fn(async () => { throw new Error('quota'); }) };
        const { StreamRequestStateStore } = loadStore({ storage: { session: storage } });
        const store = new StreamRequestStateStore({ storage });
        await expect(store.checkpoint({ requestId: 'one', status: 'streaming' }, true)).resolves.toBe(false);
    });
});
