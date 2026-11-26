import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '../src/jslib/host-guard.js'), 'utf8');
const { createHostGuard, applyCriticalHostStyles, isHostTamperedByDefault } = new Function(`${source}; return { createHostGuard, applyCriticalHostStyles, isHostTamperedByDefault };`)();

function createMutationObserver() {
    const observers = [];
    class FakeObserver {
        constructor(callback) {
            this.callback = callback;
            this.calls = [];
            this.disconnected = false;
            observers.push(this);
        }

        observe(target, options) {
            this.calls.push({ target, options });
        }

        disconnect() {
            this.disconnected = true;
        }
    }
    return { FakeObserver, observers };
}

function createClock() {
    let current = 0;
    let nextId = 1;
    const jobs = new Map();
    const delays = [];

    return {
        delays,
        now: () => current,
        setTimeout(fn, delay) {
            const id = nextId++;
            jobs.set(id, { at: current + delay, fn });
            delays.push(delay);
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

function createGuard(overrides = {}) {
    const clock = createClock();
    const { FakeObserver, observers } = createMutationObserver();
    const host = { isConnected: true };
    const root = { id: 'root' };
    const remount = vi.fn();
    const notifyBlocked = vi.fn();
    const isHostTampered = vi.fn(() => false);

    const guard = createHostGuard({
        getHost: () => host,
        remount,
        notifyBlocked,
        root,
        MutationObserverImpl: FakeObserver,
        now: clock.now,
        setTimeoutImpl: clock.setTimeout,
        clearTimeoutImpl: clock.clearTimeout,
        isHostTampered,
        debug: () => { },
        ...overrides
    });

    return { guard, clock, host, root, remount, notifyBlocked, isHostTampered, observers };
}

describe('createHostGuard', () => {
    it('observes the root for removals and the host for attribute changes', () => {
        const { guard, observers, root, host } = createGuard();

        guard.start();

        expect(observers).toHaveLength(1);
        expect(observers[0].calls).toEqual([
            { target: root, options: { childList: true, subtree: true } },
            { target: host, options: { attributes: true, attributeFilter: ['style', 'class'] } }
        ]);
    });

    it('starts observing only once', () => {
        const { guard, observers } = createGuard();

        guard.start();
        guard.start();

        expect(observers).toHaveLength(1);
    });

    it('remounts immediately when the host is no longer connected', () => {
        const { guard, clock, host, remount, observers } = createGuard();
        guard.start();

        host.isConnected = false;
        observers[0].callback([{ type: 'childList' }]);
        expect(remount).not.toHaveBeenCalled();

        clock.advance(0);
        expect(remount).toHaveBeenCalledTimes(1);
    });

    it('backs off 0, 250, 1000, 4000, 4000 ms across repeated removals', () => {
        const { guard, clock, host, remount, observers } = createGuard();
        guard.start();

        for (const expectedDelay of [0, 250, 1000, 4000, 4000]) {
            host.isConnected = false;
            observers[0].callback([{ type: 'childList' }]);
            expect(clock.delays.at(-1)).toBe(expectedDelay);
            clock.advance(expectedDelay);
        }

        expect(remount).toHaveBeenCalledTimes(5);
    });

    it('blocks and notifies once when more than five remounts fall inside 60 s', () => {
        const { guard, clock, host, remount, notifyBlocked, observers } = createGuard();
        guard.start();

        for (const delay of [0, 250, 1000, 4000, 4000]) {
            host.isConnected = false;
            observers[0].callback([{ type: 'childList' }]);
            clock.advance(delay);
        }

        expect(guard.isBlocked()).toBe(false);
        host.isConnected = false;
        observers[0].callback([{ type: 'childList' }]);
        expect(notifyBlocked).toHaveBeenCalledTimes(1);
        expect(observers[0].disconnected).toBe(true);
        expect(guard.isBlocked()).toBe(true);
        expect(remount).toHaveBeenCalledTimes(5);

        observers[0].callback([{ type: 'childList' }]);
        clock.advance(10000);
        expect(notifyBlocked).toHaveBeenCalledTimes(1);
        expect(remount).toHaveBeenCalledTimes(5);
    });

    it('resets the removal counter after 60 s without removals', () => {
        const { guard, clock, host, observers } = createGuard();
        guard.start();

        for (const delay of [0, 250, 1000, 4000, 4000]) {
            host.isConnected = false;
            observers[0].callback([{ type: 'childList' }]);
            clock.advance(delay);
        }

        clock.advance(60001);

        host.isConnected = false;
        observers[0].callback([{ type: 'childList' }]);
        expect(clock.delays.at(-1)).toBe(0);
    });

    it('restarts the delay ladder after a successful remount without clearing the removal counter', () => {
        const { guard, clock, host, notifyBlocked, observers } = createGuard();
        guard.start();

        host.isConnected = false;
        observers[0].callback([{ type: 'childList' }]);
        clock.advance(0);
        guard.onRemounted();

        host.isConnected = false;
        observers[0].callback([{ type: 'childList' }]);
        expect(clock.delays.at(-1)).toBe(0);
        clock.advance(0);

        // Two removals used; three more still fit before the cap.
        for (const expectedDelay of [250, 1000, 4000]) {
            host.isConnected = false;
            observers[0].callback([{ type: 'childList' }]);
            expect(clock.delays.at(-1)).toBe(expectedDelay);
            clock.advance(expectedDelay);
        }

        host.isConnected = false;
        observers[0].callback([{ type: 'childList' }]);
        expect(notifyBlocked).toHaveBeenCalledTimes(1);
    });

    it('remounts on an attribute change only when the host is tampered with', () => {
        const { guard, clock, remount, observers, isHostTampered } = createGuard();
        guard.start();

        observers[0].callback([{ type: 'attributes', attributeName: 'style' }]);
        expect(isHostTampered).toHaveBeenCalled();
        expect(clock.delays).toHaveLength(0);

        isHostTampered.mockReturnValue(true);
        observers[0].callback([{ type: 'attributes', attributeName: 'class' }]);
        expect(clock.delays).toEqual([0]);
        clock.advance(0);
        expect(remount).toHaveBeenCalledTimes(1);
    });

    it('ignores unrelated mutations while the host is connected', () => {
        const { guard, clock, observers } = createGuard();
        guard.start();

        observers[0].callback([{ type: 'childList' }, { type: 'attributes', attributeName: 'style' }]);

        expect(clock.delays).toHaveLength(0);
    });

    it('stops observing and cancelling a pending remount', () => {
        const { guard, clock, host, remount, observers } = createGuard();
        guard.start();

        host.isConnected = false;
        observers[0].callback([{ type: 'childList' }]);
        guard.stop();
        clock.advance(1000);

        expect(observers[0].disconnected).toBe(true);
        expect(remount).not.toHaveBeenCalled();
    });

    it('watches the replacement host after a remount', () => {
        const clock = createClock();
        const { FakeObserver, observers } = createMutationObserver();
        let host = { isConnected: true };
        const replacement = { isConnected: true };

        const guard = createHostGuard({
            getHost: () => host,
            remount: () => { },
            root: {},
            MutationObserverImpl: FakeObserver,
            now: clock.now,
            setTimeoutImpl: clock.setTimeout,
            clearTimeoutImpl: clock.clearTimeout,
            debug: () => { }
        });
        guard.start();

        host = replacement;
        guard.onRemounted();

        expect(observers[0].calls.at(-1)).toEqual({
            target: replacement,
            options: { attributes: true, attributeFilter: ['style', 'class'] }
        });
    });

    it('does nothing without a MutationObserver implementation', () => {
        const { guard, observers } = createGuard({ MutationObserverImpl: null });

        guard.start();

        expect(observers).toHaveLength(0);
    });
});

describe('isHostTamperedByDefault', () => {
    function hostWith(styles) {
        const host = document.createElement('div');
        document.body.append(host);
        Object.assign(host.style, styles);
        return host;
    }

    it.each([
        [{ display: 'none' }, true],
        [{ visibility: 'hidden' }, true],
        [{ visibility: 'collapse' }, true],
        [{ opacity: '0.4' }, true],
        [{ position: 'static' }, true],
        [{ position: 'fixed', display: 'block', visibility: 'visible', opacity: '1' }, false]
    ])('reports %o as tampered=%s', (styles, expected) => {
        expect(isHostTamperedByDefault(hostWith(styles))).toBe(expected);
    });

    it('treats a disconnected host as tampered', () => {
        expect(isHostTamperedByDefault(document.createElement('div'))).toBe(true);
    });
});

describe('applyCriticalHostStyles', () => {
    it('sets the critical properties inline with important priority', () => {
        const host = document.createElement('div');

        applyCriticalHostStyles(host);

        expect(host.style.getPropertyValue('position')).toBe('fixed');
        expect(host.style.getPropertyValue('z-index')).toBe('2147483647');
        expect(host.style.getPropertyValue('display')).toBe('block');
        expect(host.style.getPropertyValue('visibility')).toBe('visible');
        expect(host.style.getPropertyValue('opacity')).toBe('1');
        for (const property of ['position', 'z-index', 'display', 'visibility', 'opacity']) {
            expect(host.style.getPropertyPriority(property)).toBe('important');
        }
    });

    it('ignores a missing host', () => {
        expect(() => applyCriticalHostStyles(null)).not.toThrow();
    });
});
