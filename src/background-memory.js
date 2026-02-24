const DB_NAME = 'LocalAIMemory';
const DB_VERSION = 2;

const STORES = {
  CONVERSATIONS: 'conversations',
  CONTEXT: 'context',
  SESSIONS: 'sessions',
  EMBEDDINGS: 'embeddings'
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
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - IndexedDB error:`, request.error);
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

        if (!db.objectStoreNames.contains(STORES.EMBEDDINGS)) {
          const embeddingStore = db.createObjectStore(STORES.EMBEDDINGS, {
            keyPath: 'id',
            autoIncrement: true
          });
          embeddingStore.createIndex('sessionId', 'sessionId', { unique: false });
          embeddingStore.createIndex('tabId', 'tabId', { unique: false });
          embeddingStore.createIndex('sessionTurn', ['sessionId', 'turnNumber'], { unique: false });
          embeddingStore.createIndex('type', 'type', { unique: false });
          embeddingStore.createIndex('contentHash', 'contentHash', { unique: false });
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

  async storeContext(sessionId, pageContent, attachments, pageHash, tabId = null) {
    await this.init();

    if(!sessionId){  sessionId = await getActiveSessionId();  }
    if(!sessionId){
      console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - No session ID available:`, {
        providedSessionId: sessionId,
        activeSessionId: await getActiveSessionId(),
        tabId,
        pageHash
      });
      throw new Error("No session Id was provided and no active session Id was found.");
    }
    const currentContext = await this.getContext(sessionId);
    const context = {
      sessionId,
      tabId,
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

  async buildOptimisedContext(sessionId, newMessage, turnNumber, systemInstructions, pageContent, attachments, pageHash, toolsEnabled = false, tabId = null) {
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
      await this.storeContext(sessionId, pageContent, attachments, pageHash, tabId);
      sessionContext = await this.getContext(sessionId);
    }

    // if (!toolsEnabled) {
      if (pageContent) {
        context.push({ role: 'user', content: `[PAGE CONTENT]:\n${pageContent}` });
        used += this.estimateTokens(pageContent);
      } else if (sessionContext?.pageContent) {
        const key = tabId ? `${activePageStorageKey}:${tabId}` : activePageStorageKey;
        const currentPageData = await chrome.storage.local.get([key]);
        const currentHash = currentPageData[key]?.pageHash;

        if (currentHash && currentHash !== sessionContext.pageHash) {
          const freshPageContent = currentPageData[key]?.pageContent;
          if (freshPageContent) {
            await this.storeContext(sessionId, freshPageContent, attachments, currentHash, tabId);
            sessionContext = await this.getContext(sessionId);
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Page hash mismatch, updated context with fresh content`);
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

    const embeddings = await this.query(STORES.EMBEDDINGS, 'sessionId', sessionId);
    for (const embedding of embeddings) {
      await this.delete(STORES.EMBEDDINGS, embedding.id);
    }

    await this.delete(STORES.CONTEXT, sessionId);
    await this.delete(STORES.SESSIONS, sessionId);
  }

  async clearAll() {
    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(
        [STORES.CONVERSATIONS, STORES.CONTEXT, STORES.SESSIONS, STORES.EMBEDDINGS],
        'readwrite'
      );

      transaction.oncomplete = () => {
        resolve();
      };

      transaction.onerror = () => {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error clearing stores:`, transaction.error);
        reject(transaction.error);
      };

      transaction.objectStore(STORES.CONVERSATIONS).clear();
      transaction.objectStore(STORES.CONTEXT).clear();
      transaction.objectStore(STORES.SESSIONS).clear();
      transaction.objectStore(STORES.EMBEDDINGS).clear();
    });
  }

  async hashContent(content) {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  chunkPageContent(pageContent, maxTokens = 500) {
    const chunks = [];
    const paragraphs = pageContent.split('\n\n').filter(p => p.trim().length > 0);
    let currentChunk = '';

    for (const para of paragraphs) {
      const combinedTokens = this.estimateTokens(currentChunk + '\n\n' + para);

      if (combinedTokens > maxTokens && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = para;
      } else {
        currentChunk = currentChunk ? currentChunk + '\n\n' + para : para;
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || !Array.isArray(vecA) || !Array.isArray(vecB)) {
      console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Invalid vector parameters:`, {
        vecA: { type: typeof vecA, isArray: Array.isArray(vecA), value: vecA },
        vecB: { type: typeof vecB, isArray: Array.isArray(vecB), value: vecB }
      });
      throw new Error('Both vectors must be valid arrays');
    }
    if (vecA.length !== vecB.length) {
      console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Vector dimension mismatch:`, {
        vecA: { length: vecA.length, sample: vecA.slice(0, 5) },
        vecB: { length: vecB.length, sample: vecB.slice(0, 5) }
      });
      throw new Error('Vectors must have same dimensions');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async generateEmbedding(text) {
    let embedUrl;
    let model;
    try {
      const laiOptions = await getOptions();

      embedUrl = laiOptions?.embedUrl || laiOptions?.aiUrl?.replace(/chat$/i, 'embed');

      if (!embedUrl) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Embedding URL not configured:`, {
          laiOptions,
          embedUrl,
          aiUrl: laiOptions?.aiUrl,
          text: text?.substring(0, 100)
        });
        throw new Error('Embedding URL not configured');
      }

      model = laiOptions.embeddingModel || laiOptions.aiModel;

      if (!model) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Embedding model not configured:`, {
          laiOptions,
          embeddingModel: laiOptions?.embeddingModel,
          aiModel: laiOptions?.aiModel,
          text: text?.substring(0, 100)
        });
        throw new Error('Embedding model not configured');
      }

      const requestBody = {
        model: model,
        input: [text]
      };
      console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] request body`, requestBody);
      const response = await fetch(embedUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Embedding generation failed:`, {
          status: response.status,
          statusText: response.statusText,
          errorText,
          embedUrl,
          model,
          text: text?.substring(0, 100)
        });
        throw new Error(`Embedding generation failed: ${response.statusText}`);
      }

      const responseText = await response.text();
      let data;
      let embeddings;

      try {
        data = JSON.parse(responseText);
        embeddings = data.embeddings;
      } catch (parseError) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to parse response as JSON:`, {
          parseError,
          responseText,
          embedUrl,
          model,
          text: text?.substring(0, 100)
        });
        throw new Error('Failed to parse embedding response as JSON');
      }

      if (!embeddings || !Array.isArray(embeddings) || embeddings.length === 0) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Invalid embedding returned from API:`, {
          data,
          embeddings,
          responseText,
          embeddingType: typeof data?.embedding,
          embeddingIsArray: Array.isArray(data?.embedding),
          embeddingLength: data?.embedding?.length,
          embedUrl,
          model,
          text: text?.substring(0, 100)
        });
        throw new Error('Invalid embedding returned from API');
      }

      return embeddings;
    } catch (error) {
      console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - generateEmbedding error:`, {
        error,
        responseText,
        data,
        embeddings,
        embedUrl,
        model,
        text: text?.substring(0, 100)
      });
      throw error;
    }
  }

  async storeEmbedding(embeddingData) {
    try {
      await this.init();

      if (!embeddingData?.embedding || !Array.isArray(embeddingData.embedding) || embeddingData.embedding.length === 0) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Invalid embedding data:`, {
          embeddingData,
          embeddingType: typeof embeddingData?.embedding,
          embeddingIsArray: Array.isArray(embeddingData?.embedding),
          embeddingLength: embeddingData?.embedding?.length,
          sessionId: embeddingData?.sessionId,
          tabId: embeddingData?.tabId,
          type: embeddingData?.type,
          turnNumber: embeddingData?.turnNumber
        });
        throw new Error('Invalid embedding data: embedding must be a non-empty array');
      }

      const existing = await this.query(STORES.EMBEDDINGS, 'contentHash', embeddingData.contentHash);
      const duplicate = existing.find(e =>
        e.sessionId === embeddingData.sessionId &&
        e.tabId === embeddingData.tabId &&
        e.type === embeddingData.type &&
        e.turnNumber === embeddingData.turnNumber
      );

      if (duplicate) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Content already embedded for this session/tab/type/turn, skipping:`, embeddingData.contentHash);
        return duplicate.id;
      }

      return await this.put(STORES.EMBEDDINGS, embeddingData);
    } catch (error) {
      console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - storeEmbedding error:`, {
        error,
        embeddingData: {
          sessionId: embeddingData?.sessionId,
          tabId: embeddingData?.tabId,
          type: embeddingData?.type,
          turnNumber: embeddingData?.turnNumber,
          contentHash: embeddingData?.contentHash,
          hasEmbedding: !!embeddingData?.embedding,
          embeddingLength: embeddingData?.embedding?.length
        }
      });
      throw error;
    }
  }

  async semanticSearch(query, options = {}) {
    try {
      await this.init();

      const {
        sessionId = null,
        tabId = null,
        type = null,
        limit = 10,
        threshold = 0.5
      } = options;

      const queryEmbedding = await this.generateEmbedding(query);

      let embeddings;
      if (sessionId) {
        embeddings = await this.query(STORES.EMBEDDINGS, 'sessionId', sessionId);
      } else {
        embeddings = await this.getAllFromStore(STORES.EMBEDDINGS);
      }

      if (tabId) {
        embeddings = embeddings.filter(emb => emb.tabId === tabId);
      }
      if (type) {
        embeddings = embeddings.filter(emb => emb.type === type);
      }

      const results = embeddings
        .filter(emb => emb.embedding && Array.isArray(emb.embedding) && emb.embedding.length > 0)
        .map(emb => ({
          ...emb,
          similarity: this.cosineSimilarity(queryEmbedding, emb.embedding)
        }))
      .filter(result => result.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

      console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Semantic search found ${results.length} results`);
      return results;
    } catch (error) {
      console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - semanticSearch error:`, error);
      throw error;
    }
  }

  async storeTurnWithEmbeddings(sessionId, tabId, turnNumber, userMessage, assistantResponse) {
    try {
      await this.storeTurn(sessionId, turnNumber, userMessage, assistantResponse);

      const userHash = await this.hashContent(userMessage);
      const assistantHash = await this.hashContent(assistantResponse);

      const userEmbedding = await this.generateEmbedding(userMessage);
      if (!userEmbedding || !Array.isArray(userEmbedding) || userEmbedding.length === 0) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to generate user embedding:`, {
          sessionId,
          tabId,
          turnNumber,
          userMessage: userMessage?.substring(0, 100),
          userEmbedding,
          userEmbeddingType: typeof userEmbedding
        });
        throw new Error('Failed to generate valid user embedding');
      }

      await this.storeEmbedding({
        sessionId,
        tabId,
        turnNumber,
        type: 'user',
        contentHash: userHash,
        embedding: userEmbedding,
        metadata: { timestamp: Date.now() }
      });

      const assistantEmbedding = await this.generateEmbedding(assistantResponse);
      if (!assistantEmbedding || !Array.isArray(assistantEmbedding) || assistantEmbedding.length === 0) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to generate assistant embedding:`, {
          sessionId,
          tabId,
          turnNumber,
          assistantResponse: assistantResponse?.substring(0, 100),
          assistantEmbedding,
          assistantEmbeddingType: typeof assistantEmbedding
        });
        throw new Error('Failed to generate valid assistant embedding');
      }

      await this.storeEmbedding({
        sessionId,
        tabId,
        turnNumber,
        type: 'assistant',
        contentHash: assistantHash,
        embedding: assistantEmbedding,
        metadata: { timestamp: Date.now() }
      });

      console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Stored embeddings for turn ${turnNumber}`);
    } catch (error) {
      console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - storeTurnWithEmbeddings error:`, {
        error,
        sessionId,
        tabId,
        turnNumber,
        userMessageLength: userMessage?.length,
        assistantResponseLength: assistantResponse?.length
      });
      throw error;
    }
  }

  async storeToolCallEmbedding(sessionId, tabId, turnNumber, toolName, toolResult) {
    try {
      const summary = `Tool: ${toolName} - ${this.extractToolResultSummary(toolResult)}`;
      const hash = await this.hashContent(summary);
      const embedding = await this.generateEmbedding(summary);

      if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to generate tool call embedding:`, {
          sessionId,
          tabId,
          turnNumber,
          toolName,
          summary: summary?.substring(0, 100),
          embedding,
          embeddingType: typeof embedding
        });
        return;
      }

      await this.storeEmbedding({
        sessionId,
        tabId,
        turnNumber,
        type: 'tool_call',
        contentHash: hash,
        embedding: embedding,
        metadata: {
          toolName,
          toolResult: this.extractToolResultSummary(toolResult),
          timestamp: Date.now()
        }
      });
    } catch (error) {
      console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to store tool call embedding:`, {
        error,
        sessionId,
        tabId,
        turnNumber,
        toolName
      });
    }
  }

  extractToolResultSummary(toolResult) {
    if (typeof toolResult === 'string') {
      return toolResult.substring(0, 200);
    }
    if (typeof toolResult === 'object') {
      return JSON.stringify(toolResult).substring(0, 200);
    }
    return String(toolResult).substring(0, 200);
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
    const stores = ['conversations', 'context', 'sessions', 'embeddings'];
    for (const store of stores) {
      result[store] = await backgroundMemory.getAllFromStore(store);
    }
    return result;
  },

  async getEmbeddings(sessionId = null) {
    await backgroundMemory.init();
    if (sessionId) {
      return await backgroundMemory.query('embeddings', 'sessionId', sessionId);
    }
    return await backgroundMemory.getAllFromStore('embeddings');
  },

  async getEmbeddingsByTab(tabId) {
    await backgroundMemory.init();
    return await backgroundMemory.query('embeddings', 'tabId', tabId);
  },

  async getEmbeddingsByType(type) {
    await backgroundMemory.init();
    return await backgroundMemory.query('embeddings', 'type', type);
  },

  async getEmbeddingsBySessionTurn(sessionId, turnNumber) {
    await backgroundMemory.init();
    const embeddings = await backgroundMemory.getAllFromStore('embeddings');
    return embeddings.filter(emb =>
      emb.sessionId === sessionId && emb.turnNumber === turnNumber
    );
  },

  async searchEmbeddings(query, options) {
    await backgroundMemory.init();
    return await backgroundMemory.semanticSearch(query, options);
  },

  async countEmbeddings(sessionId = null) {
    await backgroundMemory.init();
    const embeddings = sessionId
      ? await backgroundMemory.query('embeddings', 'sessionId', sessionId)
      : await backgroundMemory.getAllFromStore('embeddings');
    return embeddings.length;
  },

  async deleteEmbeddingsBySession(sessionId) {
    await backgroundMemory.init();
    const embeddings = await backgroundMemory.query('embeddings', 'sessionId', sessionId);
    const transaction = backgroundMemory.db.transaction(['embeddings'], 'readwrite');
    const store = transaction.objectStore('embeddings');

    for (const emb of embeddings) {
      store.delete(emb.id);
    }

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve(embeddings.length);
      transaction.onerror = () => reject(transaction.error);
    });
  }
};

console.log('🔍 DB helpers available: dbHelpers.listStores(), .getAll(store), .dump(), .getEmbeddings(), .searchEmbeddings(), etc.');
