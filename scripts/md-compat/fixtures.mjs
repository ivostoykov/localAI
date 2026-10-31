// Labelled synthetic fixtures for issue #18.
// All inputs are small and self-contained. `classification` records the
// assessment of the *current* output; it is a judgement recorded with the
// fixture, not an assertion about untested pages.

export const extractionFixtures = [
  {
    id: 'E1',
    title: 'Inline prose (strong, em, link, inline code)',
    classification: 'bug',
    note: 'Each inline text node becomes its own line; emphasis is dropped; inline <code> becomes a fenced block.',
    html: '<main><p>Alpha <strong>bold</strong> and <em>italic</em> with <a href="/docs/a">a link</a> plus <code>fn()</code>.</p></main>'
  },
  {
    id: 'E2',
    title: 'Nested ul > li > ol > li > ul',
    classification: 'bug',
    note: 'Nested lists are emitted twice: once by extractList recursion and again when the outer walker visits the nested <ul>/<ol>.',
    html: `<main><ul>
  <li>Parent one
    <ol><li>First</li><li>Second
      <ul><li>Leaf</li></ul>
    </li></ol>
  </li>
  <li>Parent two</li>
</ul></main>`
  },
  {
    id: 'E3',
    title: 'Ordered list starting at 5',
    classification: 'bug',
    note: 'formatList numbers from 1 and drops the start attribute.',
    html: '<main><ol start="5"><li>Five</li><li>Six</li></ol></main>'
  },
  {
    id: 'E4',
    title: 'Blockquote with two paragraphs',
    classification: 'bug',
    note: 'Quote markers are not emitted; the quoted text is indistinguishable from body text.',
    html: '<main><blockquote><p>Quoted <strong>strong</strong> text.</p><p>Second paragraph.</p></blockquote></main>'
  },
  {
    id: 'E5',
    title: 'Table with thead and inline markup in cells',
    classification: 'bug',
    note: 'extractTable uses cell textContent, so emphasis and links in cells are lost.',
    html: `<main><table><thead><tr><th>Name</th><th>Value</th></tr></thead>
<tbody><tr><td><strong>a</strong></td><td><a href="/x">link</a></td></tr>
<tr><td>b</td><td>2</td></tr></tbody></table></main>`
  },
  {
    id: 'E6',
    title: 'Table without thead',
    classification: 'bug',
    note: 'Emits rows without a delimiter row, so the Markdown is not a valid GFM table. The renderer behaviour on such input is separately classified as unsupported.',
    html: '<main><table><tbody><tr><td>Name</td><td>Value</td></tr><tr><td>a</td><td>1</td></tr></tbody></table></main>'
  },
  {
    id: 'E7',
    title: 'Inline code in prose plus a fenced code block',
    classification: 'bug',
    note: 'Inline <code> becomes a block; the pre>code pair is pushed twice (PRE and CODE).',
    html: `<main><p>Run <code>npm test</code> first.</p><pre><code class="language-js">const a = 1;
const b = 2;</code></pre></main>`
  },
  {
    id: 'E8',
    title: 'Interleaved heading, prose, list, code and table',
    classification: 'bug',
    note: 'formatEnhancedPageContent emits all prose of a section first, then lists, tables and code, so document order is lost.',
    html: `<main><h2>Steps</h2><p>Intro text.</p><ul><li>one</li><li>two</li></ul>
<p>Middle.</p><pre><code class="language-sh">echo hi</code></pre><p>After code.</p>
<table><thead><tr><th>K</th><th>V</th></tr></thead><tbody><tr><td>k</td><td>v</td></tr></tbody></table>
<p>End.</p></main>`
  },
  {
    id: 'E9',
    title: 'List item containing a link and emphasis',
    classification: 'bug',
    note: 'extractList uses the cloned item textContent, so links and emphasis inside items are lost.',
    html: '<main><ul><li>See <a href="/a">docs</a> and <strong>note</strong></li></ul></main>'
  },
  {
    id: 'E10',
    title: 'Two heading levels and sections',
    classification: 'pass',
    note: 'Heading level and order preserved.',
    html: '<main><h1>Title</h1><p>Intro</p><h3>Sub</h3><p>More</p></main>'
  },
  {
    id: 'E11',
    title: 'Figure with image alt and caption',
    classification: 'partial',
    note: 'Alt text and caption text survive as bracket labels; emphasis in the caption and the image src are lost.',
    html: '<main><figure><img alt="Diagram" src="/d.png"><figcaption>Caption <em>here</em></figcaption></figure></main>'
  },
  {
    id: 'E12',
    title: 'Paragraph with a source newline',
    classification: 'pass',
    note: 'The source newline is kept, which is a soft line break in the model-facing text.',
    html: '<main><p>Line one\nline two</p></main>'
  },
  {
    id: 'E13',
    title: 'Blockquote containing a list',
    classification: 'bug',
    note: 'Quote structure is dropped and the list is emitted separately after the quoted prose.',
    html: '<main><blockquote><p>Before</p><ul><li>item</li></ul><p>After</p></blockquote></main>'
  },
  {
    id: 'E14',
    title: 'Link whose URL contains balanced parentheses',
    classification: 'pass',
    note: 'Extraction emits a valid Markdown link with balanced parentheses. Display of the same link is a separate renderer fixture (R9a).',
    html: '<main><p>See <a href="https://en.wikipedia.org/wiki/Foo_(bar)">the article</a>.</p></main>'
  },
  {
    id: 'E15',
    title: 'Fenced code whose content contains a pipe table',
    classification: 'bug',
    note: 'The pre>code pair is emitted twice; the code content itself is preserved.',
    html: `<main><pre><code class="language-md">| a | b |
| --- | --- |
| 1 | 2 |</code></pre></main>`
  }
];

export const rendererFixtures = [
  {
    id: 'R1',
    title: 'Single newlines in prose',
    classification: 'bug',
    note: 'Each source line becomes its own <p>; soft line breaks are not joined (solomd2html.js renderMultilineContent).',
    markdown: 'Line one\nLine two\nLine three'
  },
  {
    id: 'R2',
    title: 'Inline strong, em, strike, code and absolute link',
    classification: 'bug',
    note: 'The bare-URL rule runs after link construction and rewrites the generated href; the link breaks and the URL is shown as text.',
    markdown: 'Alpha **bold** and *italic* and ~~gone~~ with [a link](https://example.com/a) plus `fn()`.'
  },
  {
    id: 'R3',
    title: 'Nested list with a marker-type switch at the same level',
    classification: 'bug',
    note: 'renderListContent fixes the list type from the first line, so a following ordered list becomes items of the first list.',
    markdown: '- Parent one\n  - Child a\n  - Child b\n    - Grandchild\n1. Second top\n2. Third top'
  },
  {
    id: 'R4',
    title: 'Ordered list using the ")" delimiter',
    classification: 'bug',
    note: 'CommonMark allows "1)" and "1." delimiters; only "\\d+." is detected.',
    markdown: '7) Seven\n8) Eight'
  },
  {
    id: 'R5',
    title: 'Blockquote with nested quote and list',
    classification: 'bug',
    note: 'normaliseMd splits quote lines and renderBlockquoteContent emits one blockquote per line; a list inside a quote is rendered as literal "- item" text.',
    markdown: '> Outer quote\n> > Inner quote\n> >\n> > - item one\n> > - item two'
  },
  {
    id: 'R6a',
    title: 'Table with delimiter row and alignment',
    classification: 'pass',
    note: 'Header, alignment and body rows preserved.',
    markdown: '| Left | Right |\n| :--- | ---: |\n| a | 1 |\n| b | 2 |'
  },
  {
    id: 'R6b',
    title: 'Pipe text without a delimiter row',
    classification: 'unsupported',
    note: 'Not a valid GFM table. The renderer treats the second row as alignment data; this is a limitation of the supported subset, not a defect claim.',
    markdown: '| Name | Value |\n| a | 1 |\n| b | 2 |'
  },
  {
    id: 'R7',
    title: 'Fenced code with language, pipes and regex',
    classification: 'pass',
    note: 'Fence language and content preserved.',
    markdown: 'Before\n\n```js\nconst re = /|/;\n```\n\nAfter'
  },
  {
    id: 'R8',
    title: 'Nested emphasis and intraword underscores',
    classification: 'pass',
    note: 'Nested strong/em handled; an unclosed "**" stays literal, which is standard behaviour.',
    markdown: 'This is **bold and *italic*** plus snake_case_name and **unclosed'
  },
  {
    id: 'R9a',
    title: 'Link destination containing balanced parentheses',
    classification: 'bug',
    note: 'Valid CommonMark destination, broken by the link construction plus bare-URL rule.',
    markdown: 'See [wiki](https://en.wikipedia.org/wiki/Foo_(bar)).'
  },
  {
    id: 'R9b',
    title: 'Bare URL containing an ampersand',
    classification: 'unsupported',
    note: 'Bare-URL autolinking is a local extension, not CommonMark; the link stops at "&" and the remainder is plain text.',
    markdown: 'See https://example.com/a_b?q=1&x=2.'
  },
  {
    id: 'R10a',
    title: 'Image syntax',
    classification: 'unsupported',
    note: 'Images are outside the supported subset; output is a literal "!" plus a link, not an image.',
    markdown: '![Alt text](/img.png)'
  },
  {
    id: 'R10b',
    title: 'Task-list syntax',
    classification: 'unsupported',
    note: 'GFM task lists are outside the supported subset; brackets are shown literally.',
    markdown: '- [ ] todo\n- [x] done'
  },
  {
    id: 'R11',
    title: 'Setext heading and two-space hard break',
    classification: 'unsupported',
    note: 'Both are valid CommonMark but outside the supported subset.',
    markdown: 'Title\n=====\n\nfirst line  \nsecond line'
  },
  {
    id: 'R12',
    title: 'Raw HTML block',
    classification: 'unsupported',
    note: 'Raw HTML is escaped and shown as preformatted text. This may be an intentional safety choice; no defect is claimed.',
    markdown: '<div class="note"><strong>Raw</strong> HTML</div>'
  },
  {
    id: 'R13',
    title: 'Escaped pipe inside a table cell',
    classification: 'bug',
    note: 'GFM allows "\\|" inside a cell; the split ignores the escape and produces an extra cell.',
    markdown: '| Col | Note |\n| --- | --- |\n| a | pipe \\| here |'
  },
  {
    id: 'R14',
    title: 'Heading and list immediately after prose',
    classification: 'pass',
    note: 'normaliseMd inserts the separating blank lines.',
    markdown: 'Intro sentence\n## Heading\n- item one\n- item two'
  },
  {
    id: 'R15',
    title: 'Ordered list with a lazy continuation line',
    classification: 'bug',
    note: 'The continuation line becomes a paragraph and the following ordered item stops being list content.',
    markdown: '1. First item\n   continued on next line\n2. Second item'
  },
  {
    id: 'R16',
    title: 'Backslash escapes for Markdown punctuation',
    classification: 'unsupported',
    note: 'Backslash escapes are not decoded, so "\\*" and "\\#" would display with the backslash. Relevant if escaped text reaches the renderer.',
    markdown: 'A \\*literal\\* star and \\# hash and snake\\_case.'
  }
];
