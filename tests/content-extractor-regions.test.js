import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ceCode = fs.readFileSync(path.join(__dirname, '../src/jslib/content-extractor.js'), 'utf-8');

function getDocumentContentFiltered() {
    return document.body.cloneNode(true);
}

function hasVisibleText(node) {
    return /\S/.test(node?.nodeValue || '');
}

function getARIAContext() {
    return '';
}

const ce = new Function(
    'getDocumentContentFiltered', 'hasVisibleText', 'getARIAContext',
    `${ceCode}\nreturn { getEnhancedPageContent, getMainContentOnly };`
)(getDocumentContentFiltered, hasVisibleText, getARIAContext);

const longText = 'Long reply sentence with enough words to dominate scoring. '.repeat(40);

// Synthetic layout-table thread: no main/article, each comment wrapped in its own
// single-row table, one comment much longer than the others.
function layoutTableThread(comments) {
    const rows = comments.map((text, i) => `
        <tr class="row"><td>
            <table><tr>
                <td class="indent"></td>
                <td><span class="author">user${i}</span><div class="comment"><div class="text">${text}</div></div></td>
            </tr></table>
        </td></tr>`).join('');
    return `
        <center><table id="outer">
            <tr><td><span class="nav">Site name | new | threads</span></td></tr>
            <tr><td><table class="story"><tr><td><span class="title">Story title marker</span></td></tr></table></td></tr>
            <tr><td><table class="thread">${rows}</table></td></tr>
        </table></center>`;
}

const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

describe('generic extraction keeps every content region', () => {
    beforeEach(() => {
        document.head.innerHTML = '<title>Synthetic thread</title>';
    });

    it('keeps all sibling comments when one comment dominates the heuristic score', async () => {
        const comments = ['Short comment alpha marker.', `Beta marker. ${longText}`, 'Short comment gamma marker.', 'Short comment delta marker.'];
        document.body.innerHTML = layoutTableThread(comments);

        const out = await ce.getEnhancedPageContent();

        for (const marker of ['alpha marker', 'Beta marker', 'gamma marker', 'delta marker', 'Story title marker']) {
            expect(out).toContain(marker);
        }
    });

    it('does not render layout tables as Markdown tables or duplicate nested content', async () => {
        const comments = ['Short comment alpha marker.', `Beta marker. ${longText}`, 'Short comment gamma marker.'];
        document.body.innerHTML = layoutTableThread(comments);

        const out = await ce.getEnhancedPageContent();

        expect(out.split('\n').filter(line => line.trim().startsWith('|'))).toHaveLength(0);
        expect(occurrences(out, 'alpha marker')).toBe(1);
        expect(occurrences(out, 'Story title marker')).toBe(1);
    });

    it('keeps every sibling article, not only the first', async () => {
        document.body.innerHTML = `
            <div class="listing">
                <article><h2>First article marker</h2><p>${'First body. '.repeat(20)}</p></article>
                <article><h2>Second article marker</h2><p>${'Second body. '.repeat(20)}</p></article>
                <article><h2>Third article marker</h2><p>${'Third body. '.repeat(20)}</p></article>
            </div>`;

        const out = await ce.getEnhancedPageContent();

        expect(out).toContain('First article marker');
        expect(out).toContain('Second article marker');
        expect(out).toContain('Third article marker');
    });

    it('still renders a genuine data table as a Markdown table', async () => {
        document.body.innerHTML = `
            <main>
                <h1>Prices</h1>
                <table>
                    <thead><tr><th>Item</th><th>Price</th></tr></thead>
                    <tbody><tr><td>Tea</td><td>2</td></tr><tr><td>Coffee</td><td>3</td></tr></tbody>
                </table>
            </main>`;

        const out = await ce.getEnhancedPageContent();

        expect(out).toMatch(/\|\s*Item\s*\|\s*Price\s*\|/);
        expect(out).toMatch(/\|\s*Coffee\s*\|\s*3\s*\|/);
    });

    // Known limitation: unheaded tables of 10 cells or fewer are treated as layout and read as text.
    it('reads an unheaded table of 10 cells as text and one of 11 or more cells as a Markdown table', async () => {
        const unheaded = (rows, columns) => '<table>' + Array.from({ length: rows }, (_, r) =>
            '<tr>' + Array.from({ length: columns }, (_, c) => `<td>cell ${r}-${c}</td>`).join('') + '</tr>').join('') + '</table>';

        document.body.innerHTML = `<main>${unheaded(5, 2)}</main>`;
        const small = await ce.getEnhancedPageContent();
        expect(small).toContain('cell 4-1');
        expect(small).not.toMatch(/\|\s*cell 0-0\s*\|/);

        document.body.innerHTML = `<main>${unheaded(4, 3)}</main>`;
        const large = await ce.getEnhancedPageContent();
        expect(large).toMatch(/\|\s*cell 0-0\s*\|\s*cell 0-1\s*\|\s*cell 0-2\s*\|/);
    });

    it('main-content tool falls back to the whole page with an explicit scope note', async () => {
        const comments = ['Short comment alpha marker.', `Beta marker. ${longText}`, 'Short comment gamma marker.'];
        document.body.innerHTML = layoutTableThread(comments);

        const out = await ce.getMainContentOnly();

        expect(out).toMatch(/^CONTENT SCOPE: whole page/);
        expect(out).toContain('alpha marker');
        expect(out).toContain('gamma marker');
        expect(out).not.toContain('Could not detect');
    });

    it('main-content tool keeps a detected region without a scope note', async () => {
        document.body.innerHTML = '<nav>Navigation marker</nav><main><p>Main body marker.</p></main>';

        const out = await ce.getMainContentOnly();

        expect(out).not.toContain('CONTENT SCOPE');
        expect(out).toContain('Main body marker');
        expect(out).not.toContain('Navigation marker');
    });

    it('main-content tool reports whole-page scope when regions only share the cleaned root', async () => {
        document.body.innerHTML = `
            <nav>Navigation marker</nav>
            <article><p>First article marker.</p></article>
            <article><p>Second article marker.</p></article>
            <footer>Footer marker</footer>`;

        const out = await ce.getMainContentOnly();

        expect(out).toMatch(/^CONTENT SCOPE: whole page/);
        expect(out).toContain('First article marker');
        expect(out).toContain('Second article marker');
    });

    it('main-content tool keeps sibling articles inside a shared wrapper without a scope note', async () => {
        document.body.innerHTML = `
            <nav>Navigation marker</nav>
            <div class="feed"><article><p>First article marker.</p></article><article><p>Second article marker.</p></article></div>
            <footer>Footer marker</footer>`;

        const out = await ce.getMainContentOnly();

        expect(out).not.toContain('CONTENT SCOPE');
        expect(out).toContain('First article marker');
        expect(out).toContain('Second article marker');
        expect(out).not.toContain('Navigation marker');
        expect(out).not.toContain('Footer marker');
    });

    it('does not lose a region when the cleaned root itself matches the selector', async () => {
        document.body.className = 'post-content';
        document.body.innerHTML = `
            <div class="site-nav">Navigation marker</div>
            <div class="post-content"><p>Post body marker.</p></div>`;

        const out = await ce.getEnhancedPageContent();
        document.body.className = '';

        expect(out).toContain('Post body marker');
        expect(out).not.toContain('Navigation marker');
    });

    it('prefers role=main over articles outside it', async () => {
        document.body.innerHTML = `
            <aside><article><p>Sidebar article marker.</p></article></aside>
            <div role="main">
                <p>Main intro marker.</p>
                <article><p>Main article marker.</p></article>
            </div>`;

        const out = await ce.getEnhancedPageContent();

        expect(out).toContain('Main intro marker');
        expect(out).toContain('Main article marker');
        expect(out).not.toContain('Sidebar article marker');
    });

    it('keeps a single dominant main region (intentional scope filtering)', async () => {
        document.body.innerHTML = `
            <nav>Navigation marker</nav>
            <main><h1>Main heading marker</h1><p>${'Main body. '.repeat(30)}</p></main>
            <footer>Footer marker</footer>`;

        const out = await ce.getEnhancedPageContent();

        expect(out).toContain('Main heading marker');
        expect(out).not.toContain('Navigation marker');
        expect(out).not.toContain('Footer marker');
    });
});

describe('nested list extraction', () => {
    beforeEach(() => {
        document.head.innerHTML = '<title>Nested lists</title>';
    });

    it('keeps a second sibling nested list inside one list item', async () => {
        document.body.innerHTML = '<main><ul><li>Parent<ul><li>First marker</li></ul><ol><li>Second marker</li></ol></li></ul></main>';

        const out = await ce.getEnhancedPageContent();

        expect(occurrences(out, 'First marker')).toBe(1);
        expect(occurrences(out, 'Second marker')).toBe(1);
    });

    it('keeps a nested list wrapped in another element', async () => {
        document.body.innerHTML = '<main><ul><li>Parent<div><ul><li>Wrapped marker</li></ul></div><ul><li>First marker</li></ul><ol><li>Second marker</li></ol></li></ul></main>';

        const out = await ce.getEnhancedPageContent();

        for (const marker of ['Parent', 'Wrapped marker', 'First marker', 'Second marker']) {
            expect(occurrences(out, marker)).toBe(1);
        }
    });

    it('keeps a wrapped list nested inside a deeper list item', async () => {
        document.body.innerHTML = '<main><ul><li>Outer marker<ul><li>Middle marker<div><ul><li>Deep marker</li></ul></div></li></ul></li></ul></main>';

        const out = await ce.getEnhancedPageContent();

        for (const marker of ['Outer marker', 'Middle marker', 'Deep marker']) {
            expect(occurrences(out, marker)).toBe(1);
        }
        expect(out).toMatch(/^    - Deep marker$/m);
    });

    it('emits ordinary multi-level nesting once, without duplicates', async () => {
        document.body.innerHTML = '<main><ul><li>Level one marker<ul><li>Level two marker<ul><li>Level three marker</li></ul></li></ul></li><li>Sibling marker</li></ul></main>';

        const out = await ce.getEnhancedPageContent();

        for (const marker of ['Level one marker', 'Level two marker', 'Level three marker', 'Sibling marker']) {
            expect(occurrences(out, marker)).toBe(1);
        }
        expect(out).toMatch(/^- Level one marker$/m);
        expect(out).toMatch(/^  - Level two marker$/m);
        expect(out).toMatch(/^    - Level three marker$/m);
    });
});
