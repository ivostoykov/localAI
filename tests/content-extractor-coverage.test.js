import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ceCode = fs.readFileSync(path.join(__dirname, '../src/jslib/content-extractor.js'), 'utf-8');
const liCode = fs.readFileSync(path.join(__dirname, '../src/jslib/li-extractor.js'), 'utf-8');

function load({ linkedin = false, filter = root => root } = {}) {
  return new Function(
    'window', 'getDocumentContentFiltered', 'hasVisibleText', 'getARIAContext',
    `${linkedin ? liCode : ''}\n${ceCode}\nreturn { countTextCharacters, getVisiblePageCharacters, getEnhancedPageContent, getMainContentOnly, formatEnhancedPageContent, getPageMetadataFormatted, getPageStructureSummary };`
  )({ location: { hostname: 'www.linkedin.com', pathname: '/jobs/view/123/' } },
    () => filter(document.body.cloneNode(true)), node => /\S/.test(node.nodeValue), () => '');
}

const metadata = { url: 'https://example.test/page', title: 'Coverage test', keywords: [] };
const coverageLines = output => output.split('\n').filter(line => /^(Content scope|Coverage|Coverage note):/.test(line));
const scope = 'Content scope: whole page (no main content region detected)';
const note = 'Coverage note: most of the visible page is not included in this extract.';
let innerTextDescriptor;

function setInnerText(value) {
  Object.defineProperty(document.body, 'innerText', { configurable: true, value });
}

beforeEach(() => {
  document.head.innerHTML = '<title>Coverage test</title>';
  document.body.innerHTML = '';
  innerTextDescriptor = Object.getOwnPropertyDescriptor(document.body, 'innerText');
  setInnerText(undefined);
});

afterEach(() => {
  if (innerTextDescriptor) Object.defineProperty(document.body, 'innerText', innerTextDescriptor);
  else delete document.body.innerText;
});

describe('page extraction coverage', () => {
  it('reports exact selected-region and whole-page counts', async () => {
    document.body.innerHTML = '<nav>Nav</nav><main>Article</main><footer>End</footer>';
    expect(coverageLines(await load().getEnhancedPageContent())).toEqual([
      'Content scope: main content region (<main>)',
      'Coverage: 7 of 13 visible page characters (54%)'
    ]);
  });

  it('identifies the selected region by tag and id', async () => {
    document.body.innerHTML = '<div id="content">Body</div>';
    expect(coverageLines(await load().getEnhancedPageContent())).toEqual([
      'Content scope: main content region (<div#content>)',
      'Coverage: 4 of 4 visible page characters (100%)'
    ]);
  });

  it('reports whole-page fallback at 100 percent', async () => {
    document.body.innerHTML = '<p>Body</p>';
    expect(coverageLines(await load().getEnhancedPageContent())).toEqual([
      scope, 'Coverage: 4 of 4 visible page characters (100%)'
    ]);
  });

  it.each([
    ['123456', 40, true], ['1234', 50, false], ['123', 57, false]
  ])('uses the low-coverage threshold with outside text %s', async (outside, pct, low) => {
    document.body.innerHTML = `<nav>${outside}</nav><main>Body</main>`;
    const expected = [
      'Content scope: main content region (<main>)',
      `Coverage: 4 of ${outside.length + 4} visible page characters (${pct}%)`
    ];
    if (low) expected.push(note);
    expect(coverageLines(await load().getEnhancedPageContent())).toEqual(expected);
  });

  it('caps the percentage when extracted characters exceed live visible characters', async () => {
    document.body.innerHTML = '<p>Longer text</p>';
    setInnerText('short');
    expect(coverageLines(await load().getEnhancedPageContent())).toEqual([
      scope, 'Coverage: 11 of 5 visible page characters (100%)'
    ]);
  });

  it('uses collapsed and trimmed live innerText when available', async () => {
    document.body.innerHTML = '<main>Body</main>';
    setInnerText(' \tNav\n Body \r\fEnd  ');
    expect(load().getVisiblePageCharacters()).toBe(12);
    expect(coverageLines(await load().getEnhancedPageContent())).toEqual([
      'Content scope: main content region (<main>)',
      'Coverage: 4 of 12 visible page characters (33%)', note
    ]);
  });

  it('falls back to text nodes when innerText is unavailable', () => {
    document.body.innerHTML = '<p> Hello <b>world</b> </p>';
    expect(load().getVisiblePageCharacters()).toBe(12);
  });

  it.each([undefined, ''])('reports only scope for an empty visible page (%s)', async innerText => {
    setInnerText(innerText);
    const output = await load().getEnhancedPageContent();
    expect(coverageLines(output)).toEqual([scope]);
    expect(output).not.toMatch(/NaN|Infinity/);
  });

  it('reflects removal of user-filtered elements in extracted characters', async () => {
    document.body.innerHTML = '<main>Body<span class="ad">Advert</span></main>';
    const ce = load({ filter: root => { root.querySelector('.ad').remove(); return root; } });
    expect(coverageLines(await ce.getEnhancedPageContent())).toEqual([
      'Content scope: main content region (<main>)',
      'Coverage: 4 of 10 visible page characters (40%)', note
    ]);
  });

  it('adds coverage to the main-content tool when a region exists', async () => {
    document.body.innerHTML = '<nav>Nav</nav><main>Article</main>';
    const output = await load().getMainContentOnly();
    expect(output.startsWith('=== PAGE METADATA ===')).toBe(true);
    expect(coverageLines(output)).toEqual([
      'Content scope: main content region (<main>)',
      'Coverage: 7 of 10 visible page characters (70%)'
    ]);
  });

  it('preserves the main-content fallback prefix and adds coverage', async () => {
    document.body.innerHTML = '<p>Body</p>';
    const output = await load().getMainContentOnly();
    expect(output.split('\n')[0]).toBe('CONTENT SCOPE: whole page (no main content region detected)');
    expect(coverageLines(output)).toEqual([scope, 'Coverage: 4 of 4 visible page characters (100%)']);
  });

  it('reports site-specific LinkedIn job scope without a ratio', async () => {
    document.body.innerHTML = `<main><div data-component-type="LazyColumn">
      <div id="JobDetails_ManageJobBanner_1"></div>
      <div><p>Company</p><p>Developer</p></div>
      <div id="JobDetails_AboutTheJob_1"><h2>About the job</h2><p>Build applications.</p></div>
    </div></main>`;
    expect(coverageLines(await load({ linkedin: true }).getEnhancedPageContent())).toEqual([
      'Content scope: site-specific extraction (LinkedIn job advert)'
    ]);
  });

  it('keeps formatter output byte-identical without coverage', () => {
    const output = load().formatEnhancedPageContent([
      { level: 0, title: '', blocks: [{ type: 'text', text: 'Body' }] }
    ], metadata);
    expect(output).toBe('=== PAGE METADATA ===\nURL: https://example.test/page\nTitle: Coverage test\n\n=== PAGE CONTENT ===\n\nBody\n\n=== END OF PAGE CONTENT ===');
  });

  it('places coverage after the last metadata field', () => {
    const output = load().formatEnhancedPageContent([], {
      ...metadata, type: 'article', coverage: { scope: 'test', extractedChars: 1, visibleChars: 1 }
    });
    expect(output.split('\n')).toEqual([
      '=== PAGE METADATA ===', 'URL: https://example.test/page', 'Title: Coverage test',
      'Type: article', 'Content scope: test', 'Coverage: 1 of 1 visible page characters (100%)',
      '', '=== PAGE CONTENT ===', '', '=== END OF PAGE CONTENT ==='
    ]);
  });

  it.each([
    [NaN, 10], [1, Infinity], [undefined, 10], [1, -1]
  ])('omits ratios with invalid counts %s/%s', (extractedChars, visibleChars) => {
    const output = load().formatEnhancedPageContent([], { ...metadata, coverage: { scope: 'test', extractedChars, visibleChars } });
    expect(coverageLines(output)).toEqual(['Content scope: test']);
    expect(output).not.toMatch(/NaN|Infinity/);
  });

  it('does not add coverage to metadata-only or structure-summary tools', async () => {
    document.body.innerHTML = '<main>Body</main>';
    const ce = load();
    expect(coverageLines(ce.getPageMetadataFormatted())).toEqual([]);
    expect((await ce.getPageStructureSummary()).metadata).not.toHaveProperty('coverage');
  });
});

describe('countTextCharacters', () => {
  it('excludes script, style, noscript and template text', () => {
    document.body.innerHTML = '<p>Body</p><script>script text</script><style>style text</style><noscript>noscript text</noscript><template>template text</template>';
    expect(load().countTextCharacters(document.body)).toBe(4);
  });

  it('collapses ASCII whitespace per node, preserves boundary spaces and ignores blank nodes', () => {
    document.body.innerHTML = '<p> \tOne\n <b> two\r\f </b> \n <i>three</i></p>';
    expect(load().countTextCharacters(document.body)).toBe(15);
  });

  it('does not collapse non-breaking spaces inside text', () => {
    document.body.innerHTML = '<p>a&nbsp;&nbsp;b</p>';
    expect(load().countTextCharacters(document.body)).toBe(4);
  });

  it('returns zero for a missing root', () => {
    expect(load().countTextCharacters(null)).toBe(0);
  });
});
