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
