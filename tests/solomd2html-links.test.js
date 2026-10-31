import { describe, it, expect, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const solomdCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/solomd2html.js'),
    'utf-8'
);

function loadParser(window) {
    return new Function(
        'document',
        'DocumentFragment',
        'CustomEvent',
        'Node',
        'navigator',
        solomdCode + '; return parseAndRender;'
    )(
        window.document,
        window.DocumentFragment,
        window.CustomEvent,
        window.Node,
        window.navigator
    );
}

async function render(markdown, options = {}) {
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
    const parseAndRender = loadParser(dom.window);
    const root = dom.window.document.getElementById('root');
    await parseAndRender(markdown, root, { streamReply: false, codeCopy: false, ...options });
    return { root, dom };
}

const originalRaf = globalThis.requestAnimationFrame;

afterEach(() => {
    if (originalRaf) {
        globalThis.requestAnimationFrame = originalRaf;
    } else {
        delete globalThis.requestAnimationFrame;
    }
});

describe('renderInline link handling', () => {
    it('keeps an absolute Markdown link intact', async () => {
        const { root } = await render('See [a link](https://example.com/a) now.');

        const anchors = root.querySelectorAll('a');
        expect(anchors).toHaveLength(1);
        expect(anchors[0].getAttribute('href')).toBe('https://example.com/a');
        expect(anchors[0].textContent).toBe('a link');
        expect(anchors[0].getAttribute('target')).toBe('_blank');
        expect(anchors[0].getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('keeps a relative Markdown link intact', async () => {
        const { root } = await render('See [docs](/docs/a) now.');

        const anchor = root.querySelector('a');
        expect(anchor.getAttribute('href')).toBe('/docs/a');
        expect(anchor.textContent).toBe('docs');
    });

    it('keeps an angle autolink intact', async () => {
        const { root } = await render('See <https://example.com/b> now.');

        const anchor = root.querySelector('a');
        expect(anchor.getAttribute('href')).toBe('https://example.com/b');
        expect(anchor.textContent).toBe('https://example.com/b');
    });

    it('keeps a bare URL intact', async () => {
        const { root } = await render('See https://example.com/c?x=1 now.');

        const anchor = root.querySelector('a');
        expect(anchor.getAttribute('href')).toBe('https://example.com/c?x=1');
        expect(anchor.textContent).toBe('https://example.com/c?x=1');
    });

    it('keeps adjacent links separate', async () => {
        const { root } = await render('[a](https://example.com/a)[b](https://example.com/b) and https://example.com/c');

        const anchors = Array.from(root.querySelectorAll('a'));
        expect(anchors.map(a => a.getAttribute('href'))).toEqual([
            'https://example.com/a',
            'https://example.com/b',
            'https://example.com/c'
        ]);
        expect(anchors.map(a => a.textContent)).toEqual(['a', 'b', 'https://example.com/c']);
    });

    it('does not link or format URL text inside inline code', async () => {
        const { root } = await render('Run `npm test https://example.com/d` now.');

        expect(root.querySelectorAll('a')).toHaveLength(0);
        const code = root.querySelector('code');
        expect(code.textContent).toBe('npm test https://example.com/d');
        expect(code.children).toHaveLength(0);
    });

    it('does not format emphasis markers inside inline code', async () => {
        const { root } = await render('Code `**not bold** and _not em_` end.');

        const code = root.querySelector('code');
        expect(code.textContent).toBe('**not bold** and _not em_');
        expect(code.querySelector('strong')).toBeNull();
        expect(code.querySelector('em')).toBeNull();
    });

    it('leaves Markdown link syntax inside inline code as text', async () => {
        const { root } = await render('Literal `[x](https://example.com/e)` only.');

        expect(root.querySelectorAll('a')).toHaveLength(0);
        expect(root.querySelector('code').textContent).toBe('[x](https://example.com/e)');
    });

    it('renders emphasis inside a link label and keeps the href', async () => {
        const { root } = await render('[**bold** and *italic*](https://example.com/f)');

        const anchor = root.querySelector('a');
        expect(anchor.getAttribute('href')).toBe('https://example.com/f');
        expect(anchor.querySelector('strong').textContent).toBe('bold');
        expect(anchor.querySelector('em').textContent).toBe('italic');
    });

    it('escapes link text and prose without creating markup', async () => {
        const { root } = await render('[a <b> & "q"](https://example.com/g) and <script>alert(1)</script>');

        const anchor = root.querySelector('a');
        expect(anchor.getAttribute('href')).toBe('https://example.com/g');
        expect(anchor.textContent).toBe('a <b> & "q"');
        expect(anchor.querySelector('b')).toBeNull();
        expect(root.querySelector('script')).toBeNull();
        expect(root.textContent).toContain('<script>alert(1)</script>');
    });

    it('does not create a Markdown link anchor for an unclosed link', async () => {
        const { root } = await render('Broken [text](https://example.com/h');

        const anchors = Array.from(root.querySelectorAll('a'));
        expect(anchors.every(anchor => anchor.textContent === 'https://example.com/h')).toBe(true);
        expect(root.textContent).toContain('[text](');
    });

    it('keeps the link intact after a streamed render', async () => {
        globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);

        const { root } = await render('Stream [a link](https://example.com/a) done.', { streamReply: true });

        const anchors = root.querySelectorAll('a');
        expect(anchors).toHaveLength(1);
        expect(anchors[0].getAttribute('href')).toBe('https://example.com/a');
        expect(anchors[0].textContent).toBe('a link');
        expect(root.textContent).toBe('Stream a link done.');
    });
});
