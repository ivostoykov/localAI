/**
 * Enhanced Content Extraction Module
 *
 * Improvements over basic text extraction:
 * 1. Semantic HTML5 prioritisation (article, main, nav, aside)
 * 2. Better list and table structure preservation
 * 3. Link context preservation with [text](url) format
 * 4. Metadata extraction (Open Graph, JSON-LD, meta tags)
 * 5. Code block detection and preservation
 * 6. Image alt text and figure captions
 * 7. Readability scoring and main content detection
 */

/**
 * Main entry point - extracts enhanced page content
 * @returns {Promise<string>} Formatted page content with metadata
 */
async function getEnhancedPageContent() {
  const metadata = extractPageMetadata();
  const cleanedDOM = await getDocumentContentFiltered();
  const mainContent = detectMainContent(cleanedDOM);
  const structure = extractEnhancedTextStructure(mainContent || cleanedDOM);

  return formatEnhancedPageContent(structure, metadata);
}

/**
 * Extract page metadata (Open Graph, JSON-LD, meta tags)
 */
function extractPageMetadata() {
  const metadata = {
    title: document.title || '',
    url: document.location.href,
    description: '',
    author: '',
    publishedDate: '',
    keywords: [],
    type: '',
    siteName: '',
    language: document.documentElement.lang || 'en'
  };

  // Open Graph tags
  const ogTags = {
    'og:title': 'title',
    'og:description': 'description',
    'og:type': 'type',
    'og:site_name': 'siteName',
    'article:author': 'author',
    'article:published_time': 'publishedDate'
  };

  for (const [ogProperty, metaKey] of Object.entries(ogTags)) {
    const element = document.querySelector(`meta[property="${ogProperty}"]`);
    if (element?.content) {
      metadata[metaKey] = element.content;
    }
  }

  // Standard meta tags
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc?.content && !metadata.description) {
    metadata.description = metaDesc.content;
  }

  const metaAuthor = document.querySelector('meta[name="author"]');
  if (metaAuthor?.content && !metadata.author) {
    metadata.author = metaAuthor.content;
  }

  const metaKeywords = document.querySelector('meta[name="keywords"]');
  if (metaKeywords?.content) {
    metadata.keywords = metaKeywords.content.split(',').map(k => k.trim());
  }

  // JSON-LD structured data
  try {
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
      const data = JSON.parse(script.textContent);
      if (data['@type'] === 'Article' || data['@type'] === 'NewsArticle') {
        metadata.author = metadata.author || data.author?.name || '';
        metadata.publishedDate = metadata.publishedDate || data.datePublished || '';
        metadata.description = metadata.description || data.description || '';
      }
    }
  } catch (err) {
    console.debug(`>>> ${manifest?.name ?? ''} - Failed to parse JSON-LD:`, err);
  }

  return metadata;
}

/**
 * Detect main content area using semantic HTML and heuristics
 * @param {HTMLElement} domClone - Cleaned DOM clone
 * @returns {HTMLElement|null} Main content element or null
 */
function detectMainContent(domClone) {
  // Priority 1: Semantic HTML5 elements
  const main = domClone.querySelector('main');
  if (main) return main;

  const article = domClone.querySelector('article');
  if (article) return article;

  // Priority 2: Common content class/id patterns
  const contentSelectors = [
    '[role="main"]',
    '#content',
    '#main-content',
    '.main-content',
    '.article-content',
    '.post-content',
    '.entry-content',
    '.page-content'
  ];

  for (const selector of contentSelectors) {
    const element = domClone.querySelector(selector);
    if (element) return element;
  }

  // Priority 3: Heuristic - element with most text content
  const candidates = Array.from(domClone.querySelectorAll('div, section'));
  if (candidates.length === 0) return null;

  const scored = candidates.map(el => {
    const textLength = el.textContent?.length || 0;
    const paragraphs = el.querySelectorAll('p').length;
    const headings = el.querySelectorAll('h1, h2, h3, h4, h5, h6').length;

    // Simple scoring: text length + bonus for structural elements
    const score = textLength + (paragraphs * 100) + (headings * 50);

    return { element: el, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Return highest-scoring element if it has substantial content
  return scored[0].score > 500 ? scored[0].element : null;
}

/**
 * Enhanced text structure extraction with better formatting
 * @param {HTMLElement} domClone - Cleaned DOM
 * @returns {Array} Structure with sections, metadata, and formatted content
 */
function extractEnhancedTextStructure(domClone) {
  const structure = [];
  const headings = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
  let currentSection = {
    level: 0,
    title: '',
    content: [],
    lists: [],
    tables: [],
    codeBlocks: [],
    images: []
  };

  const walker = document.createTreeWalker(
    domClone,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
  );

  let inList = false;
  let inTable = false;
  let currentList = [];
  let currentTable = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;

    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName;

      // Handle lists
      if (tag === 'UL' || tag === 'OL') {
        if (!inList) {
          inList = true;
          currentList = extractList(node);
          currentSection.lists.push({ type: tag, items: currentList });
          inList = false;
        }
        continue;
      }

      // Handle tables
      if (tag === 'TABLE') {
        if (!inTable) {
          inTable = true;
          currentTable = extractTable(node);
          currentSection.tables.push(currentTable);
          inTable = false;
        }
        continue;
      }

      // Handle code blocks
      if (tag === 'PRE' || tag === 'CODE') {
        const code = node.textContent?.trim();
        if (code) {
          currentSection.codeBlocks.push({
            language: node.className?.replace('language-', '') || 'plaintext',
            code: code
          });
        }
        continue;
      }

      // Handle images with alt text
      if (tag === 'IMG') {
        const alt = node.getAttribute('alt');
        const src = node.getAttribute('src');
        if (alt || src) {
          currentSection.images.push({ alt: alt || '', src: src || '' });
        }
        continue;
      }

      // Handle figure captions
      if (tag === 'FIGCAPTION') {
        const caption = node.textContent?.trim();
        if (caption) {
          currentSection.content.push(`[Figure: ${caption}]`);
        }
        continue;
      }

      continue;
    }

    // Text nodes
    if (node.nodeType === Node.TEXT_NODE) {
      if (!hasVisibleText(node)) continue;

      const parent = node.parentElement;
      const parentTag = parent?.tagName || '';
      let text = node.nodeValue.trim();

      text = text.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      if (!text) continue;

      const ariaContext = getARIAContext(parent, domClone);
      if (ariaContext === null) continue;

      if (ariaContext) text = ariaContext + text;

      // Handle links with context
      if (parentTag === 'A') {
        const href = parent.getAttribute('href');
        if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
          const fullUrl = new URL(href, document.location.href).href;
          text = `[${text}](${fullUrl})`;
        }
      }

      // Handle headings
      if (headings.includes(parentTag)) {
        if (currentSection.content.length > 0 || currentSection.lists.length > 0 ||
            currentSection.tables.length > 0 || currentSection.codeBlocks.length > 0) {
          structure.push(currentSection);
        }
        const level = parseInt(parentTag.charAt(1));
        currentSection = {
          level,
          title: text,
          content: [],
          lists: [],
          tables: [],
          codeBlocks: [],
          images: []
        };
      } else {
        currentSection.content.push(text);
      }
    }
  }

  if (currentSection.content.length > 0 || currentSection.lists.length > 0 ||
      currentSection.tables.length > 0 || currentSection.codeBlocks.length > 0) {
    structure.push(currentSection);
  }

  return structure;
}

/**
 * Extract list items with hierarchy
 */
function extractList(listElement) {
  const items = [];
  const listItems = listElement.querySelectorAll(':scope > li');

  listItems.forEach(li => {
    const text = Array.from(li.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent.trim())
      .filter(Boolean)
      .join(' ');

    const nestedList = li.querySelector('ul, ol');
    const item = { text };

    if (nestedList) {
      item.nested = extractList(nestedList);
    }

    if (text || item.nested) {
      items.push(item);
    }
  });

  return items;
}

/**
 * Extract table data in markdown-friendly format
 */
function extractTable(tableElement) {
  const rows = [];

  const headerRows = tableElement.querySelectorAll('thead tr');
  const bodyRows = tableElement.querySelectorAll('tbody tr, tr');

  const allRows = [...headerRows, ...bodyRows];

  allRows.forEach(tr => {
    const cells = tr.querySelectorAll('th, td');
    const row = Array.from(cells).map(cell => cell.textContent?.trim() || '');
    if (row.some(cell => cell)) {
      rows.push(row);
    }
  });

  return {
    hasHeader: headerRows.length > 0,
    rows
  };
}

/**
 * Format lists in readable text format
 */
function formatList(items, indent = 0, ordered = false) {
  const prefix = '  '.repeat(indent);
  const lines = [];

  items.forEach((item, index) => {
    const bullet = ordered ? `${index + 1}.` : '-';
    lines.push(`${prefix}${bullet} ${item.text}`);

    if (item.nested?.length > 0) {
      lines.push(...formatList(item.nested, indent + 1, ordered));
    }
  });

  return lines;
}

/**
 * Format table in markdown-style format
 */
function formatTable(table) {
  if (table.rows.length === 0) return '';

  const lines = [];
  const colCount = Math.max(...table.rows.map(row => row.length));

  // Ensure all rows have the same number of columns
  const normalised = table.rows.map(row => {
    const padded = [...row];
    while (padded.length < colCount) padded.push('');
    return padded;
  });

  // Add header separator if table has header
  if (table.hasHeader && normalised.length > 0) {
    lines.push('| ' + normalised[0].join(' | ') + ' |');
    lines.push('| ' + Array(colCount).fill('---').join(' | ') + ' |');

    normalised.slice(1).forEach(row => {
      lines.push('| ' + row.join(' | ') + ' |');
    });
  } else {
    normalised.forEach(row => {
      lines.push('| ' + row.join(' | ') + ' |');
    });
  }

  return lines.join('\n');
}

/**
 * Format the complete page content with metadata and structure
 */
function formatEnhancedPageContent(structure, metadata) {
  const parts = [];

  // Metadata header
  parts.push('=== PAGE METADATA ===');
  parts.push(`URL: ${metadata.url}`);
  parts.push(`Title: ${metadata.title}`);

  if (metadata.description) {
    parts.push(`Description: ${metadata.description}`);
  }

  if (metadata.author) {
    parts.push(`Author: ${metadata.author}`);
  }

  if (metadata.publishedDate) {
    parts.push(`Published: ${metadata.publishedDate}`);
  }

  if (metadata.keywords.length > 0) {
    parts.push(`Keywords: ${metadata.keywords.join(', ')}`);
  }

  if (metadata.type) {
    parts.push(`Type: ${metadata.type}`);
  }

  parts.push('');
  parts.push('=== PAGE CONTENT ===');
  parts.push('');

  // Format sections
  structure.forEach(section => {
    if (section.title) {
      const hashes = '#'.repeat(section.level || 2);
      parts.push(`${hashes} ${section.title}`);
      parts.push('');
    }

    // Add images
    if (section.images.length > 0) {
      section.images.forEach(img => {
        if (img.alt) {
          parts.push(`[Image: ${img.alt}]`);
        }
      });
      parts.push('');
    }

    // Add regular content
    if (section.content.length > 0) {
      parts.push(section.content.join('\n'));
      parts.push('');
    }

    // Add lists
    if (section.lists.length > 0) {
      section.lists.forEach(list => {
        const formatted = formatList(list.items, 0, list.type === 'OL');
        parts.push(formatted.join('\n'));
        parts.push('');
      });
    }

    // Add tables
    if (section.tables.length > 0) {
      section.tables.forEach(table => {
        parts.push(formatTable(table));
        parts.push('');
      });
    }

    // Add code blocks
    if (section.codeBlocks.length > 0) {
      section.codeBlocks.forEach(block => {
        parts.push('```' + block.language);
        parts.push(block.code);
        parts.push('```');
        parts.push('');
      });
    }
  });

  parts.push('=== END OF PAGE CONTENT ===');

  return parts.join('\n');
}

/**
 * Extract special elements (used for planning/preview)
 */
function extractSpecialElements(domClone) {
  return {
    lists: domClone.querySelectorAll('ul, ol').length,
    tables: domClone.querySelectorAll('table').length,
    codeBlocks: domClone.querySelectorAll('pre, code').length,
    images: domClone.querySelectorAll('img[alt]').length,
    links: domClone.querySelectorAll('a[href]').length
  };
}

// ============================================================================
// SELECTIVE EXTRACTION FUNCTIONS FOR INTERNAL TOOLS
// ============================================================================

/**
 * Get page structure summary with metadata and element counts
 * Used by internal tool: get_page_structure
 * @returns {Promise<Object>} Structure summary with metadata and counts
 */
async function getPageStructureSummary() {
  const metadata = extractPageMetadata();
  const cleanedDOM = await getDocumentContentFiltered();
  const specialElements = extractSpecialElements(cleanedDOM);
  const structure = extractEnhancedTextStructure(cleanedDOM);

  const mainContent = detectMainContent(cleanedDOM);
  const hasMainContent = !!mainContent;

  return {
    metadata: {
      url: metadata.url,
      title: metadata.title,
      description: metadata.description,
      author: metadata.author,
      publishedDate: metadata.publishedDate,
      type: metadata.type,
      language: metadata.language
    },
    structure: {
      sections: structure.length,
      lists: specialElements.lists,
      tables: specialElements.tables,
      codeBlocks: specialElements.codeBlocks,
      images: specialElements.images,
      links: specialElements.links,
      hasMainContent: hasMainContent
    },
    summary: `Page has ${structure.length} sections, ${specialElements.lists} lists, ${specialElements.tables} tables, ${specialElements.codeBlocks} code blocks, ${specialElements.images} images with alt text, and ${specialElements.links} links.`
  };
}

/**
 * Get all or specific tables from the page
 * Used by internal tool: get_page_tables
 * @param {number|null} tableIndex - Optional specific table index (0-based)
 * @returns {Promise<string>} Formatted tables in markdown
 */
async function getPageTables(tableIndex = null) {
  const tables = document.querySelectorAll('table');

  if (tables.length === 0) {
    return 'No tables found on this page.';
  }

  if (tableIndex !== null && tableIndex !== undefined) {
    if (tableIndex < 0 || tableIndex >= tables.length) {
      return `Invalid table index ${tableIndex}. Page has ${tables.length} table(s). Use index 0 to ${tables.length - 1}.`;
    }

    const table = tables[tableIndex];
    const extracted = extractTable(table);
    const formatted = formatTable(extracted);
    return `Table ${tableIndex + 1} of ${tables.length}:\n\n${formatted}`;
  }

  // Return all tables
  const results = [];
  tables.forEach((table, i) => {
    const extracted = extractTable(table);
    const formatted = formatTable(extracted);
    results.push(`Table ${i + 1} of ${tables.length}:\n${formatted}`);
  });

  return results.join('\n\n');
}

/**
 * Get all or specific lists from the page
 * Used by internal tool: get_page_lists
 * @param {number|null} listIndex - Optional specific list index (0-based)
 * @returns {Promise<string>} Formatted lists
 */
async function getPageLists(listIndex = null) {
  const lists = document.querySelectorAll('ul, ol');

  if (lists.length === 0) {
    return 'No lists found on this page.';
  }

  if (listIndex !== null && listIndex !== undefined) {
    if (listIndex < 0 || listIndex >= lists.length) {
      return `Invalid list index ${listIndex}. Page has ${lists.length} list(s). Use index 0 to ${lists.length - 1}.`;
    }

    const list = lists[listIndex];
    const extracted = extractList(list);
    const formatted = formatList(extracted, 0, list.tagName === 'OL');
    const type = list.tagName === 'OL' ? 'Ordered' : 'Unordered';
    return `${type} List ${listIndex + 1} of ${lists.length}:\n\n${formatted.join('\n')}`;
  }

  // Return all lists
  const results = [];
  lists.forEach((list, i) => {
    const extracted = extractList(list);
    const formatted = formatList(extracted, 0, list.tagName === 'OL');
    const type = list.tagName === 'OL' ? 'Ordered' : 'Unordered';
    results.push(`${type} List ${i + 1} of ${lists.length}:\n${formatted.join('\n')}`);
  });

  return results.join('\n\n');
}

/**
 * Get all or specific code blocks from the page
 * Used by internal tool: get_page_code_blocks
 * @param {number|null} blockIndex - Optional specific code block index (0-based)
 * @returns {Promise<string>} Formatted code blocks
 */
async function getPageCodeBlocks(blockIndex = null) {
  const codeBlocks = document.querySelectorAll('pre, code');

  if (codeBlocks.length === 0) {
    return 'No code blocks found on this page.';
  }

  if (blockIndex !== null && blockIndex !== undefined) {
    if (blockIndex < 0 || blockIndex >= codeBlocks.length) {
      return `Invalid code block index ${blockIndex}. Page has ${codeBlocks.length} code block(s). Use index 0 to ${codeBlocks.length - 1}.`;
    }

    const block = codeBlocks[blockIndex];
    const language = block.className?.replace('language-', '') || 'plaintext';
    const code = block.textContent?.trim() || '';
    return `Code Block ${blockIndex + 1} of ${codeBlocks.length} (${language}):\n\`\`\`${language}\n${code}\n\`\`\``;
  }

  // Return all code blocks
  const results = [];
  codeBlocks.forEach((block, i) => {
    const language = block.className?.replace('language-', '') || 'plaintext';
    const code = block.textContent?.trim() || '';
    results.push(`Code Block ${i + 1} of ${codeBlocks.length} (${language}):\n\`\`\`${language}\n${code}\n\`\`\``);
  });

  return results.join('\n\n');
}

/**
 * Get page metadata only
 * Used by internal tool: get_page_metadata
 * @returns {string} Formatted metadata
 */
function getPageMetadataFormatted() {
  const metadata = extractPageMetadata();

  const parts = [];
  parts.push('=== PAGE METADATA ===');
  parts.push(`URL: ${metadata.url}`);
  parts.push(`Title: ${metadata.title}`);

  if (metadata.description) parts.push(`Description: ${metadata.description}`);
  if (metadata.author) parts.push(`Author: ${metadata.author}`);
  if (metadata.publishedDate) parts.push(`Published: ${metadata.publishedDate}`);
  if (metadata.type) parts.push(`Type: ${metadata.type}`);
  if (metadata.siteName) parts.push(`Site: ${metadata.siteName}`);
  if (metadata.language) parts.push(`Language: ${metadata.language}`);
  if (metadata.keywords.length > 0) parts.push(`Keywords: ${metadata.keywords.join(', ')}`);

  return parts.join('\n');
}

/**
 * Get main content area only (article/blog post without navigation/sidebar)
 * Used by internal tool: get_main_content
 * @returns {Promise<string>} Main content text
 */
async function getMainContentOnly() {
  const cleanedDOM = await getDocumentContentFiltered();
  const mainContent = detectMainContent(cleanedDOM);

  if (!mainContent) {
    return 'Could not detect main content area. The page may not have semantic HTML structure. Use get_full_page_content to get all content.';
  }

  const structure = extractEnhancedTextStructure(mainContent);
  const metadata = extractPageMetadata();

  return formatEnhancedPageContent(structure, metadata);
}

// Global debug helpers for console testing
globalThis.contentExtractorHelpers = {
  /**
   * Test basic extraction (current method)
   * Usage: await contentExtractorHelpers.testBasic()
   */
  async testBasic() {
    if (typeof getPageTextContent !== 'function') {
      return 'Error: getPageTextContent() not available. Are you on a valid page?';
    }
    const result = await getPageTextContent();
    console.log('=== BASIC EXTRACTION ===');
    console.log(result);
    return result;
  },

  /**
   * Test enhanced extraction (new method)
   * Usage: await contentExtractorHelpers.testEnhanced()
   */
  async testEnhanced() {
    const result = await getEnhancedPageContent();
    console.log('=== ENHANCED EXTRACTION ===');
    console.log(result);
    return result;
  },

  /**
   * Compare both methods side by side
   * Usage: await contentExtractorHelpers.compare()
   */
  async compare() {
    console.log('\n🔍 Extracting with both methods...\n');

    const basic = typeof getPageTextContent === 'function'
      ? await getPageTextContent()
      : 'Basic extraction not available';
    const enhanced = await getEnhancedPageContent();

    console.log('📊 COMPARISON RESULTS:');
    console.log(`Basic length: ${basic.length} chars`);
    console.log(`Enhanced length: ${enhanced.length} chars`);
    console.log(`Difference: ${enhanced.length - basic.length} chars (${((enhanced.length / basic.length - 1) * 100).toFixed(1)}%)`);

    console.group('=== BASIC OUTPUT ===');
    console.log(basic.substring(0, 2000) + (basic.length > 2000 ? '\n... (truncated)' : ''));
    console.groupEnd();

    console.group('=== ENHANCED OUTPUT ===');
    console.log(enhanced.substring(0, 2000) + (enhanced.length > 2000 ? '\n... (truncated)' : ''));
    console.groupEnd();

    return { basic, enhanced };
  },

  /**
   * Extract and show only metadata
   * Usage: contentExtractorHelpers.metadata()
   */
  metadata() {
    const metadata = extractPageMetadata();
    console.log('=== PAGE METADATA ===');
    console.table(metadata);
    return metadata;
  },

  /**
   * Detect and show main content area
   * Usage: await contentExtractorHelpers.mainContent()
   */
  async mainContent() {
    const cleanedDOM = await getDocumentContentFiltered();
    const main = detectMainContent(cleanedDOM);

    console.log('=== MAIN CONTENT DETECTION ===');
    if (main) {
      console.log('✅ Main content found:', main.tagName, main.className || main.id || '(no class/id)');
      console.log('Text length:', main.textContent?.length || 0, 'chars');
      console.log('Paragraphs:', main.querySelectorAll('p').length);
      console.log('Headings:', main.querySelectorAll('h1,h2,h3,h4,h5,h6').length);

      // Highlight it on the page temporarily
      const original = main.style.outline;
      main.style.outline = '3px solid red';
      setTimeout(() => { main.style.outline = original; }, 3000);
      console.log('🔴 Main content highlighted in red for 3 seconds');
    } else {
      console.log('❌ No main content detected, will use full body');
    }

    return main;
  },

  /**
   * Show statistics about page structure
   * Usage: await contentExtractorHelpers.stats()
   */
  async stats() {
    const cleanedDOM = await getDocumentContentFiltered();
    const specialElements = extractSpecialElements(cleanedDOM);
    const structure = extractEnhancedTextStructure(cleanedDOM);

    const stats = {
      elements: specialElements,
      sections: structure.length,
      totalLists: structure.reduce((sum, s) => sum + s.lists.length, 0),
      totalTables: structure.reduce((sum, s) => sum + s.tables.length, 0),
      totalCodeBlocks: structure.reduce((sum, s) => sum + s.codeBlocks.length, 0),
      totalImages: structure.reduce((sum, s) => sum + s.images.length, 0),
      totalContent: structure.reduce((sum, s) => sum + s.content.length, 0)
    };

    console.log('=== PAGE STRUCTURE STATISTICS ===');
    console.table(stats);
    return stats;
  },

  /**
   * Test list extraction
   * Usage: contentExtractorHelpers.testLists()
   */
  testLists() {
    const lists = document.querySelectorAll('ul, ol');
    console.log(`=== FOUND ${lists.length} LISTS ===`);

    lists.forEach((list, i) => {
      console.group(`List ${i + 1} (${list.tagName})`);
      const extracted = extractList(list);
      const formatted = formatList(extracted, 0, list.tagName === 'OL');
      console.log(formatted.join('\n'));
      console.groupEnd();
    });

    return lists.length;
  },

  /**
   * Test table extraction
   * Usage: contentExtractorHelpers.testTables()
   */
  testTables() {
    const tables = document.querySelectorAll('table');
    console.log(`=== FOUND ${tables.length} TABLES ===`);

    tables.forEach((table, i) => {
      console.group(`Table ${i + 1}`);
      const extracted = extractTable(table);
      const formatted = formatTable(extracted);
      console.log(formatted);
      console.groupEnd();
    });

    return tables.length;
  },

  /**
   * Test code block extraction
   * Usage: contentExtractorHelpers.testCodeBlocks()
   */
  testCodeBlocks() {
    const codeBlocks = document.querySelectorAll('pre, code');
    console.log(`=== FOUND ${codeBlocks.length} CODE BLOCKS ===`);

    codeBlocks.forEach((block, i) => {
      console.group(`Code Block ${i + 1} (${block.tagName})`);
      console.log('Language:', block.className?.replace('language-', '') || 'plaintext');
      console.log('Content:', block.textContent?.substring(0, 200) + (block.textContent?.length > 200 ? '...' : ''));
      console.groupEnd();
    });

    return codeBlocks.length;
  },

  /**
   * Test image extraction
   * Usage: contentExtractorHelpers.testImages()
   */
  testImages() {
    const images = document.querySelectorAll('img');
    console.log(`=== FOUND ${images.length} IMAGES ===`);

    const withAlt = Array.from(images).filter(img => img.alt);
    console.log(`Images with alt text: ${withAlt.length}`);

    withAlt.forEach((img, i) => {
      console.log(`${i + 1}. [${img.alt}] - ${img.src}`);
    });

    return { total: images.length, withAlt: withAlt.length };
  },

  /**
   * Show help/available commands
   * Usage: contentExtractorHelpers.help()
   */
  help() {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║         ENHANCED CONTENT EXTRACTOR - DEBUG HELPERS         ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  Quick Testing:                                            ║
║  • await contentExtractorHelpers.testBasic()              ║
║    → Test current extraction method                        ║
║                                                            ║
║  • await contentExtractorHelpers.testEnhanced()           ║
║    → Test new enhanced extraction                          ║
║                                                            ║
║  • await contentExtractorHelpers.compare()                ║
║    → Compare both methods side-by-side                     ║
║                                                            ║
║  Page Analysis:                                            ║
║  • contentExtractorHelpers.metadata()                     ║
║    → Show page metadata (Open Graph, meta tags, etc.)      ║
║                                                            ║
║  • await contentExtractorHelpers.mainContent()            ║
║    → Detect main content area (highlighted for 3s)         ║
║                                                            ║
║  • await contentExtractorHelpers.stats()                  ║
║    → Show page structure statistics                        ║
║                                                            ║
║  Element Testing:                                          ║
║  • contentExtractorHelpers.testLists()                    ║
║    → Test list extraction (ul, ol)                         ║
║                                                            ║
║  • contentExtractorHelpers.testTables()                   ║
║    → Test table extraction                                 ║
║                                                            ║
║  • contentExtractorHelpers.testCodeBlocks()               ║
║    → Test code block extraction (pre, code)                ║
║                                                            ║
║  • contentExtractorHelpers.testImages()                   ║
║    → Test image alt text extraction                        ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);

    return 'See commands above ☝️';
  }
};

console.log('✅ Enhanced Content Extractor loaded. Type contentExtractorHelpers.help() for commands.');
