async function createNewSession(text = `Session ${new Date().toISOString().replace(/[TZ]/g, ' ').trim()}`) {
    let model;
    const sessionId = crypto.randomUUID();
    let newSession;
    let sessions;
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
            title: text?.toString().split(/\s+/).slice(0, 6).join(' ') || '',
            data: [],
            model: model || 'unknown',
            attachments: []
        };
    } finally {
        sessions.push(newSession);
        await setAllSessions(sessions);
        await setActiveSessionId(newSession.id);
    }
    return newSession;
}

async function deleteActiveSession() {
    try {
        const sessionId = await getActiveSessionId();
        if (!sessionId) { throw new Error('No active session ID found!'); }

        const sessions = await getAllSessions();
        if (sessions.length < 1) { return; }

        const idx = sessions.findIndex(s => s.id === sessionId);
        if (idx < 0) { throw new Error(`Session with id ${sessionId} not found!`); }

        sessions.splice(idx, 1);
        await setAllSessions(sessions);
        await deleteActiveSessionId();
    } catch (e) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Delete Active Session error: ${e.message}`, e);
    }
}

async function deleteSessionById(sessionId) {
    try {
        if (!sessionId) { throw new Error('No session ID provided for deletion!'); }

        const sessions = await getAllSessions();
        if (sessions.length < 1) { return; }

        const idx = sessions.findIndex(sess => sess.id === sessionId);
        if (idx < 0) { throw new Error(`Session with id ${sessionId} not found!`); }

        sessions.splice(idx, 1);
        await setAllSessions(sessions);

        // if you just deleted active session, clear activeSessionId
        const activeSessionId = await getActiveSessionId();
        if (activeSessionId === sessionId) { await deleteActiveSessionId(); }
    } catch (error) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - deleteSessionById error: ${error.message}`, error);
    }
}

async function deleteActiveSessionId() {
    try {
        await chrome.storage.local.remove(activeSessionIdStorageKey);

    } catch (error) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${error.message}`, error);
    }
}

async function getActiveSession() {
    try {
        const sessionId = await getActiveSessionId();
        if (!sessionId) { return await createNewSession(); }

        const sessions = await getAllSessions();

        const session = sessions.find(sess => sess.id === sessionId);
        if (!session) { return await createNewSession(); }

        return session;
    } catch (e) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${e.message}`, e);
    }
}

async function getActiveSessionById(sessionId) {
    try {
        if (!sessionId) { throw new Error("Invalid or missing session id!"); }
        ;
        const sessions = await getAllSessions();

        const session = sessions.find(sess => sess.id === sessionId);

        return session || null;
    } catch (e) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${e.message}`, e);
        return null;
    }
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

        const sessions = await getAllSessions();
        const idx = sessions.findIndex(s => s.id === session.id);

        if (idx < 0) { throw new Error(`Session with id ${session.id} not found!`); }

        sessions[idx] = session;
        await setAllSessions(sessions);
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


async function setActiveSessionPageData(data) {
    await chrome.storage.local.set({ [activePageStorageKey]: data });
}

async function removeActiveSessionPageData() {
    await chrome.storage.local.remove(activePageStorageKey);
}
