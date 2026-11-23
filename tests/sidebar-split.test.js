import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

const read = path => readFileSync(path, 'utf8');
const hostCode = read('src/content.js');
const frameCode = read('src/sidebar-frame.js');
const makeChannel = new Function(read('src/jslib/sidebar-port.js') + '; return createSidebarChannel;')();

function event() {
    const listeners = [];
    return {
        addListener: listener => listeners.push(listener),
        emit: value => listeners.forEach(listener => listener(value))
    };
}

function connectPair() {
    const first = { onMessage: event(), onDisconnect: event() };
    const second = { onMessage: event(), onDisconnect: event() };
    first.postMessage = message => second.onMessage.emit(message);
    second.postMessage = message => first.onMessage.emit(message);
    return [first, second];
}

describe('sidebar port', () => {
    it('correlates out-of-order replies on the same connection', async () => {
        const [host, frame] = connectPair();
        let complete;
        makeChannel(host, (action, payload) => action === 'slow'
            ? new Promise(resolve => { complete = resolve; }) : payload.value);
        const channel = makeChannel(frame);
        const slow = channel.request('slow');
        await expect(channel.request('fast', { value: 'second' })).resolves.toBe('second');
        complete('first');
        await expect(slow).resolves.toBe('first');
    });

    it('propagates handler errors and rejects pending and future requests on disconnect', async () => {
        const [host, frame] = connectPair();
        makeChannel(host, action => {
            if (action === 'unknown') { throw new Error('Unknown operation.'); }
            return new Promise(() => {});
        });
        const onDisconnect = vi.fn();
        const channel = makeChannel(frame, undefined, onDisconnect);
        await expect(channel.request('unknown')).rejects.toThrow('Unknown operation.');
        const pending = channel.request('wait');
        frame.onDisconnect.emit();
        await expect(pending).rejects.toThrow('closed');
        await expect(channel.request('wait')).rejects.toThrow('closed');
        expect(onDisconnect).toHaveBeenCalledOnce();
    });

    it.each(['background.js', '_generated_background_page.html'])('accepts only the background sender at %s', backgroundPath => {
        const onConnect = event();
        const getURL = path => `chrome-extension://test/${path}`;
        const chrome = { runtime: { id: 'test', getURL, onConnect } };
        const manifest = { background: backgroundPath === 'background.js' ? { service_worker: backgroundPath } : { scripts: ['background.js'] } };
        const createSidebarChannel = vi.fn();
        const connectCode = hostCode.slice(hostCode.indexOf('function isSidebarBackgroundSender'), hostCode.indexOf('async function sendToSidebar'));
        new Function('chrome', 'manifest', 'createSidebarChannel', `
            let sidebarFrame = { isConnected: true };
            let sidebarPort, sidebarChannel, sidebarFrameTimer;
            ${connectCode}
        `)(chrome, manifest, createSidebarChannel);
        for (const sender of [
            { id: 'test', url: getURL('sidebar.html'), tab: { id: 42 } },
            { id: 'test', url: getURL(backgroundPath), tab: { id: 42 } },
            { id: 'other', url: getURL(backgroundPath) },
            { id: 'test', url: getURL('options.html') }
        ]) {
            const port = { name: 'localai-sidebar', sender, disconnect: vi.fn() };
            onConnect.emit(port);
            expect(port.disconnect).toHaveBeenCalledOnce();
        }
        const good = { name: 'localai-sidebar', sender: { id: 'test', url: getURL(backgroundPath) }, disconnect: vi.fn() };
        onConnect.emit(good);
        expect(good.disconnect).not.toHaveBeenCalled();
        expect(createSidebarChannel).toHaveBeenCalledExactlyOnceWith(good, expect.any(Function), expect.any(Function));
    });

    it('passes the UI acknowledgement through without acknowledging a closed panel', async () => {
        const getHostState = vi.fn(() => ({ open: true }));
        const request = { action: 'streamEnd', requestId: 'request' };
        const sendToSidebar = vi.fn(async () => ({ requestId: null }));
        const dispatch = new Function('getHostState', 'sendToSidebar', `
            const sidebarReady = true;
            ${hostCode.slice(hostCode.indexOf('async function processHostMessage'))}
            return processHostMessage;
        `)(getHostState, sendToSidebar);
        await expect(dispatch(request)).resolves.toEqual({ requestId: null });
        sendToSidebar.mockResolvedValueOnce({ requestId: 'request' });
        await expect(dispatch(request)).resolves.toEqual({ requestId: 'request' });
        getHostState.mockReturnValue({ open: false });
        await expect(dispatch(request)).resolves.toEqual({ requestId: null });
        expect(sendToSidebar).toHaveBeenCalledTimes(2);
    });
});

describe('sidebar frame', () => {
    it('does not connect or load commands when registration confirmation fails', async () => {
        const connect = vi.fn();
        const getAiUserCommands = vi.fn();
        const showSidebarConnectionFailure = vi.fn();
        const chrome = { runtime: { sendMessage: vi.fn(async () => ({ ok: false, reason: 'no-registration' })) }, tabs: { connect } };
        const start = new Function('chrome', 'getAiUserCommands', 'showSidebarConnectionFailure', `
            ${frameCode.slice(frameCode.indexOf('async function startSidebarFrame'), frameCode.indexOf('startSidebarFrame().catch'))}
            return startSidebarFrame;
        `)(chrome, getAiUserCommands, showSidebarConnectionFailure);
        await start();
        expect(showSidebarConnectionFailure).toHaveBeenCalledOnce();
        expect(connect).not.toHaveBeenCalled();
        expect(getAiUserCommands).not.toHaveBeenCalled();
    });

    it.each(['src', 'Chrome', 'Firefox'])('exposes only sidebar.html in the %s manifest', directory => {
        const manifest = JSON.parse(read(`${directory}/manifest.json`));
        expect(manifest.web_accessible_resources.flatMap(entry => entry.resources)).toEqual(['sidebar.html']);
        expect(manifest.web_accessible_resources[0].use_dynamic_url).toBe(directory === 'Firefox' ? undefined : true);
        expect(manifest.content_scripts[0].js).not.toContain('lai-main.js');
    });

    it('aborts the request for the host tab of an iframe sender', async () => {
        const background = read('src/background.js');
        const dispatchCode = background.slice(background.indexOf('async function handleRuntimeMessage'), background.indexOf('chrome.runtime.onMessage.addListener'));
        const controller = { abort: vi.fn() };
        const other = { abort: vi.fn() };
        const controllers = new Map([[42, controller], [43, other]]);
        const dispatch = new Function('controllers', dispatchCode + '; return handleRuntimeMessage;')(controllers);
        await dispatch({ action: 'abortFetch' }, {
            frameId: 7, url: 'chrome-extension://test/sidebar.html',
            tab: { id: 42, url: 'https://example.org/' }
        });
        expect(controller.abort).toHaveBeenCalledOnce();
        expect(other.abort).not.toHaveBeenCalled();
        expect(controllers.has(42)).toBe(false);
    });
});

it('starts the actual sidebar scripts and renders the prompt only after host confirmation', async () => {
    const dom = new JSDOM(read('src/sidebar.html'), {
        url: 'chrome-extension://test/sidebar.html',
        runScripts: 'outside-only'
    });
    const { window } = dom;
    const [host, frame] = connectPair();
    const state = { open: true, url: 'https://example.org/', title: 'Example' };
    let confirm;
    const sendMessage = vi.fn(({ action }) => {
        if (action === 'confirmSidebarFrame') {
            return new Promise(resolve => { confirm = resolve; });
        }
        return Promise.resolve({});
    });
    const localRead = vi.fn(async () => ({}));
    const connect = vi.fn(() => frame);
    const extensionEvent = { addListener: vi.fn(), removeListener: vi.fn() };
    window.chrome = {
        runtime: {
            id: 'test', connect, getManifest: () => ({ name: 'Local AI', version: '1.31.0' }),
            getURL: path => `chrome-extension://test/${path}`, sendMessage
        },
        storage: {
            onChanged: extensionEvent,
            local: { get: localRead, remove: vi.fn() },
            sync: { get: vi.fn(async () => ({})) }
        }
    };
    makeChannel(host, () => state);
    try {
        const scripts = [...window.document.querySelectorAll('script[src]')];
        window.eval(scripts.map(script => read(`src/${script.getAttribute('src')}`)).join('\n'));
        expect(window.document.getElementById('laiSidebar').hidden).toBe(true);
        expect(connect).not.toHaveBeenCalled();
        expect(localRead).not.toHaveBeenCalled();
        confirm({ ok: true, tabId: 42 });
        await vi.waitFor(() => expect(window.document.getElementById('laiSidebar').hidden).toBe(false));
        expect(connect).toHaveBeenCalledExactlyOnceWith({ name: 'localai-sidebar' });
        expect(window.document.getElementById('laiUserInput')).toBeTruthy();
        expect(sendMessage).toHaveBeenCalledWith({ action: 'updateTabState', panelOpen: true });
    } finally {
        window.close();
    }
});
