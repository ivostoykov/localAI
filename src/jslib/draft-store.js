/**
 * Sidebar draft store (#104).
 *
 * The iframe keeps the unsent prompt in chrome.storage.session so it survives
 * the iframe being recreated after the host is removed. Writes are debounced;
 * empty drafts remove the key so nothing accumulates per tab and session.
 */

const laiSidebarDraftPrefix = 'sidebarDraft:';

function sidebarDraftKey(tabId, sessionId) {
    return `${laiSidebarDraftPrefix}${tabId}:${sessionId}`;
}

function createDraftStore({
    storage = chrome?.storage?.session,
    tabId,
    sessionId,
    debounceMs = 300,
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout
} = {}) {
    const key = sidebarDraftKey(tabId, sessionId);
    const usable = tabId != null && !!sessionId && !!storage;
    let timer = null;
    let pendingText = null;

    function cancel() {
        if (timer != null) {
            clearTimeoutImpl(timer);
            timer = null;
        }
    }

    function write(text) {
        if (!text.trim()) { return storage.remove?.(key); }
        return storage.set?.({ [key]: text });
    }

    return {
        save(text) {
            if (!usable) { return; }
            pendingText = typeof text === 'string' ? text : '';
            cancel();
            timer = setTimeoutImpl(() => {
                timer = null;
                const draft = pendingText;
                pendingText = null;
                Promise.resolve(write(draft)).catch(error => {
                    console.warn('>>> Failed to save the sidebar draft', error);
                });
            }, debounceMs);
        },

        async load() {
            if (!usable || !storage?.get) { return null; }
            try {
                const entries = await storage.get(key);
                return entries?.[key] ?? null;
            } catch (error) {
                console.warn('>>> Failed to read the sidebar draft', error);
                return null;
            }
        },

        async clear() {
            cancel();
            pendingText = null;
            if (!usable || !storage?.remove) { return; }
            try {
                await storage.remove(key);
            } catch (error) {
                console.warn('>>> Failed to clear the sidebar draft', error);
            }
        },

        // Writes a pending draft immediately; the iframe calls it on pagehide so a
        // host removal does not lose the last keystrokes before the debounce fires.
        async flush() {
            if (timer == null) { return; }
            cancel();
            const draft = pendingText;
            pendingText = null;
            try {
                await write(draft);
            } catch (error) {
                console.warn('>>> Failed to save the sidebar draft', error);
            }
        }
    };
}

async function removeDraftsForTab(storage, tabId) {
    if (!storage?.get || !storage?.remove || tabId == null) { return; }
    try {
        const entries = await storage.get(null);
        const prefix = sidebarDraftKey(tabId, '');
        const keys = Object.keys(entries ?? {}).filter(key => key.startsWith(prefix));
        if (keys.length) { await storage.remove(keys); }
    } catch (error) {
        console.warn('>>> Failed to remove the sidebar drafts for the tab', error);
    }
}
