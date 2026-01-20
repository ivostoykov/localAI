// IndexedDB-based conversation memory system
// Provides efficient storage and retrieval for long conversations

const DB_NAME = 'LocalAIMemory';
const DB_VERSION = 1;

// Store names
const STORES = {
  CONVERSATIONS: 'conversations',
  CONTEXT: 'context',
  SESSIONS: 'sessions'
};

class ConversationMemory {
  constructor() {
    this.db = null;
  }

  /**
   * Initialise the IndexedDB database
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

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

        // Context store (page content, attachments)
        if (!db.objectStoreNames.contains(STORES.CONTEXT)) {
          const contextStore = db.createObjectStore(STORES.CONTEXT, {
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
  }

  /**
   * Store a conversation turn
   */
  async storeTurn(sessionId, turnNumber, userMessage, assistantResponse) {
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

  /**
   * Store page/attachment context for a session
   */
  async storeContext(sessionId, pageContent, attachments) {
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

  /**
   * Get recent turns for a session (for working memory)
   */
  async getRecentTurns(sessionId, limit = 3) {
    const turns = await this.query(STORES.CONVERSATIONS, 'sessionId', sessionId);

    // Sort by turn number descending, take last N
    return turns
      .sort((a, b) => b.turnNumber - a.turnNumber)
      .slice(0, limit)
      .reverse(); // Reverse to get chronological order
  }

  /**
   * Get context for a session
   */
  async getContext(sessionId) {
    return this.get(STORES.CONTEXT, sessionId);
  }

  /**
   * Get turn summaries for long-term memory
   */
  async getTurnSummaries(sessionId, skipRecent = 3) {
    const turns = await this.query(STORES.CONVERSATIONS, 'sessionId', sessionId);

    // Get all except recent N turns
    return turns
      .sort((a, b) => a.turnNumber - b.turnNumber)
      .slice(0, -skipRecent)
      .map(turn => turn.summary);
  }

  /**
   * Build optimised context for LLM request
   */
  async buildOptimisedContext(sessionId, newMessage, turnNumber, systemInstructions) {
    const context = [];
    const budget = 3200; // Total token budget
    let used = 0;

    // 1. System instructions
    if (systemInstructions) {
      context.push({ role: 'system', content: systemInstructions });
      used += this.estimateTokens(systemInstructions);
    }

    // 2. Get session context (page/attachments)
    const sessionContext = await this.getContext(sessionId);

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

    // 4. Attachments - full on first turn, summaries afterwards
    if (sessionContext?.attachments?.length > 0) {
      if (turnNumber <= 2) {
        // First couple of turns: send full attachments
        sessionContext.attachments.forEach(att => {
          context.push({
            role: 'user',
            content: `[ATTACHMENT: ${att.filename}]:\n${att.content}`
          });
          used += this.estimateTokens(att.content);
        });
      } else if (sessionContext.attachmentSummaries?.length > 0) {
        // Later turns: send summaries
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
    const budgetForRecent = budget - used - 200; // Reserve 200 for new message
    const recentTurns = await this.getRecentTurns(sessionId, 3);

    const recentMessages = [];
    let recentTokens = 0;

    for (const turn of recentTurns) {
      const userTokens = this.estimateTokens(turn.userMessage);
      const assistantTokens = this.estimateTokens(turn.assistantResponse);

      if (recentTokens + userTokens + assistantTokens > budgetForRecent) {
        break; // Budget exhausted
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

    return context;
  }

  /**
   * Clean up old sessions
   */
  async pruneOldSessions(keepDays = 30) {
    const cutoff = Date.now() - (keepDays * 24 * 60 * 60 * 1000);
    const sessions = await this.getAll(STORES.SESSIONS);

    for (const session of sessions) {
      if (session.lastAccessed < cutoff) {
        await this.deleteSession(session.sessionId);
      }
    }
  }

  /**
   * Delete entire session (conversations + context)
   */
  async deleteSession(sessionId) {
    // Delete all conversation turns
    const turns = await this.query(STORES.CONVERSATIONS, 'sessionId', sessionId);
    for (const turn of turns) {
      await this.delete(STORES.CONVERSATIONS, turn.id);
    }

    // Delete context
    await this.delete(STORES.CONTEXT, sessionId);

    // Delete session metadata
    await this.delete(STORES.SESSIONS, sessionId);
  }

  // ===== Helper Methods =====

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
    const preview = attachment.content.substring(0, 150).replace(/\n/g, ' ');
    return `[${attachment.type}: ${attachment.filename}] ${preview}...`;
  }

  estimateTokens(text) {
    // Rough estimation: 1 token ≈ 4 characters
    return Math.ceil((text || '').length / 4);
  }

  truncateToTokens(text, maxTokens) {
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) return text;
    return text.substring(0, maxChars) + '...';
  }

  // ===== Generic IndexedDB Operations =====

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

  async getAll(storeName) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

// Singleton instance - available globally in extension context
const conversationMemory = new ConversationMemory();
