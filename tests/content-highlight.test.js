import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import { JSDOM } from 'jsdom';

const code = fs.readFileSync('src/content.js', 'utf8');
const extract = name => code.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}\\n`))[0];
const startup = code.slice(code.indexOf('let startRetry'), code.indexOf('\nfunction rememberContextMenuImageTarget'));

async function setup({ loaded = true, dispatchLoad = true, crossOrigin = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="top" style="border: 1px solid red"></div><iframe></iframe></body></html>', { url: 'https://example.com' });
  const { window } = dom;
  const { document } = window;
  Object.defineProperty(document, 'readyState', { value: 'complete' });
  const frame = document.querySelector('iframe');
  if (crossOrigin) {
    Object.defineProperty(frame, 'contentWindow', {
      configurable: true,
      get() { throw new window.DOMException('Blocked a frame from accessing a cross-origin frame.', 'SecurityError'); }
    });
  }
  Object.defineProperty(frame.contentDocument, 'readyState', { configurable: true, value: loaded ? 'complete' : 'loading' });
  const frameListeners = vi.spyOn(frame.contentDocument, 'addEventListener');
  const inside = frame.contentDocument.createElement('div');
  inside.style.border = '1px solid red';
  frame.contentDocument.body.appendChild(inside);
  const deps = { getOptions: vi.fn(), rememberContextMenuImageTarget: vi.fn(), document, window, history: window.history, Event: window.Event, getShadowRoot: () => null, getRootElement: () => null, closeSessionListOnOutsideClick: vi.fn(), removeLocalStorageObject: vi.fn(), getMyTabId: vi.fn(), getAiUserCommands: vi.fn(), init: vi.fn(), chrome: { runtime: { sendMessage: vi.fn() } }, notifySidebar: vi.fn(), sendToSidebar: vi.fn(), getHostState: () => ({open: false}), manifest: {}, getLineNumber: () => 0, laiFetchStyles: () => [], console, setTimeout, showMessage: vi.fn(), closeQuickPromptListMenu: vi.fn(), closeAllDropDownRibbonMenus: vi.fn(), getSideBar: () => null };
  const optional = ['highlightElementOverDecoration', 'restoreElementDecoration', 'frameElementSelectionClicked'].filter(n => code.includes(`function ${n}(`)).map(extract).join('\n');
  const track = code.includes('const highlightedElements =') ? 'const highlightedElements = new Map();' : '';
  const api = new Function('deps', `with (deps) { let isElementSelectionActive = false; ${track}\n${startup}\n${['attachElementSelectionListenersToFrames', 'updateTabPageContentStorage', 'clearElementOverDecoration', 'clearAllElementDecorations', 'getSelectedClickedElement', 'handleSidebarEscape'].map(extract).join('\n')}\n${optional}\nreturn { start, setActive: value => { isElementSelectionActive = value; } }; }`)(deps);
  await api.start();
  if (dispatchLoad) { frame.dispatchEvent(new window.Event('load')); }
  return { window, document, frame, frameListeners, inside, top: document.getElementById('top'), ...api };
}
const hover = (el, type) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent(type, { bubbles: true }));

describe('element highlight', () => {
  it('highlights an already-loaded frame without a load event and clears on Escape', async () => {
    const { window, document, inside, setActive } = await setup({ dispatchLoad: false });
    setActive(true); hover(inside, 'mouseover');
    expect(inside.style.border).toBe('5px double lime');
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(inside.style.border).toBe('1px solid red');
    expect(inside.hasAttribute('data-original-border')).toBe(false);
  });
  it('attaches on a later load and does not duplicate the click handler', async () => {
    const { window, frame, frameListeners, inside, setActive } = await setup({ loaded: false, dispatchLoad: false });
    Object.defineProperty(frame.contentDocument, 'readyState', { value: 'complete' });
    frame.dispatchEvent(new window.Event('load'));
    frame.dispatchEvent(new window.Event('load'));
    const handlers = frameListeners.mock.calls.filter(([type]) => type === 'click').map(([, handler]) => handler);
    expect(handlers.length).toBeGreaterThan(0);
    expect(new Set(handlers).size).toBe(1);
    setActive(true); hover(inside, 'mouseover'); expect(inside.style.border).toBe('5px double lime');
  });
  it('uses the same click handler after immediate attachment and load', async () => {
    const { frameListeners } = await setup();
    const handlers = frameListeners.mock.calls.filter(([type]) => type === 'click').map(([, handler]) => handler);
    expect(handlers.length).toBe(2);
    expect(new Set(handlers).size).toBe(1);
  });
  it('skips a cross-origin frame without a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { frameListeners } = await setup({ crossOrigin: true });
    expect(warn).not.toHaveBeenCalled();
    expect(debug.mock.calls.some(([message]) => /cross-origin frame/i.test(String(message)))).toBe(true);
    expect(frameListeners).not.toHaveBeenCalled();
    warn.mockRestore();
    debug.mockRestore();
  });
  it('keeps listeners on a same-origin frame without a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { frameListeners } = await setup();
    const types = frameListeners.mock.calls.map(([type]) => type);
    expect(warn).not.toHaveBeenCalled();
    expect(types).toEqual(expect.arrayContaining(['mouseover', 'mouseout', 'click']));
    warn.mockRestore();
  });
  it('restores the original border after repeated hover and mouseout', async () => {
    const { top, setActive } = await setup(); setActive(true);
    hover(top, 'mouseover'); hover(top, 'mouseover'); hover(top, 'mouseout');
    expect(top.style.border).toBe('1px solid red');
    expect(top.hasAttribute('data-original-border')).toBe(false);
  });
  it('removes an initially absent border and ignores events while inactive', async () => {
    const { document, setActive } = await setup(); const el = document.createElement('div'); document.body.appendChild(el);
    hover(el, 'mouseover'); hover(el, 'mouseout'); expect(el.hasAttribute('style')).toBe(false);
    setActive(true); hover(el, 'mouseover'); hover(el, 'mouseout');
    expect(el.style.getPropertyValue('border')).toBe(''); expect(el.hasAttribute('data-original-border')).toBe(false);
  });
  for (const action of ['click', 'Escape']) it(`cleans top and frame highlights on ${action}`, async () => {
    const { window, document, top, inside, setActive } = await setup(); setActive(true);
    hover(top, 'mouseover'); hover(inside, 'mouseover');
    if (action === 'click') hover(top, 'click'); else document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    for (const el of [top, inside]) { expect(el.style.border).toBe('1px solid red'); expect(el.hasAttribute('data-original-border')).toBe(false); }
  });
  it('cleans tracked elements even if the attribute disappears', async () => {
    const { window, document, top, setActive } = await setup(); setActive(true); hover(top, 'mouseover'); top.removeAttribute('data-original-border');
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(top.style.border).toBe('1px solid red');
  });
});

describe('selection toggle', () => {
  it('clears highlights when selection is switched off', async () => {
    const clear = vi.fn();
    const dispatch = new Function('clearAllElementDecorations', `let isElementSelectionActive = true; ${extract('processHostMessage')} return processHostMessage;`)(clear);
    await dispatch({ action: 'toggleSelectElement', selection: false });
    expect(clear).toHaveBeenCalledOnce();
  });
});
