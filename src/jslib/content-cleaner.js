/**
 * Content Cleaner Module
 * Basic page content cleaning utilities
 *
 * NOTE: For enhanced content extraction with metadata, tables, lists, code blocks,
 * and selective extraction tools, see: src/jslib/content-extractor.js
 */

async function cleanPageContent() {
    if (typeof getPageTextContent !== 'function') {
        console.error(`>>> ${manifest?.name ?? ''} - cleanPageContent: getPageTextContent function not available`);
        return '';
    }

    try {
        return await getPageTextContent();
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
            const div = document.createElement('div');
            div.innerHTML = content;

            const unwantedSelectors = ['script', 'style', 'noscript', 'iframe'];
            unwantedSelectors.forEach(selector => {
                div.querySelectorAll(selector).forEach(el => el.remove());
            });

            return div.textContent?.trim() || '';
        } catch (e) {
            console.error(`>>> ${manifest?.name ?? ''} - cleanFileContent: Error parsing HTML`, e);
            return content;
        }
    }

    return content.trim();
}

function cleanSelection(text) {
    if (!text) { return ''; }

    return text.trim().replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n\n');
}

