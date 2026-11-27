import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ribbonCode = fs.readFileSync(path.join(__dirname, '../src/jslib/ribbon.js'), 'utf-8');
const frameCode = fs.readFileSync(path.join(__dirname, '../src/sidebar-frame.js'), 'utf-8');

const renderCode = ribbonCode.match(/var laiSessionNameRenderSeq = 0;\n[\s\S]*?async function renderSessionNameLabel\([\s\S]*?\n}\n/)[0];
const storageHandlerCode = ribbonCode.match(/function onSessionsStorageChanged\([\s\S]*?\n}\n/)[0];
const installListenersCode = frameCode.match(/function installSidebarListeners\([\s\S]*?\n}\n/)[0];

const loadRender = (getShadowRoot, getAllSessions) => new Function(
    'getShadowRoot',
    'getAllSessions',
    `
var laiActiveSessionId = null;
${renderCode}
return {
    renderSessionNameLabel,
    setActiveId: id => { laiActiveSessionId = id; }
};
`
)(getShadowRoot, getAllSessions);

const loadStorageHandler = renderSessionNameLabel => new Function(
    'allSessionsStorageKey',
    'renderSessionNameLabel',
    `${storageHandlerCode}
return onSessionsStorageChanged;`
)('aiSessions', renderSessionNameLabel);

describe('session name label (#130)', () => {
    let dom;
    let label;
    let sessions;
    let getShadowRoot;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body><div id="laiSessionName" class="session-label"></div></body></html>');
        label = dom.window.document.getElementById('laiSessionName');
        sessions = [];
        getShadowRoot = vi.fn(() => dom.window.document);
    });

    const makeLabel = () => loadRender(getShadowRoot, vi.fn(async () => sessions));

    it('shows the stored title and the full title in the tooltip', async () => {
        sessions = [{ id: 's1', title: 'Discussed migration plan' }];
        const { renderSessionNameLabel, setActiveId } = makeLabel();
        setActiveId('s1');

        await renderSessionNameLabel();

        expect(label.textContent).toBe('Discussed migration plan');
        expect(label.title).toBe('Discussed migration plan');
    });

    it('shows New session without an active session', async () => {
        const { renderSessionNameLabel } = makeLabel();

        await renderSessionNameLabel();

        expect(label.textContent).toBe('New session');
        expect(label.title).toBe('');
    });

    it('shows New session when the active record is not stored yet', async () => {
        sessions = [{ id: 'other', title: 'Another session' }];
        const { renderSessionNameLabel, setActiveId } = makeLabel();
        setActiveId('not-stored');

        await renderSessionNameLabel();

        expect(label.textContent).toBe('New session');
    });

    it('follows a session switch', async () => {
        sessions = [{ id: 's1', title: 'First session' }, { id: 's2', title: 'Second session' }];
        const { renderSessionNameLabel, setActiveId } = makeLabel();

        setActiveId('s1');
        await renderSessionNameLabel();
        expect(label.textContent).toBe('First session');

        setActiveId('s2');
        await renderSessionNameLabel();
        expect(label.textContent).toBe('Second session');
    });

    it('falls back to New session after the active session is deleted', async () => {
        sessions = [{ id: 's1', title: 'First session' }];
        const { renderSessionNameLabel, setActiveId } = makeLabel();
        setActiveId('s1');
        await renderSessionNameLabel();

        setActiveId(null);
        await renderSessionNameLabel();

        expect(label.textContent).toBe('New session');
        expect(label.title).toBe('');
    });

    it('discards a stale catalogue read after a fast switch', async () => {
        const pending = [];
        const getAllSessions = vi.fn(() => new Promise(resolve => pending.push(resolve)));
        const { renderSessionNameLabel, setActiveId } = loadRender(getShadowRoot, getAllSessions);

        setActiveId('a');
        const first = renderSessionNameLabel();
        setActiveId('b');
        const second = renderSessionNameLabel();

        pending[1]([{ id: 'b', title: 'Second session' }]);
        await second;
        pending[0]([{ id: 'a', title: 'First session' }]);
        await first;

        expect(label.textContent).toBe('Second session');
    });

    it('renders HTML in a title as text', async () => {
        const hostile = '<img src="x" onerror="alert(1)"> <b>bold</b>';
        sessions = [{ id: 's1', title: hostile }];
        const { renderSessionNameLabel, setActiveId } = makeLabel();
        setActiveId('s1');

        await renderSessionNameLabel();

        expect(label.textContent).toBe(hostile);
        expect(label.querySelector('img, b')).toBeNull();
        expect(label.title).toBe(hostile);
    });

    it('re-renders only for the local session catalogue storage key', () => {
        const renderSessionNameLabel = vi.fn();
        const onSessionsStorageChanged = loadStorageHandler(renderSessionNameLabel);

        expect(onSessionsStorageChanged({ aiSessions: { newValue: [] } }, 'local')).toBe(true);
        expect(onSessionsStorageChanged({ aiSessions: { newValue: [] } }, 'sync')).toBe(false);
        expect(onSessionsStorageChanged({ aiOptions: { newValue: {} } }, 'local')).toBe(false);
        expect(onSessionsStorageChanged(undefined, 'local')).toBe(false);
        expect(renderSessionNameLabel).toHaveBeenCalledOnce();
    });

    it('registers the storage handler and re-renders on active session changes', () => {
        const storageListeners = [];
        const renderSessionNameLabel = vi.fn();
        const installListeners = new Function(
            'chrome', 'document', 'window', 'sidebarChannel', 'sidebarDraft', 'stopSidebarSpeech',
            'reconcileActiveSessionWithStorage', 'onModelOptionsChanged', 'onSessionsStorageChanged',
            'renderSessionNameLabel',
            `${installListenersCode}
return installSidebarListeners;`
        )(
            { storage: { onChanged: { addListener: listener => storageListeners.push(listener) } } },
            dom.window.document,
            dom.window,
            undefined,
            undefined,
            vi.fn(),
            vi.fn(),
            vi.fn(),
            loadStorageHandler(renderSessionNameLabel),
            renderSessionNameLabel
        );

        installListeners();
        expect(storageListeners).toHaveLength(3);
        expect(renderSessionNameLabel).toHaveBeenCalledOnce();

        storageListeners[2]({ aiSessions: { newValue: [] } }, 'local');
        expect(renderSessionNameLabel).toHaveBeenCalledTimes(2);

        dom.window.document.dispatchEvent(new dom.window.Event('laiActiveSessionChanged'));
        expect(renderSessionNameLabel).toHaveBeenCalledTimes(3);
    });
});
