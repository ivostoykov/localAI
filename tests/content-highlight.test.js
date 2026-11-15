import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import { JSDOM } from 'jsdom';

const code = fs.readFileSync('src/content.js', 'utf8');
const extract = name => code.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}\\n`))[0];
const startup = code.slice(code.indexOf('let startRetry'), code.indexOf('\nasync function restoreTabSessionOnStartup'));

async function setup() {
  const dom = new JSDOM('<!doctype html><html><body><div id="top" style="border: 1px solid red"></div><iframe></iframe></body></html>', { url: 'https://example.com' });
  const { window } = dom;
  const { document } = window;
  Object.defineProperty(document, 'readyState', { value: 'complete' });
  const frame = document.querySelector('iframe');
  const inside = frame.contentDocument.createElement('div');
  inside.style.border = '1px solid red';
  frame.contentDocument.body.appendChild(inside);
  const deps = { document, window, history: window.history, Event: window.Event, getShadowRoot: () => null, removeLocalStorageObject: vi.fn(), getMyTabId: vi.fn(), getAiUserCommands: vi.fn(), restoreTabSessionOnStartup: vi.fn(), manifest: {}, getLineNumber: () => 0, laiFetchStyles: () => [], console, setTimeout, showMessage: vi.fn(), closeQuickPromptListMenu: vi.fn(), closeAllDropDownRibbonMenus: vi.fn(), getSideBar: () => null };
  const optional = ['highlightElementOverDecoration', 'restoreElementDecoration'].filter(n => code.includes(`function ${n}(`)).map(extract).join('\n');
  const track = code.includes('const highlightedElements =') ? 'const highlightedElements = new Map();' : '';
  const api = new Function('deps', `with (deps) { let isElementSelectionActive = false; ${track}\n${startup}\n${['attachElementSelectionListenersToFrames', 'updateTabPageContentStorage', 'clearElementOverDecoration', 'clearAllElementDecorations', 'getSelectedClickedElement'].map(extract).join('\n')}\n${optional}\nreturn { start, setActive: value => { isElementSelectionActive = value; } }; }`)(deps);
  await api.start();
  frame.dispatchEvent(new window.Event('load'));
  return { window, document, frame, inside, top: document.getElementById('top'), ...api };
}
const hover = (el, type) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent(type, { bubbles: true }));

describe('element highlight', () => {
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
  it('clears highlights when selection is switched off', () => {
    const main = fs.readFileSync('src/lai-main.js', 'utf8');
    const branch = main.match(/case "toggleSelectElement":[\s\S]*?break;/)[0];
    const clear = vi.fn();
    const run = new Function('response', 'clearAllElementDecorations', `let isElementSelectionActive = true; switch (response.action) { ${branch} } return isElementSelectionActive;`);
    expect(run({ action: 'toggleSelectElement', selection: false }, clear)).toBe(false);
    expect(clear).toHaveBeenCalledOnce();
    run({ action: 'toggleSelectElement', selection: true }, clear);
    expect(clear).toHaveBeenCalledOnce();
  });
});
