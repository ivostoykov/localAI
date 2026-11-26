import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '../src/jslib/sidebar-frame-registry.js'), 'utf8');
const loadModule = new Function('chrome', `${source}; return { SidebarFrameRegistry, attachSidebarFrameCleanup, createSidebarPortBroker };`);

const { SidebarFrameRegistry, attachSidebarFrameCleanup, createSidebarPortBroker } = loadModule({});

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

function createRegistry({ entries = {}, now = () => 1000 } = {}) {
    const storage = createStorage(entries);
    const registry = new SidebarFrameRegistry({
        storage,
        extensionId: 'ext',
        sidebarUrl: 'chrome-extension://dynamic-guid/sidebar.html',
        now
    });
    return { registry, storage };
}

const topFrameSender = (overrides = {}) => ({
    id: 'ext',
    tab: { id: 7 },
    frameId: 0,
    url: 'https://example.com/page',
    ...overrides
});

const sidebarFrameSender = (overrides = {}) => ({
    id: 'ext',
    tab: { id: 7 },
    frameId: 3,
    url: 'chrome-extension://dynamic-guid/sidebar.html',
    ...overrides
});

describe('SidebarFrameRegistry register', () => {
    it('stores a fresh unconsumed registration for the top frame of the tab', async () => {
        const { registry, storage } = createRegistry();

        await expect(registry.register(topFrameSender())).resolves.toEqual({ ok: true });

        expect(storage.entries['sidebarFrameReg:7']).toEqual({ createdAt: 1000, consumed: false });
    });

    it('replaces an earlier registration for the same tab', async () => {
        let now = 1000;
        const { registry, storage } = createRegistry({ now: () => now });
        await registry.register(topFrameSender());
        storage.entries['sidebarFrameReg:7'].consumed = true;

        now = 2000;
        await registry.register(topFrameSender());

        expect(storage.entries['sidebarFrameReg:7']).toEqual({ createdAt: 2000, consumed: false });
    });

    it.each([
        ['a sender without a tab', topFrameSender({ tab: undefined })],
        ['a sender without a numeric tab id', topFrameSender({ tab: { id: '7' } })],
        ['a child frame sender', topFrameSender({ frameId: 1 })],
        ['a foreign extension sender', topFrameSender({ id: 'other' })],
        ['an extension page sender', topFrameSender({ url: 'chrome-extension://ext/options.html' })],
        ['a Firefox extension page sender', topFrameSender({ url: 'moz-extension://uuid/options.html' })]
    ])('rejects %s', async (label, sender) => {
        const { registry, storage } = createRegistry();

        await expect(registry.register(sender)).resolves.toEqual({ ok: false, reason: 'bad-sender' });
        expect(storage.set).not.toHaveBeenCalled();
    });
});

describe('SidebarFrameRegistry confirm', () => {
    it('accepts the sidebar document and consumes the registration exactly once', async () => {
        let now = 1000;
        const { registry, storage } = createRegistry({ now: () => now });
        await registry.register(topFrameSender());

        now = 2500;
        await expect(registry.confirm(sidebarFrameSender())).resolves.toEqual({ ok: true, tabId: 7 });
        expect(storage.entries['sidebarFrameReg:7']).toEqual({ createdAt: 1000, consumed: true, consumedAt: 2500, frameId: 3, documentId: null });

        await expect(registry.confirm(sidebarFrameSender())).resolves.toEqual({ ok: false, reason: 'consumed' });
    });

    it('accepts the static extension origin as well as the dynamic runtime URL', async () => {
        const { registry } = createRegistry();
        await registry.register(topFrameSender());

        await expect(registry.confirm(sidebarFrameSender({ url: 'chrome-extension://ext/sidebar.html' })))
            .resolves.toEqual({ ok: true, tabId: 7 });
    });

    it('ignores a query string on the sidebar document', async () => {
        const { registry } = createRegistry();
        await registry.register(topFrameSender());

        await expect(registry.confirm(sidebarFrameSender({ url: 'chrome-extension://dynamic-guid/sidebar.html?frame=1' })))
            .resolves.toEqual({ ok: true, tabId: 7 });
    });

    it.each([
        ['a top frame sender', sidebarFrameSender({ frameId: 0 })],
        ['a non-numeric frame id', sidebarFrameSender({ frameId: '3' })],
        ['a sender without a tab', sidebarFrameSender({ tab: undefined })],
        ['a foreign extension sender', sidebarFrameSender({ id: 'other' })],
        ['another extension page', sidebarFrameSender({ url: 'chrome-extension://ext/options.html' })],
        ['another extension origin', sidebarFrameSender({ url: 'chrome-extension://other/sidebar.html' })],
        ['a web page pretending to be the sidebar', sidebarFrameSender({ url: 'https://example.com/sidebar.html' })]
    ])('rejects %s', async (label, sender) => {
        const { registry } = createRegistry();
        await registry.register(topFrameSender());

        await expect(registry.confirm(sender)).resolves.toEqual({ ok: false, reason: 'bad-sender' });
    });

    it('lets exactly one of two concurrent confirms win', async () => {
        const { registry, storage } = createRegistry();
        await registry.register(topFrameSender());

        const replies = await Promise.all([
            registry.confirm(sidebarFrameSender()),
            registry.confirm(sidebarFrameSender())
        ]);

        expect(replies.filter(reply => reply.ok)).toHaveLength(1);
        expect(replies.find(reply => !reply.ok)).toEqual({ ok: false, reason: 'consumed' });
        expect(storage.entries['sidebarFrameReg:7'].consumed).toBe(true);
    });

    it('rejects a tab without a registration', async () => {
        const { registry } = createRegistry();

        await expect(registry.confirm(sidebarFrameSender())).resolves.toEqual({ ok: false, reason: 'no-registration' });
    });

    it('rejects a registration made for another tab', async () => {
        const { registry } = createRegistry();
        await registry.register(topFrameSender());

        await expect(registry.confirm(sidebarFrameSender({ tab: { id: 8 } })))
            .resolves.toEqual({ ok: false, reason: 'no-registration' });
    });

    it('accepts at exactly ten seconds and rejects anything older', async () => {
        let now = 1000;
        const fresh = createRegistry({ now: () => now });
        await fresh.registry.register(topFrameSender());
        now = 11000;
        await expect(fresh.registry.confirm(sidebarFrameSender())).resolves.toEqual({ ok: true, tabId: 7 });

        let later = 1000;
        const stale = createRegistry({ now: () => later });
        await stale.registry.register(topFrameSender());
        later = 11001;
        await expect(stale.registry.confirm(sidebarFrameSender())).resolves.toEqual({ ok: false, reason: 'expired' });
    });

    it('treats a malformed stored record as expired', async () => {
        const { registry } = createRegistry({ entries: { 'sidebarFrameReg:7': { createdAt: 'yesterday', consumed: false } } });

        await expect(registry.confirm(sidebarFrameSender())).resolves.toEqual({ ok: false, reason: 'expired' });
    });
});

describe('attachSidebarFrameCleanup', () => {
    function createTabs() {
        const listeners = {};
        return {
            listeners,
            onRemoved: { addListener: listener => { listeners.removed = listener; } },
            onUpdated: { addListener: listener => { listeners.updated = listener; } }
        };
    }

    // Cleanup listeners fire and forget; the queued removal settles on the next turn.
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));

    async function registeredRegistry() {
        const context = createRegistry();
        await context.registry.register(topFrameSender());
        return context;
    }

    it('removes the registration when the tab closes', async () => {
        const { registry, storage } = await registeredRegistry();
        const tabs = createTabs();
        attachSidebarFrameCleanup(registry, tabs);

        tabs.listeners.removed(7);
        await flush();

        expect(storage.entries['sidebarFrameReg:7']).toBeUndefined();
    });

    it('removes the registration when a new document starts loading', async () => {
        const { registry, storage } = await registeredRegistry();
        const tabs = createTabs();
        attachSidebarFrameCleanup(registry, tabs);

        tabs.listeners.updated(7, { status: 'loading' });
        await flush();

        expect(storage.entries['sidebarFrameReg:7']).toBeUndefined();
    });

    it.each([
        ['a same-document URL update', { url: 'https://example.com/next' }],
        ['a completed load', { status: 'complete' }],
        ['an unrelated update', { pinned: true }],
        ['no change details', undefined]
    ])('keeps the registration on %s', async (label, changeInfo) => {
        const { registry, storage } = await registeredRegistry();
        const tabs = createTabs();
        attachSidebarFrameCleanup(registry, tabs);

        tabs.listeners.updated(7, changeInfo);
        await flush();

        expect(storage.entries['sidebarFrameReg:7']).toEqual({ createdAt: 1000, consumed: false });
    });
});

function mockPort(sender) {
    function event() {
        const listeners = [];
        return {
            addListener: listener => listeners.push(listener),
            emit: message => listeners.forEach(listener => listener(message))
        };
    }
    return {
        name: 'localai-sidebar',
        sender,
        onMessage: event(),
        onDisconnect: event(),
        postMessage: vi.fn(),
        disconnect: vi.fn()
    };
}

describe('sidebar port broker', () => {
    async function setup(confirm = true) {
        const { registry } = createRegistry();
        const sender = sidebarFrameSender({ documentId: 'confirmed-document' });
        await registry.register(topFrameSender());
        if (confirm) { await registry.confirm(sender); }
        const pagePort = mockPort();
        const tabs = { connect: vi.fn(() => pagePort) };
        return { broker: createSidebarPortBroker(registry, tabs), sender, pagePort, tabs };
    }

    it.each([
        { tab: { id: 8 } },
        { frameId: 4 },
        { id: 'other' },
        { url: 'chrome-extension://ext/options.html' },
        { documentId: 'different-document' }
    ])('rejects a sender that does not match the confirmed sidebar: %j', async override => {
        const { broker, sender, tabs } = await setup();
        const port = mockPort({ ...sender, ...override });
        await broker(port);
        expect(port.disconnect).toHaveBeenCalledOnce();
        expect(tabs.connect).not.toHaveBeenCalled();
    });

    it('rejects a frame that has not confirmed', async () => {
        const { broker, sender, tabs } = await setup(false);
        const port = mockPort(sender);
        await broker(port);
        expect(port.disconnect).toHaveBeenCalledOnce();
        expect(tabs.connect).not.toHaveBeenCalled();
    });

    it('admits only one concurrent port and relays messages in both directions unchanged', async () => {
        const { broker, sender, tabs, pagePort } = await setup();
        const port = mockPort(sender);
        const duplicate = mockPort(sender);
        const first = broker(port);
        const second = broker(duplicate);
        const request = { id: 1, action: 'getHostState' };
        port.onMessage.emit(request);
        await Promise.all([first, second]);
        expect(tabs.connect).toHaveBeenCalledExactlyOnceWith(7, { frameId: 0, name: 'localai-sidebar' });
        expect(duplicate.disconnect).toHaveBeenCalledOnce();
        expect(pagePort.postMessage).toHaveBeenCalledExactlyOnceWith(request);
        const reply = { id: 1, ok: true, result: { open: true } };
        pagePort.onMessage.emit(reply);
        expect(port.postMessage).toHaveBeenCalledExactlyOnceWith(reply);
    });

    it.each(['frame', 'page'])('disconnects the other endpoint when the %s disconnects', async endpoint => {
        const { broker, sender, pagePort, tabs } = await setup();
        const port = mockPort(sender);
        await broker(port);
        (endpoint === 'frame' ? port : pagePort).onDisconnect.emit();
        expect((endpoint === 'frame' ? pagePort : port).disconnect).toHaveBeenCalledOnce();
        await broker(mockPort(sender));
        expect(tabs.connect).toHaveBeenCalledTimes(2);
    });

    it('does not connect a port that closed during authentication', async () => {
        const { broker, sender, tabs } = await setup();
        const port = mockPort(sender);
        const pending = broker(port);
        port.onDisconnect.emit();
        await pending;
        expect(tabs.connect).not.toHaveBeenCalled();
    });
});
