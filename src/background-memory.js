// Background service worker memory management
// IndexedDB must be accessed from background in Manifest V3

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
        console.error(`>>> ${manifest?.name || 'Unknown'} - [background-memory.js] - IndexedDB error:`, request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log(`>>> ${manifest?.name || 'Unknown'} - [background-memory.js] - IndexedDB initialized`);
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        console.log(`>>> ${manifest?.name || 'Unknown'} - [background-memory.js] - Creating IndexedDB stores`);

        // Conversation turns store
        if (!db.objectStoreNames.contains(STORES.CONVERSATIONS)) {
          const conversationStore = db.createObjectStore(STORES.CONVERSATIONS, {
            keyPath: 'id',
            autoIncrement: true
          });
          conversationStore.createIndex('sessionId', 'sessionId', { unique: false });
          conversationStore.createIndex('timestamp', 'timestamp', { unique: false });
          conversationStore.createIndex('turnNumber', 'turnNumber', { unique: false });
        }

        // Context store
        if (!db.objectStoreNames.contains(STORES.CONTEXT)) {
          db.createObjectStore(STORES.CONTEXT, {
            keyPath: 'sessionId'
          });
        }

        // Session metadata store
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

    return this.put(STORES.CONVERSATIONS, turn);
  }

  async storeContext(sessionId, pageContent, attachments) {
    await this.init();

    const context = {
      sessionId,
      pageContent: pageContent || null,
      pageSummary: pageContent ? this.extractPageSummary(pageContent) : null,
      attachments: attachments || [],
      attachmentSummaries: (attachments || []).map(att => this.extractAttachmentSummary(att)),
      timestamp: Date.now()
    };

    return this.put(STORES.CONTEXT, context);
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

  async buildOptimisedContext(sessionId, newMessage, turnNumber, systemInstructions, pageContent, attachments) {
    await this.init();

    const context = [];
    const budget = 3200;
    let used = 0;

    // 1. System instructions
    if (systemInstructions) {
      context.push({ role: 'system', content: systemInstructions });
      used += this.estimateTokens(systemInstructions);
    }

    // 2. Get or store session context
    let sessionContext = await this.getContext(sessionId);

    // If page content or attachments provided, store them
    if (pageContent || attachments?.length > 0) {
      await this.storeContext(sessionId, pageContent, attachments);
      sessionContext = await this.getContext(sessionId);
    }

    // 3. Page context - full on turn 1, summary afterwards
    if (sessionContext?.pageContent) {
      if (turnNumber === 1 || newMessage.includes('@{{page}}')) {
        context.push({ role: 'user', content: `[PAGE CONTENT]:\n${sessionContext.pageContent}` });
        used += this.estimateTokens(sessionContext.pageContent);
      } else if (sessionContext.pageSummary) {
        context.push({ role: 'system', content: `[PAGE SUMMARY]: ${sessionContext.pageSummary}` });
        used += this.estimateTokens(sessionContext.pageSummary);
      }
    }

    // 4. Attachments - full on first couple of turns, summaries afterwards
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

    // 5. Long-term memory (old turn summaries)
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

    // 6. Recent turns (working memory)
    const budgetForRecent = Math.max(budget - used - 200, 500); // Reserve 200 for new message, minimum 500
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

    // 7. Current message
    context.push({ role: 'user', content: newMessage });

    console.log(`>>> ${manifest?.name || 'Unknown'} - [background-memory.js] - Turn ${turnNumber}: ${context.length} messages, ~${used + recentTokens} tokens`);

    return context;
  }

  async deleteSession(sessionId) {
    await this.init();

    // Delete all conversation turns
    const turns = await this.query(STORES.CONVERSATIONS, 'sessionId', sessionId);
    for (const turn of turns) {
      await this.delete(STORES.CONVERSATIONS, turn.id);
    }

    // Delete context
    await this.delete(STORES.CONTEXT, sessionId);

    // Delete session metadata
    await this.delete(STORES.SESSIONS, sessionId);

    console.log(`>>> ${manifest?.name || 'Unknown'} - [background-memory.js] - Deleted session ${sessionId}`);
  }

  async clearAll() {
    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(
        [STORES.CONVERSATIONS, STORES.CONTEXT, STORES.SESSIONS],
        'readwrite'
      );

      transaction.oncomplete = () => {
        console.log(`>>> ${manifest?.name || 'Unknown'} - [background-memory.js] - Cleared all IndexedDB stores`);
        resolve();
      };

      transaction.onerror = () => {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [background-memory.js] - Error clearing stores:`, transaction.error);
        reject(transaction.error);
      };

      transaction.objectStore(STORES.CONVERSATIONS).clear();
      transaction.objectStore(STORES.CONTEXT).clear();
      transaction.objectStore(STORES.SESSIONS).clear();
    });
  }

  // Helper methods
  generateQuickSummary(userMessage, assistantResponse) {
    const userPreview = userMessage.substring(0, 80).replace(/\n/g, ' ');
    const assistantPreview = assistantResponse.substring(0, 100).replace(/\n/g, ' ');
    return `Q: ${userPreview}... A: ${assistantPreview}...`;
  }

  extractPageSummary(pageContent) {
    const maxLength = 300;

    // Extract headings
    const headings = pageContent.match(/##[^\n]+/g) || [];
    const headingText = headings.slice(0, 5).join('; ');

    // Extract first paragraph
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

  // Generic IndexedDB operations
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
}

// Singleton instance
const backgroundMemory = new BackgroundMemory();
