import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cleanerCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/content-cleaner.js'),
    'utf-8'
);

const executeCleanerCode = new Function('document', cleanerCode + '; return { cleanSelection };');
const { cleanSelection } = executeCleanerCode(global.document);

function loadFileCleaner(DOMParserImpl = global.DOMParser) {
    const execute = new Function('document', 'DOMParser', cleanerCode + '; return { cleanFileContent };');
    return execute(global.document, DOMParserImpl).cleanFileContent;
}

function createRecordingDOMParser(records) {
    const BaseDOMParser = global.DOMParser;
    return class RecordingDOMParser extends BaseDOMParser {
        parseFromString(input, type) {
            const doc = super.parseFromString(input, type);
            records.push({ doc, input, type });
            return doc;
        }
    };
}

describe('cleanSelection (#74)', () => {
    it('returns an empty string for missing text', () => {
        expect(cleanSelection('')).toBe('');
        expect(cleanSelection(null)).toBe('');
        expect(cleanSelection(undefined)).toBe('');
    });

    it('trims surrounding white space', () => {
        expect(cleanSelection('  \n text \n ')).toBe('text');
    });

    it('keeps single line breaks', () => {
        expect(cleanSelection('first line\nsecond line')).toBe('first line\nsecond line');
    });

    it('reduces runs of blank lines to one blank line', () => {
        expect(cleanSelection('first\n\n\n\nsecond')).toBe('first\n\nsecond');
        expect(cleanSelection('first\n \n \nsecond')).toBe('first\n\nsecond');
    });

    it('collapses spaces and tabs inside a line to one space', () => {
        expect(cleanSelection('a \t b\t\tc')).toBe('a b c');
    });

    it('normalises Windows line endings', () => {
        expect(cleanSelection('first line\r\nsecond line\r\n\r\nthird line')).toBe('first line\nsecond line\n\nthird line');
    });
});

describe('cleanFileContent HTML parsing (#100)', () => {
    it('extracts ordinary text and keeps head and body text', () => {
        const cleanFileContent = loadFileCleaner();

        expect(cleanFileContent('<p>Hello <b>world</b> &amp; friends</p>', 'text/html')).toBe('Hello world & friends');
        expect(cleanFileContent('<html><head><title>Doc</title></head><body><h1>Heading</h1><p>Body</p></body></html>', 'text/html'))
            .toBe('DocHeadingBody');
    });

    it('removes script, style, noscript and iframe content as before', () => {
        const cleanFileContent = loadFileCleaner();
        const fixture = [
            '<html><head><style>.hidden { display: none; }</style></head>',
            '<body><p>Kept text</p>',
            '<script>var leaked = true;</script>',
            '<noscript>No script fallback</noscript>',
            '<iframe src="https://example.test/">Frame text</iframe>',
            '<style>.inline { color: red; }</style></body></html>'
        ].join('');

        const text = cleanFileContent(fixture, 'text/html');

        expect(text).toBe('Kept text');
        expect(text).not.toContain('leaked');
        expect(text).not.toContain('fallback');
        expect(text).not.toContain('Frame text');
        expect(text).not.toContain('display: none');
        expect(text).not.toContain('color: red');
    });

    it('does not run event handlers from an attached HTML file', () => {
        globalThis.__attachedHtmlHandlerRan = false;
        const cleanFileContent = loadFileCleaner();
        const fixture = [
            '<html><body>',
            '<img src="missing.png" onerror="globalThis.__attachedHtmlHandlerRan = true">',
            '<svg onload="globalThis.__attachedHtmlHandlerRan = true"></svg>',
            '<p onmouseover="globalThis.__attachedHtmlHandlerRan = true">Safe text</p>',
            '<script>globalThis.__attachedHtmlHandlerRan = true</script>',
            '</body></html>'
        ].join('');

        const text = cleanFileContent(fixture, 'text/html');

        expect(text).toBe('Safe text');
        expect(globalThis.__attachedHtmlHandlerRan).toBe(false);
        delete globalThis.__attachedHtmlHandlerRan;
    });

    it('parses into an inert document owned by DOMParser, not the host page', () => {
        const records = [];
        const cleanFileContent = loadFileCleaner(createRecordingDOMParser(records));
        const hostBodyBefore = document.body.innerHTML;
        const fixture = '<html><body><img src="missing.png" onerror="hostMutation()"><p>Host safe</p></body></html>';

        const text = cleanFileContent(fixture, 'text/html');

        expect(text).toBe('Host safe');
        expect(records).toHaveLength(1);
        expect(records[0].type).toBe('text/html');
        expect(records[0].input).toBe(fixture);
        expect(records[0].doc).not.toBe(document);
        expect(records[0].doc.defaultView).toBeNull();
        expect(document.body.innerHTML).toBe(hostBodyBefore);
        expect(document.querySelector('img')).toBeNull();
    });
});

