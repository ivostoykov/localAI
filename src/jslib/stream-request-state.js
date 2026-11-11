const laiStreamRequestPrefix = 'laiStreamRequest:';
const laiStreamCheckpointInterval = 1000;
const laiStreamTerminalRetention = 10 * 60 * 1000;

class StreamRequestStateStore {
    constructor({ storage = chrome?.storage?.session, now = () => Date.now(), checkpointInterval = laiStreamCheckpointInterval, retention = laiStreamTerminalRetention } = {}) {
        this.storage = storage;
        this.now = now;
        this.checkpointInterval = checkpointInterval;
        this.retention = retention;
        this.lastCheckpointAt = new Map();
        this.liveRequestIds = new Set();
    }

    key(requestId) {
        return `${laiStreamRequestPrefix}${requestId}`;
    }

    async checkpoint(state, force = false) {
        if (!this.storage?.set || !state?.requestId) { return false; }
        const now = this.now();
        const lastCheckpoint = this.lastCheckpointAt.get(state.requestId) ?? 0;
        if (!force && now - lastCheckpoint < this.checkpointInterval) { return false; }

        const value = { ...state, updatedAt: now };
        try {
            await this.storage.set({ [this.key(state.requestId)]: value });
            this.lastCheckpointAt.set(state.requestId, now);
            if (state.status === 'streaming') {
                this.liveRequestIds.add(state.requestId);
            } else {
                this.liveRequestIds.delete(state.requestId);
                this.lastCheckpointAt.delete(state.requestId);
            }
            Object.assign(state, value);
            return true;
        } catch (error) {
            console.warn('>>> Failed to checkpoint stream request state', error);
            return false;
        }
    }

    async remove(requestId) {
        this.lastCheckpointAt.delete(requestId);
        this.liveRequestIds.delete(requestId);
        try {
            await this.storage?.remove?.(this.key(requestId));
        } catch (error) {
            console.warn('>>> Failed to remove stream request state', error);
        }
    }

    async removeForTab(tabId) {
        if (!this.storage?.get || !this.storage?.remove) { return; }
        try {
            const entries = await this.storage.get(null);
            const keys = Object.entries(entries)
                .filter(([key, state]) => key.startsWith(laiStreamRequestPrefix) && state?.tabId === tabId)
                .map(([key]) => key);
            if (keys.length > 0) { await this.storage.remove(keys); }
        } catch (error) {
            console.warn('>>> Failed to remove tab stream request state', error);
        }
    }

    async sweepExpired() {
        if (!this.storage?.get || !this.storage?.remove) { return; }
        try {
            const now = this.now();
            const entries = await this.storage.get(null);
            const keys = Object.entries(entries)
                .filter(([key, state]) => key.startsWith(laiStreamRequestPrefix)
                    && now - (state?.updatedAt ?? now) >= this.retention
                    && (state?.status !== 'streaming' || !this.liveRequestIds.has(state?.requestId)))
                .map(([key]) => key);
            if (keys.length > 0) {
                keys.forEach(key => {
                    const requestId = key.slice(laiStreamRequestPrefix.length);
                    this.lastCheckpointAt.delete(requestId);
                    this.liveRequestIds.delete(requestId);
                });
                await this.storage.remove(keys);
            }
        } catch (error) {
            console.warn('>>> Failed to sweep stream request state', error);
        }
    }
}

const streamRequestState = new StreamRequestStateStore();
