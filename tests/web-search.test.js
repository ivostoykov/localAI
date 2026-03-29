import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeBrowser } from '@webext-core/fake-browser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const searchEnginesCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/search-engines.js'),
    'utf-8'
);
const webSearchCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/web-search.js'),
    'utf-8'
);

const moduleCode = `
    ${searchEnginesCode}
    var DEFAULT_SEARCH_ENGINE = 'duckduckgo';
    var DEFAULT_SEARCH_RESULT_COUNT = 3;
    ${webSearchCode}
    return { waitForTabLoad, extractSerpUrls, isCaptchaOrConsentPage, fetchPageSummary, searchWeb };
`;

const { waitForTabLoad, extractSerpUrls, isCaptchaOrConsentPage, fetchPageSummary, searchWeb } =
    new Function(moduleCode)();

describe('web-search.js', () => {
    beforeEach(() => {
        fakeBrowser.reset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    describe('waitForTabLoad', () => {
        it('resolves when the target tab fires complete', async () => {
            const promise = waitForTabLoad(7);
            await fakeBrowser.tabs.onUpdated.trigger(7, { status: 'complete' }, { id: 7 });
            await expect(promise).resolves.toBeUndefined();
        });

        it('ignores complete events from other tabs', async () => {
            const promise = waitForTabLoad(7);
            let resolved = false;
            promise.then(() => { resolved = true; });

            await fakeBrowser.tabs.onUpdated.trigger(99, { status: 'complete' }, { id: 99 });
            await Promise.resolve();

            expect(resolved).toBe(false);

            await fakeBrowser.tabs.onUpdated.trigger(7, { status: 'complete' }, { id: 7 });
            await promise;
        });

        it('ignores loading status events', async () => {
            const promise = waitForTabLoad(7);
            let resolved = false;
            promise.then(() => { resolved = true; });

            await fakeBrowser.tabs.onUpdated.trigger(7, { status: 'loading' }, { id: 7 });
            await Promise.resolve();

            expect(resolved).toBe(false);

            await fakeBrowser.tabs.onUpdated.trigger(7, { status: 'complete' }, { id: 7 });
            await promise;
        });

        it('rejects after the specified timeout', async () => {
            vi.useFakeTimers();
            const promise = waitForTabLoad(1, 5000);
            const assertion = expect(promise).rejects.toThrow('Tab load timed out');
            await vi.advanceTimersByTimeAsync(5000);
            await assertion;
        });
    });

    describe('isCaptchaOrConsentPage', () => {
        beforeEach(() => {
            vi.spyOn(chrome.scripting, 'executeScript');
        });

        it.each([
            ['captcha',          'solve the captcha please'],
            ['verify',           'please verify you are human'],
            ['consent',          'cookie consent required'],
            ['blocked',          'your request has been blocked'],
            ['unusual traffic',  'unusual traffic from your computer network'],
            ['robot',            'are you a robot?'],
        ])('returns true when page title contains "%s"', async (_, title) => {
            chrome.scripting.executeScript.mockResolvedValue([{ result: title }]);
            expect(await isCaptchaOrConsentPage(1)).toBe(true);
        });

        it('returns false for a normal search results title', async () => {
            chrome.scripting.executeScript.mockResolvedValue([{ result: 'best javascript frameworks 2024' }]);
            expect(await isCaptchaOrConsentPage(1)).toBe(false);
        });

        it('returns false when executeScript throws', async () => {
            chrome.scripting.executeScript.mockRejectedValue(new Error('scripting unavailable'));
            expect(await isCaptchaOrConsentPage(1)).toBe(false);
        });
    });

    describe('extractSerpUrls', () => {
        beforeEach(() => {
            vi.spyOn(chrome.scripting, 'executeScript');
        });

        it('filters out own-engine URLs for DuckDuckGo', async () => {
            chrome.scripting.executeScript.mockResolvedValue([{
                result: ['https://example.com', 'https://duckduckgo.com/?q=test']
            }]);
            const urls = await extractSerpUrls(1, 'duckduckgo', 5);
            expect(urls).toEqual(['https://example.com']);
        });

        it('deduplicates results', async () => {
            chrome.scripting.executeScript.mockResolvedValue([{
                result: ['https://example.com', 'https://example.com', 'https://other.com']
            }]);
            const urls = await extractSerpUrls(1, 'duckduckgo', 5);
            expect(urls).toEqual(['https://example.com', 'https://other.com']);
        });

        it('limits results to maxResults', async () => {
            chrome.scripting.executeScript.mockResolvedValue([{
                result: ['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com']
            }]);
            const urls = await extractSerpUrls(1, 'duckduckgo', 2);
            expect(urls).toHaveLength(2);
        });

        it('applies decodeUrl for Google redirect URLs', async () => {
            chrome.scripting.executeScript.mockResolvedValue([{
                result: ['https://www.google.com/url?q=https://example.com/article&sa=U']
            }]);
            const urls = await extractSerpUrls(1, 'google', 5);
            expect(urls).toEqual(['https://example.com/article']);
        });

        it('filters out google.com URLs after decoding', async () => {
            chrome.scripting.executeScript.mockResolvedValue([{
                result: ['https://www.google.com/search?q=test', 'https://example.com']
            }]);
            const urls = await extractSerpUrls(1, 'google', 5);
            expect(urls).toEqual(['https://example.com']);
        });

        it('returns an empty array when executeScript throws', async () => {
            chrome.scripting.executeScript.mockRejectedValue(new Error('scripting unavailable'));
            const urls = await extractSerpUrls(1, 'duckduckgo', 5);
            expect(urls).toEqual([]);
        });

        it('passes maxResults to the injected script', async () => {
            chrome.scripting.executeScript.mockResolvedValue([{ result: [] }]);
            await extractSerpUrls(1, 'duckduckgo', 3);
            const call = chrome.scripting.executeScript.mock.calls[0][0];
            expect(call.args).toContain(3);
        });
    });

    describe('fetchPageSummary', () => {
        const TAB_ID = 42;

        beforeEach(() => {
            vi.spyOn(chrome.tabs, 'update').mockImplementation(async (tabId) => {
                await fakeBrowser.tabs.onUpdated.trigger(tabId, { status: 'complete' }, { id: tabId });
            });
            vi.spyOn(chrome.tabs, 'sendMessage');
        });

        it('returns empty content when getMainContentOnly returns its diagnostic string', async () => {
            chrome.tabs.sendMessage.mockResolvedValue({
                result: 'Could not detect main content area. The page may not have semantic HTML structure. Use get_enhanced_page_content to get all content.'
            });
            const { url, content } = await fetchPageSummary(TAB_ID, 'https://example.com');
            expect(url).toBe('https://example.com');
            expect(content).toBe('');
        });

        it('returns empty content when response has an error field', async () => {
            chrome.tabs.sendMessage.mockResolvedValue({ error: 'extraction failed' });
            const { content } = await fetchPageSummary(TAB_ID, 'https://example.com');
            expect(content).toBe('');
        });

        it('returns the extracted content for a valid response', async () => {
            chrome.tabs.sendMessage.mockResolvedValue({ result: '# Article\n\nSome text here.' });
            const { content } = await fetchPageSummary(TAB_ID, 'https://example.com');
            expect(content).toBe('# Article\n\nSome text here.');
        });

        it('returns empty content when sendMessage rejects', async () => {
            chrome.tabs.sendMessage.mockRejectedValue(new Error('No content script on this page'));
            const { content } = await fetchPageSummary(TAB_ID, 'https://example.com');
            expect(content).toBe('');
        });

        it('returns the original url alongside content', async () => {
            chrome.tabs.sendMessage.mockResolvedValue({ result: 'some content' });
            const { url } = await fetchPageSummary(TAB_ID, 'https://example.com/page');
            expect(url).toBe('https://example.com/page');
        });
    });

    describe('searchWeb', () => {
        it('returns early for an empty query', async () => {
            expect(await searchWeb('')).toBe('No search query provided.');
        });

        it('returns early for a whitespace-only query', async () => {
            expect(await searchWeb('   ')).toBe('No search query provided.');
        });

        it('returns early for an undefined query', async () => {
            expect(await searchWeb(undefined)).toBe('No search query provided.');
        });
    });
});
