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

    it('renders a relative Markdown link as plain text (#99)', async () => {
        const { root } = await render('See [docs](/docs/a) now.');

        expect(root.querySelector('a')).toBeNull();
        expect(root.textContent).toBe('See [docs](/docs/a) now.');
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

    it('stops a bare URL before inline code with no space', async () => {
        const { root } = await render('See https://example.com/x`code` end.');

        const anchor = root.querySelector('a');
        const code = root.querySelector('code');
        expect(anchor.getAttribute('href')).toBe('https://example.com/x');
        expect(anchor.textContent).toBe('https://example.com/x');
        expect(anchor.querySelector('code')).toBeNull();
        expect(code.textContent).toBe('code');
        expect(anchor.nextSibling).toBe(code);
    });

    it('stops a bare URL before an adjacent Markdown link', async () => {
        const { root } = await render('See https://example.com/x[a](https://other.example/a) end.');

        const anchors = Array.from(root.querySelectorAll('a'));
        expect(anchors).toHaveLength(2);
        expect(anchors[0].getAttribute('href')).toBe('https://example.com/x');
        expect(anchors[0].textContent).toBe('https://example.com/x');
        expect(anchors[1].getAttribute('href')).toBe('https://other.example/a');
        expect(anchors[1].textContent).toBe('a');
        expect(anchors[0].nextSibling).toBe(anchors[1]);
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

describe('renderInline link scheme allow-list (#99)', () => {
    const expectInert = (root, source) => {
        expect(root.querySelector('a')).toBeNull();
        expect(root.querySelector('[href]')).toBeNull();
        expect(root.querySelector('script, iframe, object, embed')).toBeNull();
        expect(root.textContent).toContain(source);
    };

    it.each([
        '[x](javascript:x)',
        '[x](JaVaScRiPt:x)',
        '[x](  javascript:x)',
        '[x](\tjavascript:x)',
        '[x](&#106;avascript:x)',
        '[x](&#x6A;avascript:x)',
        '[x](java&#x09;script:x)',
        '[x](javascript&colon;x)',
        '[x](data:text/html;base64,PHNjcmlwdD4=)',
        '[x](DATA:text/html,x)',
        '[x](vbscript:x)',
        '[x](file:///etc/passwd)',
        '[x](//example.com/a)',
        '[x](https:example.com)',
        '[javascript:x]',
        '[data:text/html,x]',
        '<javascript:x>',
        '<data:text/html,x>'
    ])('renders %j as inert plain text', async source => {
        const { root } = await render(`Before ${source} after`);
        expectInert(root, source);
    });

    it('keeps formatting outside a blocked link and does not link a URL inside it', async () => {
        const { root } = await render('**bold** [x](data:text/html,https://example.com/a) *em* `code`');

        expect(root.querySelector('a')).toBeNull();
        expect(root.querySelector('strong').textContent).toBe('bold');
        expect(root.querySelector('em').textContent).toBe('em');
        expect(root.querySelector('code').textContent).toBe('code');
        expect(root.textContent).toContain('[x](data:text/html,https://example.com/a)');
    });

    it.each([
        ['[a](HTTPS://Example.com/A)', 'HTTPS://Example.com/A', 'a'],
        ['[a](http://example.com/a)', 'http://example.com/a', 'a'],
        ['[a]( https://example.com/a )', 'https://example.com/a', 'a'],
        ['[a](https://example.com/?x=1&y=2)', 'https://example.com/?x=1&y=2', 'a'],
        ['[mail](mailto:someone@example.com)', 'mailto:someone@example.com', 'mail'],
        ['<HTTP://example.com/b>', 'HTTP://example.com/b', 'HTTP://example.com/b'],
        ['<mailto:someone@example.com>', 'mailto:someone@example.com', 'mailto:someone@example.com'],
        ['[https://example.com/c]', 'https://example.com/c', 'https://example.com/c'],
        ['[MAILTO:someone@example.com]', 'MAILTO:someone@example.com', 'MAILTO:someone@example.com'],
        ['HTTPS://example.com/d', 'HTTPS://example.com/d', 'HTTPS://example.com/d']
    ])('links the allowed destination in %j', async (source, href, text) => {
        const { root } = await render(`See ${source} now.`);

        const anchors = root.querySelectorAll('a');
        expect(anchors).toHaveLength(1);
        expect(anchors[0].getAttribute('href')).toBe(href);
        expect(anchors[0].textContent).toBe(text);
        expect(anchors[0].getAttribute('target')).toBe('_blank');
        expect(anchors[0].getAttribute('rel')).toBe('noopener noreferrer');
    });

    it.each([
        '[custom:open?next=https://example.test]',
        '<custom:open?next=https://example.test>',
        'custom:open?next=https://example.test',
        '[javascript:void(0)?u=https://example.test]',
        '<data:text/html,https://example.test>'
    ])('keeps the unsupported outer URL %j entirely plain text', async source => {
        const { root } = await render(`Open ${source} now.`);
        expectInert(root, source);
        expect(root.textContent).toBe(`Open ${source} now.`);
    });

    it.each([
        ['<https://example.com/p?a=1&b=2&c=3>', 'https://example.com/p?a=1&b=2&c=3'],
        ['https://example.com/p?a=1&b=2&c=3', 'https://example.com/p?a=1&b=2&c=3'],
        ['[https://example.com/p?a=1&b=2]', 'https://example.com/p?a=1&b=2']
    ])('keeps the whole ampersand query in %j', async (source, href) => {
        const { root } = await render(`See ${source} now.`);

        const anchors = root.querySelectorAll('a');
        expect(anchors).toHaveLength(1);
        expect(anchors[0].getAttribute('href')).toBe(href);
        expect(anchors[0].textContent).toBe(href);
        expect(root.textContent).toBe(`See ${href} now.`);
    });

    it('never puts held markup into an href', async () => {
        const { root } = await render('[x](https://example.com/`code`) and <https://example.com/`y`>');

        for (const element of root.querySelectorAll('[href]')) {
            expect(element.getAttribute('href')).not.toMatch(/[<>\u0000]/);
        }
        expect(root.querySelector('a code')).toBeNull();
        expect(root.innerHTML).not.toContain('\u0000');
    });

    it('links allowed and leaves blocked links in the same line', async () => {
        const { root } = await render('[ok](https://example.com/a) [bad](javascript:x) <mailto:a@example.com>');

        const anchors = Array.from(root.querySelectorAll('a'));
        expect(anchors.map(anchor => anchor.getAttribute('href'))).toEqual(['https://example.com/a', 'mailto:a@example.com']);
        expect(root.textContent).toContain('[bad](javascript:x)');
    });
});
