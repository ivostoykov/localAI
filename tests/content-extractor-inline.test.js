import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ceCode = fs.readFileSync(path.join(__dirname, '../src/jslib/content-extractor.js'), 'utf-8');

function createExtractor(root, display) {
  const names = ['getDocumentContentFiltered', 'hasVisibleText', 'getARIAContext'];
  const args = [() => root, node => /\S/.test(node.nodeValue), () => ''];
  if (display) {
    names.push('getClonedElementDisplay');
    args.push(element => display.get(element));
  }
  return new Function(...names, `${ceCode}\nreturn { getEnhancedPageContent, extractEnhancedTextStructure, formatEnhancedPageContent };`)(...args);
}

function pageContent(output) {
  return output.split('=== PAGE CONTENT ===\n\n')[1].split('=== END OF PAGE CONTENT ===')[0];
}

async function extract(html, displays) {
  document.body.innerHTML = `<main>${html}</main>`;
  const root = document.body.cloneNode(true);
  const display = displays && new Map(displays.map(([selector, value]) => [root.querySelector(selector), value]));
  return pageContent(await createExtractor(root, display).getEnhancedPageContent());
}

const url = href => new URL(href, document.location.href).href;

describe('inline page extraction without a display helper', () => {
  beforeEach(() => { document.head.innerHTML = '<title>Inline test</title>'; });

  it('joins text around a relative link', async () => {
    expect(await extract('<p>Read the <a href="/docs">docs</a> now.</p>'))
      .toBe(`Read the [docs](${url('/docs')}) now.\n\n`);
  });

  it.each([
    ['adjacent text', '<p>foo<b>bar</b></p>', 'foobar'],
    ['space before an inline element', '<p>foo <b>bar</b></p>', 'foo bar'],
    ['whitespace-only text between inline elements', '<p><b>foo</b> <i>bar</i></p>', 'foo bar'],
    ['collapsed whitespace', '<p>a\n   b</p>', 'a b'],
    ['non-breaking spaces', '<p>a&nbsp;&nbsp;b</p>', 'a\u00a0\u00a0b'],
    ['explicit break', '<p>one<br>two</p>', 'one\ntwo'],
    ['nested blocks', '<div>foo<p>bar</p>baz</div>', 'foo\nbar\nbaz'],
    ['horizontal rule', '<div>foo<hr>bar</div>', 'foo\nbar'],
    ['empty block', '<div>foo<div></div>bar</div>', 'foo\nbar'],
    ['sibling blocks', '<p>a</p><p>b</p>', 'a\nb'],
    ['inline code', '<p>Run <code>npm test</code> first.</p>', 'Run `npm test` first.'],
    ['nested inline code text', '<p>Run<code> npm <b>test</b> </code>first.</p>', 'Run `npm test` first.'],
    ['blank inline code', '<p>Run<code> </code>first.</p>', 'Run first.'],
    ['fragment link', '<p>go <a href="#top">up</a></p>', 'go up'],
    ['javascript link', '<p>go <a href="javascript:void(0)">up</a></p>', 'go up'],
    ['empty link', '<p>go <a href="">up</a></p>', 'go up'],
    ['image without alt', '<p>one<img src="image.png"> two</p>', 'one two'],
    ['image with alt', '<p>one<img alt="description" src="image.png">two</p>', 'one\n[Image: description]\ntwo'],
    ['custom inline elements', '<p>one<my-label> two</my-label> three</p>', 'one two three'],
    ['default inline controls and pictures', '<p>one<picture><img src="x"></picture><button> two</button><input><select></select><textarea></textarea><svg></svg> three</p>', 'one two three']
  ])('preserves %s', async (_name, html, expected) => {
    expect(await extract(html)).toBe(`${expected}\n\n`);
  });

  it('keeps fenced preformatted code in order', async () => {
    expect(await extract('<p>Before</p><pre><code>x</code></pre><p>After</p>'))
      .toBe('Before\n\n```plaintext\nx\n```\n\nAfter\n\n');
  });

  it('renders a link spanning inline children once', async () => {
    expect(await extract('<p><a href="/x">Read <b>the</b> docs</a>.</p>'))
      .toBe(`[Read the docs](${url('/x')}).\n\n`);
  });

  it('renders linked inline code', async () => {
    expect(await extract('<p>See <a href="/x"><code>api()</code></a></p>'))
      .toBe(`See [\`api()\`](${url('/x')})\n\n`);
  });

  it('moves link boundary spaces outside brackets', async () => {
    expect(await extract('<p>Read<a href="/x"> the <b>docs</b> </a>now.</p>'))
      .toBe(`Read [the docs](${url('/x')}) now.\n\n`);
  });

  it('keeps blank links as whitespace', async () => {
    expect(await extract('<p>Read<a href="/x"> </a>now.</p>')).toBe('Read now.\n\n');
  });

  it('opens a section for a linked heading', async () => {
    expect(await extract('<h2><a href="/t">Linked title</a></h2><p>Body</p>'))
      .toBe(`## [Linked title](${url('/t')})\n\nBody\n\n`);
  });

  it('retains a heading containing inline formatting without body content', async () => {
    expect(await extract('<h2>Hello <em>world</em></h2>')).toBe('## Hello world\n\n');
  });

  it('joins explicit heading breaks into one title', async () => {
    expect(await extract('<h2>One<br>Two</h2>')).toBe('## One Two\n\n');
  });

  it('retains consecutive heading-only sections', async () => {
    expect(await extract('<h2>One</h2><h3>Two</h3>')).toBe('## One\n\n### Two\n\n');
  });

  it('recognises a heading at the extraction root', () => {
    const root = document.createElement('h2');
    root.innerHTML = 'Hello <em>world</em>';
    const ce = createExtractor(root);
    const output = ce.formatEnhancedPageContent(ce.extractEnhancedTextStructure(root), { keywords: [] });
    expect(pageContent(output)).toBe('## Hello world\n\n');
  });

  it('keeps a list between inline runs', async () => {
    expect(await extract('<div>Before <b>list</b><ul><li>Item</li></ul>After <i>list</i></div>'))
      .toBe('Before list\n\n- Item\n\nAfter list\n\n');
  });

  it('keeps a table between inline runs', async () => {
    expect(await extract('<div>Before <b>table</b><table><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>After <i>table</i></div>'))
      .toBe('Before table\n\n| Header |\n| --- |\n| Cell |\n\nAfter table\n\n');
  });
});

describe('recorded live display overrides tag names', () => {
  it.each(['block', 'flex', 'list-item', 'table-cell'])('breaks at a span with display:%s', async display => {
    expect(await extract('<div>one<span>two</span>three</div>', [['span', display]]))
      .toBe('one\ntwo\nthree\n\n');
  });

  it.each(['inline', 'inline-block', 'contents', 'ruby', 'ruby-base'])('joins a div with display:%s', async display => {
    expect(await extract('<div>one<div id="inner"> two </div>three</div>', [['#inner', display]]))
      .toBe('one two three\n\n');
  });

  it('falls back to tags for unknown or empty recorded displays', async () => {
    expect(await extract('<p>one<span> two</span><b> three</b></p>', [['span', '']]))
      .toBe('one two three\n\n');
  });

  it('keeps explicitly block-level code fenced', async () => {
    expect(await extract('<p>Before<code>x</code>After</p>', [['code', 'block']]))
      .toBe('Before\n\n```plaintext\nx\n```\n\nAfter\n\n');
  });

  it('breaks at a block image even without alt text', async () => {
    expect(await extract('<p>one<img src="x">two</p>', [['img', 'block']]))
      .toBe('one\ntwo\n\n');
  });
});
