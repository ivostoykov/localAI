/**
 * Content Cleaner Module
 * Basic page content cleaning utilities
 *
 * NOTE: For enhanced content extraction with metadata, tables, lists, code blocks,
 * and selective extraction tools, see: src/jslib/content-extractor.js
 */

async function cleanPageContent() {
    if (typeof getEnhancedPageContent !== 'function') {
        console.error(`>>> ${manifest?.name ?? ''} - cleanPageContent: getEnhancedPageContent function not available`);
        return '';
    }

    try {
        return await getEnhancedPageContent();
    } catch (e) {
        console.error(`>>> ${manifest?.name ?? ''} - cleanPageContent: Error extracting page content`, e);
        return '';
    }
}

function cleanFileContent(content, mimeType) {
    if (!content) {
        return '';
    }

    if (mimeType && mimeType.includes('html')) {
        try {
            const doc = new DOMParser().parseFromString(content, 'text/html');

            const unwantedSelectors = ['script', 'style', 'noscript', 'iframe'];
            unwantedSelectors.forEach(selector => {
                doc.querySelectorAll(selector).forEach(el => el.remove());
            });

            return doc.documentElement?.textContent?.trim() || '';
        } catch (e) {
            console.error(`>>> ${manifest?.name ?? ''} - cleanFileContent: Error parsing HTML`, e);
            return content;
        }
    }

    return content.trim();
}

function cleanSelection(text) {
    if (!text) { return ''; }

    return text.replace(/\r\n?/g, '\n').trim().replace(/\n\s*\n/g, '\n\n').replace(/[^\S\n]+/g, ' ');
}

