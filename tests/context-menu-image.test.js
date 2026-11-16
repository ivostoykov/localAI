import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import { JSDOM } from 'jsdom';

const code = fs.readFileSync('src/background.js', 'utf8');
const start = code.indexOf('async function attachContextMenuImage(tab)');
const end = code.indexOf('\n}\n\n// Ollama', start) + 2;
const handlerCode = code.slice(start, end);

function buildHandler({ bounds = { rect: { x: 10, y: 20, right: 110, bottom: 70, width: 100, height: 50 }, viewportWidth: 1000, viewportHeight: 700, devicePixelRatio: 2 }, capture = vi.fn(async () => 'data:image/png;base64,AA=='), sendMessage, showUIMessage = vi.fn() } = {}) {
    const sent = [];
    const send = sendMessage ?? vi.fn(async (tabId, message) => {
        sent.push(message);
        if (message.action === 'getContextMenuImageBounds') return bounds;
        if (message.action === 'hideLocalAIForImageCapture') return { hidden: true };
        return { result: true };
    });
    const drawImage = vi.fn();
    class Canvas {
        constructor(width, height) { this.width = width; this.height = height; }
        getContext() { return { drawImage }; }
        async convertToBlob() { return { arrayBuffer: async () => new Uint8Array([1, 2]).buffer }; }
    }
    const bitmap = { width: 2000, height: 1400, close: vi.fn() };
    const deps = {
        chrome: { tabs: { sendMessage: send, captureVisibleTab: capture } },
        showUIMessage,
        createImageBitmap: vi.fn(async () => bitmap),
        fetch: vi.fn(async () => ({ blob: async () => ({}) })),
        OffscreenCanvas: Canvas,
        manifest: { name: 'test' },
        getLineNumber: () => 1,
        console: { debug: vi.fn() },
        Uint8Array,
        btoa
    };
    const handler = new Function('deps', `with (deps) { ${handlerCode}; return attachContextMenuImage; }`)(deps);
    return { handler, sent, send, drawImage, bitmap, showUIMessage, capture, deps };
}

describe('context menu image capture', () => {
    it('creates the image menu under Local AI for image context', async () => {
        const composeStart = code.indexOf('async function composeContextMenu()');
        const composeEnd = code.indexOf('\n}\n\nasync function attachContextMenuImage', composeStart) + 2;
        const composeSource = code.slice(composeStart, composeEnd);
        const create = vi.fn(async () => undefined);
        const compose = new Function('deps', `with (deps) { ${composeSource}\n return composeContextMenu; }`)({ chrome: { contextMenus: { removeAll: vi.fn(), create } }, console: { debug: vi.fn() }, manifest: {}, getLineNumber: () => 0 });
        await compose();
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ id: 'attachImage', parentId: 'sendToLocalAi', title: 'Attach Image', contexts: ['image'] }));
    });

    it('crops using the bitmap to viewport ratio and sends PNG base64', async () => {
        const { handler, drawImage, sent, bitmap } = buildHandler();
        await handler({ id: 3, windowId: 4 });
        expect(drawImage).toHaveBeenCalledWith(bitmap, 20, 40, 200, 100, 0, 0, 200, 100);
        expect(sent.find(item => item.action === 'attachCroppedContextMenuImage')).toEqual({ action: 'attachCroppedContextMenuImage', base64: 'AQI=' });
        expect(sent.some(item => item.action === 'waitForImageCaptureFrame')).toBe(true);
        expect(sent.some(item => item.action === 'restoreLocalAIAfterImageCapture')).toBe(true);
    });

    it('logs and notifies when the remembered image is missing', async () => {
        const { handler, showUIMessage, capture } = buildHandler({ bounds: null });
        await handler({ id: 3, windowId: 4 });
        expect(showUIMessage).toHaveBeenCalledWith(expect.stringContaining('right-click the image again'), 'error', { id: 3, windowId: 4 });
        expect(capture).not.toHaveBeenCalled();
    });

    it('logs and notifies when there is no tab', async () => {
        const { handler, showUIMessage, capture } = buildHandler();
        await handler(null);
        expect(showUIMessage).toHaveBeenCalledWith(expect.stringContaining('tab is unavailable'), 'error', null);
        expect(capture).not.toHaveBeenCalled();
    });

    it('logs and notifies when the image rectangle has zero size', async () => {
        const { handler, showUIMessage, capture } = buildHandler({ bounds: { rect: { x: 0, y: 0, right: 0, bottom: 0, width: 0, height: 0 }, viewportWidth: 100, viewportHeight: 100 } });
        await handler({ id: 3, windowId: 4 });
        expect(showUIMessage).toHaveBeenCalledWith(expect.stringContaining('no visible size'), 'error', { id: 3, windowId: 4 });
        expect(capture).not.toHaveBeenCalled();
    });

    it('logs and notifies when the content script is unreachable', async () => {
        const sendMessage = vi.fn(async () => { throw new Error('receiving end does not exist'); });
        const { handler, showUIMessage, capture } = buildHandler({ sendMessage });
        await handler({ id: 3, windowId: 4 });
        expect(showUIMessage).toHaveBeenCalledWith(expect.stringContaining('receiving end does not exist'), 'error', { id: 3, windowId: 4 });
        expect(capture).not.toHaveBeenCalled();
    });

    it('logs and notifies on capture failure and restores overlapping UI', async () => {
        const capture = vi.fn(async () => { throw new Error('capture denied'); });
        const { handler, sent, showUIMessage } = buildHandler({ capture });
        await handler({ id: 3, windowId: 4 });
        expect(showUIMessage).toHaveBeenCalledWith(expect.stringContaining('capture denied'), 'error', { id: 3, windowId: 4 });
        expect(sent.some(item => item.action === 'restoreLocalAIAfterImageCapture')).toBe(true);
    });
});

describe('content side image capture helpers', () => {
    it('uses the composed-path image target and reports its rectangle and pixel ratio', () => {
        const dom = new JSDOM('<img id="target">', { url: 'https://example.com' });
        const image = dom.window.document.getElementById('target');
        Object.defineProperty(image, 'getBoundingClientRect', { value: () => ({ left: 2, top: 3, right: 20, bottom: 30, width: 18, height: 27 }) });
        const code = fs.readFileSync('src/content.js', 'utf8');
        const helpers = [...code.matchAll(/function (?:rememberContextMenuImageTarget|getContextMenuImageBounds)\([\s\S]*?\n\}/g)].map(match => match[0]).join('\n');
        const deps = { HTMLImageElement: dom.window.HTMLImageElement, window: { devicePixelRatio: 2, innerWidth: 800, innerHeight: 600 } };
        const funcs = new Function('deps', `with (deps) { let contextMenuImageTarget = null; ${helpers}\n return { rememberContextMenuImageTarget, getContextMenuImageBounds }; }`)(deps);
        funcs.rememberContextMenuImageTarget({ composedPath: () => [image] });
        expect(funcs.getContextMenuImageBounds()).toEqual({
            rect: { x: 2, y: 3, right: 20, bottom: 30, width: 18, height: 27 },
            devicePixelRatio: 2, viewportWidth: 800, viewportHeight: 600
        });
    });

    it('converts the cropped PNG base64 into a File handled by the existing image path', async () => {
        const code = fs.readFileSync('src/content.js', 'utf8');
        const attach = code.match(/async function attachCroppedContextMenuImage\(base64\) \{[\s\S]*?\n\}/)[0];
        const handleImageFile = vi.fn(async () => undefined);
        const showMessage = vi.fn();
        const funcs = new Function('deps', `with (deps) { ${attach}\n return attachCroppedContextMenuImage; }`)({ atob, Uint8Array, File, Date, handleImageFile, showMessage });
        await funcs('AQI=');
        const file = handleImageFile.mock.calls[0][0];
        expect(file).toBeInstanceOf(File);
        expect(file.type).toBe('image/png');
        expect(file.name).toMatch(/^image-\d+\.png$/);
        expect(file.size).toBe(2);
        expect(showMessage).toHaveBeenCalledWith('Image attached successfully.', 'info');
    });
});
