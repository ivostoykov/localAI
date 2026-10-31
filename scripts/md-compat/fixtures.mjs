// Labelled synthetic fixtures for issue #18. Data only: grades live in grades.mjs.

export const extractionFixtures = [
  {
    "id": "E1",
    "title": "Inline prose (strong, em, link, inline code)",
    "html": "<main><p>Alpha <strong>bold</strong> and <em>italic</em> with <a href=\"/docs/a\">a link</a> plus <code>fn()</code>.</p></main>"
  },
  {
    "id": "E2",
    "title": "Nested ul > li > ol > li > ul",
    "html": "<main><ul>\n  <li>Parent one\n    <ol><li>First</li><li>Second\n      <ul><li>Leaf</li></ul>\n    </li></ol>\n  </li>\n  <li>Parent two</li>\n</ul></main>"
  },
  {
    "id": "E3",
    "title": "Ordered list starting at 5",
    "html": "<main><ol start=\"5\"><li>Five</li><li>Six</li></ol></main>"
  },
  {
    "id": "E4",
    "title": "Blockquote with two paragraphs",
    "html": "<main><blockquote><p>Quoted <strong>strong</strong> text.</p><p>Second paragraph.</p></blockquote></main>"
  },
  {
    "id": "E5",
    "title": "Table with thead and inline markup in cells",
    "html": "<main><table><thead><tr><th>Name</th><th>Value</th></tr></thead>\n<tbody><tr><td><strong>a</strong></td><td><a href=\"/x\">link</a></td></tr>\n<tr><td>b</td><td>2</td></tr></tbody></table></main>"
  },
  {
    "id": "E6",
    "title": "Table without thead",
    "html": "<main><table><tbody><tr><td>Name</td><td>Value</td></tr><tr><td>a</td><td>1</td></tr></tbody></table></main>"
  },
  {
    "id": "E7",
    "title": "Inline code in prose plus a fenced code block",
    "html": "<main><p>Run <code>npm test</code> first.</p><pre><code class=\"language-js\">const a = 1;\nconst b = 2;</code></pre></main>"
  },
  {
    "id": "E8",
    "title": "Interleaved heading, prose, list, code and table",
    "html": "<main><h2>Steps</h2><p>Intro text.</p><ul><li>one</li><li>two</li></ul>\n<p>Middle.</p><pre><code class=\"language-sh\">echo hi</code></pre><p>After code.</p>\n<table><thead><tr><th>K</th><th>V</th></tr></thead><tbody><tr><td>k</td><td>v</td></tr></tbody></table>\n<p>End.</p></main>"
  },
  {
    "id": "E9",
    "title": "List item containing a link and emphasis",
    "html": "<main><ul><li>See <a href=\"/a\">docs</a> and <strong>note</strong></li></ul></main>"
  },
  {
    "id": "E10",
    "title": "Two heading levels and sections",
    "html": "<main><h1>Title</h1><p>Intro</p><h3>Sub</h3><p>More</p></main>"
  },
  {
    "id": "E11",
    "title": "Figure with image alt and caption",
    "html": "<main><figure><img alt=\"Diagram\" src=\"/d.png\"><figcaption>Caption <em>here</em></figcaption></figure></main>"
  },
  {
    "id": "E12",
    "title": "Paragraph with a source newline",
    "html": "<main><p>Line one\nline two</p></main>"
  },
  {
    "id": "E13",
    "title": "Blockquote containing a list",
    "html": "<main><blockquote><p>Before</p><ul><li>item</li></ul><p>After</p></blockquote></main>"
  },
  {
    "id": "E14",
    "title": "Link whose URL contains balanced parentheses",
    "html": "<main><p>See <a href=\"https://en.wikipedia.org/wiki/Foo_(bar)\">the article</a>.</p></main>"
  },
  {
    "id": "E15",
    "title": "Fenced code whose content contains a pipe table",
    "html": "<main><pre><code class=\"language-md\">| a | b |\n| --- | --- |\n| 1 | 2 |</code></pre></main>"
  }
];

export const rendererFixtures = [
  {
    "id": "R1",
    "title": "Single newlines in prose",
    "markdown": "Line one\nLine two\nLine three"
  },
  {
    "id": "R2",
    "title": "Inline strong, em, strike, code and absolute link",
    "markdown": "Alpha **bold** and *italic* and ~~gone~~ with [a link](https://example.com/a) plus `fn()`."
  },
  {
    "id": "R3",
    "title": "Nested list with a marker-type switch at the same level",
    "markdown": "- Parent one\n  - Child a\n  - Child b\n    - Grandchild\n1. Second top\n2. Third top"
  },
  {
    "id": "R4",
    "title": "Ordered list using the \")\" delimiter",
    "markdown": "7) Seven\n8) Eight"
  },
  {
    "id": "R5",
    "title": "Blockquote with nested quote and list",
    "markdown": "> Outer quote\n> > Inner quote\n> >\n> > - item one\n> > - item two"
  },
  {
    "id": "R6a",
    "title": "Table with delimiter row and alignment",
    "markdown": "| Left | Right |\n| :--- | ---: |\n| a | 1 |\n| b | 2 |"
  },
  {
    "id": "R6b",
    "title": "Pipe text without a delimiter row",
    "markdown": "| Name | Value |\n| a | 1 |\n| b | 2 |"
  },
  {
    "id": "R7",
    "title": "Fenced code with language, pipes and regex",
    "markdown": "Before\n\n```js\nconst re = /|/;\n```\n\nAfter"
  },
  {
    "id": "R8",
    "title": "Nested emphasis and intraword underscores",
    "markdown": "This is **bold and *italic*** plus snake_case_name and **unclosed"
  },
  {
    "id": "R9a",
    "title": "Link destination containing balanced parentheses",
    "markdown": "See [wiki](https://en.wikipedia.org/wiki/Foo_(bar))."
  },
  {
    "id": "R9b",
    "title": "Bare URL containing an ampersand",
    "markdown": "See https://example.com/a_b?q=1&x=2."
  },
  {
    "id": "R10a",
    "title": "Image syntax",
    "markdown": "![Alt text](/img.png)"
  },
  {
    "id": "R10b",
    "title": "Task-list syntax",
    "markdown": "- [ ] todo\n- [x] done"
  },
  {
    "id": "R11",
    "title": "Setext heading and two-space hard break",
    "markdown": "Title\n=====\n\nfirst line  \nsecond line"
  },
  {
    "id": "R12",
    "title": "Raw HTML block",
    "markdown": "<div class=\"note\"><strong>Raw</strong> HTML</div>"
  },
  {
    "id": "R13",
    "title": "Escaped pipe inside a table cell",
    "markdown": "| Col | Note |\n| --- | --- |\n| a | pipe \\| here |"
  },
  {
    "id": "R14",
    "title": "Heading and list immediately after prose",
    "markdown": "Intro sentence\n## Heading\n- item one\n- item two"
  },
  {
    "id": "R15",
    "title": "Ordered list with a lazy continuation line",
    "markdown": "1. First item\n   continued on next line\n2. Second item"
  },
  {
    "id": "R16",
    "title": "Backslash escapes for Markdown punctuation",
    "markdown": "A \\*literal\\* star and \\# hash and snake\\_case."
  }
];
