/**
 * Host element guard (#104).
 *
 * A page can remove or hide the sidebar host at any time, by accident (Turbo/pjax,
 * framework hydration, document.open()) or on purpose. The guard watches the
 * document root for the host disappearing and watches the host's style and class
 * for tampering, recreates the host with back-off, and gives up after repeated
 * removals so the user is notified outside the page.
 */

const laiHostGuardDelays = [0, 250, 1000, 4000];
const laiHostGuardMaxRemounts = 5;
const laiHostGuardResetMs = 60 * 1000;

function applyCriticalHostStyles(host) {
    if (!host?.style?.setProperty) { return; }
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('z-index', '2147483647', 'important');
    host.style.setProperty('display', 'block', 'important');
    host.style.setProperty('visibility', 'visible', 'important');
    host.style.setProperty('opacity', '1', 'important');
}

function isHostTamperedByDefault(host) {
    if (!host?.isConnected) { return true; }
    const style = globalThis.getComputedStyle?.(host);
    if (!style) { return false; }
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') { return true; }
    const opacity = Number.parseFloat(style.opacity);
    if (Number.isFinite(opacity) && opacity < 0.5) { return true; }
    return style.position !== 'fixed';
}

function createHostGuard({
    getHost,
    remount,
    notifyBlocked = () => { },
    root = document.documentElement,
    MutationObserverImpl = globalThis.MutationObserver,
    now = () => Date.now(),
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout,
    isHostTampered = () => isHostTamperedByDefault(getHost()),
    debug = (...args) => console.debug(...args)
} = {}) {
    let observer = null;
    let timer = null;
    let running = false;
    let blocked = false;
    let attempt = 0;
    let remountCount = 0;
    let lastRemovalAt = null;

    function stopWatching() {
        observer?.disconnect();
        observer = null;
        if (timer != null) {
            clearTimeoutImpl(timer);
            timer = null;
        }
        running = false;
    }

    function block() {
        if (blocked) { return; }
        blocked = true;
        debug('>>> Host guard stopped after repeated removals.');
        stopWatching();
        notifyBlocked();
    }

    function scheduleRemount() {
        if (!running || blocked || timer != null) { return; }

        const current = now();
        if (lastRemovalAt != null && current - lastRemovalAt > laiHostGuardResetMs) {
            remountCount = 0;
            attempt = 0;
        }
        if (remountCount >= laiHostGuardMaxRemounts) {
            block();
            return;
        }

        lastRemovalAt = current;
        const delay = laiHostGuardDelays[Math.min(attempt, laiHostGuardDelays.length - 1)];
        attempt += 1;
        remountCount += 1;
        timer = setTimeoutImpl(() => {
            timer = null;
            if (!running || blocked) { return; }
            debug('>>> Host guard remounting.', { delay, remountCount });
            remount();
        }, delay);
    }

    function observeHostAttributes() {
        if (!observer) { return; }
        const host = getHost?.();
        if (host?.isConnected) {
            observer.observe(host, { attributes: true, attributeFilter: ['style', 'class'] });
        }
    }

    function handleRecords(records = []) {
        if (!running || blocked) { return; }

        const host = getHost?.();
        if (!host || !host.isConnected) {
            scheduleRemount();
            return;
        }
        if (records.some(record => record?.type === 'attributes') && isHostTampered()) {
            scheduleRemount();
        }
    }

    return {
        start() {
            if (running || blocked) { return; }
            if (typeof MutationObserverImpl !== 'function' || !root) { return; }
            running = true;
            observer = new MutationObserverImpl(handleRecords);
            observer.observe(root, { childList: true, subtree: true });
            observeHostAttributes();
        },

        stop() {
            stopWatching();
        },

        // The content script calls this after a successful recreation; the next
        // removal starts at the first delay again. The 60 s removal counter stays.
        onRemounted() {
            attempt = 0;
            observeHostAttributes();
        },

        isBlocked() {
            return blocked;
        }
    };
}
