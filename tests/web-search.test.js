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
    const requestWebAccessConsent = async () => ({ granted: true });
    const throwIfNavigationCancelled = async () => {};
    ${webSearchCode}
    return { waitForTabLoad, extractSerpUrls, isCaptchaOrConsentPage, fetchPageSummary,
        searchWeb: (query, originTabId) => searchWeb(query, { originTabId }) };
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

        it('ignores the initial about:blank completion', async () => {
            const promise = waitForTabLoad(7, 'about:blank');
            let resolved = false;
            promise.then(() => { resolved = true; });

            await fakeBrowser.tabs.onUpdated.trigger(7, { status: 'complete' }, { id: 7, url: 'about:blank' });
            await Promise.resolve();

            expect(resolved).toBe(false);

            await fakeBrowser.tabs.onUpdated.trigger(7, { status: 'complete' }, { id: 7, url: 'https://duckduckgo.com/?q=test' });
            await promise;
        });

        it('ignores the completion of the page the tab was already on', async () => {
            const promise = waitForTabLoad(7, 'https://example.com/one');
            let resolved = false;
            promise.then(() => { resolved = true; });

            await fakeBrowser.tabs.onUpdated.trigger(7, { status: 'complete' }, { id: 7, url: 'https://example.com/one' });
            await Promise.resolve();

            expect(resolved).toBe(false);

            await fakeBrowser.tabs.onUpdated.trigger(7, { status: 'complete' }, { id: 7, url: 'https://example.com/two' });
            await promise;
        });

        it('falls back to the tab URL when the event has none', async () => {
            vi.spyOn(chrome.tabs, 'get').mockResolvedValue({ id: 7, url: 'about:blank' });
            const promise = waitForTabLoad(7, 'about:blank');
            let resolved = false;
            promise.then(() => { resolved = true; });

            await fakeBrowser.tabs.onUpdated.trigger(7, { status: 'complete' }, { id: 7 });
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(resolved).toBe(false);

            chrome.tabs.get.mockResolvedValue({ id: 7, url: 'https://example.com/results' });
            await fakeBrowser.tabs.onUpdated.trigger(7, { status: 'complete' }, { id: 7 });
            await promise;
        });

        it('resolves when the tab URL cannot be read', async () => {
            vi.spyOn(chrome.tabs, 'get').mockRejectedValue(new Error('No tab with id'));
            const promise = waitForTabLoad(7, 'about:blank');
            await fakeBrowser.tabs.onUpdated.trigger(7, { status: 'complete' }, { id: 7 });
            await expect(promise).resolves.toBeUndefined();
        });

        it('resolves when the navigation redirects to a different final URL', async () => {
            const promise = waitForTabLoad(7, 'about:blank');
            await fakeBrowser.tabs.onUpdated.trigger(7, { status: 'complete' }, { id: 7, url: 'https://consent.example.net/accept' });
            await expect(promise).resolves.toBeUndefined();
        });

        it('rejects after the specified timeout', async () => {
            vi.useFakeTimers();
            const promise = waitForTabLoad(1, 'about:blank', 5000);
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

        it('returns empty content when getMainContentOnly found no main content region', async () => {
            chrome.tabs.sendMessage.mockResolvedValue({
                result: 'CONTENT SCOPE: whole page (no main content region detected)\n=== PAGE METADATA ===\nNavigation and footer text'
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

        it('does not extract from a completion of the previous page', async () => {
            vi.useFakeTimers();
            chrome.tabs.update.mockImplementation(async tabId => {
                await fakeBrowser.tabs.onUpdated.trigger(tabId, { status: 'complete' }, { id: tabId, url: 'https://example.com/one' });
            });
            const promise = fetchPageSummary(TAB_ID, 'https://example.com/two', 'https://example.com/one');
            await vi.advanceTimersByTimeAsync(20000);
            const { content } = await promise;
            expect(content).toBe('');
            expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        });

        it('extracts after the new page completes', async () => {
            chrome.tabs.update.mockImplementation(async tabId => {
                await fakeBrowser.tabs.onUpdated.trigger(tabId, { status: 'complete' }, { id: tabId, url: 'https://example.com/one' });
                await fakeBrowser.tabs.onUpdated.trigger(tabId, { status: 'complete' }, { id: tabId, url: 'https://example.com/two' });
            });
            chrome.tabs.sendMessage.mockResolvedValue({ result: 'second page' });
            const { content } = await fetchPageSummary(TAB_ID, 'https://example.com/two', 'https://example.com/one');
            expect(content).toBe('second page');
        });
    });

    describe('searchWeb', () => {
        beforeEach(() => {
            vi.spyOn(chrome.tabs, 'remove');
        });

        it.each([37, 2000, 2456])('reports truncation only for summaries above the cap (%s characters)', async length => {
            vi.spyOn(chrome.tabs, 'create').mockResolvedValue({ id: 42 });
            vi.spyOn(chrome.tabs, 'update').mockImplementation(async tabId => {
                await fakeBrowser.tabs.onUpdated.trigger(tabId, { status: 'complete' }, { id: tabId });
            });
            vi.spyOn(chrome.scripting, 'executeScript')
                .mockResolvedValueOnce([{ result: 'Search results' }])
                .mockResolvedValueOnce([{ result: ['https://example.com/article'] }]);
            const content = 'a'.repeat(length);
            vi.spyOn(chrome.tabs, 'sendMessage').mockResolvedValue({ result: content });
            const output = await searchWeb('test');
            const summary = length > 2000
                ? `${content.slice(0, 2000)}\n[TRUNCATED: first 2000 of ${length} characters shown]`
                : content;
            expect(output).toBe(`# Web Search: "test"\nEngine: DuckDuckGo\n\n## https://example.com/article\n\n${summary}`);
            expect(chrome.tabs.remove).toHaveBeenCalledWith(42);
        });

        it('closes a new tab after a no-results search', async () => {
            vi.spyOn(chrome.tabs, 'create').mockResolvedValue({ id: 43 });
            vi.spyOn(chrome.tabs, 'update').mockImplementation(async tabId => {
                await fakeBrowser.tabs.onUpdated.trigger(tabId, { status: 'complete' }, { id: tabId });
            });
            vi.spyOn(chrome.scripting, 'executeScript')
                .mockResolvedValueOnce([{ result: 'Search results' }])
                .mockResolvedValueOnce([{ result: [] }]);
            expect(await searchWeb('empty')).toContain('No results found');
            expect(chrome.tabs.remove).toHaveBeenCalledWith(43);
        });

        it('closes a new tab after a load failure', async () => {
            vi.spyOn(chrome.tabs, 'create').mockResolvedValue({ id: 44 });
            vi.spyOn(chrome.tabs, 'update').mockRejectedValue(new Error('navigation failed'));
            expect(await searchWeb('failure')).toContain('could not load results page');
            expect(chrome.tabs.remove).toHaveBeenCalledWith(44);
        });

        it('does not treat the initial about:blank load as the results page', async () => {
            vi.useFakeTimers();
            vi.spyOn(chrome.tabs, 'create').mockResolvedValue({ id: 47 });
            vi.spyOn(chrome.tabs, 'update').mockImplementation(async tabId => {
                await fakeBrowser.tabs.onUpdated.trigger(tabId, { status: 'complete' }, { id: tabId, url: 'about:blank' });
            });
            vi.spyOn(chrome.scripting, 'executeScript').mockResolvedValue([{ result: [] }]);
            const promise = searchWeb('test');
            await vi.advanceTimersByTimeAsync(20000);
            expect(await promise).toContain('could not load results page');
            expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
        });

        it('keeps captcha tabs open and warns the originating tab', async () => {
            vi.spyOn(chrome.tabs, 'create').mockResolvedValue({ id: 45 });
            vi.spyOn(chrome.tabs, 'update').mockImplementation(async tabId => {
                await fakeBrowser.tabs.onUpdated.trigger(tabId, { status: 'complete' }, { id: tabId });
            });
            vi.spyOn(chrome.scripting, 'executeScript').mockResolvedValue([{ result: 'captcha' }]);
            vi.spyOn(chrome.tabs, 'sendMessage').mockResolvedValue(undefined);
            expect(await searchWeb('blocked', 9)).toContain('captcha or consent');
            expect(chrome.tabs.remove).not.toHaveBeenCalled();
            expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(9, expect.objectContaining({
                action: 'showMessage', messageType: 'warning'
            }), { frameId: 0 });
        });

        it('swallows a tab close failure', async () => {
            vi.spyOn(chrome.tabs, 'create').mockResolvedValue({ id: 46 });
            vi.spyOn(chrome.tabs, 'update').mockImplementation(async tabId => {
                await fakeBrowser.tabs.onUpdated.trigger(tabId, { status: 'complete' }, { id: tabId });
            });
            vi.spyOn(chrome.scripting, 'executeScript')
                .mockResolvedValueOnce([{ result: 'Search results' }])
                .mockResolvedValueOnce([{ result: [] }]);
            vi.spyOn(chrome.tabs, 'remove').mockRejectedValue(new Error('already closed'));
            await expect(searchWeb('test')).resolves.toContain('No results found');
        });

        it('uses separate tabs for concurrent searches', async () => {
            let nextId = 50;
            vi.spyOn(chrome.tabs, 'create').mockImplementation(async () => ({ id: nextId++ }));
            vi.spyOn(chrome.tabs, 'update').mockImplementation(async tabId => {
                await fakeBrowser.tabs.onUpdated.trigger(tabId, { status: 'complete' }, { id: tabId });
            });
            vi.spyOn(chrome.scripting, 'executeScript').mockResolvedValue([{ result: 'captcha' }]);
            await Promise.all([searchWeb('one'), searchWeb('two')]);
            expect(chrome.tabs.create).toHaveBeenCalledTimes(2);
            expect(chrome.tabs.create.mock.results.map(r => r.value)).toHaveLength(2);
        });

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
