import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import { JSDOM } from 'jsdom';

const code = fs.readFileSync('src/content.js', 'utf8');
const startup = code.slice(code.indexOf('let startRetry'), code.indexOf('\nasync function restoreTabSessionOnStartup'));
const storage = code.match(/async function updateTabPageContentStorage\(\) \{[\s\S]*?\n\}/)[0];
const contextMenuHandler = code.match(/function rememberContextMenuImageTarget\(event\) \{[\s\S]*?\n\}/)[0];

function setup(ready = 'complete') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.com' });
  const { window } = dom;
  const { document } = window;
  Object.defineProperty(document, 'readyState', { configurable: true, value: ready });
  const listeners = vi.spyOn(document, 'addEventListener');
  const rootAccessors = code.slice(code.indexOf('let sidebarRoot;'), code.indexOf('function getSideBar()'));
  const init = code.slice(code.indexOf('async function init()'), code.indexOf('async function getDocumentContentFiltered()'));
  const { getRootElement, getShadowRoot, build } = new Function('deps',
    `with (deps) { ${rootAccessors}
${init}; return { getRootElement, getShadowRoot, build: init }; }`)({
      document, chrome: { runtime: { id: 'test' } }, buildMainButton: vi.fn(),
      laiFetchAndBuildSidebarContent: vi.fn(), initSidebar: vi.fn(), laiUpdateMainButtonStyles: vi.fn()
    });
  const buildSidebar = vi.fn(build);
  const deps = { isElementSelectionActive: false, document, window, history: window.history, Event: window.Event, getShadowRoot, getRootElement, closeQuickPromptListMenu: vi.fn(), closeSessionListOnOutsideClick: vi.fn(), closeAllDropDownRibbonMenus: vi.fn(), getSideBar: vi.fn(), getOptions: vi.fn(), isPinned: vi.fn(), laiSwapSidebarWithButton: vi.fn(), clearAllElementDecorations: vi.fn(), attachElementSelectionListenersToFrames: vi.fn(), clearElementOverDecoration: vi.fn(), highlightElementOverDecoration: vi.fn(), removeLocalStorageObject: vi.fn(), getMyTabId: vi.fn(), getAiUserCommands: vi.fn(), restoreTabSessionOnStartup: buildSidebar, manifest: {}, getLineNumber: () => 0, laiFetchStyles: () => [], console, setTimeout };
  const start = new Function('deps', `with (deps) { ${contextMenuHandler}\n${startup}\n${storage}\nreturn start; }`)(deps);
  return { window, document, listeners, build: buildSidebar, start, getShadowRoot, deps };
}

const count = spy => ['click', 'keydown', 'mouseover', 'mouseout', 'contextmenu'].map(type => spy.mock.calls.filter(call => call[0] === type).length);

describe('content start-up', () => {
  it('ignores repeated DOMContentLoaded and start while the UI exists', async () => {
    const { window, document, listeners, build, start } = setup();
    await start();
    const counts = count(listeners);
    const push = vi.fn();
    window.addEventListener('pushstate', push);
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await start();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(count(listeners)).toEqual(counts);
    window.history.pushState({}, '', '/next');
    expect(push).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('keeps the shadow root private and leaves extension clicks to its own handlers', async () => {
    const { window, document, start, getShadowRoot, deps } = setup();
    await start();
    const host = document.querySelector('local-ai');
    expect(Reflect.get(host, 'shadowRoot')).toBeNull();
    const button = document.createElement('button');
    getShadowRoot().appendChild(button);
    const action = vi.fn();
    button.addEventListener('click', action);
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true }));
    expect(action).toHaveBeenCalledOnce();
    expect(deps.closeAllDropDownRibbonMenus).not.toHaveBeenCalled();
    document.body.click();
    expect(deps.closeQuickPromptListMenu).toHaveBeenCalledOnce();
    expect(deps.closeSessionListOnOutsideClick).toHaveBeenCalledOnce();
    expect(deps.closeAllDropDownRibbonMenus).toHaveBeenCalledOnce();
  });

  it.each([
    { closeOnClickOut: true, pinned: false, closes: true },
    { closeOnClickOut: true, pinned: true, closes: false },
    { closeOnClickOut: false, pinned: false, closes: false }
  ])('dismisses page-click menus with closeOnClickOut=$closeOnClickOut and pinned=$pinned', async ({ closeOnClickOut, pinned, closes }) => {
    const { document, start, deps } = setup();
    await start();
    const sidebar = document.createElement('div');
    sidebar.classList.add('active');
    deps.getSideBar.mockReturnValue(sidebar);
    deps.getOptions.mockResolvedValue({ closeOnClickOut });
    deps.isPinned.mockReturnValue(pinned);

    document.body.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(deps.closeQuickPromptListMenu).toHaveBeenCalledOnce();
    expect(deps.closeSessionListOnOutsideClick).toHaveBeenCalledOnce();
    expect(deps.closeAllDropDownRibbonMenus).toHaveBeenCalledOnce();
    if (closes) {
      expect(deps.laiSwapSidebarWithButton).toHaveBeenCalledWith(true);
    } else {
      expect(deps.laiSwapSidebarWithButton).not.toHaveBeenCalled();
    }
  });

  it('rebuilds a missing UI without adding listeners', async () => {
    const { document, listeners, build, start } = setup();
    await start();
    const counts = count(listeners);
    document.getElementById('localAI').remove();
    await start();
    expect(build).toHaveBeenCalledTimes(2);
    expect(count(listeners)).toEqual(counts);
  });

  it('schedules only one retry while loading', async () => {
    vi.useFakeTimers();
    try {
      const { start } = setup('loading');
      await start();
      await start();
      expect(vi.getTimerCount()).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it('registers the capture-phase context menu listener once', async () => {
    const { listeners, start } = setup();
    await start();
    await start();
    const registrations = listeners.mock.calls.filter(call => call[0] === 'contextmenu');
    expect(registrations).toHaveLength(1);
    expect(registrations[0][2]).toBe(true);
  });
});
