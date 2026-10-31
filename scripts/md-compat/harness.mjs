// Shared loading helpers for the Markdown compatibility harness (issue #18).
// Read-only: project sources are loaded unmodified; nothing is written to src/.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '../..');

export const dom = new JSDOM(
  '<!DOCTYPE html><html lang="en"><head><title>Sample page</title></head><body></body></html>',
  { url: 'https://example.com/docs/page.html', pretendToBeVisual: true }
);
export const { window } = dom;
export const { document } = window;

// --- helpers the extractor calls, copied verbatim from src/content.js ---
// hasVisibleText(): src/content.js:388
// getARIAContext(): src/content.js:301
// They are copies only so the harness can load content-extractor.js without
// the rest of content.js. Keep them in step with the source when it changes.

function getARIAContext(element, rootElement) {
  if (!element || !element.attributes) return '';
  if (element.getAttribute('aria-hidden') === 'true') return null;
  const textAriaAttrs = ['aria-label', 'aria-labelledby', 'aria-describedby', 'aria-description'];
  const relevantAttrs = Array.from(element.attributes).filter(a => textAriaAttrs.includes(a.name));
  if (relevantAttrs.length < 1) return '';
  const parts = [];
  for (const attr of relevantAttrs) {
    const value = attr.value.trim();
    if (!value) continue;
    switch (attr.name) {
      case 'aria-label':
      case 'aria-description':
        parts.push(`${attr.name}: ${value}`);
        break;
      case 'aria-labelledby':
      case 'aria-describedby': {
        if (!rootElement) continue;
        let ref = null;
        try { ref = rootElement.querySelector(`#${value}`); } catch { ref = null; }
        const t = ref?.textContent.trim();
        if (t) parts.push(`${attr.name}: ${t}`);
        break;
      }
    }
  }
  return parts.length > 0 ? `[${parts.join('; ')}] ` : '';
}

function hasVisibleText(node) {
  if (!node?.nodeValue || !/[^\n\r\t ]/.test(node.nodeValue)) return false;
  const parent = node.parentElement;
  if (!parent) return false;
  const parentTag = parent.tagName?.toLowerCase();
  if (parentTag === 'script' || parentTag === 'style' || parentTag === 'noscript') return false;
  let element = parent;
  while (element && element !== document.body) {
    if (element.getAttribute('aria-hidden') === 'true') return false;
    element = element.parentElement;
  }
  const cs = window.getComputedStyle(parent);
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  return true;
}

// --- project extractor, unmodified ---
const extractorSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/jslib/content-extractor.js'), 'utf8');
const extractor = new Function(
  'document', 'window', 'Node', 'NodeFilter', 'hasVisibleText', 'getARIAContext', 'manifest', 'CSS',
  extractorSrc + `
  ; return { extractEnhancedTextStructure, formatEnhancedPageContent, detectMainContent,
             extractList, extractTable, formatList, formatTable };`
)(document, window, window.Node, window.NodeFilter, hasVisibleText, getARIAContext, { name: 'localAI' }, window.CSS);

// --- project renderer, unmodified (same pattern as tests/solomd2html.test.js) ---
const rendererSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/jslib/solomd2html.js'), 'utf8');
export const parseAndRender = new Function(
  'document', 'DocumentFragment', 'CustomEvent', 'Node', 'navigator', 'window',
  rendererSrc + '; return parseAndRender;'
)(document, window.DocumentFragment, window.CustomEvent, window.Node, window.navigator, window);

// --- extraction pipeline (metadata frame retained, metadata blanked) ---
const METADATA_RE = /^=== PAGE (METADATA|CONTENT) ===$|^URL: .*|^Title: .*|^=== END OF PAGE CONTENT ===$/gm;

export function extract(html) {
  document.body.innerHTML = html;
  const clone = document.body.cloneNode(true);
  const main = extractor.detectMainContent(clone) || clone;
  const structure = extractor.extractEnhancedTextStructure(main);
  return extractor.formatEnhancedPageContent(structure, {
    url: 'https://example.com/docs/page.html', title: 'Sample page',
    description: '', author: '', publishedDate: '', keywords: [], type: ''
  });
}

export function extractBody(html) {
  return extract(html).replace(METADATA_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

// --- renderer pipeline ---
export async function render(markdown) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  await parseAndRender(markdown, root, { streamReply: false, codeCopy: false });
  const html = root.innerHTML;
  const summary = serialise(root);
  root.remove();
  return { html, summary };
}

// Compact structural description of rendered DOM. Block-level tag names and
// order are preserved; inline markup is shown in <angle>brackets</angle>.
export function serialise(node) {
  const lines = [];
  const INLINE = new Set(['STRONG', 'EM', 'CODE', 'A', 'DEL', 'SPAN', 'B', 'I']);
  const inline = (el) => Array.from(el.childNodes).map(n => {
    if (n.nodeType === 3) return n.textContent.replace(/\s+/g, ' ');
    if (n.nodeType !== 1) return '';
    const tag = n.tagName.toLowerCase();
    if (tag === 'strong' || tag === 'b') return `<strong>${inline(n)}</strong>`;
    if (tag === 'em' || tag === 'i') return `<em>${inline(n)}</em>`;
    if (tag === 'code') return `<code>${inline(n)}</code>`;
    if (tag === 'del') return `<del>${inline(n)}</del>`;
    if (tag === 'a') return `<a href=${JSON.stringify(n.getAttribute('href'))}>${inline(n)}</a>`;
    if (tag === 'br') return '<br>';
    return `<${tag}>${inline(n)}</${tag}>`;
  }).join('');

  const block = (el, depth) => {
    const pad = '  '.repeat(depth);
    const tag = el.tagName.toLowerCase();
    if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote', 'li'].includes(tag)) {
      if (tag === 'pre') {
        const code = el.querySelector('code');
        lines.push(`${pad}pre${code?.className ? `.${code.className}` : ''}: ${JSON.stringify(code?.textContent ?? el.textContent)}`);
        return;
      }
      lines.push(`${pad}${tag}: ${inline(el).trim()}`);
      if (tag === 'blockquote' || tag === 'li') {
        for (const child of el.children) {
          if (INLINE.has(child.tagName)) continue;
          block(child, depth + 1);
        }
      }
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      lines.push(`${pad}${tag}${el.hasAttribute('start') ? `(start=${el.getAttribute('start')})` : ''}`);
      for (const child of el.children) block(child, depth + 1);
      return;
    }
    if (tag === 'table') {
      const head = el.querySelectorAll('thead tr').length;
      const body = el.querySelectorAll('tbody tr').length;
      lines.push(`${pad}table(thead:${head},tbody:${body})`);
      for (const tr of el.querySelectorAll('tr')) {
        const cells = Array.from(tr.children).map(c => `${c.tagName.toLowerCase()}:${inline(c).trim()}`);
        lines.push(`${pad}  row: ${cells.join(' | ')}`);
      }
      return;
    }
    if (tag === 'hr') { lines.push(`${pad}hr`); return; }
    if (tag === 'details') { lines.push(`${pad}details`); return; }
    for (const child of el.children) block(child, depth);
  };

  for (const child of node.children) block(child, 0);
  return lines.join('\n');
}

// --- pinned Turndown evaluation copies (fetched, never vendored) ---
const TURNDOWN = {
  url: 'https://unpkg.com/turndown@7.2.4/dist/turndown.js',
  sha256: 'c97187f436d41638bf7acf346a39d9d42f2f2c02af18245a297c09e796f8e46f',
  file: 'turndown-7.2.4.js'
};
const GFM = {
  url: 'https://unpkg.com/turndown-plugin-gfm@1.0.2/dist/turndown-plugin-gfm.js',
  sha256: 'cf744cc1b7580f06d64ce236a4ff2630a53d389eccf2133a09d71ca443511912',
  file: 'turndown-plugin-gfm-1.0.2.js'
};

async function fetchPinned({ url, sha256, file }) {
  const cacheDir = path.join(HERE, '.cache');
  const target = path.join(cacheDir, file);
  let bytes;
  if (fs.existsSync(target)) {
    bytes = fs.readFileSync(target);
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    bytes = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (digest !== sha256) throw new Error(`hash mismatch for ${file}: ${digest}`);
  return bytes.toString('utf8');
}

export async function loadTurndown() {
  const [tdSrc, gfmSrc] = await Promise.all([fetchPinned(TURNDOWN), fetchPinned(GFM)]);
  const build = () => {
    const w = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://example.com/docs/page.html' }).window;
    const TurndownService = new Function('window', 'document', 'Node', tdSrc + '; return TurndownService;')(w, w.document, w.Node);
    const plugin = new Function('window', gfmSrc + '; return turndownPluginGfm;')(w);
    const service = new TurndownService({
      headingStyle: 'atx', hr: '---', bulletListMarker: '-',
      codeBlockStyle: 'fenced', fence: '```', emDelimiter: '_',
      strongDelimiter: '**', linkStyle: 'inlined'
    });
    return { service, window: w, plugin };
  };
  const plain = build();
  const gfm = build();
  gfm.service.use(gfm.plugin.gfm);
  return {
    plain: (html) => {
      const w = plain.window;
      w.document.body.innerHTML = html;
      return plain.service.turndown(w.document.querySelector('main') || w.document.body);
    },
    gfm: (html) => {
      const w = gfm.window;
      w.document.body.innerHTML = html;
      return gfm.service.turndown(w.document.querySelector('main') || w.document.body);
    },
    provenance: { turndown: TURNDOWN, gfm: GFM }
  };
}
