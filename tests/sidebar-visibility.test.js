import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '../src/jslib/sidebar-visibility.js'), 'utf8');
const gateSource = fs.readFileSync(path.join(__dirname, '../src/jslib/visibility-gate.js'), 'utf8');
const { waitForOpenTransition, createSidebarVisibilityController } = new Function(`${gateSource}; ${source}; return { waitForOpenTransition, createSidebarVisibilityController };`)();

function createTarget() {
    const listeners = new Map();
    return {
        listeners,
        addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener(type, listener) {
            if (listeners.get(type) === listener) { listeners.delete(type); }
        },
        emitTransitionEnd(target = this) { listeners.get('transitionend')?.({ target }); }
    };
}

describe('waitForOpenTransition', () => {
    it('resolves on the transitionend of the target and removes the listener', async () => {
        const target = createTarget();
        const promise = waitForOpenTransition(target, { setTimeoutImpl: () => 1, clearTimeoutImpl: () => { } });

        target.emitTransitionEnd();
        await promise;

        expect(target.listeners.has('transitionend')).toBe(false);
    });

    it('ignores transitionend from descendants', async () => {
        const target = createTarget();
        let settled = false;
        const promise = waitForOpenTransition(target, { setTimeoutImpl: () => 1, clearTimeoutImpl: () => { } })
            .then(() => { settled = true; });

        target.emitTransitionEnd({ id: 'child' });
        await Promise.resolve();

        expect(settled).toBe(false);
        target.emitTransitionEnd();
        await promise;
        expect(settled).toBe(true);
    });

    it('falls back to the timeout when no transition fires', async () => {
        const target = createTarget();
        let finish;
        const promise = waitForOpenTransition(target, {
            timeoutMs: 700,
            setTimeoutImpl: fn => { finish = fn; return 1; },
            clearTimeoutImpl: () => { }
        });

        finish();
        await promise;

        expect(target.listeners.has('transitionend')).toBe(false);
    });

    it('resolves immediately without an element', async () => {
        await expect(waitForOpenTransition(null)).resolves.toBeUndefined();
    });
});

describe('createSidebarVisibilityController', () => {
    function createGate({ visible = true } = {}) {
        const gate = {
            disconnected: false,
            isVisible: () => visible,
            disconnect() { this.disconnected = true; }
        };
        return gate;
    }

    it('creates the gate only after the open transition', async () => {
        const target = {};
        const gate = createGate();
        const createGateImpl = vi.fn(() => gate);
        const waitForTransition = vi.fn(async () => { });
        const controller = createSidebarVisibilityController({
            getRoot: () => target,
            createGate: createGateImpl,
            waitForTransition,
            IntersectionObserverImpl: {}
        });

        await expect(controller.enable()).resolves.toBe(gate);

        expect(waitForTransition).toHaveBeenCalledWith(target);
        expect(createGateImpl).toHaveBeenCalledWith({ target, IntersectionObserverImpl: {} });
    });

    it('shares one gate between repeated enables', async () => {
        const gate = createGate();
        const createGateImpl = vi.fn(() => gate);
        const controller = createSidebarVisibilityController({
            getRoot: () => ({}),
            createGate: createGateImpl,
            waitForTransition: async () => { }
        });

        await controller.enable();
        await controller.enable();

        expect(createGateImpl).toHaveBeenCalledTimes(1);
    });

    it('does not create a gate without a root', async () => {
        const createGateImpl = vi.fn();
        const controller = createSidebarVisibilityController({
            getRoot: () => null,
            createGate: createGateImpl,
            waitForTransition: async () => { }
        });

        await expect(controller.enable()).resolves.toBeNull();
        expect(createGateImpl).not.toHaveBeenCalled();
    });

    it('does not create a gate when the panel closes during the transition', async () => {
        const createGateImpl = vi.fn(() => ({ isVisible: () => true, disconnect: vi.fn() }));
        let release;
        const controller = createSidebarVisibilityController({
            getRoot: () => ({}),
            createGate: createGateImpl,
            waitForTransition: () => new Promise(resolve => { release = resolve; })
        });

        const pending = controller.enable();
        controller.disable();
        release();

        await expect(pending).resolves.toBeNull();
        expect(createGateImpl).not.toHaveBeenCalled();
    });

    it('disconnects and clears the gate', async () => {
        const gate = createGate();
        const controller = createSidebarVisibilityController({
            getRoot: () => ({}),
            createGate: () => gate,
            waitForTransition: async () => { }
        });
        await controller.enable();

        controller.disable();

        expect(gate.disconnected).toBe(true);
        expect(controller.isVisible()).toBe(true);
    });

    it('runs allowed actions and blocks hidden ones with a message', async () => {
        const showMessage = vi.fn();
        const gate = createGate({ visible: true });
        const controller = createSidebarVisibilityController({
            getRoot: () => ({}),
            createGate: () => gate,
            waitForTransition: async () => { },
            showMessage
        });
        await controller.enable();

        const allowedAction = vi.fn();
        expect(controller.guard(allowedAction)).toBe(true);
        expect(allowedAction).toHaveBeenCalledTimes(1);

        gate.isVisible = () => false;
        const blockedAction = vi.fn();
        expect(controller.guard(blockedAction)).toBe(false);
        expect(blockedAction).not.toHaveBeenCalled();
        expect(showMessage).toHaveBeenCalledWith(expect.stringContaining('not fully visible'), 'warning');
    });

    it('allows actions before the gate exists', () => {
        const controller = createSidebarVisibilityController({ getRoot: () => null, createGate: () => null });
        const action = vi.fn();

        expect(controller.guard(action)).toBe(true);
        expect(action).toHaveBeenCalledTimes(1);
    });
});
