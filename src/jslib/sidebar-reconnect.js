/**
 * Sidebar port reconnection (#104).
 *
 * A Chrome MV3 service worker can stop while the sidebar iframe stays mounted, which
 * disconnects the brokered port. The iframe retries the broker connection up to three
 * times with back-off while its frame registration is still confirmed; a successful
 * reconnect resets the counter.
 */

function createSidebarReconnector({
    connect,
    isConfirmed,
    onFailed = () => { },
    delays = [250, 1000, 2500],
    wait = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
    let attempts = 0;
    let inFlight = false;
    let cancelled = false;

    async function attempt() {
        if (cancelled) { return; }
        if (attempts >= delays.length) {
            onFailed();
            return;
        }

        inFlight = true;
        const delay = delays[attempts];
        attempts += 1;
        await wait(delay);
        if (cancelled) {
            inFlight = false;
            return;
        }

        let confirmed = false;
        try {
            confirmed = !!(await isConfirmed());
        } catch {
            confirmed = false;
        }
        if (!confirmed) {
            inFlight = false;
            onFailed();
            return;
        }

        try {
            await connect();
            inFlight = false;
        } catch {
            inFlight = false;
            await attempt();
        }
    }

    return {
        schedule() {
            if (cancelled || inFlight) { return; }
            void attempt();
        },
        reset() {
            attempts = 0;
        },
        cancel() {
            cancelled = true;
        },
        get attempts() {
            return attempts;
        }
    };
}
