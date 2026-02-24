if(typeof manifest === 'undefined'){
    var manifest = chrome.runtime.getManifest();
}

async function createNewSession(text = `Session ${new Date().toISOString().replace(/[TZ]/g, ' ').trim()}`) {
    let model;
    const sessionId = crypto.randomUUID();
    let newSession = false;
    let sessions = [];
    try {
        const laiOptions = await getOptions();
        model = laiOptions?.aiModel || 'unknown';
        sessions = await getAllSessions();
        const title = text.split(/\s+/).slice(0, 6).join(' ');

        const now = Date.now();
        newSession = {
            id: sessionId,
            title: title,
            messages: [],
            model: model,
            createdAt: now,
            lastAccessedAt: now
        };
    } catch (e) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${e.message}`, e);
        const now = Date.now();
        newSession = {
            id: sessionId,
            title: text?.toString()?.split(/\s+/)?.slice(0, 6)?.join(' ') || '',
            messages: [],
            model: model || 'unknown',
            createdAt: now,
            lastAccessedAt: now
        };
    }

    sessions.push(newSession);
    await setAllSessions(sessions);
    await setActiveSessionId(newSession?.id);

    return newSession;
}

async function deleteSession(sessionId = null) {
    try {
        if (!sessionId) {
            sessionId = await getActiveSessionId();
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - No active session found.`);
        }

        const sessions = await getAllSessions();
        if (sessions.length < 1) { return; }

        const idx = sessions.findIndex(s => s?.id === sessionId);
        if (idx < 0) {
            console.warn(`Session with id ${sessionId} not found!`);
            return;
        }

        sessions.splice(idx, 1);
        await setAllSessions(sessions);

        const activeSessionId = await getActiveSessionId();
        if (activeSessionId === sessionId) {
            await deleteActiveSessionId();
        }

        await deleteSessionMemory(sessionId);
    } catch (e) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Delete session error: ${e.message}`, e);
    }
}

async function deleteActiveSession() {
    return deleteSession();
}

async function deleteSessionById(sessionId) {
    return deleteSession(sessionId);
}

async function deleteActiveSessionId() {
    try {
        await chrome.storage.local.remove(activeSessionIdStorageKey);

    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${error.message}`, error);
    }
}

async function getSession(sessionId = null, createIfMissing = true, updateAccess = true) {
    try {
        if (!sessionId) {
            sessionId = await getActiveSessionId();
            if (!sessionId && createIfMissing) {
                return await createNewSession();
            }
            if (!sessionId) {
                return null;
            }
        }

        const sessions = await getAllSessions();
        const session = sessions.find(sess => sess?.id === sessionId);

        if (!session && createIfMissing && !sessionId) {
            return await createNewSession();
        }

        if (session && updateAccess) {
            session.lastAccessedAt = Date.now();
            await setAllSessions(sessions);
        }

        return session || null;
    } catch (e) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${e.message}`, e);
        return null;
    }
}

async function getActiveSession() {
    return getSession();
}

async function getActiveSessionById(sessionId) {
    return getSession(sessionId, false);
}

async function getAllSessions() {
    try {
        const result = await chrome.storage.local.get([allSessionsStorageKey]);
        return result[allSessionsStorageKey] ?? [];
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${error.message}`, error);
        return [];
    }
}

async function getActiveSessionId() {
    try {
        const result = await chrome.storage.local.get(activeSessionIdStorageKey);
        const sessionId = result[activeSessionIdStorageKey];

        if (sessionId && typeof sessionId === 'string' && sessionId.trim()) {
            return sessionId;
        }
        return null;
    } catch (error) {
        if(error.message.indexOf("context invalidated") > -1){
            showMessage(`${error.message}. Please reload the page.`, "error");
            return null;
        }
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - getActiveSessionId error: ${error.message}`, error);
        return null;
    }
}

async function setAllSessions(obj = []) {
    try {
        if (obj && typeof obj === 'object' && allSessionsStorageKey in obj) {
            obj = obj[allSessionsStorageKey]; // unwrap if needed
        }

        await chrome.storage.local.set({ [allSessionsStorageKey]: obj });
        return true;
    } catch (e) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${e.message}`, e);
        return false;
    }
}

async function setActiveSessionId(sessionId) {
    try {
        if (!sessionId || typeof sessionId !== 'string') {
            throw new Error(`Invalid session ID provided: ${sessionId}`);
        }
        await chrome.storage.local.set({ [activeSessionIdStorageKey]: sessionId });
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - setActiveSessionId error: ${error.message}`, error);
    }
}

async function setActiveSession(session) {
    try {
        if (!session?.id) { throw new Error(`[${getLineNumber()}]: Session object is missing a valid id!`); }

        if ((session?.messages?.length ?? 0) + (session?.attachments?.length ?? 0) === 0)  {
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Skipping save of empty session ${session?.id}`);
            return;
        }

        const sessions = await getAllSessions();
        const idx = sessions.findIndex(s => s?.id === session?.id);

        if (idx < 0) { throw new Error(`Session with id ${session?.id} not found!`); }

        session.lastAccessedAt = Date.now();
        sessions[idx] = session;
        const filteredSessions = sessions.filter(s => (s?.messages?.length ?? 0) + (s?.attachments?.length ?? 0) > 0);
        await setAllSessions(filteredSessions);
        await setActiveSessionId(session?.id);
    } catch (e) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - setActiveSession error: ${e.message}`, e);
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - the session thrown the error`, session);
    }
}

async function getArchivedSessions() {
    try {
        const result = await chrome.storage.local.get([archivedSessionsStorageKey]);
        return result[archivedSessionsStorageKey] ?? [];
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${error.message}`, error);
        return [];
    }
}

async function setArchivedSessions(sessions = []) {
    try {
        await chrome.storage.local.set({ [archivedSessionsStorageKey]: sessions });
        return true;
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${error.message}`, error);
        return false;
    }
}

async function archiveSession(sessionId) {
    try {
        if (!sessionId) {
            console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - No session ID provided for archiving`);
            return false;
        }

        const sessions = await getAllSessions();
        const sessionIndex = sessions.findIndex(s => s?.id === sessionId);

        if (sessionIndex < 0) {
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Session ${sessionId} not found in active sessions`);
            return false;
        }

        const session = sessions[sessionIndex];
        session.closedAt = Date.now();

        const archivedSessions = await getArchivedSessions();
        archivedSessions.push(session);
        await setArchivedSessions(archivedSessions);

        sessions.splice(sessionIndex, 1);
        await setAllSessions(sessions);

        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Archived session ${sessionId}`);
        return true;
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${error.message}`, error);
        return false;
    }
}

async function pruneArchivedSessions() {
    try {
        const retentionMs = ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        const cutoffTime = Date.now() - retentionMs;

        const archivedSessions = await getArchivedSessions();
        const initialCount = archivedSessions.length;

        const retained = archivedSessions.filter(s =>
            s.closedAt && s.closedAt > cutoffTime
        );

        if (retained.length < initialCount) {
            await setArchivedSessions(retained);
            const prunedCount = initialCount - retained.length;
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Pruned ${prunedCount} archived sessions older than ${ARCHIVE_RETENTION_DAYS} days`);
            return prunedCount;
        }

        return 0;
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${error.message}`, error);
        return 0;
    }
}

async function cleanupOrphanedSessions() {
    try {
        await pruneArchivedSessions();

        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Cleanup completed`);
        return true;
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${error.message}`, error);
        return false;
    }
}

async function removeLocalStorageObject(key = '') {
    try {
        if (!key) { throw new Error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Storage key is either missing or empty [${key}]`); }
        await chrome.storage.local.remove(key);
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${error.message}`, error);
    }
}

async function getAiUserCommands() {
    try {
        const result = await chrome.storage.local.get([storageUserCommandsKey]);
        const list = result[storageUserCommandsKey] || [];
        aiUserCommands = list;
        return list;
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${error.message}`, error);
        return [];
    }
}

async function setAiUserCommands() {
    try {
        await chrome.storage.local.set({ [storageUserCommandsKey]: aiUserCommands });
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${error.message}`, error);
    }
}

async function getOptions() {
    const defaults = {
        "openPanelOnLoad": false,
        "aiUrl": "",
        "aiModel": "",
        "embedUrl": "",
        "embeddingModel": "",
        "closeOnClickOut": true,
        "closeOnCopy": false,
        "closeOnSendTo": true,
        "showEmbeddedButton": false,
        "loadHistoryOnStart": false,
        "systemInstructions": 'You are a helpful assistant.',
        "personalInfo": '',
        "debug": false
    };

    try {
        const key = storageOptionKey || 'laiOptions';
        const opt = await chrome.storage.sync.get(key);
        const aiOptions = opt[key] || {};
        const laiOptions = Object.assign({}, aiOptions);

        for (const key in defaults) {
            if (!(key in laiOptions)) {
                laiOptions[key] = defaults[key];
            }
        }

        return laiOptions;
    } catch (e) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${e.message}`, e);
        return null;
    }
}

async function setOptions(options) {
    try {
        const key = storageOptionKey || 'laiOptions';
        const e = new Error();
        console.log(`>>> ${manifest?.name ?? ''} - ${setOptions?.name}`, options, e, )
        await chrome.storage.sync.set({ [key]: options });
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${error.message}`, error, options);
    }
}

async function getActiveSessionPageData(tabId) {
    const key = tabId ? `${activePageStorageKey}:${tabId}` : activePageStorageKey;
    const result = await chrome.storage.local.get([key]);
    const pageData = result[key] || null;
    if(!pageData){
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Missing page data`, {pageData, key, result});
    }
    return pageData;
}

async function setActiveSessionPageData(tabId) {
    try {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Called setActiveSessionPageData`, {
            tabId,
            url: location.href,
            readyState: document.readyState,
            bodyExists: !!document.body,
            bodyLength: document.body?.innerText?.length ?? 0
        });

        await waitForDOMToSettle(1000, 120000);

        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - After waitForDOMToSettle`, {
            readyState: document.readyState,
            bodyLength: document.body?.innerText?.length ?? 0
        });

        const url = location.href;
        const pageContent = await getPageTextContent() ?? null;

        if(!pageContent) {
            console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Empty page content!`, {
                url,
                readyState: document.readyState,
                bodyExists: !!document.body,
                bodyLength: document.body?.innerText?.length ?? 0,
                bodyFirstChars: document.body?.innerText?.substring(0, 100) ?? ''
            });
            return;
        }

        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Successfully extracted page content`, {
            url,
            contentLength: pageContent.length,
            contentFirstChars: pageContent.substring(0, 100)
        });

        const pageHash = generatePageHash(url, pageContent.length);
        console.debug(`>>> ${manifest?.name} - [${getLineNumber()}] - current hash`, pageHash);
        const key = tabId ? `${activePageStorageKey}:${tabId}` : activePageStorageKey;
        await chrome.storage.local.set({ [key]: {url, pageContent, pageHash} });

        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Successfully stored page data`, {
            key,
            url,
            contentLength: pageContent.length
        });
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error in setActiveSessionPageData:`, {
            error: error.message,
            stack: error.stack,
            tabId,
            url: location.href,
            readyState: document.readyState
        });
    }
}

async function removeActiveSessionPageData(tabId) {
    const key = tabId ? `${activePageStorageKey}:${tabId}` : activePageStorageKey;
    await chrome.storage.local.remove(key);
    await chrome.storage.local.remove(activePageStorageKey); // temp to remove old storage
}

async function deleteSessionMemory(sessionId) {
    try {
        await chrome.runtime.sendMessage({ action: 'deleteSessionMemory', sessionId: sessionId });
    } catch (e) {
        console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to delete session memory:`, e);
    }
}

async function clearAllMemory() {
    try {
        await chrome.runtime.sendMessage({ action: 'clearAllMemory' });

        const allKeys = await chrome.storage.local.get(null);
        const pageDataKeys = Object.keys(allKeys).filter(key =>
            key === activePageStorageKey || key.startsWith(`${activePageStorageKey}:`)
        );

        if (pageDataKeys.length > 0) {
            await chrome.storage.local.remove(pageDataKeys);
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Cleared ${pageDataKeys.length} page data keys`);
        }
    } catch (e) {
        console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to clear all memory:`, e);
    }
}
