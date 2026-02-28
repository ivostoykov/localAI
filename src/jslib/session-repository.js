class SessionRepository {
    constructor() {
        this.storageKey = 'activeSession';
        this.sessionsKey = 'sessions';
        this.db = null;
        this.writeQueues = new Map();
    }

    setIndexedDB(backgroundMemoryInstance) {
        this.db = backgroundMemoryInstance;
    }

    async _queueContextUpdate(sessionId, updateFn) {
        if (!this.writeQueues.has(sessionId)) {
            this.writeQueues.set(sessionId, Promise.resolve());
        }

        const promise = this.writeQueues.get(sessionId).then(async () => {
            try {
                return await updateFn();
            } catch (error) {
                throw error;
            }
        });

        this.writeQueues.set(sessionId, promise.catch(() => {}));
        return promise;
    }

    // ============================================================
    // SESSION OPERATIONS (chrome.storage.local)
    // ============================================================
    // Delegates to sessions.js functions to avoid duplication

    async getActiveSession() {
        return await getActiveSession();
    }

    async saveActiveSession(session) {
        return await setActiveSession(session);
    }

    async addMessage(role, content, timestamp = Date.now()) {
        const session = await this.getActiveSession();
        if (!session) {
            throw new Error('No active session');
        }

        if (!session.messages) {
            session.messages = [];
        }

        session.messages.push({ role, content, timestamp });
        await this.saveActiveSession(session);
    }

    // ============================================================
    // ATTACHMENT OPERATIONS (IndexedDB)
    // ============================================================

    async storeAttachment(sessionId, attachment) {
        if (!this.db) {
            throw new Error('IndexedDB not initialised. Call setIndexedDB() first');
        }

        return this._queueContextUpdate(sessionId, async () => {
            try {
                let context = await this.db.getContext(sessionId);
                if (!context) {
                    context = {
                        sessionId,
                        attachments: [],
                        timestamp: Date.now()
                    };
                }

                if (!context.attachments) {
                    context.attachments = [];
                }

                const existingIndex = context.attachments.findIndex(att => att.id === attachment.id);
                if (existingIndex >= 0) {
                    context.attachments[existingIndex] = attachment;
                } else {
                    context.attachments.push(attachment);
                }

                context.attachmentSummaries = context.attachments.map(att =>
                    this.db.extractAttachmentSummary(att)
                );

                await this.db.storeContext(sessionId, context.pageContent, context.attachments, context.pageHash, context.tabId);
            } catch (error) {
                console.error(`>>> ${manifest?.name ?? ''} - sessionRepository.storeAttachment:`, error);
                throw error;
            }
        });
    }

    async getAttachment(sessionId, attachmentId) {
        if (!this.db) {
            throw new Error('IndexedDB not initialised');
        }

        try {
            const context = await this.db.getContext(sessionId);
            if (!context || !context.attachments) {
                return null;
            }

            return context.attachments.find(att => att.id === attachmentId) || null;
        } catch (error) {
            console.error(`>>> ${manifest?.name ?? ''} - sessionRepository.getAttachment:`, error);
            throw error;
        }
    }

    async getAttachments(sessionId) {
        if (!this.db) {
            throw new Error('IndexedDB not initialised');
        }

        try {
            const context = await this.db.getContext(sessionId);
            return context?.attachments || [];
        } catch (error) {
            console.error(`>>> ${manifest?.name ?? ''} - sessionRepository.getAttachments:`, error);
            throw error;
        }
    }

    async deleteAttachment(sessionId, attachmentId) {
        if (!this.db) {
            throw new Error('IndexedDB not initialised');
        }

        return this._queueContextUpdate(sessionId, async () => {
            try {
                const context = await this.db.getContext(sessionId);
                if (!context || !context.attachments) {
                    return;
                }

                context.attachments = context.attachments.filter(att => att.id !== attachmentId);
                context.attachmentSummaries = context.attachments.map(att =>
                    this.db.extractAttachmentSummary(att)
                );

                await this.db.storeContext(sessionId, context.pageContent, context.attachments, context.pageHash, context.tabId);
            } catch (error) {
                console.error(`>>> ${manifest?.name ?? ''} - sessionRepository.deleteAttachment:`, error);
                throw error;
            }
        });
    }

    // ============================================================
    // IMAGE OPERATIONS (IndexedDB)
    // ============================================================
    // Note: Images need a separate store. For now, storing in context.images array
    // TODO: Create dedicated IMAGES store in IndexedDB

    async storeImage(sessionId, imageData) {
        if (!this.db) {
            throw new Error('IndexedDB not initialised');
        }

        return this._queueContextUpdate(sessionId, async () => {
            try {
                let context = await this.db.getContext(sessionId);
                if (!context) {
                    context = {
                        sessionId,
                        images: [],
                        timestamp: Date.now()
                    };
                }

                if (!context.images) {
                    context.images = [];
                }

                const existingIndex = context.images.findIndex(img => img.id === imageData.id);
                if (existingIndex >= 0) {
                    context.images[existingIndex] = imageData;
                } else {
                    context.images.push(imageData);
                }

                await this.db.put('context', context);
            } catch (error) {
                console.error(`>>> ${manifest?.name ?? ''} - sessionRepository.storeImage:`, error);
                throw error;
            }
        });
    }

    async getImage(sessionId, imageId) {
        if (!this.db) {
            throw new Error('IndexedDB not initialised');
        }1

        try {
            const context = await this.db.getContext(sessionId);
            if (!context || !context.images) {
                return null;
            }

            return context.images.find(img => img.id === imageId) || null;
        } catch (error) {
            console.error(`>>> ${manifest?.name ?? ''} - sessionRepository.getImage:`, error);
            return null;
        }
    }

    async resolveImageRefs(sessionId, imageRefs) {
        if (!imageRefs || imageRefs.length === 0) {
            return [];
        }

        const images = [];
        for (const imageId of imageRefs) {
            const img = await this.getImage(sessionId, imageId);
            if (img && img.base64) {
                images.push(img.base64);
            }
        }

        return images;
    }

    // ============================================================
    // CONTEXT OPERATIONS (IndexedDB)
    // ============================================================

    async buildOptimisedContext(sessionId, turnNumber, newMessage, systemInstructions, pageContent) {
        if (!this.db) {
            throw new Error('IndexedDB not initialised');
        }

        try {
            const attachments = await this.getAttachments(sessionId);

            return await this.db.buildOptimisedContext(
                sessionId,
                newMessage,
                turnNumber,
                systemInstructions,
                pageContent,
                attachments
            );
        } catch (error) {
            console.error(`>>> ${manifest?.name ?? ''} - sessionRepository.buildOptimisedContext:`, error);
            throw error;
        }
    }

    async storeToolCalls(sessionId, turnNumber, calls) {
        if (!this.db) {
            throw new Error('IndexedDB not initialised');
        }

        return this._queueContextUpdate(sessionId, async () => {
            try {
                let context = await this.db.getContext(sessionId);
                if (!context) {
                    context = {
                        sessionId,
                        toolCalls: {},
                        timestamp: Date.now()
                    };
                }

                if (!context.toolCalls) {
                    context.toolCalls = {};
                }
                context.toolCalls[turnNumber] = calls;
                await this.db.put('context', context);
            } catch (error) {
                console.error(`>>> ${manifest?.name ?? ''} - sessionRepository.storeToolCalls:`, error);
                throw error;
            }
        });
    }

    // ============================================================
    // UTILITY
    // ============================================================

    estimateTokens(text) {
        if (!text) return 0;
        return Math.ceil(text.length / 4);
    }
}

const sessionRepository = new SessionRepository();
