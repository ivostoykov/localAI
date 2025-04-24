async function createNewSession(text) {
    let laiOptions;
    let model;
    try {
        laiOptions = await getOptions();
        model = laiOptions?.aiModel || 'unknown';
        const sessions = await getAllSessions();
        const title = text.split(/\s+/).slice(0, 6).join(' ');
        const newSession = { "title": title, "data": [], "model": model };
        sessions.push(newSession);
        await setAllSessions(sessions);
        await setActiveSessionIndex(sessions.length - 1);
        return newSession;
    } catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
        const title = text?.toString().split(/\s+/).slice(0, 6).join(' ') || '';
        return { "title": title, "data": [], "model": model };
    }
}

async function getActiveSession() {
    let laiOptions;
    let model;
    try {
        laiOptions = await getOptions();
        model = laiOptions?.aiModel || 'unknown';
        const sessions = await getAllSessions();
        const index = await getActiveSessionIndex();
        if (typeof index !== 'number' || index < 0) {
            showMessage("Failed to find an active session", "error", "error");
            throw new Error(`Failed to find an active session at [${getLineNumber()}]`);
        }
        return sessions[index] || { "title": '', "data": [], "model": model || '' };
    } catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
        return { title: '', data: [], "model": model || '' };
    }
}

async function setActiveSession(session) {
    try {
        if(!session.model || session.model?.toLowerCase() === 'unknown'){
            const laiOptions = await getOptions();
            session["model"] = laiOptions?.aiModel || 'unknown';
        }
        const sessions = await getAllSessions();
        const index = await getActiveSessionIndex();
        if (typeof index !== 'number' || index < 0) {
            showMessage("Failed to find an active session", "error");
            throw new Error(`Failed to find an active session at [${getLineNumber()}]`);
        }
        sessions[index] = session;
        await setAllSessions(sessions);
    } catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    }
}

async function deleteActiveSession() {
    try {
        const sessions = await getAllSessions();
        const index = await getActiveSessionIndex();
        if (typeof index !== 'number' || index < 0 || index >= sessions.length) {
            showMessage("Failed to find an active session", "error");
            throw new Error(`Failed to find an active session at [${getLineNumber()}]`);
        }
        sessions.splice(index, 1);
        await setAllSessions(sessions);
        await deleteActiveSessionIndex();
    } catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    }
}

async function deleteSessionAtIndex(index) {
    try {
        const sessions = await getAllSessions();
        if (typeof index !== 'number' || index < 0 || index >= sessions.length) {
            throw new Error(`Invalid session index: ${index}`);
        }
        sessions.splice(index, 1);
        await setAllSessions(sessions);
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - deleteSessionAtIndex: ${error.message}`, error);
        throw error;
    }
}

async function getSessionByIndex(index) {
    try {
        const sessions = await getAllSessions();
        if (typeof index !== 'number' || index < 0 || index >= sessions.length) {
            throw new Error(`Invalid session index: ${index}`);
        }
        return sessions[index];
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - getSessionByIndex: ${error.message}`, error);
        return { title: '', data: [] }; // fallback empty session
    }
}

async function getAllSessions() {
    try {
        const sessions = await chrome.storage.local.get([allSessionsStorageKey]);
        return sessions[allSessionsStorageKey] || [];
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${error.message}`, error);
        return [];
    }
}

async function setAllSessions(obj = []) {
    try {
        await chrome.storage.local.set({ [allSessionsStorageKey]: obj });
    } catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    }
    return true;
}

async function getActiveSessionIndex() {
    try {
        const result = await chrome.storage.local.get(activeSessionIndexStorageKey);
        const raw = result[activeSessionIndexStorageKey];
        const idx = Number(raw);
        if (!Number.isInteger(idx) || idx < 0) {
            return -1;
        }
        return idx;
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${error.message}`, error);
        return -1;
    }
}

async function setActiveSessionIndex(index){
    try {
        await chrome.storage.local.set({ [activeSessionIndexStorageKey]: index });
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${error.message}`, error, index);
    }
}

async function deleteActiveSessionIndex() {
    try {
        await chrome.storage.local.remove(activeSessionIndexStorageKey);

    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${error.message}`, error);
    }
}

async function removeLocalStorageObject(key = '') {
    try {
        if (!key) {  throw new Error(`>>> ${manifest.name} - [${getLineNumber()}] - Storage key is either missing or empty [${key}]`);  }
        await chrome.storage.local.remove(key);
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${error.message}`, error);
    }
}

async function getAiUserCommands() {
    try {
        const result = await chrome.storage.local.get([storageUserCommandsKey]);
        const list = result[storageUserCommandsKey] || [];
        aiUserCommands = list;
        return list;
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${error.message}`, error);
        return [];
    }
}

async function setAiUserCommands() {
    try {
        await chrome.storage.local.set({ [storageUserCommandsKey]: aiUserCommands });
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${error.message}`, error);
    }
}

async function getOptions(){
    let opt;
    let aiOptions;
    try {
        opt = await chrome.storage.sync.get(storageOptionKey);
        aiOptions = opt[storageOptionKey] || {};
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${error.message}`, error, opt);
    }
    return aiOptions;
}
async function setOptions(options){
    try {
        await chrome.storage.sync.set({[storageOptionKey]: options});
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${error.message}`, error, options);
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
