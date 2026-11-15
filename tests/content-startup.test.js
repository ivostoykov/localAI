import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import { JSDOM } from 'jsdom';

const code = fs.readFileSync('src/content.js', 'utf8');
const startup = code.slice(code.indexOf('let startRetry'), code.indexOf('\nasync function restoreTabSessionOnStartup'));
const storage = code.match(/async function updateTabPageContentStorage\(\) \{[\s\S]*?\n\}/)[0];

function setup(ready = 'complete') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.com' });
  const { window } = dom;
  const { document } = window;
  Object.defineProperty(document, 'readyState', { configurable: true, value: ready });
  const listeners = vi.spyOn(document, 'addEventListener');
  const build = vi.fn(() => { const host = document.createElement('local-ai'); host.id = 'localAI'; host.attachShadow({ mode: 'open' }); document.documentElement.appendChild(host); });
  const deps = { document, window, history: window.history, Event: window.Event, getShadowRoot: () => document.getElementById('localAI')?.shadowRoot, attachElementSelectionListenersToFrames: vi.fn(), clearElementOverDecoration: vi.fn(), highlightElementOverDecoration: vi.fn(), removeLocalStorageObject: vi.fn(), getMyTabId: vi.fn(), getAiUserCommands: vi.fn(), restoreTabSessionOnStartup: build, manifest: {}, getLineNumber: () => 0, laiFetchStyles: () => [], console, setTimeout };
  const start = new Function('deps', `with (deps) { ${startup}\n${storage}\nreturn start; }`)(deps);
  return { window, document, listeners, build, start };
}

const count = spy => ['click', 'keydown', 'mouseover', 'mouseout'].map(type => spy.mock.calls.filter(call => call[0] === type).length);

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
});
