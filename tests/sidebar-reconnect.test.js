import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '../src/jslib/sidebar-reconnect.js'), 'utf8');
const { createSidebarReconnector } = new Function(`${source}; return { createSidebarReconnector };`)();

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function createHarness(options = {}) {
    const waits = [];
    const connect = vi.fn(async () => { });
    const isConfirmed = vi.fn(async () => options.confirmed ?? true);
    const onFailed = vi.fn();
    const reconnector = createSidebarReconnector({
        connect,
        isConfirmed,
        onFailed,
        delays: options.delays ?? [250, 1000, 2500],
        wait: ms => new Promise(resolve => waits.push({ ms, resolve }))
    });
    return { reconnector, waits, connect, isConfirmed, onFailed };
}

describe('createSidebarReconnector', () => {
    it('retries with back-off and reconnects once the frame is confirmed', async () => {
        const { reconnector, waits, connect, isConfirmed } = createHarness();

        reconnector.schedule();
        expect(waits.map(entry => entry.ms)).toEqual([250]);
        waits[0].resolve();
        await flush();

        expect(isConfirmed).toHaveBeenCalledTimes(1);
        expect(connect).toHaveBeenCalledTimes(1);
        expect(reconnector.attempts).toBe(1);
    });

    it('walks the whole back-off when the connection keeps failing', async () => {
        const { reconnector, waits, connect, onFailed } = createHarness();
        connect.mockRejectedValue(new Error('broker down'));

        reconnector.schedule();
        for (const expected of [250, 1000, 2500]) {
            expect(waits.at(-1).ms).toBe(expected);
            waits.at(-1).resolve();
            await flush();
        }

        expect(connect).toHaveBeenCalledTimes(3);
        expect(onFailed).toHaveBeenCalledTimes(1);
    });

    it('gives up when the frame registration is no longer confirmed', async () => {
        const { reconnector, waits, connect, onFailed } = createHarness({ confirmed: false });

        reconnector.schedule();
        waits[0].resolve();
        await flush();

        expect(connect).not.toHaveBeenCalled();
        expect(onFailed).toHaveBeenCalledTimes(1);
    });

    it('retries a transient confirmation error within the host teardown window', async () => {
        const { reconnector, waits, connect, isConfirmed, onFailed } = createHarness();
        isConfirmed.mockRejectedValueOnce(new Error('background starting'));

        reconnector.schedule();
        waits[0].resolve();
        await flush();

        expect(connect).not.toHaveBeenCalled();
        expect(waits.map(entry => entry.ms)).toEqual([250, 1000]);
        waits[1].resolve();
        await flush();

        expect(connect).toHaveBeenCalledOnce();
        expect(onFailed).not.toHaveBeenCalled();
    });

    it('resets the attempt counter after a successful reconnect', async () => {
        const { reconnector, waits } = createHarness();

        reconnector.schedule();
        waits[0].resolve();
        await flush();
        reconnector.reset();

        reconnector.schedule();
        expect(waits.at(-1).ms).toBe(250);
    });

    it('ignores repeated schedules while an attempt is waiting', async () => {
        const { reconnector, waits } = createHarness();

        reconnector.schedule();
        reconnector.schedule();

        expect(waits).toHaveLength(1);
    });

    it('stops retrying after cancel', async () => {
        const { reconnector, waits, connect } = createHarness();

        reconnector.schedule();
        reconnector.cancel();
        waits[0].resolve();
        await flush();

        expect(connect).not.toHaveBeenCalled();
    });
});
