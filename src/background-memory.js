const DB_NAME = 'LocalAIMemory';
const DB_VERSION = 1;

const STORES = {
  CONVERSATIONS: 'conversations',
  CONTEXT: 'context',
  SESSIONS: 'sessions'
};

class BackgroundMemory {
  constructor() {
    this.db = null;
    this.initPromise = null;
  }

  async init() {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error(`>>> ${manifest?.name ?? ''} - [background-memory.js] - IndexedDB error:`, request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(STORES.CONVERSATIONS)) {
          const conversationStore = db.createObjectStore(STORES.CONVERSATIONS, {
            keyPath: 'id',
            autoIncrement: true
          });
          conversationStore.createIndex('sessionId', 'sessionId', { unique: false });
          conversationStore.createIndex('timestamp', 'timestamp', { unique: false });
          conversationStore.createIndex('turnNumber', 'turnNumber', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.CONTEXT)) {
          db.createObjectStore(STORES.CONTEXT, {
            keyPath: 'sessionId'
          });
        }

        if (!db.objectStoreNames.contains(STORES.SESSIONS)) {
          const sessionStore = db.createObjectStore(STORES.SESSIONS, {
            keyPath: 'sessionId'
          });
          sessionStore.createIndex('lastAccessed', 'lastAccessed', { unique: false });
        }
      };
    });

    return this.initPromise;
  }

  async storeTurn(sessionId, turnNumber, userMessage, assistantResponse) {
    await this.init();

    const turn = {
      sessionId,
      turnNumber,
      userMessage,
      assistantResponse,
      timestamp: Date.now(),
      tokens: this.estimateTokens(userMessage + assistantResponse),
      summary: this.generateQuickSummary(userMessage, assistantResponse)
    };
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - built turn:`, turn);

    return this.put(STORES.CONVERSATIONS, turn);
  }

  async storeContext(sessionId, pageContent, attachments, pageHash) {
    await this.init();

    if(!sessionId){  sessionId = await getActiveSessionId();  }
    if(!sessionId){  throw new Error("No session Id was provided and no active session Id was found.");  }
    const currentContext = await this.getContext(sessionId);
    const context = {
      sessionId,
      pageContent: pageContent || null,
      pageHash: pageHash || null,
      pageSummary: pageContent ? this.extractPageSummary(pageContent) : null,
      attachments: attachments || [],
      attachmentSummaries: (attachments || []).map(att => this.extractAttachmentSummary(att)),
      timestamp: Date.now()
    };
    const updatedContext = Object.assign({}, currentContext, context);

    return this.put(STORES.CONTEXT, updatedContext);
    // return this.put(STORES.CONTEXT, context);
  }

  async getRecentTurns(sessionId, limit = 3) {
    await this.init();
    const turns = await this.query(STORES.CONVERSATIONS, 'sessionId', sessionId);

    return turns
      .sort((a, b) => b.turnNumber - a.turnNumber)
      .slice(0, limit)
      .reverse();
  }

  async getContext(sessionId) {
    await this.init();
    return this.get(STORES.CONTEXT, sessionId);
  }

  async getTurnSummaries(sessionId, skipRecent = 3) {
    await this.init();
    const turns = await this.query(STORES.CONVERSATIONS, 'sessionId', sessionId);

    return turns
      .sort((a, b) => a.turnNumber - b.turnNumber)
      .slice(0, -skipRecent)
      .map(turn => turn.summary);
  }

  async buildOptimisedContext(sessionId, newMessage, turnNumber, systemInstructions, pageContent, attachments, pageHash, toolsEnabled = false) {
    await this.init();

    const context = [];
    const budget = 3200;
    let used = 0;

    if (systemInstructions) {
      context.push({ role: 'system', content: systemInstructions });
      used += this.estimateTokens(systemInstructions);
    }

    let sessionContext = await this.getContext(sessionId);

    if (pageContent || attachments?.length > 0) {
      await this.storeContext(sessionId, pageContent, attachments, pageHash);
      sessionContext = await this.getContext(sessionId);
    }

    // if (!toolsEnabled) {
      if (pageContent) {
        context.push({ role: 'user', content: `[PAGE CONTENT]:\n${pageContent}` });
        used += this.estimateTokens(pageContent);
      } else if (sessionContext?.pageContent) {
        const currentPageData = await chrome.storage.local.get([activePageStorageKey]);
        const currentHash = currentPageData[activePageStorageKey]?.pageHash;

        if (currentHash && currentHash !== sessionContext.pageHash) {
          const freshPageContent = currentPageData[activePageStorageKey]?.pageContent;
          if (freshPageContent) {
            await this.storeContext(sessionId, freshPageContent, attachments, currentHash);
            sessionContext = await this.getContext(sessionId);
            console.debug(`>>> ${manifest?.name ?? ''} - [background-memory.js] - Page hash mismatch, updated context with fresh content`);
          }
        }

        if (turnNumber === 1 || newMessage.includes('@{{page}}')) {
          context.push({ role: 'user', content: `[PAGE CONTENT]:\n${sessionContext.pageContent}` });
          used += this.estimateTokens(sessionContext.pageContent);
        } else if (sessionContext.pageSummary) {
          context.push({ role: 'system', content: `[PAGE SUMMARY]: ${sessionContext.pageSummary}` });
          used += this.estimateTokens(sessionContext.pageSummary);
        }
      }
    // }

    if (sessionContext?.attachments?.length > 0) {
      if (turnNumber <= 2) {
        sessionContext.attachments.forEach(att => {
          const header = `[ATTACHMENT ${att.type?.toUpperCase()}]` +
            (att.filename ? ` (${att.filename})` : '') +
            (att.sourceUrl ? ` (from ${att.sourceUrl.split('/').slice(-2).join('/')})` : '');
          context.push({
            role: 'user',
            content: `${header}:\n${att.content}`
          });
          used += this.estimateTokens(att.content);
        });
      } else if (sessionContext.attachmentSummaries?.length > 0) {
        const summaries = sessionContext.attachmentSummaries.join('\n');
        context.push({ role: 'system', content: `[ATTACHMENTS]: ${summaries}` });
        used += this.estimateTokens(summaries);
      }
    }

    if (turnNumber > 3) {
      const oldSummaries = await this.getTurnSummaries(sessionId, 3);
      if (oldSummaries.length > 0) {
        const summaryText = oldSummaries.join(' ');
        const maxSummaryTokens = 300;
        const truncated = this.truncateToTokens(summaryText, maxSummaryTokens);
        context.push({ role: 'system', content: `[HISTORY]: ${truncated}` });
        used += Math.min(this.estimateTokens(summaryText), maxSummaryTokens);
      }
    }

    const budgetForRecent = Math.max(budget - used - 200, 500);
    const recentTurns = await this.getRecentTurns(sessionId, 3);

    const recentMessages = [];
    let recentTokens = 0;

    for (const turn of recentTurns) {
      const userTokens = this.estimateTokens(turn.userMessage);
      const assistantTokens = this.estimateTokens(turn.assistantResponse);

      if (recentTokens + userTokens + assistantTokens > budgetForRecent) {
        break;
      }

      recentMessages.push(
        { role: 'user', content: turn.userMessage },
        { role: 'assistant', content: turn.assistantResponse }
      );
      recentTokens += userTokens + assistantTokens;
    }

    context.push(...recentMessages);
    context.push({ role: 'user', content: newMessage });

    return context;
  }

  async deleteSession(sessionId) {
    await this.init();

    const turns = await this.query(STORES.CONVERSATIONS, 'sessionId', sessionId);
    for (const turn of turns) {
      await this.delete(STORES.CONVERSATIONS, turn.id);
    }

    await this.delete(STORES.CONTEXT, sessionId);
    await this.delete(STORES.SESSIONS, sessionId);
  }

  async clearAll() {
    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(
        [STORES.CONVERSATIONS, STORES.CONTEXT, STORES.SESSIONS],
        'readwrite'
      );

      transaction.oncomplete = () => {
        resolve();
      };

      transaction.onerror = () => {
        console.error(`>>> ${manifest?.name ?? ''} - [background-memory.js] - Error clearing stores:`, transaction.error);
        reject(transaction.error);
      };

      transaction.objectStore(STORES.CONVERSATIONS).clear();
      transaction.objectStore(STORES.CONTEXT).clear();
      transaction.objectStore(STORES.SESSIONS).clear();
    });
  }

  generateQuickSummary(userMessage, assistantResponse) {
    const userPreview = userMessage.substring(0, 80).replace(/\n/g, ' ');
    const assistantPreview = assistantResponse.substring(0, 100).replace(/\n/g, ' ');
    return `Q: ${userPreview}... A: ${assistantPreview}...`;
  }

  extractPageSummary(pageContent) {
    const maxLength = 300;
    const headings = pageContent.match(/##[^\n]+/g) || [];
    const headingText = headings.slice(0, 5).join('; ');
    const paragraphs = pageContent.split('\n\n').filter(p => p.length > 50);
    const firstPara = paragraphs[0] || '';
    const preview = firstPara.substring(0, 150);
    const summary = `Structure: ${headingText}. Content: ${preview}...`;
    return summary.substring(0, maxLength);
  }

  extractAttachmentSummary(attachment) {
    const preview = (attachment.content || '').substring(0, 150).replace(/\n/g, ' ');
    return `[${attachment.type}: ${attachment.filename || 'unknown'}] ${preview}...`;
  }

  estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
  }

  truncateToTokens(text, maxTokens) {
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) return text;
    return text.substring(0, maxChars) + '...';
  }

  async get(storeName, key) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async put(storeName, data) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(data);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(storeName, key) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async query(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async addPageToSession(sessionId, pageData) {
    try {
      const context = await this.getContext(sessionId) || { sessionId, pages: [] };

      if (!context.pages) {
        context.pages = [];
      }

      // Skip if hash already exists (strict deduplication)
      const hashExists = context.pages.some(p => p.hash === pageData.hash);
      if (hashExists) {
        return false;
      }

      // Add timestamp if not provided
      if (!pageData.timestamp) {
        pageData.timestamp = Date.now();
      }

      // Apply FIFO rotation when limit reached
      if (context.pages.length >= MAX_SESSION_PAGES) {
        context.pages.shift(); // Remove oldest
      }

      context.pages.push(pageData);
      await this.put(STORES.CONTEXT, context);
      return true;
    } catch (error) {
      console.error('addPageToSession error:', error);
      return false;
    }
  }

  async getSessionPages(sessionId) {
    try {
      const context = await this.getContext(sessionId);
      return context?.pages || [];
    } catch (error) {
      console.error('getSessionPages error:', error);
      return [];
    }
  }

  async getLastSessionPages(sessionId, count) {
    try {
      const pages = await this.getSessionPages(sessionId);
      if (count <= 0 || count > pages.length) {
        return pages;
      }
      return pages.slice(-count);
    } catch (error) {
      console.error('getLastSessionPages error:', error);
      return [];
    }
  }

  async getAllFromStore(storeName) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async clearSessionPages(sessionId) {
    try {
      const context = await this.getContext(sessionId);
      if (!context || !context.pages || context.pages.length === 0) {
        return false;
      }

      context.pages = [];
      await this.put(STORES.CONTEXT, context);
      return true;
    } catch (error) {
      console.error('clearSessionPages error:', error);
      return false;
    }
  }
}

const backgroundMemory = new BackgroundMemory();

// Global debug helpers for console access
globalThis.dbHelpers = {
  async listStores() {
    await backgroundMemory.init();
    return [...backgroundMemory.db.objectStoreNames];
  },

  async getAll(storeName) {
    await backgroundMemory.init();
    return await backgroundMemory.getAllFromStore(storeName);
  },

  async getContext(sessionId) {
    await backgroundMemory.init();
    return await backgroundMemory.getContext(sessionId);
  },

  async getConversations() {
    await backgroundMemory.init();
    return await backgroundMemory.getAllFromStore('conversations');
  },

  async getSessions() {
    await backgroundMemory.init();
    return await backgroundMemory.getAllFromStore('sessions');
  },

  async dump() {
    await backgroundMemory.init();
    const result = {};
    const stores = ['conversations', 'context', 'sessions'];
    for (const store of stores) {
      result[store] = await backgroundMemory.getAllFromStore(store);
    }
    return result;
  }
};

console.log('🔍 DB helpers available: dbHelpers.listStores(), .getAll(store), .dump(), etc.');
