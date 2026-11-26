/**
 * Sidebar iframe registration handshake (#104).
 *
 * sidebar.html stays web-accessible, so any page could embed it and overlay the
 * real panel. The content script in the top frame registers its tab just before
 * creating the iframe; the sidebar document running inside that iframe then
 * confirms itself. A confirm is accepted only in the same tab, only once, and
 * only within ten seconds of the registration. Registrations live in
 * chrome.storage.session so a restarted background keeps pending ones.
 */

const laiSidebarFrameRegPrefix = 'sidebarFrameReg:';
const laiSidebarFrameRegTtlMs = 10 * 1000;
const laiExtensionUrlProtocols = ['chrome-extension:', 'moz-extension:', 'safari-web-extension:'];

function sidebarFrameTabId(sender) {
    return typeof sender?.tab?.id === 'number' ? sender.tab.id : null;
}

function isExtensionPageUrl(rawUrl) {
    try {
        return laiExtensionUrlProtocols.includes(new URL(rawUrl).protocol);
    } catch {
        return false;
    }
}

class SidebarFrameRegistry {
    constructor({
        storage = chrome?.storage?.session,
        extensionId = chrome?.runtime?.id ?? '',
        sidebarUrl = chrome?.runtime?.getURL?.('sidebar.html') ?? '',
        now = () => Date.now(),
        ttl = laiSidebarFrameRegTtlMs
    } = {}) {
        this.storage = storage;
        this.extensionId = extensionId;
        this.sidebarUrl = sidebarUrl;
        this.now = now;
        this.ttl = ttl;
        this.queues = new Map(); // per-tab promise chain; storage reads and writes must not interleave
    }

    key(tabId) {
        return `${laiSidebarFrameRegPrefix}${tabId}`;
    }

    // Runs one registry operation at a time per tab. The background handles messages
    // concurrently, so two confirms could otherwise both read `consumed: false`.
    enqueue(tabId, operation) {
        const key = String(tabId);
        const previous = this.queues.get(key) ?? Promise.resolve();
        const result = previous.then(operation, operation);
        const tail = result.then(() => undefined, () => undefined);
        this.queues.set(key, tail);
        tail.then(() => {
            if (this.queues.get(key) === tail) { this.queues.delete(key); }
        });
        return result;
    }

    async get(tabId) {
        if (tabId == null || !this.storage?.get) { return null; }
        try {
            const entries = await this.storage.get(this.key(tabId));
            return entries?.[this.key(tabId)] ?? null;
        } catch (error) {
            console.warn('>>> Failed to read the sidebar frame registration', error);
            return null;
        }
    }

    isOwnSender(sender) {
        return typeof this.extensionId === 'string' && !!this.extensionId && sender?.id === this.extensionId;
    }

    // Accepts the sidebar document on its static extension origin and on the URL
    // runtime.getURL() reports now. With use_dynamic_url the latter carries a
    // per-session GUID instead of the extension ID.
    isSidebarUrl(rawUrl) {
        let url;
        try {
            url = new URL(rawUrl);
        } catch {
            return false;
        }
        if (url.pathname !== '/sidebar.html' || !laiExtensionUrlProtocols.includes(url.protocol)) { return false; }

        const hosts = new Set();
        if (this.extensionId) { hosts.add(this.extensionId); }
        if (this.sidebarUrl) {
            try {
                hosts.add(new URL(this.sidebarUrl).host);
            } catch { }
        }
        return hosts.has(url.host);
    }

    async register(sender) {
        const tabId = sidebarFrameTabId(sender);
        if (tabId == null || sender.frameId !== 0 || !this.isOwnSender(sender) || isExtensionPageUrl(sender.url)) {
            return { ok: false, reason: 'bad-sender' };
        }

        return this.enqueue(tabId, async () => {
            await this.storage.set({ [this.key(tabId)]: { createdAt: this.now(), consumed: false } });
            return { ok: true };
        });
    }

    async confirm(sender) {
        const tabId = sidebarFrameTabId(sender);
        if (tabId == null || typeof sender.frameId !== 'number' || sender.frameId <= 0
            || !this.isOwnSender(sender) || !this.isSidebarUrl(sender.url)) {
            return { ok: false, reason: 'bad-sender' };
        }

        return this.enqueue(tabId, async () => {
            const record = await this.get(tabId);
            if (!record) { return { ok: false, reason: 'no-registration' }; }
            if (record.consumed) { return { ok: false, reason: 'consumed' }; }
            if (!Number.isFinite(record.createdAt) || this.now() - record.createdAt > this.ttl) {
                return { ok: false, reason: 'expired' };
            }

            await this.storage.set({ [this.key(tabId)]: { ...record, consumed: true, consumedAt: this.now(), frameId: sender.frameId, documentId: sender.documentId ?? null } });
            return { ok: true, tabId };
        });
    }

    async isConfirmedSender(sender) {
        const tabId = sidebarFrameTabId(sender);
        if (tabId == null || !Number.isInteger(sender.frameId) || sender.frameId <= 0
            || !this.isOwnSender(sender) || !this.isSidebarUrl(sender.url)) { return false; }
        const record = await this.get(tabId);
        return record?.consumed === true && record.frameId === sender.frameId
            && (record.documentId == null || record.documentId === sender.documentId);
    }

    async remove(tabId) {
        if (tabId == null) { return; }
        return this.enqueue(tabId, async () => {
            try {
                await this.storage?.remove?.(this.key(tabId));
            } catch (error) {
                console.warn('>>> Failed to remove the sidebar frame registration', error);
            }
        });
    }
}

function attachSidebarFrameCleanup(registry, tabs = chrome?.tabs) {
    if (!registry || !tabs) { return; }

    tabs.onRemoved?.addListener(tabId => { registry.remove(tabId); });
    tabs.onUpdated?.addListener((tabId, changeInfo) => {
        // A same-document history update keeps the top document and its iframe, so
        // only a new load invalidates the registration.
        if (changeInfo?.status !== 'loading') { return; }
        registry.remove(tabId);
    });
}


function createSidebarPortBroker(registry, tabs) {
    const activeTabs = new Set();

    return async function brokerSidebarPort(framePort) {
        if (framePort.name !== 'localai-sidebar') { return; }

        const tabId = sidebarFrameTabId(framePort.sender);
        if (tabId == null || activeTabs.has(tabId)) {
            framePort.disconnect();
            return;
        }

        let pagePort;
        let disconnected = false;
        let reserved = false;
        const queued = [];

        function disconnect() {
            if (disconnected) { return; }
            disconnected = true;
            if (reserved) { activeTabs.delete(tabId); }
            queued.length = 0;
            pagePort?.disconnect();
            framePort.disconnect();
        }

        function forward(port, message) {
            try {
                port.postMessage(message);
            } catch {
                disconnect();
            }
        }

        framePort.onDisconnect.addListener(disconnect);
        framePort.onMessage.addListener(message => {
            if (disconnected) { return; }
            if (pagePort) { forward(pagePort, message); }
            else if (queued.length < 16) { queued.push(message); }
            else { disconnect(); }
        });

        try {
            if (!await registry.isConfirmedSender(framePort.sender) || activeTabs.has(tabId)) {
                disconnect();
                return;
            }
            if (disconnected) { return; }
            activeTabs.add(tabId);
            reserved = true;
            pagePort = tabs.connect(tabId, { frameId: 0, name: framePort.name });
            pagePort.onDisconnect.addListener(disconnect);
            pagePort.onMessage.addListener(message => {
                if (!disconnected) { forward(framePort, message); }
            });
            for (const message of queued) { forward(pagePort, message); }
            queued.length = 0;
        } catch {
            disconnect();
        }
    };
}
