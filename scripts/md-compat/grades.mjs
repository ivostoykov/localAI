// Manual grades for issue #18, recorded against specific source hashes.
//
// These grades are a person's assessment of generated outputs, not harness
// results. run.mjs prints them separately from generated data and warns if the
// current source hashes no longer match the graded hashes.

export const gradedAgainst = {
  commit: 'b8a6f271387b9451631038d0fc1ee263d82d56da',
  gradedBy: 'dev2',
  gradedAt: '2026-10-31',
  sources: {
    'src/jslib/content-extractor.js': '9d8c004cab7e047400f353162bb7666f63e5ae965a225c8e565f997afdcd1db8',
    'src/jslib/solomd2html.js': '0fcbd8901e5d5c4ee1688f13e69aa0e0929c37b1b54a50f1cc1ae30d2de719dc',
    'src/content.js': '536dc1cf991bc1197045de4dae941095bc46a0f2ec89bc3d7e4a41a001e4c643'
  }
};

// Extraction fixtures: how the current output compares with the input HTML.
export const extractionGrades = {
  E1: { grade: 'bug', note: 'Each inline text node becomes its own line; emphasis is dropped; inline <code> becomes a fenced block.' },
  E2: { grade: 'bug', note: 'Nested lists are emitted twice: once by extractList recursion and again when the outer walker visits the nested <ul>/<ol>.' },
  E3: { grade: 'bug', note: 'formatList numbers from 1 and drops the start attribute.' },
  E4: { grade: 'bug', note: 'Quote markers are not emitted; the quoted text is indistinguishable from body text.' },
  E5: { grade: 'bug', note: 'extractTable uses cell textContent, so emphasis and links in cells are lost.' },
  E6: { grade: 'bug', note: 'Emits rows without a delimiter row, so the Markdown is not a valid GFM table. The renderer behaviour on such input is graded unsupported (R6b).' },
  E7: { grade: 'bug', note: 'Inline <code> becomes a block; the pre>code pair is pushed twice (PRE and CODE).' },
  E8: { grade: 'bug', note: 'formatEnhancedPageContent emits all prose of a section first, then lists, tables and code, so document order is lost.' },
  E9: { grade: 'bug', note: 'extractList uses the cloned item textContent, so links and emphasis inside items are lost.' },
  E10: { grade: 'pass', note: 'Heading level and order preserved.' },
  E11: { grade: 'partial', note: 'Alt text and caption text survive as bracket labels; emphasis in the caption and the image src are lost.' },
  E12: { grade: 'pass', note: 'The source newline is kept, which is a soft line break in the model-facing text.' },
  E13: { grade: 'bug', note: 'Quote structure is dropped and the list is emitted separately after the quoted prose.' },
  E14: { grade: 'pass', note: 'Extraction emits a valid Markdown link with balanced parentheses. Display of the same link is graded separately (R9a).' },
  E15: { grade: 'bug', note: 'The pre>code pair is emitted twice; the code content itself is preserved.' }
};

// Renderer fixtures: how the current renderer treats each input.
export const rendererGrades = {
  R1: { grade: 'bug', note: 'Each source line becomes its own <p>; soft line breaks are not joined (solomd2html.js renderMultilineContent).' },
  R2: { grade: 'bug', note: 'The bare-URL rule runs after link construction and rewrites the generated href; the link breaks and the URL is shown as text.' },
  R3: { grade: 'bug', note: 'renderListContent fixes the list type from the first line, so a following ordered list becomes items of the first list.' },
  R4: { grade: 'bug', note: 'CommonMark allows "1)" and "1." delimiters; only "\\d+." is detected.' },
  R5: { grade: 'bug', note: 'normaliseMd splits quote lines and renderBlockquoteContent emits one blockquote per line; a list inside a quote is rendered as literal "- item" text.' },
  R6a: { grade: 'pass', note: 'Header, alignment and body rows preserved.' },
  R6b: { grade: 'unsupported', note: 'Not a valid GFM table. The renderer treats the second row as alignment data; this is a limitation of the supported subset, not a defect claim.' },
  R7: { grade: 'pass', note: 'Fence language and content preserved.' },
  R8: { grade: 'pass', note: 'Nested strong/em handled; an unclosed "**" stays literal, which is standard behaviour.' },
  R9a: { grade: 'bug', note: 'Valid CommonMark destination, broken by the link construction plus the bare-URL rule.' },
  R9b: { grade: 'unsupported', note: 'Bare-URL autolinking is a local extension, not CommonMark; the link stops at "&" and the remainder is plain text.' },
  R10a: { grade: 'unsupported', note: 'Images are outside the supported subset; output is a literal "!" plus a link, not an image.' },
  R10b: { grade: 'unsupported', note: 'GFM task lists are outside the supported subset; brackets are shown literally.' },
  R11: { grade: 'unsupported', note: 'Setext heading and two-space hard break are valid CommonMark but outside the supported subset.' },
  R12: { grade: 'unsupported', note: 'Raw HTML is escaped and shown as preformatted text. This may be an intentional safety choice; no defect is claimed.' },
  R13: { grade: 'bug', note: 'GFM allows "\\|" inside a cell; the split ignores the escape and produces an extra cell.' },
  R14: { grade: 'pass', note: 'normaliseMd inserts the separating blank lines.' },
  R15: { grade: 'bug', note: 'The continuation line becomes a paragraph and the following ordered item stops being list content.' },
  R16: { grade: 'unsupported', note: 'Backslash escapes are not decoded, so "\\*" and "\\#" would display with the backslash. Relevant if escaped text reaches the renderer.' }
};

// Renderer-side outcome of Turndown output, assessed per extraction fixture.
// `pass` means the visible structure and inline meaning survive the current
// renderer. Failures name the renderer gap or the rule adoption would need.
export const turndownCompatGrades = {
  E1: { result: 'pass' },
  E2: { result: 'pass' },
  E3: { result: 'pass' },
  E4: { result: 'fail', reason: 'renderer: one blockquote per line (R5)' },
  E5: { result: 'pass', note: 'gfm plugin only' },
  E6: { result: 'fail', reason: 'adoption rule: gfm emits raw HTML for a header-less table' },
  E7: { result: 'pass' },
  E8: { result: 'pass', note: 'gfm plugin only' },
  E9: { result: 'pass' },
  E10: { result: 'pass' },
  E11: { result: 'fail', reason: 'renderer: images unsupported (R10a)' },
  E12: { result: 'pass' },
  E13: { result: 'fail', reason: 'renderer: blockquote fragmentation and literal list text (R5)' },
  E14: { result: 'fail', reason: 'renderer: link corruption (R2, R9a)' },
  E15: { result: 'pass' }
};
