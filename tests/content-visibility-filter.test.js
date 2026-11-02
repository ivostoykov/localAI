import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentCode = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf-8');
const ceCode = fs.readFileSync(path.join(__dirname, '../src/jslib/content-extractor.js'), 'utf-8');

function sliceConst(source, name) {
    const match = source.match(new RegExp(`^const ${name} = .*;$`, 'm'));
    if (!match) { throw new Error(`${name} not found in content.js`); }
    return match[0];
}

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
    'removeHiddenContentFromClone',
    'hasVisibleText',
    'getARIAContext'
];

let filterConfig;
const helpers = new Function(
    'loadFilteringConfig',
    `${sliceConst(contentCode, 'HIDDEN_ELEMENT_TEXT_ATTRIBUTES')}\n${helperNames.map(n => sliceFunction(contentCode, n)).join('\n')}\nreturn { ${helperNames.join(', ')} };`
)(async () => filterConfig);

const extractor = new Function(
    'getDocumentContentFiltered', 'hasVisibleText', 'getARIAContext',
    `${ceCode}\nreturn { getEnhancedPageContent };`
)(helpers.getDocumentContentFiltered, helpers.hasVisibleText, helpers.getARIAContext);

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
        document.body.removeAttribute('data-style');
        document.body.removeAttribute('title');
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

    it('keeps children of content-visibility:hidden hosts that are display:contents or inline', () => {
        const clone = filterClone(`
            <div data-style="display:contents;content-visibility:hidden"><p>ContentsChild</p></div>
            <span data-style="display:inline;content-visibility:hidden">InlineText <b>InlineChild</b></span>
            <span id="block" data-style="display:block;content-visibility:hidden">Skipped</span>
            <span id="atomic" data-style="display:inline-block;content-visibility:hidden">AlsoSkipped</span>`);
        expect(words(clone)).toEqual(['ContentsChild', 'InlineText', 'InlineChild']);
        expect(clone.querySelector('#block')).not.toBeNull();
        expect(clone.querySelector('#atomic')).not.toBeNull();
    });

    it('strips text-bearing attributes from visibility:hidden elements but not from visible overrides', () => {
        const clone = filterClone(`
            <div id="hidden" data-style="visibility:hidden" title="HiddenTitle" aria-label="HiddenLabel">
                <img id="hidden-img" alt="HiddenAlt" title="HiddenImgTitle" aria-describedby="x" aria-labelledby="y" aria-description="d" src="a.png">
                <img id="shown-img" data-style="visibility:visible" alt="ShownAlt" title="ShownTitle" src="b.png">
            </div>`);
        for (const id of ['hidden', 'hidden-img']) {
            const el = clone.querySelector(`#${id}`);
            for (const attr of ['alt', 'title', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-description']) {
                expect(el.hasAttribute(attr), `${id} ${attr}`).toBe(false);
            }
        }
        expect(clone.querySelector('#hidden-img').getAttribute('src')).toBe('a.png');
        expect(clone.querySelector('#shown-img').getAttribute('alt')).toBe('ShownAlt');
        expect(clone.querySelector('#shown-img').getAttribute('title')).toBe('ShownTitle');
    });

    it.each([
        ['display:none'],
        ['content-visibility:hidden'],
        ['visibility:hidden']
    ])('applies %s set on the root itself without mutating the live root', (rootStyle) => {
        document.body.innerHTML = '<p>Text</p><img alt="RootAlt" src="a.png">';
        document.body.setAttribute('data-style', rootStyle);
        document.body.setAttribute('title', 'RootTitle');
        const before = document.body.outerHTML;
        const clone = document.body.cloneNode(true);
        helpers.removeHiddenContentFromClone(document.body, clone, declaredStyle);
        expect(words(clone)).toEqual([]);
        expect(clone.hasAttribute('title')).toBe(rootStyle !== 'visibility:hidden');
        expect(clone.querySelector('img')?.getAttribute('alt') ?? null).toBeNull();
        expect(document.body.outerHTML).toBe(before);
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

    it('keeps hidden image alt text out of enhanced extraction', async () => {
        document.body.innerHTML = `
            <main>
                <h1>Title</h1>
                <p>Body text</p>
                <div style="visibility:hidden"><img alt="HiddenAltText" src="hidden.png"></div>
                <img alt="VisibleAltText" src="shown.png">
            </main>`;
        const out = await extractor.getEnhancedPageContent();
        expect(out).toContain('VisibleAltText');
        expect(out).not.toContain('HiddenAltText');
        expect(document.querySelector('img[alt="HiddenAltText"]')).not.toBeNull();
    });

    it('still removes hidden content when selector filtering is disabled', async () => {
        filterConfig = { enabled: false, selectors: [] };
        document.body.innerHTML = '<p>Visible</p><p style="display:none">Hidden</p>';
        const filtered = await helpers.getDocumentContentFiltered();
        expect(words(filtered)).toEqual(['Visible']);
    });
});
