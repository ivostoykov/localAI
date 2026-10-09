import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const liCode = fs.readFileSync(path.join(__dirname, '../src/jslib/li-extractor.js'), 'utf-8');
const ceCode = fs.readFileSync(path.join(__dirname, '../src/jslib/content-extractor.js'), 'utf-8');

const fakeWindow = { location: { hostname: '', pathname: '' } };

function setLocation(url) {
    const u = new URL(url);
    fakeWindow.location.hostname = u.hostname;
    fakeWindow.location.pathname = u.pathname;
}

function getDocumentContentFiltered() {
    return document.body.cloneNode(true);
}

// Minimal stand-ins for the content.js helpers used by generic extraction.
function hasVisibleText(node) {
    return /\S/.test(node?.nodeValue || '');
}

function getARIAContext() {
    return '';
}

const load = (code, exportsList) => new Function(
    'window', 'getDocumentContentFiltered', 'hasVisibleText', 'getARIAContext',
    `${code}\nreturn { ${exportsList} };`
)(fakeWindow, getDocumentContentFiltered, hasVisibleText, getARIAContext);

const li = load(liCode, 'isLinkedInJobsPage, isLinkedInProfilePage, extractLinkedInJobContent');
const withLi = load(`${liCode}\n${ceCode}`, 'getEnhancedPageContent');
const withoutLi = load(ceCode, 'getEnhancedPageContent');
const withThrowingLi = load(
    `function isLinkedInJobsPage() { return true; }
function extractLinkedInJobContent() { throw new Error('extractor failure'); }
${ceCode}`,
    'getEnhancedPageContent'
);

const SUMMARY = `<div><p>Atos</p>
<p>Chief Technology Officer - Digital Applications</p>
<p>England, United Kingdom · 1 week ago · 92 people clicked apply</p>
<p>Hybrid</p>
<button aria-label="Apply on company website">Apply</button>
<button aria-label="Save the job">Save</button></div>`;

const PEOPLE = `<div id="JobDetailsPeopleWhoCanHelpSlot_1"><h2>People you can reach out to</h2>
<p>Guy and others in your network</p>
<a href="#">Show all</a></div>`;

const ABOUT = `<div id="JobDetails_AboutTheJob_1"><h2>About the job</h2>
<p>Show all your leadership. Save time and apply modern practices.</p>
<p>Choose your future.</p>
<button>… more</button></div>`;

function renderJob({ summary = SUMMARY, people = PEOPLE, about = ABOUT } = {}) {
    document.body.innerHTML = `<main><div data-component-type="LazyColumn">
  <div id="JobDetails_ManageJobBanner_1"></div>
  ${summary}
  <div><div><h2>Use AI to assess how you fit</h2><p>Premium</p></div>
  ${people}
  ${about}
  </div>
</div></main>`;
}

describe('li-extractor.js LinkedIn jobs', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        setLocation('https://www.linkedin.com/jobs/view/4470869769/?alternateChannel=search');
    });

    describe('isLinkedInJobsPage', () => {
        it.each([
            'https://www.linkedin.com/jobs/view/4470869769/',
            'https://www.linkedin.com/jobs/view/4470869769/?currentJobId=1&eBP=abc',
            'https://linkedin.com/jobs/search/?keywords=cto',
            'https://uk.linkedin.com/jobs/collections/recommended/'
        ])('matches %s', url => {
            setLocation(url);
            expect(li.isLinkedInJobsPage()).toBe(true);
        });

        it.each([
            'https://www.linkedin.com/in/someone/',
            'https://www.linkedin.com/feed/?redirect=/jobs/view/1',
            'https://notlinkedin.com/jobs/view/1',
            'https://linkedin.com.evil.example/jobs/view/1',
            'https://example.com/jobs/view/1?ref=linkedin.com',
            'https://www.linkedin.com/jobsearch/'
        ])('does not match %s', url => {
            setLocation(url);
            expect(li.isLinkedInJobsPage()).toBe(false);
        });
    });

    describe('extractLinkedInJobContent', () => {
        it('joins summary, people and about sections in order', () => {
            renderJob();
            const parts = li.extractLinkedInJobContent().split('\n\n---\n\n');
            expect(parts).toHaveLength(3);
            expect(parts[0]).toContain('Chief Technology Officer - Digital Applications');
            expect(parts[1]).toContain('Guy and others in your network');
            expect(parts[2]).toMatch(/^About the job/);
        });

        it('finds the summary despite whitespace text nodes and the empty banner', () => {
            renderJob();
            const column = document.querySelector('[data-component-type="LazyColumn"]');
            expect(column.childNodes[1].nodeType).toBe(Node.ELEMENT_NODE);
            expect(column.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
            expect(li.extractLinkedInJobContent()).toMatch(/^Atos/);
        });

        it('removes standalone controls but keeps matching words in content', () => {
            renderJob();
            const result = li.extractLinkedInJobContent();
            expect(result).toContain('92 people clicked apply');
            expect(result).toContain('Show all your leadership. Save time and apply modern practices.');
            expect(result).not.toMatch(/^\s*(?:Apply|Save|Show all)\s*$/m);
            expect(result).not.toMatch(/… more\s*$/);
            expect(result).toMatch(/Choose your future\.$/);
        });

        it('omits absent people section without an empty separator', () => {
            renderJob({ people: '' });
            const result = li.extractLinkedInJobContent();
            expect(result.split('\n\n---\n\n')).toHaveLength(2);
            expect(result).not.toContain('---\n\n---');
        });

        it('omits the summary rather than taking a headed section by position', () => {
            renderJob({ summary: '' });
            const parts = li.extractLinkedInJobContent().split('\n\n---\n\n');
            expect(parts).toHaveLength(2);
            expect(parts[0]).toContain('Guy and others');
            expect(parts.join()).not.toContain('Use AI to assess');
        });

        it('returns null when about the job is missing or empty', () => {
            renderJob({ about: '' });
            expect(li.extractLinkedInJobContent()).toBeNull();
            renderJob({ about: '<div id="JobDetails_AboutTheJob_1"><button>… more</button></div>' });
            expect(li.extractLinkedInJobContent()).toBeNull();
        });

        it('returns null when about the job holds only its heading and controls', () => {
            renderJob({ about: '<div id="JobDetails_AboutTheJob_1"><h2>About the job</h2></div>' });
            expect(li.extractLinkedInJobContent()).toBeNull();
            renderJob({ about: '<div id="JobDetails_AboutTheJob_1"><h2>About the job</h2>\n<a href="#">Show all</a>\n<button>… more</button></div>' });
            expect(li.extractLinkedInJobContent()).toBeNull();
        });

        it('does not click controls or navigate', () => {
            renderJob();
            let clicks = 0;
            document.addEventListener('click', () => clicks++, true);
            li.extractLinkedInJobContent();
            expect(clicks).toBe(0);
        });
    });

    describe('getEnhancedPageContent routing', () => {
        it('returns the jobs content on a LinkedIn jobs page', async () => {
            renderJob();
            const result = await withLi.getEnhancedPageContent();
            expect(result).toContain('=== PAGE CONTENT ===');
            expect(result).toContain('Chief Technology Officer - Digital Applications\n');
            expect(result).toContain('\n\n---\n\nAbout the job');
            expect(result).not.toContain('Use AI to assess');
            expect(result).toMatch(/Choose your future\.\n\n=== END OF PAGE CONTENT ===$/);
        });

        it('falls back to generic extraction when core job content is missing', async () => {
            renderJob({ about: '' });
            const result = await withLi.getEnhancedPageContent();
            expect(result).toContain('Use AI to assess');
            expect(result).not.toContain('\n\n---\n\n');
        });

        it('falls back to generic extraction when about the job is only a heading', async () => {
            renderJob({ about: '<div id="JobDetails_AboutTheJob_1"><h2>About the job</h2></div>' });
            const result = await withLi.getEnhancedPageContent();
            expect(result).toContain('Use AI to assess');
            expect(result).not.toContain('\n\n---\n\n');
        });

        it('falls back to generic extraction when the jobs helper throws', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            renderJob();
            const result = await withThrowingLi.getEnhancedPageContent();
            expect(result).toContain('Use AI to assess');
            expect(result).not.toContain('\n\n---\n\n');
            expect(warn).toHaveBeenCalledTimes(1);
            warn.mockRestore();
        });

        it('falls back to generic extraction when the jobs helper is unavailable', async () => {
            renderJob();
            const result = await withoutLi.getEnhancedPageContent();
            expect(result).toContain('Use AI to assess');
        });

        it('uses generic extraction for other sites', async () => {
            setLocation('https://example.com/jobs/view/1');
            renderJob();
            const result = await withLi.getEnhancedPageContent();
            expect(result).toContain('Use AI to assess');
        });

        it('keeps profile routing on /in/ pages', async () => {
            setLocation('https://www.linkedin.com/in/someone/');
            expect(li.isLinkedInProfilePage()).toBe(true);
            expect(li.isLinkedInJobsPage()).toBe(false);
            document.body.innerHTML = `<main><h2>About</h2><p>Profile text</p>
<section componentkey="ExperienceTopLevelSection"><h2>Experience</h2>
<div componentkey="entity-collection-item-1"><p>Engineer</p><p>Acme · Full-time</p><p>Jan 2020 - Present · 6 yrs</p></div>
</section></main>`;
            const result = await withLi.getEnhancedPageContent();
            expect(result).toContain('Profile text');
            expect(result).toContain('Company: Acme');
            expect(result).toContain('- Title: Engineer');
        });
    });
});
