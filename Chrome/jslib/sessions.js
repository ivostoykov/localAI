async function createNewSession(text) {
    try {
        const sessions = await getAllSessions();
        const title = text.split(/\s+/).slice(0, 6).join(' ');
        const newSession = { "title": title, "data": [] };
        sessions.push(newSession);
        await setAllSessions(sessions);
        await setActiveSessionIndex(sessions.length - 1);
        return newSession;
    } catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    }
}

async function getActiveSession() {
    try {
        const sessions = await getAllSessions();
        const index = await getActiveSessionIndex();
        if (typeof index !== 'number' || index < 0) {
            showUIMessage("Failed to find an active session");
            throw new Error(`Failed to find an active session at [${getLineNumber()}]`);
        }
        return sessions[index] || {};
    } catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    }
}

async function setActiveSession(session) {
    try {
        const sessions = await getAllSessions();
        const index = await getActiveSessionIndex();
        if (typeof index !== 'number' || index < 0) {
            showUIMessage("Failed to find an active session");
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
            showUIMessage("Failed to find an active session");
            throw new Error(`Failed to find an active session at [${getLineNumber()}]`);
        }
        sessions.splice(index, 1);
        await setAllSessions(sessions);
        await deleteActiveSessionIndex();
    } catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    }
}

async function getAllSessions() {
    try {
        const sessions = await chrome.storage.local.get([allSessionsStorageKey]);
        return sessions[allSessionsStorageKey] || [];
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    }
}

async function setAllSessions(obj = []) {
    try {
        if(obj.length < 1){
            console.warn(`>>> ${manifest.name} - [${getLineNumber()}] - session object is missing or empty`, obj);
            return;
        }
        await chrome.storage.local.set({ [allSessionsStorageKey]: obj });
    } catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    }
    return true;
}

async function getActiveSessionIndex(){
    const index = await chrome.storage.local.get([activeSessionIndexStorageKey]);
    let idx;
    try {
        idx = typeof(index[activeSessionIndexStorageKey]) !== 'number' ? parseInt(index[activeSessionIndexStorageKey]) : index[activeSessionIndexStorageKey];
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${error.message}`, error, index);
    }
    return idx;
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

    } catch (err) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
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
        const commands = await chrome.storage.local.get([storageUserCommandsKey]);
        aiUserCommands = commands[storageUserCommandsKey] || [];
    } catch (err) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    }
}

async function setAiUserCommands() {
    try {
        await chrome.storage.local.set({ [storageUserCommandsKey]: aiUserCommands });
    } catch (err) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
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
