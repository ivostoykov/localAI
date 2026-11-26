import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');

const slice = (startMarker, endMarker) => {
    const start = code.indexOf(startMarker);
    const end = code.indexOf(endMarker, start);
    return code.slice(start, end);
};

const functionCode = name => code.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}\\n`))[0];

const load = (source, exports) => new Function('deps', `with (deps) { ${source}; return { ${exports.join(', ')} }; }`);

describe('content host guard wiring', () => {
    it('recreates the host and reopens the panel after a removal', async () => {
        const deps = {
            sidebarOpen: true,
            init: vi.fn(async () => { }),
            setSidebarOpen: vi.fn(async () => { }),
            hostGuard: { start: vi.fn(), onRemounted: vi.fn() }
        };
        const { remountSidebarHost } = load(functionCode('remountSidebarHost'), ['remountSidebarHost'])(deps);

        await remountSidebarHost();

        expect(deps.init).toHaveBeenCalledTimes(1);
        expect(deps.setSidebarOpen).toHaveBeenCalledWith(true);
        expect(deps.hostGuard.start).toHaveBeenCalledTimes(1);
        expect(deps.hostGuard.onRemounted).toHaveBeenCalledTimes(1);
    });

    it('leaves the panel closed when it was closed before the removal', async () => {
        const deps = {
            sidebarOpen: false,
            init: vi.fn(async () => { }),
            setSidebarOpen: vi.fn(async () => { }),
            hostGuard: { start: vi.fn(), onRemounted: vi.fn() }
        };
        const { remountSidebarHost } = load(functionCode('remountSidebarHost'), ['remountSidebarHost'])(deps);

        await remountSidebarHost();

        expect(deps.setSidebarOpen).not.toHaveBeenCalled();
    });

    it('restarts observation even when recreation fails', async () => {
        const deps = {
            sidebarOpen: false,
            init: vi.fn(async () => { throw new Error('no document'); }),
            setSidebarOpen: vi.fn(async () => { }),
            hostGuard: { start: vi.fn(), onRemounted: vi.fn() }
        };
        const { remountSidebarHost } = load(functionCode('remountSidebarHost'), ['remountSidebarHost'])(deps);

        await expect(remountSidebarHost()).rejects.toThrow('no document');
        expect(deps.hostGuard.start).toHaveBeenCalledTimes(1);
        expect(deps.hostGuard.onRemounted).toHaveBeenCalledTimes(1);
    });

    it('suspends tamper detection around its own style changes', () => {
        const source = 'let hostGuardSuspended = false;\n'
            + functionCode('withHostGuardSuspended')
            + functionCode('isHostGuardSuspended')
            + functionCode('isHostTamperedNow');
        const deps = { getRootElement: () => ({}), isHostTamperedByDefault: () => true };
        const { withHostGuardSuspended, isHostGuardSuspended, isHostTamperedNow } =
            load(source, ['withHostGuardSuspended', 'isHostGuardSuspended', 'isHostTamperedNow'])(deps);

        expect(isHostGuardSuspended()).toBe(false);
        expect(isHostTamperedNow()).toBe(true);

        const observed = withHostGuardSuspended(() => [isHostGuardSuspended(), isHostTamperedNow()]);
        expect(observed).toEqual([true, false]);

        expect(() => withHostGuardSuspended(() => { throw new Error('boom'); })).toThrow('boom');
        expect(isHostGuardSuspended()).toBe(false);
    });

    it('suspends the guard while hiding and restoring the host for image capture', () => {
        const host = { style: { display: '' }, dataset: {} };
        const suspended = [];
        const deps = {
            getRootElement: () => host,
            getSideBar: () => ({
                classList: { contains: () => true },
                getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 })
            }),
            getMainButton: () => null,
            withHostGuardSuspended: operation => {
                suspended.push(true);
                try { return operation(); } finally { suspended.push(false); }
            }
        };
        const { hideLocalAIForImageCapture, restoreLocalAIAfterImageCapture } =
            load(`${functionCode('hideLocalAIForImageCapture')}\n${functionCode('restoreLocalAIAfterImageCapture')}`,
                ['hideLocalAIForImageCapture', 'restoreLocalAIAfterImageCapture'])(deps);

        expect(hideLocalAIForImageCapture({ x: 10, y: 10, right: 20, bottom: 20 })).toEqual({ hidden: true });
        expect(host.style.display).toBe('none');
        expect(suspended).toEqual([true, false]);

        expect(restoreLocalAIAfterImageCapture()).toBe(true);
        expect(suspended).toEqual([true, false, true, false]);
    });

    it('clears the port state but leaves the iframe mounted when the broker disconnects', () => {
        vi.useFakeTimers();
        const port = {};
        const deps = {
            isExtensionContextValid: () => true,
            sidebarPort: port,
            sidebarChannel: {},
            sidebarReady: true,
            isElementSelectionActive: true,
            sidebarFrame: { isConnected: true },
            sidebarPortRetryTimer: undefined,
            clearAllElementDecorations: vi.fn(),
            teardownSidebarFrame: vi.fn()
        };
        const { handleSidebarPortDisconnect } = load(functionCode('handleSidebarPortDisconnect'), ['handleSidebarPortDisconnect'])(deps);

        handleSidebarPortDisconnect(port);

        expect(deps.sidebarPort).toBeUndefined();
        expect(deps.sidebarChannel).toBeUndefined();
        expect(deps.sidebarReady).toBe(false);
        expect(deps.isElementSelectionActive).toBe(false);
        expect(deps.clearAllElementDecorations).toHaveBeenCalledTimes(1);
        expect(deps.teardownSidebarFrame).not.toHaveBeenCalled();

        vi.advanceTimersByTime(6000);
        expect(deps.teardownSidebarFrame).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });

    it.each(['disconnect', 'retry timer', 'guard remount'])('retires an orphaned sidebar during %s', trigger => {
        vi.useFakeTimers();
        try {
            const runtime = { id: 'test' };
            const port = {};
            const host = document.createElement('div');
            document.body.append(host);
            const hostGuard = { start: vi.fn(), stop: vi.fn() };
            const frameTimeout = vi.fn();
            const deps = {
                globalThis: { chrome: { runtime } },
                console: { debug: vi.fn() },
                createHostGuard: vi.fn(() => hostGuard),
                getRootElement: () => host.isConnected ? host : null,
                isHostTamperedNow: () => true,
                remountSidebarHost: vi.fn(),
                sidebarPort: port,
                sidebarChannel: {},
                sidebarReady: true,
                isElementSelectionActive: false,
                sidebarFrame: { isConnected: true },
                sidebarFrameTimer: setTimeout(frameTimeout, 6001),
                sidebarPortRetryTimer: undefined,
                clearAllElementDecorations: vi.fn(),
                teardownSidebarFrame: vi.fn()
            };
            const source = 'let hostGuard; let sidebarRetired = false;'
                + functionCode('isExtensionContextValid')
                + functionCode('retireOrphanedSidebar')
                + functionCode('startHostGuard')
                + functionCode('handleSidebarPortDisconnect');
            const { startHostGuard, handleSidebarPortDisconnect } =
                load(source, ['startHostGuard', 'handleSidebarPortDisconnect'])(deps);
            startHostGuard();
            if (trigger === 'retry timer') { handleSidebarPortDisconnect(port); }

            delete runtime.id;
            if (trigger === 'guard remount') {
                deps.createHostGuard.mock.calls[0][0].remount();
            } else if (trigger === 'disconnect') {
                handleSidebarPortDisconnect(port);
            }
            vi.advanceTimersByTime(6001);
            expect(host.isConnected).toBe(false);

            handleSidebarPortDisconnect(port);
            expect(hostGuard.stop).toHaveBeenCalledOnce();
            expect(deps.console.debug).toHaveBeenCalledOnce();
            expect(frameTimeout).not.toHaveBeenCalled();
            expect(deps.teardownSidebarFrame).not.toHaveBeenCalled();
            expect(deps.remountSidebarHost).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('tears the panel down immediately when the iframe is gone', () => {
        const port = {};
        const deps = {
            isExtensionContextValid: () => true,
            sidebarPort: port,
            sidebarChannel: {},
            sidebarReady: true,
            isElementSelectionActive: false,
            sidebarFrame: { isConnected: false },
            sidebarPortRetryTimer: undefined,
            clearAllElementDecorations: vi.fn(),
            getRootElement: () => ({}),
            teardownSidebarFrame: vi.fn()
        };
        const { handleSidebarPortDisconnect } = load(functionCode('handleSidebarPortDisconnect'), ['handleSidebarPortDisconnect'])(deps);

        handleSidebarPortDisconnect(port);

        expect(deps.teardownSidebarFrame).toHaveBeenCalledTimes(1);
    });

    it('ignores a disconnect from a port that was already replaced', () => {
        const stale = {};
        const deps = { isExtensionContextValid: () => true, sidebarPort: {}, sidebarChannel: {}, sidebarReady: true, isElementSelectionActive: true, clearAllElementDecorations: vi.fn() };
        const { handleSidebarPortDisconnect } = load(functionCode('handleSidebarPortDisconnect'), ['handleSidebarPortDisconnect'])(deps);

        handleSidebarPortDisconnect(stale);

        expect(deps.sidebarPort).toEqual({});
        expect(deps.clearAllElementDecorations).not.toHaveBeenCalled();
    });

    it('asks the background to clear the badge', async () => {
        const deps = { chrome: { runtime: { sendMessage: vi.fn(async () => ({ ok: true })) } }, manifest: { name: 'x' }, getLineNumber: () => 1 };
        const { clearSidebarBlockedBadge } = load(functionCode('clearSidebarBlockedBadge'), ['clearSidebarBlockedBadge'])(deps);

        await clearSidebarBlockedBadge();

        expect(deps.chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'clearSidebarBlocked' });
    });

    it('recreates a blocked guard and reports the block through the background', () => {
        const blockedGuard = { stop: vi.fn(), isBlocked: () => true, start: vi.fn() };
        const freshGuard = { start: vi.fn() };
        const createHostGuard = vi.fn(() => freshGuard);
        const sendMessage = vi.fn(async () => ({ ok: true }));
        const deps = { hostGuard: blockedGuard, createHostGuard, chrome: { runtime: { sendMessage } }, manifest: { name: 'x' }, getLineNumber: () => 1, getRootElement: () => ({}), remountSidebarHost: vi.fn(), isHostTamperedNow: () => false };

        const { startHostGuard } = load(functionCode('startHostGuard'), ['startHostGuard'])(deps);
        startHostGuard();

        expect(blockedGuard.stop).toHaveBeenCalledTimes(1);
        expect(createHostGuard).toHaveBeenCalledTimes(1);
        expect(freshGuard.start).toHaveBeenCalledTimes(1);

        const options = createHostGuard.mock.calls[0][0];
        options.notifyBlocked();
        expect(sendMessage).toHaveBeenCalledWith({ action: 'sidebarBlocked' });
    });

    it('marks the panel open and clears the badge when opening succeeds', async () => {
        const container = { classList: { toggle: vi.fn() }, style: {}, append: vi.fn() };
        const deps = {
            sidebarOpen: false,
            getShadowRoot: () => ({}),
            start: vi.fn(),
            getSideBar: () => container,
            getHighestZIndex: () => 1,
            installResizeHandle: vi.fn(),
            sidebarFrame: { isConnected: true, src: 'chrome-extension://ext/sidebar.html' },
            isSidebarFrameUrl: () => true,
            getOptions: async () => ({}),
            getMainButton: () => null,
            sidebarPinned: false,
            getHostState: () => ({ open: true, pinned: false, url: 'https://example.com', title: 't' }),
            sidebarReady: false,
            sendToSidebar: vi.fn(async () => { }),
            clearSidebarBlockedBadge: vi.fn()
        };
        const { setSidebarOpen } = load(functionCode('setSidebarOpen'), ['setSidebarOpen'])(deps);

        await setSidebarOpen(true);

        expect(deps.sidebarOpen).toBe(true);
        expect(deps.clearSidebarBlockedBadge).toHaveBeenCalledTimes(1);
    });

    it('does not recreate the host when closing a missing host', async () => {
        const deps = {
            sidebarOpen: true,
            getShadowRoot: () => null,
            start: vi.fn(),
            getHostState: () => ({ open: false, pinned: false, url: 'https://example.com', title: 't' })
        };
        const { setSidebarOpen } = load(functionCode('setSidebarOpen'), ['setSidebarOpen'])(deps);

        await expect(setSidebarOpen(false)).resolves.toMatchObject({ open: false });
        expect(deps.start).not.toHaveBeenCalled();
        expect(deps.sidebarOpen).toBe(false);
    });

    it('refuses an automatic open after the guard blocked the panel', async () => {
        const deps = {
            sidebarOpen: false,
            getShadowRoot: () => null,
            hostGuard: { isBlocked: () => true },
            start: vi.fn()
        };
        const { setSidebarOpen } = load(functionCode('setSidebarOpen'), ['setSidebarOpen'])(deps);

        await expect(setSidebarOpen(true)).rejects.toThrow('repeated removals');
        expect(deps.start).not.toHaveBeenCalled();
    });

    it('lets a user open recreate the host and restart the guard after a block', async () => {
        let rootAvailable = false;
        const container = { classList: { toggle: vi.fn() } };
        const deps = {
            sidebarOpen: false,
            getShadowRoot: () => (rootAvailable ? {} : null),
            hostGuard: { isBlocked: () => true },
            start: vi.fn(async () => { rootAvailable = true; }),
            getSideBar: () => container,
            getHighestZIndex: () => 1,
            installResizeHandle: vi.fn(),
            sidebarFrame: { isConnected: true, src: 'chrome-extension://ext/sidebar.html' },
            isSidebarFrameUrl: () => true,
            getOptions: async () => ({}),
            getMainButton: () => null,
            sidebarPinned: false,
            getHostState: () => ({ open: true, pinned: false, url: 'https://example.com', title: 't' }),
            sidebarReady: false,
            sendToSidebar: vi.fn(async () => { }),
            clearSidebarBlockedBadge: vi.fn()
        };
        const { setSidebarOpen } = load(functionCode('setSidebarOpen'), ['setSidebarOpen'])(deps);

        await setSidebarOpen(true, true, true, true);

        expect(deps.start).toHaveBeenCalledTimes(1);
        expect(deps.sidebarOpen).toBe(true);
        expect(deps.clearSidebarBlockedBadge).toHaveBeenCalledTimes(1);
    });

    it('does not recreate the host when the iframe unload disconnects the broker', async () => {
        const port = {};
        const frame = { isConnected: false, remove: vi.fn() };
        const deps = {
            isExtensionContextValid: () => true,
            sidebarPort: port,
            sidebarChannel: {},
            sidebarReady: true,
            isElementSelectionActive: false,
            sidebarFrame: frame,
            sidebarPortRetryTimer: undefined,
            clearAllElementDecorations: vi.fn(),
            getRootElement: () => null,
            getShadowRoot: () => null,
            getHostState: () => ({ open: false }),
            start: vi.fn(),
            sidebarOpen: true
        };
        const source = functionCode('teardownSidebarFrame')
            + functionCode('handleSidebarPortDisconnect')
            + functionCode('setSidebarOpen');
        const { handleSidebarPortDisconnect } = load(source, ['handleSidebarPortDisconnect'])(deps);

        handleSidebarPortDisconnect(port);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(frame.remove).toHaveBeenCalledTimes(1);
        expect(deps.start).not.toHaveBeenCalled();
        expect(deps.sidebarOpen).toBe(true);
    });

    it('tears down the frame without recreating a host', () => {
        const frame = { remove: vi.fn() };
        const deps = {
            sidebarFrame: frame,
            setSidebarOpen: vi.fn(async () => { })
        };
        const { teardownSidebarFrame } = load(functionCode('teardownSidebarFrame'), ['teardownSidebarFrame'])(deps);

        teardownSidebarFrame();

        expect(frame.remove).toHaveBeenCalledTimes(1);
        expect(deps.sidebarFrame).toBeUndefined();
        expect(deps.setSidebarOpen).toHaveBeenCalledWith(false);
    });

    it('does not clear the badge when closing', async () => {
        const container = { classList: { toggle: vi.fn() } };
        const deps = {
            sidebarOpen: true,
            getShadowRoot: () => ({}),
            start: vi.fn(),
            getSideBar: () => container,
            getOptions: async () => ({}),
            getMainButton: () => null,
            sidebarPinned: false,
            getHostState: () => ({ open: false }),
            sidebarReady: false,
            sendToSidebar: vi.fn(async () => { }),
            clearSidebarBlockedBadge: vi.fn()
        };
        const { setSidebarOpen } = load(functionCode('setSidebarOpen'), ['setSidebarOpen'])(deps);

        await setSidebarOpen(false);

        expect(deps.sidebarOpen).toBe(false);
        expect(deps.clearSidebarBlockedBadge).not.toHaveBeenCalled();
    });
});
