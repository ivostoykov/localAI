import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '../src/jslib/visibility-gate.js'), 'utf8');
const { createVisibilityGate, guardAction } = new Function(`${source}; return { createVisibilityGate, guardAction };`)();

function createObserverImpl({ throwOnConstruct = false } = {}) {
    const instances = [];
    class FakeIntersectionObserver {
        constructor(callback, options) {
            if (throwOnConstruct) { throw new Error('trackVisibility is not supported'); }
            this.callback = callback;
            this.options = options;
            this.disconnected = false;
            instances.push(this);
        }

        observe(target) {
            this.target = target;
        }

        disconnect() {
            this.disconnected = true;
        }
    }
    return { FakeIntersectionObserver, instances };
}

describe('createVisibilityGate', () => {
    it('observes the target with IntersectionObserver v2 options and starts hidden', () => {
        const { FakeIntersectionObserver, instances } = createObserverImpl();
        const target = {};
        const onChange = vi.fn();

        const gate = createVisibilityGate({ target, onChange, IntersectionObserverImpl: FakeIntersectionObserver });

        expect(gate.supported).toBe(true);
        expect(gate.isVisible()).toBe(false);
        expect(instances).toHaveLength(1);
        expect(instances[0].target).toBe(target);
        expect(instances[0].options).toEqual({ trackVisibility: true, delay: 100, threshold: [1.0] });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('follows isVisible from the latest entry', () => {
        const { FakeIntersectionObserver, instances } = createObserverImpl();
        const onChange = vi.fn();
        const gate = createVisibilityGate({ target: {}, onChange, IntersectionObserverImpl: FakeIntersectionObserver });

        instances[0].callback([{ isVisible: false }]);
        expect(gate.isVisible()).toBe(false);
        expect(onChange).toHaveBeenLastCalledWith(false, { supported: true });

        instances[0].callback([{ isVisible: false }, { isVisible: true }]);
        expect(gate.isVisible()).toBe(true);
        expect(onChange).toHaveBeenLastCalledWith(true, { supported: true });
    });

    it('falls back to visible when IntersectionObserver is unavailable', () => {
        const onChange = vi.fn();

        const gate = createVisibilityGate({ target: {}, onChange, IntersectionObserverImpl: null });

        expect(gate.supported).toBe(false);
        expect(gate.isVisible()).toBe(true);
        expect(onChange).toHaveBeenCalledWith(true, { supported: false });
    });

    it('falls back to visible when an engine ignores trackVisibility and omits isVisible', () => {
        const { FakeIntersectionObserver, instances } = createObserverImpl();
        const onChange = vi.fn();
        const gate = createVisibilityGate({ target: {}, onChange, IntersectionObserverImpl: FakeIntersectionObserver });

        instances[0].callback([{ intersectionRatio: 1, isIntersecting: true }]);

        expect(gate.supported).toBe(false);
        expect(gate.isVisible()).toBe(true);
        expect(instances[0].disconnected).toBe(true);
        expect(onChange).toHaveBeenLastCalledWith(true, { supported: false });
    });

    it('falls back to visible when the observer rejects the options', () => {
        const { FakeIntersectionObserver } = createObserverImpl({ throwOnConstruct: true });
        const onChange = vi.fn();

        const gate = createVisibilityGate({ target: {}, onChange, IntersectionObserverImpl: FakeIntersectionObserver });

        expect(gate.supported).toBe(false);
        expect(gate.isVisible()).toBe(true);
        expect(onChange).toHaveBeenCalledWith(true, { supported: false });
    });

    it('falls back to visible without a target', () => {
        const { FakeIntersectionObserver, instances } = createObserverImpl();
        const onChange = vi.fn();

        const gate = createVisibilityGate({ onChange, IntersectionObserverImpl: FakeIntersectionObserver });

        expect(gate.supported).toBe(false);
        expect(gate.isVisible()).toBe(true);
        expect(instances).toHaveLength(0);
        expect(onChange).toHaveBeenCalledWith(true, { supported: false });
    });

    it('disconnects the observer', () => {
        const { FakeIntersectionObserver, instances } = createObserverImpl();
        const gate = createVisibilityGate({ target: {}, IntersectionObserverImpl: FakeIntersectionObserver });

        gate.disconnect();

        expect(instances[0].disconnected).toBe(true);
    });

    it('ignores an empty entry list', () => {
        const { FakeIntersectionObserver, instances } = createObserverImpl();
        const onChange = vi.fn();
        const gate = createVisibilityGate({ target: {}, onChange, IntersectionObserverImpl: FakeIntersectionObserver });

        instances[0].callback([]);

        expect(gate.isVisible()).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('guardAction', () => {
    it('runs the action while the sidebar is visible', () => {
        const action = vi.fn();
        const onBlocked = vi.fn();

        const allowed = guardAction({ isVisible: () => true }, action, onBlocked);

        expect(allowed).toBe(true);
        expect(action).toHaveBeenCalledTimes(1);
        expect(onBlocked).not.toHaveBeenCalled();
    });

    it('blocks the action and reports it while the sidebar is hidden', () => {
        const action = vi.fn();
        const onBlocked = vi.fn();

        const allowed = guardAction({ isVisible: () => false }, action, onBlocked);

        expect(allowed).toBe(false);
        expect(action).not.toHaveBeenCalled();
        expect(onBlocked).toHaveBeenCalledTimes(1);
    });

    it('allows the action when the gate reports no support', () => {
        const gate = createVisibilityGate({ target: {}, IntersectionObserverImpl: null });
        const action = vi.fn();

        expect(guardAction(gate, action)).toBe(true);
        expect(action).toHaveBeenCalledTimes(1);
    });
});
