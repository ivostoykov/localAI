// Shared loading helpers for the Markdown compatibility harness (issue #18).
// Read-only: project sources are loaded unmodified; nothing is written to src/.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '../..');

export const dom = new JSDOM(
  '<!DOCTYPE html><html lang="en"><head><title>Sample page</title></head><body></body></html>',
  { url: 'https://example.com/docs/page.html', pretendToBeVisual: true }
);
export const { window } = dom;
export const { document } = window;

// --- helpers the extractor calls, loaded from src/content.js itself ---
// content.js cannot be evaluated on its own (it registers listeners and uses
// browser globals), so the two functions the extractor calls are sliced out of
// the file by name and evaluated as-is. No logic is copied.
//
// hasVisibleText(): src/content.js:388
// getARIAContext(): src/content.js:301
//
// jsdom has no CSS.escape, which getARIAContext() uses for aria-labelledby.
// A spec-shaped polyfill is supplied only for that missing browser global.

function sliceFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces for ${name}`);
}

function loadSourceFunction(file, name, globals) {
  const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  const body = sliceFunction(source, name);
  const names = Object.keys(globals);
  return new Function(...names, `${body}; return ${name};`)(...names.map(n => globals[n]));
}

// CSS.escape per the CSSOM algorithm, used only when the environment lacks it.
function cssEscape(value) {
  const s = String(value);
  let out = '';
  const first = s.charCodeAt(0);
  if (first === 0x2D && s.length === 1) return '\\-';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0) { out += '\uFFFD'; continue; }
    if ((c >= 1 && c <= 0x1f) || c === 0x7f ||
        (i === 0 && c >= 0x30 && c <= 0x39) ||
        (i === 1 && c >= 0x30 && c <= 0x39 && first === 0x2D)) {
      out += `\\${c.toString(16)} `;
      continue;
    }
    if (c >= 0x80 || c === 0x2d || c === 0x5f ||
        (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) {
      out += s[i];
      continue;
    }
    out += `\\${s[i]}`;
  }
  return out;
}

const cssGlobal = window.CSS?.escape ? window.CSS : { escape: cssEscape };

const hasVisibleText = loadSourceFunction('src/content.js', 'hasVisibleText', { document, window });
const getARIAContext = loadSourceFunction('src/content.js', 'getARIAContext', { CSS: cssGlobal });

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

// --- recorded provenance for the report ---
export function sourceInfo() {
  const files = ['src/jslib/content-extractor.js', 'src/jslib/solomd2html.js', 'src/content.js'];
  const hashes = {};
  for (const file of files) {
    hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT, file))).digest('hex');
  }
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    commit = 'unknown (git unavailable)';
  }
  return { commit, hashes, cssEscape: window.CSS?.escape ? 'native' : 'polyfill' };
}
