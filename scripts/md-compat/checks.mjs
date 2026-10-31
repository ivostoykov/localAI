// Automated structural checks for issue #18.
// These compare generated outputs with expectations derived from the fixture's
// own HTML or Markdown. They are not grades: a pass means the measured
// property holds, not that the case is acceptable.

import { document } from './harness.mjs';
import { extractBody } from './harness.mjs';

const occurrences = (text, needle) => text.split(needle).length - 1;

function parse(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

function byId(items, id) {
  const item = items.find(i => i.id === id);
  if (!item) throw new Error(`fixture ${id} missing`);
  return item;
}

export function runChecks({ extraction, renderer }) {
  const checks = [];
  const add = (id, description, expected, actual, pass) => {
    checks.push({ id, description, expected, actual, pass });
  };

  // E1: inline prose stays one paragraph with inline markup under Turndown.
  {
    const e = byId(extraction, 'E1');
    const currentLines = e.current.split('\n').filter(Boolean);
    const turndownInline = e.turndownGfm.split('\n')[0];
    add('E1',
      'Current extraction splits one sentence into many lines; Turndown keeps it on one line with inline markup.',
      'current non-empty lines > 5; first Turndown line contains **bold**, _italic_ and a link',
      `current lines=${currentLines.length}; turndown first line=${JSON.stringify(turndownInline)}`,
      currentLines.length > 5 && /\*\*bold\*\*/.test(turndownInline) && /_italic_/.test(turndownInline) && /\[a link\]\(\/docs\/a\)/.test(turndownInline));
  }

  // E2: nested list appears once, at depth, under Turndown; current duplicates it.
  {
    const e = byId(extraction, 'E2');
    const leafLines = e.turndownGfmRender.split('\n')
      .map(line => line.match(/^(\s*)li: <span>Leaf<\/span>$/))
      .filter(Boolean);
    const depth = leafLines.length ? leafLines[0][1].length / 2 : -1;
    add('E2',
      'Nested list leaf appears exactly once at depth under Turndown; current output repeats the leaf.',
      'Turndown: one leaf item at depth >= 3; current: more than one "Leaf" occurrence',
      `turndown leaf lines=${leafLines.length}, depth=${depth}; current "Leaf" occurrences=${occurrences(e.current, 'Leaf')}`,
      leafLines.length === 1 && depth >= 3 && occurrences(e.current, 'Leaf') > 2);
  }

  // E3: ordered list start preserved by Turndown, lost by current extraction.
  {
    const e = byId(extraction, 'E3');
    add('E3',
      'Ordered-list start=5 survives Turndown and the renderer; current extraction renumbers from 1.',
      'current starts "1. Five"; Turndown render contains ol(start=5)',
      `current first line=${JSON.stringify(e.current.split('\n')[0])}; turndown render=${JSON.stringify(e.turndownGfmRender.split('\n')[0])}`,
      /^1\. Five$/.test(e.current.split('\n')[0]) && /ol\(start=5\)/.test(e.turndownGfmRender));
  }

  // E7: pre>code emitted twice by the current extractor, once by Turndown.
  {
    const e = byId(extraction, 'E7');
    add('E7',
      'A pre>code block is emitted twice by current extraction and once by Turndown.',
      'current occurrences of "const a = 1;" = 2; Turndown = 1',
      `current=${occurrences(e.current, 'const a = 1;')}; turndown=${occurrences(e.turndownGfm, 'const a = 1;')}`,
      occurrences(e.current, 'const a = 1;') === 2 && occurrences(e.turndownGfm, 'const a = 1;') === 1);
  }

  // E8: document order.
  {
    const e = byId(extraction, 'E8');
    const currentOrderLost = e.current.indexOf('End.') < e.current.indexOf('- one');
    const turndownOrderKept = e.turndownGfm.indexOf('-   one') < e.turndownGfm.indexOf('Middle.')
      && e.turndownGfm.indexOf('echo hi') < e.turndownGfm.indexOf('End.');
    add('E8',
      'Current extraction puts all prose before lists and code; Turndown follows document order.',
      'current: "End." before "- one"; Turndown: list before "Middle.", code before "End."',
      `current order lost=${currentOrderLost}; turndown order kept=${turndownOrderKept}`,
      currentOrderLost && turndownOrderKept);
  }

  // E13: quote with a list.
  {
    const e = byId(extraction, 'E13');
    add('E13',
      'A list inside a blockquote stays inside the quote under Turndown; current extraction moves it after the quote text.',
      'current: "After" before "- item"; Turndown: "> -   item" between "> Before" and "> After"',
      `current index(After)=${e.current.indexOf('After')}, index(- item)=${e.current.indexOf('- item')}; turndown quoted list=${/>\s+-   item/.test(e.turndownGfm)}`,
      e.current.indexOf('After') < e.current.indexOf('- item') && />\s+-   item/.test(e.turndownGfm));
  }

  // E15: fenced code containing a pipe table.
  {
    const e = byId(extraction, 'E15');
    add('E15',
      'A fenced code block containing pipes is emitted twice by current extraction and once by Turndown.',
      'current occurrences of "| a | b |" = 2; Turndown = 1',
      `current=${occurrences(e.current, '| a | b |')}; turndown=${occurrences(e.turndownGfm, '| a | b |')}`,
      occurrences(e.current, '| a | b |') === 2 && occurrences(e.turndownGfm, '| a | b |') === 1);
  }

  // R1: soft line breaks.
  {
    const r = byId(renderer, 'R1');
    const pCount = parse(r.html).querySelectorAll('p').length;
    add('R1',
      'Three source lines render as three paragraphs instead of one paragraph with soft breaks.',
      '1 paragraph',
      `${pCount} paragraphs`,
      pCount === 1);
  }

  // R2: absolute link.
  {
    const r = byId(renderer, 'R2');
    const href = parse(r.html).querySelector('a')?.getAttribute('href');
    add('R2',
      'An absolute Markdown link keeps its destination.',
      'https://example.com/a',
      JSON.stringify(href),
      href === 'https://example.com/a');
  }

  // R3: marker-type switch.
  {
    const r = byId(renderer, 'R3');
    const root = parse(r.html);
    const topLists = Array.from(root.children).filter(el => el.tagName === 'UL' || el.tagName === 'OL');
    add('R3',
      'A switch from "-" to "1." at the same level produces a second list.',
      'two top-level lists (ul then ol)',
      `${topLists.length} top-level list(s): ${topLists.map(l => l.tagName).join(',') || 'none'}`,
      topLists.length === 2 && topLists[0].tagName === 'UL' && topLists[1].tagName === 'OL');
  }

  // R6b: delimiter-less pipe text.
  {
    const r = byId(renderer, 'R6b');
    const bodyRows = parse(r.html).querySelectorAll('tbody tr').length;
    add('R6b',
      'Delimiter-less pipe text is not a GFM table; the renderer consumes the second row as alignment data.',
      'unsupported input; the test records the actual handling',
      `${bodyRows} body row(s)`,
      bodyRows === 1);
  }

  // R13: escaped pipe.
  {
    const r = byId(renderer, 'R13');
    const firstBodyRow = parse(r.html).querySelector('tbody tr');
    const cells = firstBodyRow ? firstBodyRow.children.length : 0;
    add('R13',
      'An escaped pipe inside a table cell stays inside that cell.',
      '2 cells in the first body row',
      `${cells} cells`,
      cells === 2);
  }

  // R15: lazy continuation.
  {
    const r = byId(renderer, 'R15');
    const root = parse(r.html);
    const listItems = root.querySelectorAll('ol > li').length;
    add('R15',
      'A lazily continued ordered list keeps both items in one list.',
      '2 ordered list items',
      `${listItems} ordered list item(s)`,
      listItems === 2);
  }

  // P1: aria-labelledby resolution through the exact getARIAContext() source.
  {
    const md = extractBody('<main><div aria-labelledby="lbl">Labelled text</div><span id="lbl">Label text</span></main>');
    add('P1',
      'getARIAContext() resolves aria-labelledby through CSS.escape (polyfilled in jsdom).',
      'extraction contains "[aria-labelledby: Label text]"',
      JSON.stringify(md.split('\n').find(line => line.includes('Labelled text')) || md),
      md.includes('[aria-labelledby: Label text]'));
  }

  // P2: aria-hidden skip.
  {
    const md = extractBody('<main><div aria-hidden="true">secret text</div><p>visible text</p></main>');
    add('P2',
      'aria-hidden="true" content is excluded by hasVisibleText().',
      'extraction contains "visible text" and not "secret text"',
      JSON.stringify(md),
      md.includes('visible text') && !md.includes('secret text'));
  }

  return checks;
}
