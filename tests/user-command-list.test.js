import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ribbonCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/ribbon.js'),
    'utf-8'
);

const executeRibbonCode = new Function(
    'document',
    'chrome',
    'manifest',
    'getLineNumber',
    'getShadowRoot',
    'checkExtensionState',
    'userPredefinedCmd',
    'aiUserCommands',
    'userCmdItemBtns',
    ribbonCode + '; return { popUserCommandList };'
);

function setupCommandList({ predefined = [], user = [] } = {}) {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div id="commandListContainer" class="invisible">
            <button id="cmdListClose"></button>
            <button id="cmdListNew"></button>
            <button id="cmdImport"></button>
            <button id="cmdExport"></button>
            <div class="user-command-block"></div>
        </div>
    </body></html>`);
    const { document } = dom.window;
    const chrome = {
        runtime: { getURL: p => `chrome-extension://test/${p}` },
        storage: { onChanged: { addListener() {} } }
    };
    const { popUserCommandList } = executeRibbonCode(
        document,
        chrome,
        { name: 'Local AI helper' },
        () => 'test:1',
        () => document,
        () => true,
        predefined,
        user,
        { edit: null, execute: null, paste: null, delete: null }
    );

    popUserCommandList(null);

    return document.querySelectorAll('.user-command-item');
}

describe('user command list rendering (#101)', () => {
    it('renders the bold name and description for ordinary commands', () => {
        const entries = setupCommandList({ user: [{ commandName: 'summary', commandDescription: 'Summarise the page' }] });

        expect(entries).toHaveLength(1);
        const entry = entries[0].querySelector('.user-cmd-item-command');
        expect(entry.firstElementChild.tagName).toBe('B');
        expect(entry.querySelector('b').textContent).toBe('/summary');
        expect(entry.textContent).toBe('/summary - Summarise the page');
    });

    it('falls back to the default description', () => {
        const entries = setupCommandList({ user: [{ commandName: 'summary' }] });

        expect(entries[0].querySelector('.user-cmd-item-command').textContent)
            .toBe('/summary - No description provided.');
    });

    it('keeps markup in an imported name and description as literal text', () => {
        globalThis.__commandMarkupRan = false;
        const name = '/sum<img src="missing.png" onerror="globalThis.__commandMarkupRan = true">mary';
        const description = 'Desc <b>bold</b> <script>globalThis.__commandMarkupRan = true</script>';

        const entries = setupCommandList({ user: [{ commandName: name, commandDescription: description }] });

        const entry = entries[0].querySelector('.user-cmd-item-command');
        expect(entry.textContent).toBe(`/${name} - ${description}`);
        expect(entry.querySelectorAll('img, script, b')).toHaveLength(1);
        expect(entry.querySelector('b').textContent).toBe(`/${name}`);
        expect(entry.querySelector('img')).toBeNull();
        expect(entry.querySelector('script')).toBeNull();
        expect(globalThis.__commandMarkupRan).toBe(false);
        delete globalThis.__commandMarkupRan;
    });
});
