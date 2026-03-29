/**
 * Search Engines Module
 * Engine configurations and SERP result selectors for browser-session web search.
 * Pure module — no browser API dependency.
 */

const ENGINES = {
    duckduckgo: {
        name: 'DuckDuckGo',
        buildUrl: (query) => `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=web`,
        resultSelectors: [
            'a[data-testid="result-title-a"]',
            'a.result__a',
            'h2.result__title a'
        ],
        filterUrl: (url) => !url.includes('duckduckgo.com') && url.startsWith('http')
    },
    google: {
        name: 'Google',
        buildUrl: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        resultSelectors: [
            'div#search h3 a[href^="http"]',
            'div.g h3 a[href^="http"]'
        ],
        filterUrl: (url) => {
            try {
                const u = new URL(url);
                return !u.hostname.endsWith('google.com') && !u.hostname.endsWith('googleapis.com');
            } catch {
                return false;
            }
        },
        decodeUrl: (url) => {
            try {
                const u = new URL(url);
                if (u.pathname === '/url') {
                    const decoded = u.searchParams.get('q');
                    if (decoded && decoded.startsWith('http')) return decoded;
                }
            } catch { /* ignore */ }
            return url;
        }
    },
    bing: {
        name: 'Bing',
        buildUrl: (query) => `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
        resultSelectors: [
            'li.b_algo h2 a'
        ],
        filterUrl: (url) => {
            try {
                const u = new URL(url);
                return !u.hostname.endsWith('bing.com') && !u.hostname.endsWith('microsoft.com');
            } catch {
                return false;
            }
        }
    }
};

function getSearchUrl(engine, query) {
    const eng = ENGINES[engine] ?? ENGINES.duckduckgo;
    return eng.buildUrl(query);
}

function getEngineConfig(engine) {
    return ENGINES[engine] ?? ENGINES.duckduckgo;
}
