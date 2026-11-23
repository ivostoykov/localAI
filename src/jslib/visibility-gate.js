/**
 * Sidebar visibility gate (#104).
 *
 * IntersectionObserver v2 reports whether the observed element is actually
 * visible to the user, not merely in the viewport. Sensitive actions (Send,
 * Delete All, Allow always) wait for a fully visible sidebar so an overlay
 * cannot trick the user into pressing them.
 *
 * Engines without v2 (Firefox, Safari) do not block: the gate reports visible
 * and supported: false.
 */

function createVisibilityGate({
    target,
    onChange = () => { },
    IntersectionObserverImpl = globalThis.IntersectionObserver
} = {}) {
    let supported = typeof IntersectionObserverImpl === 'function' && !!target;
    let visible = !supported;
    let observer = null;

    const gate = {
        isVisible: () => visible,
        disconnect() {
            observer?.disconnect();
            observer = null;
        },
        get supported() {
            return supported;
        }
    };

    function report() {
        onChange(visible, { supported });
    }

    if (!supported) {
        report();
        return gate;
    }

    try {
        observer = new IntersectionObserverImpl(entries => {
            const entry = entries?.[entries.length - 1];
            if (!entry) { return; }

            if (typeof entry.isVisible !== 'boolean') {
                // IntersectionObserver v2 is unavailable: do not gate the panel.
                supported = false;
                visible = true;
                gate.disconnect();
                report();
                return;
            }

            visible = entry.isVisible === true;
            report();
        }, { trackVisibility: true, delay: 100, threshold: [1.0] });
        observer.observe(target);
    } catch {
        observer = null;
        supported = false;
        visible = true;
        report();
    }

    return gate;
}

function guardAction(gate, action, onBlocked) {
    if (gate?.isVisible?.()) {
        action();
        return true;
    }

    onBlocked?.();
    return false;
}
