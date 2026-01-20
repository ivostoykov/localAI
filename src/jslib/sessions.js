/**
 * Session Management Module
 *
 * Shared between:
 * - Content scripts (frontend UI - ribbon.js, lai-main.js)
 * - Background service worker (AI request handling - background.js)
 *
 * Single source of truth for all session CRUD operations.
 */

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

        newSession = {
            id: sessionId,
            title: title,
            data: [],
            model: model,
            attachments: []
        };
    } catch (e) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${e.message}`, e);
        newSession = {
            id: sessionId,
            title: text?.toString()?.split(/\s+/)?.slice(0, 6)?.join(' ') || '',
            data: [],
            model: model || 'unknown',
            attachments: []
        };
    }

    sessions.push(newSession);
    await setAllSessions(sessions);
    await setActiveSessionId(newSession.id);

    return newSession;
}

async function deleteSession(sessionId = null) {
    try {
        if (!sessionId) {
            sessionId = await getActiveSessionId();
            if (!sessionId) { throw new Error('No active session ID found!'); }
        }

        const sessions = await getAllSessions();
        if (sessions.length < 1) { return; }

        const idx = sessions.findIndex(s => s.id === sessionId);
        if (idx < 0) { throw new Error(`Session with id ${sessionId} not found!`); }

        sessions.splice(idx, 1);
        await setAllSessions(sessions);

        const activeSessionId = await getActiveSessionId();
        if (activeSessionId === sessionId) {
            await deleteActiveSessionId();
        }

        await deleteSessionMemory(sessionId);
    } catch (e) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Delete session error: ${e.message}`, e);
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
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${error.message}`, error);
    }
}

async function getSession(sessionId = null, createIfMissing = true) {
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
        const session = sessions.find(sess => sess.id === sessionId);

        if (!session && createIfMissing && !sessionId) {
            return await createNewSession();
        }

        return session || null;
    } catch (e) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${e.message}`, e);
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
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${error.message}`, error);
        return [];
    }
}

async function getActiveSessionId() {
    try {
        const result = await chrome.storage.local.get(activeSessionIdStorageKey);
        const sessionId = result[activeSessionIdStorageKey];
        if (typeof sessionId !== 'string' || !sessionId.trim()) {
            return null;
        }
        return sessionId;
    } catch (error) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - getActiveSessionId error: ${error.message}`, error);
        return null;
    }
}

async function setAllSessions(obj = []) {
    try {
        if (obj && typeof obj === 'object' && allSessionsStorageKey in obj) {
            obj = obj[allSessionsStorageKey]; // unwrap if needed
        }

        await chrome.storage.local.set({ [allSessionsStorageKey]: obj });
    } catch (e) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${e.message}`, e);
    }
    return true;
}

async function setActiveSessionId(sessionId) {
    try {
        if (!sessionId || typeof sessionId !== 'string') {
            throw new Error(`Invalid session ID provided: ${sessionId}`);
        }
        await chrome.storage.local.set({ [activeSessionIdStorageKey]: sessionId });
    } catch (error) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - setActiveSessionId error: ${error.message}`, error);
    }
}

async function setActiveSession(session) {
    try {
        if (!session?.id) { throw new Error(`[${getLineNumber()}]: Session object is missing a valid id!`); }

        if (session?.data?.length === 0 && session?.attachments?.length === 0) {
            console.debug(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Skipping save of empty session ${session.id}`);
            return;
        }

        const sessions = await getAllSessions();
        const idx = sessions.findIndex(s => s.id === session.id);

        if (idx < 0) { throw new Error(`Session with id ${session.id} not found!`); }

        sessions[idx] = session;
        const filteredSessions = sessions.filter(s => s?.data?.length > 0 || s?.attachments?.length > 0);
        await setAllSessions(filteredSessions);
        await setActiveSessionId(session.id);
    } catch (e) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - setActiveSession error: ${e.message}`, e);
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - the session thrown the error`, session);
    }
}

async function removeLocalStorageObject(key = '') {
    try {
        if (!key) { throw new Error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Storage key is either missing or empty [${key}]`); }
        await chrome.storage.local.remove(key);
    } catch (error) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${error.message}`, error);
    }
}

async function getAiUserCommands() {
    try {
        const result = await chrome.storage.local.get([storageUserCommandsKey]);
        const list = result[storageUserCommandsKey] || [];
        aiUserCommands = list;
        return list;
    } catch (error) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${error.message}`, error);
        return [];
    }
}

async function setAiUserCommands() {
    try {
        await chrome.storage.local.set({ [storageUserCommandsKey]: aiUserCommands });
    } catch (error) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${error.message}`, error);
    }
}

async function getOptions() {
    let opt;
    let aiOptions;
    try {
        opt = await chrome.storage.sync.get(storageOptionKey);
        aiOptions = opt[storageOptionKey] || {};
    } catch (error) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${error.message}`, error, opt);
    }
    return aiOptions;
}
async function setOptions(options) {
    try {
        await chrome.storage.sync.set({ [storageOptionKey]: options });
    } catch (error) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${error.message}`, error, options);
    }
}

async function getActiveSessionPageData() {
    const result = await chrome.storage.local.get([activePageStorageKey]);
    return result[activePageStorageKey] || null;
}


async function setActiveSessionPageData(data = null) {
    if(!data) {  return;  }
    const activePageData = await getActiveSessionPageData();
    if(activePageData?.url === data?.url && activePageData?.pageContent) {  return;  }
    if(data?.url && !data.pageContent) {
        console.warn(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Empty page content!`, {data, activePageData});
        return;
    }
    await chrome.storage.local.set({ [activePageStorageKey]: data });
}

async function removeActiveSessionPageData() {
    await chrome.storage.local.remove(activePageStorageKey);
}

async function deleteSessionMemory(sessionId) {
    try {
        await chrome.runtime.sendMessage({ action: 'deleteSessionMemory', sessionId: sessionId });
    } catch (e) {
        console.warn(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Failed to delete session memory:`, e);
    }
}

async function clearAllMemory() {
    try {
        await chrome.runtime.sendMessage({ action: 'clearAllMemory' });
    } catch (e) {
        console.warn(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Failed to clear all memory:`, e);
    }
}
