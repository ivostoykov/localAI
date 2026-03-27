/**
 * LinkedIn Profile Experience Extractor
 *
 * Handles the LinkedIn-specific "Experience" section which renders in multiple
 * DOM layouts depending on whether roles are grouped under a company header or
 * listed as standalone entries.
 *
 * Supported layouts:
 *   Grouped   — a company header div followed by a <ul> of role <li> items
 *   Standalone — each entry is a single block with role title first, then
 *                company/employment info, dates, and optional location
 *
 * Entry point called from content-extractor.js:
 *   replaceLinkedInExperienceSection(formattedPageContent) -> string
 *
 * Stable selectors used (avoids minified class names):
 *   section[componentkey*="ExperienceTopLevelSection"]
 *   [componentkey^="entity-collection-item"]
 *   [data-testid="expandable-text-box"]  (achievement / note text)
 */

const _LI_NOISE = new Set(['Show all', 'Show less', 'Show more']);
const _LI_LOC_TYPES = new Set(['hybrid', 'remote', 'on-site', 'on site', 'in person']);
const _LI_DATE_RE = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}|Present|\d{4}\s*[-\u2013]\s*(?:\d{4}|Present)/;

function isLinkedInProfilePage() {
    return /linkedin\.com/.test(window.location.hostname) &&
           /\/in\//.test(window.location.pathname);
}

/**
 * Replaces the raw ## Experience section in the already-formatted page
 * content string with the normalised LinkedIn output.
 * Returns the original string unchanged if no Experience section is found
 * or the current page is not a LinkedIn profile.
 */
function replaceLinkedInExperienceSection(content) {
    const experienceText = _extractLinkedInExperienceSection();
    if (!experienceText) return content;

    const replacement = experienceText.replace(/\n+$/, '\n');
    return content.replace(
        /## Experience\n[\s\S]*?(?=\n## |\n=== END)/,
        replacement
    );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _extractLinkedInExperienceSection() {
    const section = document.querySelector('section[componentkey*="ExperienceTopLevelSection"]');
    if (!section) return null;

    const items = section.querySelectorAll('[componentkey^="entity-collection-item"]');
    if (items.length === 0) return null;

    const parts = ['## Experience', ''];

    for (const item of items) {
        const ul = item.querySelector('ul');
        const rendered = ul
            ? _renderGroupedEntry(item, ul)
            : _renderStandaloneEntry(item);
        if (rendered.length > 0) {
            parts.push(...rendered);
        }
    }

    return parts.join('\n');
}

function _getCleanText(el) {
    return el?.textContent?.trim() || '';
}

function _getNoteText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('button, [role="button"]').forEach(n => n.remove());
    const text = clone.textContent.trim();
    return text.includes('\n') ? '' : text;
}

function _looksLikeTenure(text) {
    return /^\d+\s*(yr|mo)/i.test(text.trim());
}

function _looksLikeDate(text) {
    return _LI_DATE_RE.test(text);
}

function _isLocationType(text) {
    return _LI_LOC_TYPES.has(text.toLowerCase().trim());
}

/**
 * Collects visible <p> texts from an element, excluding:
 *   - the paragraph that wraps a note span (note captured separately)
 *   - known UI noise strings
 */
function _collectPs(root, noteEl) {
    return [...root.querySelectorAll('p')]
        .filter(p => !noteEl || !p.contains(noteEl))
        .map(p => _getCleanText(p))
        .filter(t => t && !_LI_NOISE.has(t));
}

// ---------------------------------------------------------------------------
// Grouped layout  (company header + <ul> of role items)
// ---------------------------------------------------------------------------

function _renderGroupedEntry(item, ul) {
    const headerPs = [...item.querySelectorAll('p')]
        .filter(p => !ul.contains(p))
        .map(p => _getCleanText(p))
        .filter(t => t && !_LI_NOISE.has(t));

    const company = headerPs[0] || '';
    if (!company) return [];

    let employment = '', locationType = '';
    let hIdx = 1;
    if (headerPs[hIdx] && !_looksLikeTenure(headerPs[hIdx]) && !_isLocationType(headerPs[hIdx])) {
        employment = headerPs[hIdx++];
    }
    if (headerPs[hIdx] && _looksLikeTenure(headerPs[hIdx])) hIdx++;
    if (headerPs[hIdx] && _isLocationType(headerPs[hIdx])) {
        locationType = headerPs[hIdx];
    }

    const lines = [`Company: ${company}`];
    if (employment) lines.push(`Employment: ${employment}`);
    if (locationType) lines.push(`Location type: ${locationType}`);

    const roles = [...ul.querySelectorAll(':scope > li')]
        .map(li => _parseRoleItem(li))
        .filter(Boolean);

    if (roles.length > 0) {
        lines.push('Roles:');
        roles.forEach(role => lines.push(_formatRole(role)));
    }

    lines.push('');
    return lines;
}

// ---------------------------------------------------------------------------
// Standalone layout  (role title first, company/employment inline)
// ---------------------------------------------------------------------------

function _renderStandaloneEntry(item) {
    const noteEl = item.querySelector('[data-testid="expandable-text-box"]');
    const noteText = noteEl ? _getNoteText(noteEl) : '';
    const ps = _collectPs(item, noteEl);

    if (ps.length === 0) return [];

    const roleTitle = ps[0];
    let company = '', employment = '', dates = '', duration = '', location = '';

    if (ps[1] && !_looksLikeDate(ps[1])) {
        const sep = ps[1].indexOf(' · ');
        if (sep >= 0) {
            company    = ps[1].slice(0, sep);
            employment = ps[1].slice(sep + 3);
        } else {
            company = ps[1];
        }
        if (ps[2] && _looksLikeDate(ps[2])) {
            const dp = ps[2].split(' · ');
            dates    = dp[0] || '';
            duration = dp.slice(1).join(' · ');
            location = ps[3] || '';
        }
    } else if (ps[1] && _looksLikeDate(ps[1])) {
        const dp = ps[1].split(' · ');
        dates    = dp[0] || '';
        duration = dp.slice(1).join(' · ');
        location = ps[2] || '';
    }

    const lines = [];
    if (company)    lines.push(`Company: ${company}`);
    if (employment) lines.push(`Employment: ${employment}`);
    lines.push('Roles:');
    lines.push(_formatRole({ title: roleTitle, dates, duration, location, note: noteText }));
    lines.push('');
    return lines;
}

// ---------------------------------------------------------------------------
// Role item parsing  (used by grouped layout <li> elements)
// ---------------------------------------------------------------------------

function _parseRoleItem(li) {
    const noteEl = li.querySelector('[data-testid="expandable-text-box"]');
    const noteText = noteEl ? _getNoteText(noteEl) : '';
    const ps = _collectPs(li, noteEl);

    if (!ps[0]) return null;

    let idx = 1;

    // Some profiles include per-role employment type (e.g. "Full-time") as a
    // separate short text before the date range.
    let roleEmployment = '';
    if (ps[idx] && !_looksLikeDate(ps[idx]) && ps[idx].split(' ').length <= 3) {
        roleEmployment = ps[idx];
        idx++;
    }

    const dateDuration = ps[idx] || '';
    const sep      = dateDuration.indexOf(' · ');
    const dates    = sep >= 0 ? dateDuration.slice(0, sep) : dateDuration;
    const duration = sep >= 0 ? dateDuration.slice(sep + 3) : '';
    const location = ps[idx + 1] || '';

    return { title: ps[0], roleEmployment, dates, duration, location, note: noteText };
}

function _formatRole(role) {
    let line = `- Title: ${role.title}`;
    if (role.roleEmployment) line += ` | Employment: ${role.roleEmployment}`;
    if (role.dates)          line += ` | Dates: ${role.dates}`;
    if (role.duration)       line += ` | Duration: ${role.duration}`;
    if (role.location)       line += ` | Location: ${role.location}`;
    if (role.note)           line += ` | Note: ${role.note}`;
    return line;
}
