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
  `${ceCode}\nreturn { getEnhancedPageContent, formatEnhancedPageContent };`
)(getDocumentContentFiltered, hasVisibleText, getARIAContext);

const metadata = { url: 'https://example.test/page', title: 'Order test', keywords: [] };

function assertOrder(output, ...markers) {
  let previous = -1;
  markers.forEach(marker => {
    const index = output.indexOf(marker);
    expect(index, marker).toBeGreaterThan(previous);
    previous = index;
  });
}

function pageContent(output) {
  return output.slice(
    output.indexOf('=== PAGE CONTENT ==='),
    output.indexOf('=== END OF PAGE CONTENT ===')
  );
}

describe('generic extraction keeps structured blocks in document order', () => {
  beforeEach(() => {
    document.head.innerHTML = '<title>Order test</title>';
  });

  it('keeps a list between surrounding paragraphs', async () => {
    document.body.innerHTML = '<main><p>Paragraph A</p><ul><li>List item</li></ul><p>Paragraph B</p></main>';

    assertOrder(await ce.getEnhancedPageContent(), 'Paragraph A', '- List item', 'Paragraph B');
  });

  it('keeps a data table between surrounding paragraphs', async () => {
    document.body.innerHTML = `
      <main><p>Paragraph A</p><table><thead><tr><th>Header row</th></tr></thead>
      <tbody><tr><td>Value</td></tr></tbody></table><p>Paragraph B</p></main>`;

    assertOrder(await ce.getEnhancedPageContent(), 'Paragraph A', '| Header row |', 'Paragraph B');
  });

  it('keeps a code block between surrounding paragraphs', async () => {
    document.body.innerHTML = '<main><p>Paragraph A</p><pre>const value = 1;</pre><p>Paragraph B</p></main>';

    assertOrder(await ce.getEnhancedPageContent(), 'Paragraph A', '```plaintext', 'Paragraph B');
  });

  it('keeps mixed structured blocks in one section in document order', async () => {
    document.body.innerHTML = `
      <main><p>One</p><ol><li>Two</li></ol><p>Three</p>
      <table><thead><tr><th>Four</th></tr></thead><tbody><tr><td>Value</td></tr></tbody></table>
      <p>Five</p><pre>six()</pre><p>Seven</p></main>`;

    assertOrder(await ce.getEnhancedPageContent(), 'One', '1. Two', 'Three', '| Four |', 'Five', '```plaintext', 'Seven');
  });

  it('keeps order within each heading section before starting the next', async () => {
    document.body.innerHTML = `
      <main><h2>First heading</h2><p>First A</p><ul><li>First list</li></ul><p>First B</p>
      <h2>Second heading</h2><p>Second A</p><ul><li>Second list</li></ul><p>Second B</p></main>`;

    assertOrder(
      await ce.getEnhancedPageContent(),
      '# First heading', 'First A', '- First list', 'First B', '# Second heading', 'Second A', '- Second list', 'Second B'
    );
  });

  it('keeps an image description between paragraphs and omits an empty description', async () => {
    document.body.innerHTML = `
      <main><p>Paragraph A</p><img alt="described image" src="image.png"><img src="empty.png"><p>Paragraph B</p></main>`;

    const output = await ce.getEnhancedPageContent();
    assertOrder(output, 'Paragraph A', '[Image: described image]', 'Paragraph B');
    expect(output).not.toContain('empty.png');
  });

  it('keeps a figure caption between paragraphs', async () => {
    document.body.innerHTML = `
      <main><p>Paragraph A</p><figure><img alt="figure image" src="figure.png"><figcaption>Figure caption</figcaption></figure><p>Paragraph B</p></main>`;

    assertOrder(await ce.getEnhancedPageContent(), 'Paragraph A', '[Image: figure image]', '[Figure: Figure caption]', 'Paragraph B');
  });

  it('preserves existing formatting for text, nested ordered lists and headed tables', async () => {
    document.body.innerHTML = `
      <main><p>Intro</p><ol><li>First<ol><li>Nested</li></ol></li></ol>
      <table><thead><tr><th>Item</th><th>Count</th></tr></thead><tbody><tr><td>Apples</td><td>2</td></tr></tbody></table></main>`;

    expect(pageContent(await ce.getEnhancedPageContent())).toBe(`=== PAGE CONTENT ===

Intro

1. First
  1. Nested

| Item | Count |
| --- | --- |
| Apples | 2 |

`);
  });

  it('joins consecutive text lines with one newline', async () => {
    document.body.innerHTML = '<main><p>Paragraph A</p><p>Paragraph B</p></main>';

    expect(pageContent(await ce.getEnhancedPageContent())).toContain('Paragraph A\nParagraph B\n\n');
  });

  it('keeps level-zero content ordered before the first heading', async () => {
    document.body.innerHTML = '<main><p>Before A</p><ul><li>Before list</li></ul><p>Before B</p><h2>Heading</h2><p>After</p></main>';

    assertOrder(await ce.getEnhancedPageContent(), 'Before A', '- Before list', 'Before B', '# Heading', 'After');
  });

  it('formats a legacy section without blocks like an equivalent ordered section', () => {
    const legacy = {
      title: '', images: [], content: ['job text'], lists: [], tables: [], codeBlocks: []
    };
    const ordered = {
      ...legacy, blocks: [{ type: 'text', text: 'job text' }]
    };

    const legacyOutput = ce.formatEnhancedPageContent([legacy], metadata);
    expect(legacyOutput).toContain('job text');
    expect(legacyOutput).toBe(ce.formatEnhancedPageContent([ordered], metadata));
  });

  it('uses the old content-before-lists order for a legacy section', () => {
    const legacy = {
      title: '', images: [], content: ['legacy text'],
      lists: [{ type: 'UL', items: [{ text: 'legacy list' }] }], tables: [], codeBlocks: []
    };

    assertOrder(ce.formatEnhancedPageContent([legacy], metadata), 'legacy text', '- legacy list');
  });
});
