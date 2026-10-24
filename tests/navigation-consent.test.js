import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf-8');
const consentHtml = read('src/navigation-consent.html');
const consentCode = read('src/navigation-consent.js');

// jsdom cannot create trusted events, so interaction tests can opt into treating dispatched events as user input.
// The script is evaluated after the document has loaded, so its DOMContentLoaded hook stays idle and tests call init themselves.
async function loadConsentPage({ trustEvents = false, response = { status: 'ok', url: 'https://example.com/jobs/<img src=x onerror=alert(1)>' } } = {}) {
    const dom = new JSDOM(consentHtml, { url: 'chrome-extension://test-extension/navigation-consent.html?requestId=req-1' });
    const { window } = dom;
    if (window.document.readyState !== 'complete') {
        await new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
    }
    window.close = vi.fn();
    const chrome = {
        runtime: {
            sendMessage: vi.fn(async (message) => (message.action === 'getNavigationConsentRequest' ? response : { status: 'ok' }))
        }
    };
    const override = trustEvents ? 'function isTrustedUserEvent() { return true; }\n' : '';
    const api = new Function('document', 'location', 'chrome', 'window', 'URLSearchParams',
        `${consentCode}\n${override}return { initNavigationConsent };`
    )(window.document, window.location, chrome, window, window.URLSearchParams);
    return { window, document: window.document, chrome, init: api.initNavigationConsent };
}

const responses = (chrome) => chrome.runtime.sendMessage.mock.calls
    .map(([message]) => message)
    .filter(message => message.action === 'navigationConsentResponse');

const key = (window, target, keyName) => {
    const event = new window.KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
};

const INPUT_DELAY_MS = 750;

// Loads the page, initialises it and waits past the input delay so it accepts answers.
async function openReadyConsentPage(options) {
    const page = await loadConsentPage(options);
    await page.init();
    await vi.advanceTimersByTimeAsync(INPUT_DELAY_MS);
    return page;
}

describe('navigation-consent page', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('loads the request for its own request id and renders the URL as text', async () => {
        const { document, chrome } = await openReadyConsentPage();

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'getNavigationConsentRequest', requestId: 'req-1' });
        const urlEl = document.getElementById('consentUrl');
        expect(urlEl.textContent).toBe('https://example.com/jobs/<img src=x onerror=alert(1)>');
        expect(urlEl.children).toHaveLength(0);
        expect(document.getElementById('consentNote').textContent).toMatch(/"Allow" also turns on "Allow navigation"/);
        expect([...document.querySelectorAll('#consentButtons button')].map(b => b.textContent)).toEqual(['Allow', 'Allow only this time', 'Cancel']);
        expect(document.activeElement?.id).toBe('consentOnce');
    });

    it('shows an error and no choices when the background rejects the request', async () => {
        const { document, chrome } = await openReadyConsentPage({ response: { status: 'rejected' } });

        expect(document.getElementById('consentError').classList.contains('invisible')).toBe(false);
        expect(document.getElementById('consentButtons').classList.contains('invisible')).toBe(true);
        document.getElementById('consentAllow').click();
        expect(responses(chrome)).toHaveLength(0);
    });

    it('ignores scripted clicks and key presses', async () => {
        const { window, document, chrome } = await openReadyConsentPage();

        document.getElementById('consentAllow').click();
        key(window, document.body, 'Enter');
        key(window, document.body, 'Escape');

        expect(responses(chrome)).toHaveLength(0);
        expect(window.close).not.toHaveBeenCalled();
    });

    describe('with user input', () => {
        it('ignores input until the window has been shown for a moment', async () => {
            const { window, document, chrome, init } = await loadConsentPage({ trustEvents: true });
            await init();

            expect([...document.querySelectorAll('#consentButtons button')].every(b => b.disabled)).toBe(true);
            expect(document.getElementById('consentWait').classList.contains('invisible')).toBe(false);
            key(window, document.body, 'Enter');
            document.getElementById('consentAllow').click();
            await vi.advanceTimersByTimeAsync(INPUT_DELAY_MS - 50);
            key(window, document.body, 'Enter');
            expect(responses(chrome)).toHaveLength(0);

            await vi.advanceTimersByTimeAsync(50);
            expect(document.activeElement?.id).toBe('consentOnce');
            expect(document.getElementById('consentWait').classList.contains('invisible')).toBe(true);
            key(window, document.body, 'Escape');
            await vi.advanceTimersByTimeAsync(0);
            expect(responses(chrome).map(r => r.choice)).toEqual(['cancel']);
        });

        it('ignores input again for a moment after the window regains focus', async () => {
            const { window, document, chrome } = await openReadyConsentPage({ trustEvents: true });

            window.dispatchEvent(new window.Event('focus'));
            key(window, document.body, 'Enter');
            expect(responses(chrome)).toHaveLength(0);
            expect(document.getElementById('consentWait').classList.contains('invisible')).toBe(false);

            await vi.advanceTimersByTimeAsync(INPUT_DELAY_MS);
            key(window, document.body, 'Enter');
            await vi.advanceTimersByTimeAsync(0);
            expect(responses(chrome).map(r => r.choice)).toEqual(['once']);
        });

        it.each([
            ['consentAllow', 'allow'],
            ['consentOnce', 'once'],
            ['consentCancel', 'cancel']
        ])('%s answers %s once and closes the window', async (id, choice) => {
            const { window, document, chrome } = await openReadyConsentPage({ trustEvents: true });

            document.getElementById(id).click();
            document.getElementById('consentAllow').click();
            await vi.advanceTimersByTimeAsync(0);

            expect(window.close).toHaveBeenCalled();
            expect(responses(chrome)).toEqual([{ action: 'navigationConsentResponse', requestId: 'req-1', choice }]);
            expect([...document.querySelectorAll('#consentButtons button')].every(b => b.disabled)).toBe(true);
        });

        it('Escape cancels even when focus has left the controls', async () => {
            const { window, document, chrome } = await openReadyConsentPage({ trustEvents: true });
            document.activeElement.blur();

            key(window, document.body, 'Escape');
            await vi.advanceTimersByTimeAsync(0);

            expect(responses(chrome)).toEqual([{ action: 'navigationConsentResponse', requestId: 'req-1', choice: 'cancel' }]);
        });

        it('Enter outside a button chooses allow once', async () => {
            const { window, document, chrome } = await openReadyConsentPage({ trustEvents: true });

            key(window, document.getElementById('consentUrl'), 'Enter');
            await vi.advanceTimersByTimeAsync(0);

            expect(responses(chrome)[0]?.choice).toBe('once');
        });

        it('leaves Enter on an explicitly focused button to the button', async () => {
            const { window, document, chrome } = await openReadyConsentPage({ trustEvents: true });
            const cancel = document.getElementById('consentCancel');
            cancel.focus();

            const event = key(window, cancel, 'Enter');

            expect(event.defaultPrevented).toBe(false);
            expect(responses(chrome)).toHaveLength(0);
        });
    });

    it('sends keep-alive messages while waiting and stops after answering', async () => {
        const { document, chrome } = await openReadyConsentPage({ trustEvents: true });

        await vi.advanceTimersByTimeAsync(31000 - INPUT_DELAY_MS);
        const keepAlives = () => chrome.runtime.sendMessage.mock.calls.filter(([m]) => m.action === 'navigationConsentKeepAlive');
        expect(keepAlives()).toHaveLength(2);
        expect(keepAlives()[0][0]).toEqual({ action: 'navigationConsentKeepAlive', requestId: 'req-1' });

        document.getElementById('consentCancel').click();
        await vi.advanceTimersByTimeAsync(31000);
        expect(keepAlives()).toHaveLength(2);
    });

    it('is not web accessible in any manifest', () => {
        for (const file of ['src/manifest.json', 'Chrome/manifest.json', 'Firefox/manifest.json']) {
            const manifest = JSON.parse(read(file));
            const resources = (manifest.web_accessible_resources || []).flatMap(entry => entry.resources || []);
            expect(resources.some(r => /navigation-consent|^\*$|^\*\.html$/.test(r)), file).toBe(false);
        }
    });
});
