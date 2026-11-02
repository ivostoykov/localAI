import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentCode = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf-8');

function sliceFunction(source, name) {
    const start = source.search(new RegExp(`^(async )?function ${name}\\(`, 'm'));
    if (start < 0) { throw new Error(`${name} not found in content.js`); }
    const end = source.indexOf('\n}\n', start);
    return source.slice(start, end + 2);
}

const helperNames = [
    'getDocumentContentFiltered',
    'removeAllExtensionInjectedElements',
    'removeElementsBySelectors',
    'removeHiddenContentFromClone'
];

let filterConfig;
const helpers = new Function(
    'loadFilteringConfig',
    `${helperNames.map(n => sliceFunction(contentCode, n)).join('\n')}\nreturn { ${helperNames.join(', ')} };`
)(async () => filterConfig);

// jsdom has no layout engine and does not resolve content-visibility, so these
// unit tests drive the pairing logic through declared styles. Real computed-style
// behaviour is checked separately in a browser.
function declaredStyle(el) {
    const declared = Object.fromEntries((el.getAttribute('data-style') || '')
        .split(';').map(p => p.split(':').map(s => s.trim())).filter(([k]) => k));
    let visibility = 'visible';
    for (let node = el; node; node = node.parentElement) {
        const own = node.getAttribute?.('data-style')?.match(/(?:^|;)\s*visibility:\s*(\w+)/)?.[1];
        if (own) { visibility = own; break; }
    }
    return {
        display: declared.display || 'block',
        visibility,
        contentVisibility: declared['content-visibility'] || 'visible'
    };
}

function filterClone(html) {
    document.body.innerHTML = html;
    const clone = document.body.cloneNode(true);
    helpers.removeHiddenContentFromClone(document.body, clone, declaredStyle);
    return clone;
}

function words(node) {
    return node.textContent.split(/\s+/).filter(Boolean);
}

describe('removeHiddenContentFromClone', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('removes display:none subtrees including descendants that declare visibility', () => {
        const clone = filterClone(`
            <p>Shown</p>
            <div data-style="display:none">Gone <span data-style="visibility:visible">AlsoGone</span></div>`);
        expect(words(clone)).toEqual(['Shown']);
    });

    it('drops inherited visibility:hidden text but keeps visible descendants', () => {
        const clone = filterClone(`
            <div data-style="visibility:hidden">Hidden
                <p>InheritedHidden</p>
                <p data-style="visibility:visible">Override</p>
            </div>
            <div data-style="visibility:collapse">Collapsed</div>`);
        expect(words(clone)).toEqual(['Override']);
        expect(clone.querySelector('[data-style="visibility:visible"]')).not.toBeNull();
    });

    it('empties content-visibility:hidden elements but keeps the element itself', () => {
        const clone = filterClone(`
            <section id="cv" data-style="content-visibility:hidden"><p>Skipped</p></section>
            <p>Kept</p>`);
        expect(words(clone)).toEqual(['Kept']);
        expect(clone.querySelector('#cv')).not.toBeNull();
    });

    it('keeps children of display:contents wrappers and zero-size elements', () => {
        const clone = filterClone(`
            <div data-style="display:contents"><p>ContentsChild</p></div>
            <div style="width:0;height:0">ZeroSize</div>`);
        expect(words(clone)).toEqual(['ContentsChild', 'ZeroSize']);
    });

    it('keeps sibling pairing aligned across comments and removed nodes', () => {
        const clone = filterClone(`
            <!-- note --><span data-style="display:none">A</span>B<span>C</span><!-- x --><span data-style="display:none">D</span><span>E</span>`);
        expect(clone.textContent.replace(/\s+/g, '')).toBe('BCE');
    });

    it('does not mutate the live DOM', () => {
        document.body.innerHTML = '<div data-style="display:none">Live</div><p data-style="visibility:hidden">Live2</p>';
        const before = document.body.innerHTML;
        helpers.removeHiddenContentFromClone(document.body, document.body.cloneNode(true), declaredStyle);
        expect(document.body.innerHTML).toBe(before);
    });

    it('uses real computed styles from the live DOM by default', () => {
        document.body.innerHTML = `
            <div style="display:none">InlineNone</div>
            <div style="visibility:hidden">Hidden<span style="visibility:visible">Visible</span></div>
            <p>Plain</p>`;
        const clone = document.body.cloneNode(true);
        helpers.removeHiddenContentFromClone(document.body, clone);
        expect(words(clone)).toEqual(['Visible', 'Plain']);
    });

    it('tolerates missing roots', () => {
        expect(() => helpers.removeHiddenContentFromClone(null, null)).not.toThrow();
    });
});

describe('removeAllExtensionInjectedElements', () => {
    it('keeps ordinary hyphenated custom elements and their light DOM', () => {
        const root = document.createElement('div');
        root.innerHTML = `
            <shreddit-post><p>Post body</p></shreddit-post>
            <my-card title="x">Card text</my-card>`;
        helpers.removeAllExtensionInjectedElements(root);
        expect(words(root)).toEqual(['Post', 'body', 'Card', 'text']);
    });

    it('removes the extension host and elements carrying extension resource URLs', () => {
        const root = document.createElement('div');
        root.innerHTML = `
            <local-ai>Sidebar</local-ai>
            <img src="chrome-extension://abc/icon.png">
            <div data-x="moz-extension://abc/x">Injected</div>
            <p>Page</p>`;
        helpers.removeAllExtensionInjectedElements(root);
        expect(root.querySelector('local-ai, img')).toBeNull();
        expect(words(root)).toEqual(['Page']);
    });
});

describe('getDocumentContentFiltered', () => {
    beforeEach(() => {
        filterConfig = { enabled: true, selectors: ['.ad'] };
    });

    it('removes hidden content, user-selected elements and extension elements without touching the page', async () => {
        document.body.innerHTML = `
            <main>
                <p>Article</p>
                <div style="display:none">HiddenNotice</div>
                <div class="ad">Advert</div>
                <x-widget>WidgetText</x-widget>
            </main>`;
        const before = document.body.innerHTML;
        const filtered = await helpers.getDocumentContentFiltered();
        expect(words(filtered)).toEqual(['Article', 'WidgetText']);
        expect(document.body.innerHTML).toBe(before);
    });

    it('still removes hidden content when selector filtering is disabled', async () => {
        filterConfig = { enabled: false, selectors: [] };
        document.body.innerHTML = '<p>Visible</p><p style="display:none">Hidden</p>';
        const filtered = await helpers.getDocumentContentFiltered();
        expect(words(filtered)).toEqual(['Visible']);
    });
});
