/**
 * Web Search Module
 * Orchestrates browser-session web search using a temporary background tab.
 * Runs in the background service worker context.
 */

const SEARCH_SUMMARY_MAX_CHARS = 2000;

async function createSearchTab() {
    const tab = await chrome.tabs.create({ active: false, url: 'about:blank' });
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
            func: (selectors, limit) => {
                const seen = new Set();
                const links = [];
                for (const sel of selectors) {
                    if (links.length >= limit) break;
                    try {
                        for (const el of document.querySelectorAll(sel)) {
                            if (links.length >= limit) break;
                            const href = el.href;
                            if (href && href.startsWith('http') && !seen.has(href)) {
                                seen.add(href);
                                links.push(href);
                            }
                        }
                    } catch { /* ignore invalid selectors */ }
                }
                return links;
            },
            args: [config.resultSelectors, maxResults]
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
        // No detected region: whole-page text is mostly navigation, so keep the summary empty.
        const content = raw.startsWith('CONTENT SCOPE: whole page') ? '' : raw;
        return { url, content };
    } catch (err) {
        console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - fetchPageSummary failed for ${url}:`, err.message);
        return { url, content: '' };
    }
}

async function searchWeb(query, session) {
    if (typeof query !== 'string' || !query.trim()) {
        return 'No search query provided.';
    }

    if (!session) {
        return 'Search was not performed: no active model request. Do not retry this search unless the user asks for it.';
    }

    const stored = await chrome.storage.sync.get('laiOptions');
    const opts = stored.laiOptions || {};
    const engine = opts.searchEngine || DEFAULT_SEARCH_ENGINE;
    const maxResults = Math.min(Number(opts.searchResultCount) || DEFAULT_SEARCH_RESULT_COUNT, 5);

    const serpUrl = getSearchUrl(engine, query);
    const engineName = getEngineConfig(engine).name;
    const consent = await requestWebAccessConsent(session, {
        kind: 'search', query, provider: engineName, host: new URL(serpUrl).host
    });
    if (!consent.granted) {
        return `Search was not performed: ${consent.reason}. Do not retry this search unless the user asks for it.`;
    }
    await throwIfNavigationCancelled(session);

    const originatingTabId = session.originTabId;
    let searchTabId;
    let keepSearchTab = false;
    try {
        searchTabId = await createSearchTab();
    } catch (err) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Could not create search tab:`, err);
        return `Search failed: could not create search tab. ${err.message}`;
    }

    try {
        await throwIfNavigationCancelled(session);
        try {
            const loadPromise = waitForTabLoad(searchTabId);
            await chrome.tabs.update(searchTabId, { url: serpUrl });
            await loadPromise;
        } catch (err) {
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Could not load results page:`, err);
            return `Search failed: could not load results page. ${err.message}`;
        }

        if (await isCaptchaOrConsentPage(searchTabId)) {
            keepSearchTab = true;
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Search stopped at captcha or consent page`, searchTabId);
            if (originatingTabId) {
                try {
                    await chrome.tabs.sendMessage(originatingTabId, {
                        action: 'showMessage',
                        message: 'The search engine is showing a captcha or consent page in a background tab. Resolve it there, then retry the search.',
                        messageType: 'warning'
                    });
                } catch (err) {
                    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Could not notify originating tab:`, err);
                }
            }
            return 'Search blocked: the search engine is showing a captcha or consent page. Please open the search tab and resolve it manually, then try again.';
        }

        const resultUrls = await extractSerpUrls(searchTabId, engine, maxResults);
        if (resultUrls.length === 0) {
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - No search results found`);
            return `No results found for: "${query}". The search engine page may have changed its layout or the query returned no matches.`;
        }

        const summaries = [];
        for (const url of resultUrls) {
            await throwIfNavigationCancelled(session);
            const { content } = await fetchPageSummary(searchTabId, url);
            if (content?.trim()) {
                const summary = content.length > SEARCH_SUMMARY_MAX_CHARS
                    ? `${content.slice(0, SEARCH_SUMMARY_MAX_CHARS)}\n[TRUNCATED: first ${SEARCH_SUMMARY_MAX_CHARS} of ${content.length} characters shown]`
                    : content;
                summaries.push(`## ${url}\n\n${summary}`);
            }
        }

        if (summaries.length === 0) {
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - No page content extracted`);
            const urlList = resultUrls.map(u => `- ${u}`).join('\n');
            return `Found ${resultUrls.length} result(s) for "${query}" but could not extract content from any of them.\n\nURLs found:\n${urlList}`;
        }

        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - searchWeb complete:`, { engine: engineName, summaries: summaries.length });
        return `# Web Search: "${query}"\nEngine: ${engineName}\n\n${summaries.join('\n\n---\n\n')}`;
    } catch (err) {
        if (err?.name === 'AbortError') { throw err; }
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Search failed unexpectedly:`, err);
        return `Search failed: ${err.message}`;
    } finally {
        if (!keepSearchTab) {
            try {
                await chrome.tabs.remove(searchTabId);
            } catch (err) {
                console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Could not close search tab:`, err);
            }
        }
    }
}
