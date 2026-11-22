import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const laiMainCode = fs.readFileSync(
    path.join(__dirname, '../src/lai-main.js'),
    'utf-8'
);

const executeLaiMainCode = new Function(
    'document',
    'manifest',
    'getLineNumber',
    'chrome',
    'getShadowRoot',
    'commandPlaceholders',
    laiMainCode + '; return { showHelp, laiHandleStreamActions };'
);

function setup({ placeholders = {} } = {}) {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div id="laiSidebar">
            <textarea id="laiUserInput"></textarea>
            <button id="laiAbort"></button>
        </div>
        <template id="helpTemplate">
            <div id="helpPopup">
                <button class="help-close-btn"></button>
                <ul></ul>
            </div>
        </template>
    </body></html>`);
    const { document } = dom.window;
    const chrome = { runtime: { sendMessage: () => Promise.resolve() } };
    const exports = executeLaiMainCode(
        document,
        { name: 'Local AI helper' },
        () => 'test:1',
        chrome,
        () => document,
        placeholders
    );

    return { document, ...exports };
}

describe('showHelp rendering (#101)', () => {
    it('renders help entries with a bold command name and plain description', () => {
        const { document, showHelp } = setup({ placeholders: { '/help': 'Show this help' } });

        showHelp();

        const item = document.querySelector('#helpPopup li');
        expect(item.firstElementChild.tagName).toBe('STRONG');
        expect(item.querySelector('strong').textContent).toBe('/help');
        expect(item.textContent).toBe('/help: Show this help');
    });

    it('keeps markup in a help entry as literal text', () => {
        const name = '/he<img src="missing.png" onerror="globalThis.__helpMarkupRan = true">lp';
        const description = 'Text <b>bold</b> <script>globalThis.__helpMarkupRan = true</script>';
        globalThis.__helpMarkupRan = false;
        const { document, showHelp } = setup({ placeholders: { [name]: description } });

        showHelp();

        const item = document.querySelector('#helpPopup li');
        expect(item.textContent).toBe(`${name}: ${description}`);
        expect(item.querySelector('strong').textContent).toBe(name);
        expect(item.querySelectorAll('img, script')).toHaveLength(0);
        expect(item.querySelectorAll('b')).toHaveLength(0);
        expect(globalThis.__helpMarkupRan).toBe(false);
        delete globalThis.__helpMarkupRan;
    });

    it('keeps the click interaction that inserts the command into the prompt', () => {
        const { document, showHelp } = setup({ placeholders: { '/help': 'Show this help' } });
        document.getElementById('laiUserInput').value = 'prefix';

        showHelp();
        document.querySelector('#helpPopup li').click();

        expect(document.getElementById('laiUserInput').value).toBe('prefix /help');
    });
});

describe('abort marker rendering (#101)', () => {
    it('renders the ordinary abort marker as an element with text', () => {
        const { document, laiHandleStreamActions } = setup();
        const recipient = document.createElement('span');

        laiHandleStreamActions('Stream Aborted', recipient, '... Aborted');

        const marker = recipient.querySelector('.lai-aborted-text');
        expect(marker.tagName).toBe('SPAN');
        expect(marker.textContent).toBe('... Aborted');
    });

    it('keeps abort text markup literal and does not duplicate the marker', () => {
        const { document, laiHandleStreamActions } = setup();
        const recipient = document.createElement('span');
        const abortText = '... Aborted <img src="missing.png" onerror="globalThis.__abortMarkupRan = true">';
        globalThis.__abortMarkupRan = false;

        laiHandleStreamActions('Stream Aborted', recipient, abortText);
        laiHandleStreamActions('Stream Aborted', recipient, abortText);

        const markers = recipient.querySelectorAll('.lai-aborted-text');
        expect(markers).toHaveLength(1);
        expect(markers[0].textContent).toBe(abortText);
        expect(markers[0].children).toHaveLength(0);
        expect(recipient.querySelector('img')).toBeNull();
        expect(globalThis.__abortMarkupRan).toBe(false);
        delete globalThis.__abortMarkupRan;
    });
});
