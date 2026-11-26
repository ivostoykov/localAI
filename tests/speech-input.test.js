import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const read = file => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
const logCode = read('jslib/speech-log.js');
const controllerCode = read('jslib/speech-session.js');
const sidebarCode = read('jslib/stt.js');

function loadSpeechScript(source, globals, exports) {
    return new Function(...Object.keys(globals), logCode + source + '\nreturn ' + exports)(...Object.values(globals));
}

function loadController() {
    let open = false;
    const runtime = {
        id: 'localai',
        getURL: path => 'chrome-extension://localai/' + path,
        getContexts: vi.fn(async () => open ? [{}] : []),
        sendMessage: vi.fn(async () => ({ ok: true }))
    };
    const offscreen = {
        createDocument: vi.fn(async () => {
            if (open) { throw new Error('Speech host already exists.'); }
            open = true;
        }),
        closeDocument: vi.fn(async () => { open = false; })
    };
    const tabs = {
        create: vi.fn(async () => ({})),
        sendMessage: vi.fn(async () => ({ received: true }))
    };
    const debug = vi.fn();
    const controller = loadSpeechScript(controllerCode, {
        console: { debug }, manifest: { name: 'Local AI' }, getLineNumber: () => '42'
    }, 'createSpeechSessionController')({ runtime, offscreen, tabs }, async sender => sender.confirmed === true);

    const sidebar = (tabId, documentId = 'sidebar-' + tabId) => ({
        id: runtime.id, tab: { id: tabId }, frameId: 2, documentId, confirmed: true
    });
    const host = { id: runtime.id, url: runtime.getURL('speech-host.html') };
    const start = (id, tabId) => controller.handle({ action: 'startSpeech', id, tabId: 99 }, sidebar(tabId));
    const emit = (id, type, fields) => controller.handle({ action: 'speechHostEvent', id, type, ...fields }, host);

    return { controller, runtime, offscreen, tabs, debug, sidebar, host, start, emit };
}

describe('background speech sessions', () => {
    it('routes using the confirmed sender tab and rejects a stop from a different frame or document', async () => {
        const { controller, runtime, tabs, sidebar, start, emit, offscreen } = loadController();
        expect(await start('session', 12)).toEqual({ ok: true });
        expect(await controller.handle({ action: 'stopSpeech', id: 'session' }, sidebar(99))).toMatchObject({ ok: false });
        expect(await controller.handle({ action: 'stopSpeech', id: 'session' }, sidebar(12, 'replacement'))).toMatchObject({ ok: false });
        expect(await emit('session', 'transcript', { transcript: 'Hello', tabId: 99 })).toEqual({ ok: true });
        expect(tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(12, {
            action: 'speechUpdate', id: 'session', type: 'transcript', transcript: 'Hello'
        }, { frameId: 0 });
        expect(await controller.handle({ action: 'stopSpeech', id: 'session' }, sidebar(12))).toEqual({ ok: true });
        expect(runtime.sendMessage).toHaveBeenLastCalledWith({ action: 'speechHostCommand', id: 'session', command: 'stop' });
        await emit('session', 'end');
        expect(offscreen.closeDocument).toHaveBeenCalledTimes(1);
        expect(tabs.sendMessage).toHaveBeenLastCalledWith(12, {
            action: 'speechUpdate', id: 'session', type: 'end'
        }, { frameId: 0 });
    });

    it('serialises takeovers and ignores stale events from the previous session', async () => {
        const { offscreen, tabs, start, emit } = loadController();
        expect(await Promise.all([start('old', 1), start('new', 2)])).toEqual([{ ok: true }, { ok: true }]);
        expect(offscreen.createDocument).toHaveBeenCalledTimes(2);
        expect(offscreen.closeDocument).toHaveBeenCalledTimes(1);
        expect(tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(1, {
            action: 'speechUpdate', id: 'old', type: 'end', message: expect.stringContaining('another sidebar')
        }, { frameId: 0 });
        expect(await emit('old', 'transcript', { transcript: 'stale' })).toMatchObject({ ok: false });
        expect(tabs.sendMessage).toHaveBeenCalledTimes(1);
        expect(await emit('new', 'heartbeat')).toEqual({ ok: true });
    });

    it('opens the extension grant page and tells the originating sidebar how to retry', async () => {
        const { tabs, debug, start, emit, offscreen } = loadController();
        await start('session', 1);
        await emit('session', 'error', { code: 'not-allowed' });
        expect(tabs.create).toHaveBeenCalledExactlyOnceWith({ url: 'chrome-extension://localai/microphone-access.html' });
        expect(tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(1, {
            action: 'speechUpdate', id: 'session', type: 'error',
            message: expect.stringContaining('Allow microphone access')
        }, { frameId: 0 });
        expect(debug).toHaveBeenCalledWith('>>> Local AI - [42] - Speech recognition failed: not-allowed');
        expect(offscreen.closeDocument).toHaveBeenCalledTimes(1);
    });

    it('logs start failures and returns the message to the sidebar', async () => {
        const { offscreen, debug, start } = loadController();
        offscreen.createDocument.mockRejectedValueOnce(new Error('Host unavailable'));
        expect(await start('failed', 1)).toEqual({ ok: false, message: 'Could not start speech input: Host unavailable' });
        expect(debug).toHaveBeenCalledWith('>>> Local AI - [42] - Could not start speech input: Host unavailable');
        expect(await start('retry', 1)).toEqual({ ok: true });
    });

    it('rejects unconfirmed sidebars and host events sent from a tab', async () => {
        const { controller, offscreen, tabs, start, host } = loadController();
        expect(await controller.handle({ action: 'startSpeech', id: 'session' }, { tab: { id: 1 } }))
            .toMatchObject({ ok: false });
        expect(offscreen.createDocument).not.toHaveBeenCalled();
        await start('session', 1);
        expect(await controller.handle({ action: 'speechHostEvent', id: 'session', type: 'error', code: 'not-allowed' },
            { ...host, tab: { id: 1 } })).toMatchObject({ ok: false });
        expect(tabs.create).not.toHaveBeenCalled();
        expect(offscreen.closeDocument).not.toHaveBeenCalled();
    });
});

describe('sidebar speech controls', () => {
    function loadSidebar(sendMessage) {
        const showMessage = vi.fn();
        const debug = vi.fn();
        const updateStatusBar = vi.fn();
        const sidebar = loadSpeechScript(sidebarCode, {
            chrome: { runtime: { sendMessage } }, showMessage, updateStatusBar,
            console: { debug }, manifest: { name: 'Local AI' }, getLineNumber: () => '42'
        }, '{ updateSpeechAvailability, toggleRecording, updateSidebarSpeech }');
        const container = document.createElement('div');
        container.className = 'invisible';
        container.innerHTML = '<img id="mic"><img id="micOff" class="invisible">';
        return { sidebar, container, showMessage, updateStatusBar, debug };
    }

    it('keeps both microphone controls hidden when the background reports no support', async () => {
        const sendMessage = vi.fn(async () => ({ available: false }));
        const { sidebar, container, showMessage, debug } = loadSidebar(sendMessage);
        await sidebar.updateSpeechAvailability(container);
        expect(sendMessage).toHaveBeenCalledExactlyOnceWith({ action: 'speechAvailability' });
        expect(container.classList.contains('invisible')).toBe(true);
        expect(showMessage).not.toHaveBeenCalled();
        expect(debug).not.toHaveBeenCalled();
        sendMessage.mockResolvedValueOnce({ available: true });
        await sidebar.updateSpeechAvailability(container);
        expect(container.classList.contains('invisible')).toBe(false);
    });

    it('inserts only the current transcript and reports errors while resetting the mic', () => {
        const sendMessage = vi.fn(async () => ({ ok: true }));
        const { sidebar, container, showMessage, updateStatusBar, debug } = loadSidebar(sendMessage);
        const textbox = document.createElement('textarea');
        const input = vi.fn();
        textbox.value = 'One';
        textbox.addEventListener('input', input);
        sidebar.toggleRecording(textbox, container);
        const [{ id }] = sendMessage.mock.lastCall;
        expect(sidebar.updateSidebarSpeech({ id: 'stale', type: 'transcript', transcript: 'stale' })).toEqual({ received: false });
        expect(sidebar.updateSidebarSpeech({ id, type: 'transcript', transcript: 'two' })).toEqual({ received: true });
        expect(textbox.value).toBe('One two');
        expect(input).toHaveBeenCalledTimes(1);
        sidebar.updateSidebarSpeech({ id, type: 'error', message: 'Speech recognition failed: audio-capture' });
        expect(container.classList.contains('recording')).toBe(false);
        expect(updateStatusBar).toHaveBeenLastCalledWith('Ready.');
        expect(showMessage).toHaveBeenCalledWith('Speech recognition failed: audio-capture', 'error');
        expect(debug).toHaveBeenCalledWith('>>> Local AI - [42] - Speech recognition failed: audio-capture');
    });
});
