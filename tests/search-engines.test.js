import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/search-engines.js'),
    'utf-8'
);

const testCode = `${engineCode}\nreturn { ENGINES, getSearchUrl, getEngineConfig };`;
const { ENGINES, getSearchUrl, getEngineConfig } = new Function(testCode)();

describe('search-engines.js', () => {
    describe('getSearchUrl', () => {
        it('builds a DuckDuckGo URL', () => {
            const url = getSearchUrl('duckduckgo', 'hello world');
            expect(url).toContain('duckduckgo.com');
            expect(url).toContain('hello%20world');
        });

        it('builds a Google URL', () => {
            const url = getSearchUrl('google', 'hello world');
            expect(url).toContain('google.com/search');
            expect(url).toContain('hello%20world');
        });

        it('builds a Bing URL', () => {
            const url = getSearchUrl('bing', 'hello world');
            expect(url).toContain('bing.com/search');
            expect(url).toContain('hello%20world');
        });

        it('falls back to DuckDuckGo for unknown engine', () => {
            const url = getSearchUrl('unknown', 'test');
            expect(url).toContain('duckduckgo.com');
        });

        it('encodes special characters in query', () => {
            const url = getSearchUrl('duckduckgo', 'C++ & Python');
            expect(url).not.toContain(' ');
            expect(url).not.toContain('+');
            expect(url).toContain('duckduckgo.com');
        });
    });

    describe('getEngineConfig', () => {
        it('returns DuckDuckGo config', () => {
            const config = getEngineConfig('duckduckgo');
            expect(config.name).toBe('DuckDuckGo');
            expect(config.resultSelectors).toBeInstanceOf(Array);
            expect(config.resultSelectors.length).toBeGreaterThan(0);
        });

        it('returns Google config', () => {
            const config = getEngineConfig('google');
            expect(config.name).toBe('Google');
            expect(typeof config.decodeUrl).toBe('function');
        });

        it('returns Bing config', () => {
            const config = getEngineConfig('bing');
            expect(config.name).toBe('Bing');
        });

        it('falls back to DuckDuckGo for unknown engine', () => {
            const config = getEngineConfig('yahoo');
            expect(config.name).toBe('DuckDuckGo');
        });

        it('falls back to DuckDuckGo for undefined', () => {
            const config = getEngineConfig(undefined);
            expect(config.name).toBe('DuckDuckGo');
        });
    });

    describe('filterUrl — DuckDuckGo', () => {
        const { filterUrl } = getEngineConfig('duckduckgo');

        it('accepts external URLs', () => {
            expect(filterUrl('https://example.com/article')).toBe(true);
        });

        it('rejects duckduckgo.com URLs', () => {
            expect(filterUrl('https://duckduckgo.com/?q=test')).toBe(false);
        });

        it('rejects non-http URLs', () => {
            expect(filterUrl('ftp://example.com')).toBe(false);
        });
    });

    describe('filterUrl — Google', () => {
        const { filterUrl } = getEngineConfig('google');

        it('accepts external URLs', () => {
            expect(filterUrl('https://example.com/page')).toBe(true);
        });

        it('rejects google.com URLs', () => {
            expect(filterUrl('https://www.google.com/search?q=test')).toBe(false);
        });

        it('rejects googleapis.com URLs', () => {
            expect(filterUrl('https://fonts.googleapis.com/css')).toBe(false);
        });
    });

    describe('filterUrl — Bing', () => {
        const { filterUrl } = getEngineConfig('bing');

        it('accepts external URLs', () => {
            expect(filterUrl('https://example.com/page')).toBe(true);
        });

        it('rejects bing.com URLs', () => {
            expect(filterUrl('https://www.bing.com/search?q=test')).toBe(false);
        });

        it('rejects microsoft.com URLs', () => {
            expect(filterUrl('https://www.microsoft.com/page')).toBe(false);
        });
    });

    describe('decodeUrl — Google', () => {
        const { decodeUrl } = getEngineConfig('google');

        it('decodes /url?q= redirect', () => {
            const redirect = 'https://www.google.com/url?q=https://example.com/article&sa=U';
            expect(decodeUrl(redirect)).toBe('https://example.com/article');
        });

        it('passes through direct URLs unchanged', () => {
            const direct = 'https://example.com/page';
            expect(decodeUrl(direct)).toBe(direct);
        });

        it('passes through non-redirect google URLs unchanged', () => {
            const url = 'https://www.google.com/search?q=test';
            expect(decodeUrl(url)).toBe(url);
        });
    });
});
