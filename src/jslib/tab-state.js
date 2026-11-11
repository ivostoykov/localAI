/**
 * Tab session binding — keeps sidebar continuity across navigations (#40).
 *
 * The background owns one binding per browser tab in chrome.storage.session under
 * `laiTabState:<tabId>`: the chat session the tab's sidebar is bound to and whether the
 * panel was open. Content scripts never touch that storage; they report changes and read
 * the state back through these messages, so a tab only ever sees its own binding and only
 * requests the background accepted as its own.
 *
 * TabStateStore is instantiated in the background only; content scripts load this file
 * solely for the reporting helpers below.
 */

const laiTabStatePrefix = 'laiTabState:';
const laiStreamInterruptedMessage = 'Stream interrupted by a page reload.';

class TabStateStore {
    constructor({ storage = chrome?.storage?.session } = {}) {
        this.storage = storage;
    }

    key(tabId) {
        return `${laiTabStatePrefix}${tabId}`;
    }

    async get(tabId) {
        if (!this.storage?.get || tabId == null) { return null; }
        try {
            const entries = await this.storage.get(this.key(tabId));
            return entries?.[this.key(tabId)] ?? null;
        } catch (error) {
            console.warn('>>> Failed to read tab state', error);
            return null;
        }
    }

    async update(tabId, changes = {}) {
        if (!this.storage?.get || !this.storage?.set || tabId == null) { return null; }
        const { sessionId, panelOpen } = changes;
        if (sessionId === undefined && panelOpen === undefined) { return await this.get(tabId); }

        try {
            const current = (await this.get(tabId)) ?? { tabId };
            const next = { ...current, tabId };
            if (sessionId !== undefined) {
                next.sessionId = (typeof sessionId === 'string' && sessionId.trim()) ? sessionId : null;
            }
            if (panelOpen !== undefined) {
                next.panelOpen = !!panelOpen;
            }
            next.updatedAt = Date.now();
            await this.storage.set({ [this.key(tabId)]: next });
            return next;
        } catch (error) {
            console.warn('>>> Failed to update tab state', error);
            return null;
        }
    }

    async remove(tabId) {
        if (!this.storage?.remove || tabId == null) { return; }
        try {
            await this.storage.remove(this.key(tabId));
        } catch (error) {
            console.warn('>>> Failed to remove tab state', error);
        }
    }
}

// chrome.tabs is not exposed to content scripts, which makes it the discriminator for
// the background (service worker in Chrome, event page with a window in Firefox).
function isTabStateBackgroundContext() {
    return typeof chrome?.tabs?.query === 'function';
}

async function reportTabBinding(update = {}) {
    if (isTabStateBackgroundContext()) { return; }
    try {
        await chrome.runtime.sendMessage({ action: 'updateTabState', ...update });
        if (chrome.runtime.lastError) { throw new Error(chrome.runtime.lastError.message); }
    } catch (error) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to report tab state`, error);
    }
}

async function fetchTabStartupState() {
    try {
        const reply = await chrome.runtime.sendMessage({ action: 'getTabState' });
        if (chrome.runtime.lastError) { throw new Error(chrome.runtime.lastError.message); }
        return reply ?? null;
    } catch (error) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to read tab state`, error);
        return null;
    }
}

async function acknowledgeTabRequestSnapshot(requestId) {
    if (!requestId) { return; }
    try {
        await chrome.runtime.sendMessage({ action: 'removeStreamRequestState', requestId });
        if (chrome.runtime.lastError) { throw new Error(chrome.runtime.lastError.message); }
    } catch (error) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to acknowledge the tab request snapshot`, error);
    }
}
