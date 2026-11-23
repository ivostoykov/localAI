/**
 * Sidebar draft controller (#104).
 *
 * Binds the draft store to the active chat session: loads the stored draft after a
 * session restore or an iframe recreation, saves on prompt input, clears on a
 * successful send and on a session switch.
 */

function createSidebarDraftController({
    tabId,
    getSessionId = () => getActiveSessionId(),
    getInput = () => document.getElementById('laiUserInput'),
    storage = chrome?.storage?.session,
    createStore = createDraftStore,
    debounceMs = 300
} = {}) {
    let store = null;
    let sessionId = null;

    function bind(session) {
        store = createStore({ storage, tabId, sessionId: session, debounceMs });
        sessionId = session;
        return store;
    }

    function discard() {
        store = null;
        sessionId = null;
    }

    async function load() {
        const session = await getSessionId();
        if (!session) { discard(); return; }
        if (store && sessionId === session) { return; }

        bind(session);
        const draft = await store.load();
        const input = getInput();
        if (draft != null && input && input.value === '') {
            input.value = draft;
        }
    }

    async function save(text) {
        const session = await getSessionId();
        if (!session) { discard(); return; }
        if (!store || sessionId !== session) { bind(session); }
        store.save(text);
    }

    async function clear() {
        const current = store;
        discard();
        await current?.clear();
    }

    async function switchSession() {
        await clear();
        await load();
    }

    return {
        load,
        save,
        clear,
        switchSession,
        async flush() {
            await store?.flush();
        }
    };
}
