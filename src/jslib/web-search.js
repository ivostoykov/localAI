/**
 * Web Search Module
 * Orchestrates browser-session web search using a reusable background tab.
 * Runs in the background service worker context.
 */

const SEARCH_TAB_KEY = 'searchTabId';

async function getOrCreateSearchTab() {
    const stored = await chrome.storage.session.get(SEARCH_TAB_KEY);
    const storedId = stored[SEARCH_TAB_KEY];

    if (storedId) {
        try {
            await chrome.tabs.get(storedId);
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Reusing search tab`, storedId);
            return storedId;
        } catch {
            // Tab no longer exists — fall through to create a new one
        }
    }

    const tab = await chrome.tabs.create({ active: false, url: 'about:blank' });
    await chrome.storage.session.set({ [SEARCH_TAB_KEY]: tab.id });
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Created search tab`, tab.id);
    return tab.id;
}

function waitForTabLoad(tabId, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error('Tab load timed out'));
        }, timeoutMs);

        function listener(updatedTabId, changeInfo) {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                clearTimeout(timer);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        }

        chrome.tabs.onUpdated.addListener(listener);
    });
}

async function extractSerpUrls(searchTabId, engine, maxResults) {
    const config = getEngineConfig(engine);

    let scriptResult;
    try {
        scriptResult = await chrome.scripting.executeScript({
            target: { tabId: searchTabId },
            func: (selectors) => {
                const seen = new Set();
                const links = [];
                for (const sel of selectors) {
                    try {
                        document.querySelectorAll(sel).forEach(el => {
                            const anchor = el.tagName === 'A' ? el : el.closest('a');
                            const href = anchor?.href;
                            if (href && href.startsWith('http') && !seen.has(href)) {
                                seen.add(href);
                                links.push(href);
                            }
                        });
                    } catch { /* ignore invalid selectors */ }
                }
                return links;
            },
            args: [config.resultSelectors]
        });
    } catch (err) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - extractSerpUrls failed:`, err);
        return [];
    }

    let urls = scriptResult?.[0]?.result || [];

    if (config.decodeUrl) {
        urls = urls.map(config.decodeUrl);
    }

    if (config.filterUrl) {
        urls = urls.filter(config.filterUrl);
    }

    const result = [...new Set(urls)].slice(0, maxResults);
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - SERP URLs extracted (${result.length}):`, result);
    return result;
}

async function isCaptchaOrConsentPage(tabId) {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => document.title.toLowerCase()
        });
        const title = results?.[0]?.result || '';
        return /captcha|verify|consent|blocked|unusual traffic|robot/i.test(title);
    } catch {
        return false;
    }
}

async function fetchPageSummary(searchTabId, url) {
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Fetching page summary:`, url);
    try {
        const loadPromise = waitForTabLoad(searchTabId);
        await chrome.tabs.update(searchTabId, { url });
        await loadPromise;
        const response = await chrome.tabs.sendMessage(searchTabId, {
            action: 'callContentExtractor',
            functionName: 'getMainContentOnly',
            argument: null
        });
        const raw = response?.error ? '' : (response?.result || '');
        const content = raw.startsWith('Could not detect') ? '' : raw;
        return { url, content };
    } catch (err) {
        console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - fetchPageSummary failed for ${url}:`, err.message);
        return { url, content: '' };
    }
}

async function searchWeb(query) {
    if (!query?.trim()) {
        return 'No search query provided.';
    }

    const stored = await chrome.storage.sync.get('laiOptions');
    const opts = stored.laiOptions || {};
    const engine = opts.searchEngine || DEFAULT_SEARCH_ENGINE;
    const maxResults = Math.min(Number(opts.searchResultCount) || DEFAULT_SEARCH_RESULT_COUNT, 5);

    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - searchWeb:`, { query, engine, maxResults });

    let searchTabId;
    try {
        searchTabId = await getOrCreateSearchTab();
    } catch (err) {
        return `Search failed: could not create search tab. ${err.message}`;
    }

    const serpUrl = getSearchUrl(engine, query);
    try {
        const loadPromise = waitForTabLoad(searchTabId);
        await chrome.tabs.update(searchTabId, { url: serpUrl });
        await loadPromise;
    } catch (err) {
        return `Search failed: could not load results page. ${err.message}`;
    }

    if (await isCaptchaOrConsentPage(searchTabId)) {
        return `Search blocked: the search engine is showing a captcha or consent page. Please open the search tab and resolve it manually, then try again.`;
    }

    const resultUrls = await extractSerpUrls(searchTabId, engine, maxResults);
    if (resultUrls.length === 0) {
        return `No results found for: "${query}". The search engine page may have changed its layout or the query returned no matches.`;
    }

    const summaries = [];
    for (const url of resultUrls) {
        const { content } = await fetchPageSummary(searchTabId, url);
        if (content?.trim()) {
            summaries.push(`## ${url}\n\n${content.slice(0, 2000)}`);
        }
    }

    if (summaries.length === 0) {
        const urlList = resultUrls.map(u => `- ${u}`).join('\n');
        return `Found ${resultUrls.length} result(s) for "${query}" but could not extract content from any of them.\n\nURLs found:\n${urlList}`;
    }

    const engineName = getEngineConfig(engine).name;
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - searchWeb complete:`, { engine: engineName, summaries: summaries.length });
    return `# Web Search: "${query}"\nEngine: ${engineName}\n\n${summaries.join('\n\n---\n\n')}`;
}
