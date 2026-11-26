/**
 * Sidebar visibility wiring (#104).
 *
 * The gate is created after the open transition so the transition itself does not
 * read as "hidden". Sensitive actions stay blocked until IntersectionObserver v2
 * reports the sidebar fully visible; engines without v2 allow them.
 */

function waitForOpenTransition(target, {
    timeoutMs = 700,
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout
} = {}) {
    if (!target?.addEventListener) { return Promise.resolve(); }

    return new Promise(resolve => {
        let settled = false;
        const finish = () => {
            if (settled) { return; }
            settled = true;
            clearTimeoutImpl(timer);
            target.removeEventListener?.('transitionend', onTransitionEnd);
            resolve();
        };
        const onTransitionEnd = event => {
            if (!event || event.target === target) { finish(); }
        };
        const timer = setTimeoutImpl(finish, timeoutMs);
        target.addEventListener('transitionend', onTransitionEnd);
    });
}

function createSidebarVisibilityController({
    getRoot,
    showMessage = () => { },
    createGate = createVisibilityGate,
    IntersectionObserverImpl = globalThis.IntersectionObserver,
    waitForTransition = waitForOpenTransition
} = {}) {
    let gate = null;
    let enabling = null;
    let generation = 0;

    async function enable() {
        if (gate) { return gate; }
        if (enabling) { return enabling; }
        const root = getRoot?.();
        if (!root) { return null; }

        const current = ++generation;
        enabling = (async () => {
            await waitForTransition(root);
            if (current !== generation) { return null; }
            if (!gate) {
                gate = createGate({ target: root, IntersectionObserverImpl });
            }
            enabling = null;
            return gate;
        })();
        return enabling;
    }

    function disable() {
        generation += 1;
        gate?.disconnect?.();
        gate = null;
        enabling = null;
    }

    function guard(action) {
        if (!gate) {
            action();
            return true;
        }
        return guardAction(gate, action, () => {
            showMessage('The sidebar is not fully visible. Bring it into view and try again.', 'warning');
        });
    }

    return {
        enable,
        disable,
        guard,
        isVisible: () => gate?.isVisible?.() ?? true
    };
}
