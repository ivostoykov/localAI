import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '../src/jslib/sidebar-draft.js'), 'utf8');
const { createSidebarDraftController } = new Function(`${source}; return { createSidebarDraftController };`)();

function createHarness({ session = 'session-1', draft = null, inputValue = '' } = {}) {
    const stores = [];
    const createStore = vi.fn(options => {
        const store = {
            options,
            load: vi.fn(async () => draft),
            save: vi.fn(),
            clear: vi.fn(async () => { }),
            flush: vi.fn(async () => { })
        };
        stores.push(store);
        return store;
    });
    let activeSession = session;
    const input = { value: inputValue };
    const controller = createSidebarDraftController({
        tabId: 7,
        getSessionId: async () => activeSession,
        getInput: () => input,
        storage: {},
        createStore
    });
    return {
        controller,
        stores,
        input,
        createStore,
        setSession: value => { activeSession = value; }
    };
}

describe('createSidebarDraftController', () => {
    it('loads the stored draft for the active session into an empty prompt', async () => {
        const { controller, stores, input, createStore } = createHarness({ draft: 'unsent' });

        await controller.load();

        expect(createStore).toHaveBeenCalledWith(expect.objectContaining({ tabId: 7, sessionId: 'session-1' }));
        expect(stores[0].load).toHaveBeenCalledTimes(1);
        expect(input.value).toBe('unsent');
    });

    it('keeps text the user already typed', async () => {
        const { controller, input } = createHarness({ draft: 'stored', inputValue: 'typed' });

        await controller.load();

        expect(input.value).toBe('typed');
    });

    it('does not re-read the store when the session has not changed', async () => {
        const { controller, stores, createStore } = createHarness({ draft: 'x' });

        await controller.load();
        await controller.load();

        expect(createStore).toHaveBeenCalledTimes(1);
        expect(stores[0].load).toHaveBeenCalledTimes(1);
    });

    it('binds a new store and saves when the session changes before the load hook', async () => {
        const { controller, stores, setSession, createStore } = createHarness({ draft: 'x' });
        await controller.load();

        setSession('session-2');
        await controller.save('new text');

        expect(createStore).toHaveBeenCalledTimes(2);
        expect(stores[1].options.sessionId).toBe('session-2');
        expect(stores[1].save).toHaveBeenCalledWith('new text');
        expect(stores[0].save).not.toHaveBeenCalled();
    });

    it('does not save without an active session', async () => {
        const { controller, stores, setSession } = createHarness({ session: null });

        await controller.save('text');

        expect(stores).toHaveLength(0);
    });

    it('clears the current draft and discards the binding', async () => {
        const { controller, stores } = createHarness({ draft: 'x' });
        await controller.load();

        await controller.clear();

        expect(stores[0].clear).toHaveBeenCalledTimes(1);
        await controller.save('after clear');
        expect(stores[0].save).not.toHaveBeenCalled();
    });

    it('clears the old session draft and loads the new session draft on a switch', async () => {
        const { controller, stores, setSession } = createHarness({ draft: 'x' });
        await controller.load();

        setSession('session-2');
        await controller.switchSession();

        expect(stores[0].clear).toHaveBeenCalledTimes(1);
        expect(stores[1].options.sessionId).toBe('session-2');
        expect(stores[1].load).toHaveBeenCalledTimes(1);
    });

    it('flushes the pending draft', async () => {
        const { controller, stores } = createHarness({ draft: 'x' });
        await controller.load();

        await controller.flush();

        expect(stores[0].flush).toHaveBeenCalledTimes(1);
    });
});
