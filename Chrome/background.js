var controller;
var shouldAbort = false;
var laiOptions;
const storageOptionKey = 'laiOptions';
const sessionHistoryKey = 'sessionHistory';
const manifest = chrome.runtime.getManifest();

chrome.runtime.onInstalled.addListener(() => {
    init();
});

chrome.tabs.onCreated.addListener(tab => {  init();  });

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {

    if(tab.url && !tab.url.startsWith('http')) {  return;  }

    if (changeInfo.status === 'complete' && tab.url) {
        laiOptions = await getOptions();
        init();
    }
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== 'sync') {  return; }
    for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
        if(key === storageOptionKey){
            laiOptions = await getOptions();
        }
    }
});

chrome.action.onClicked.addListener((tab) => {
    if(tab.url.startsWith('http')) {
        chrome.tabs.sendMessage(tab.id, { action: "toggleSidebar" })
            .catch(async e => {
                console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
                await showUIMessage(e.message, 'error', tab);
            });
    }
});

chrome.runtime.onConnect.addListener(function(port) {
    port.onDisconnect.addListener(function() {
      tryReloadExtension();
    });
});

chrome.runtime.onUpdateAvailable.addListener(function(details) {  tryReloadExtension();  });

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!controller) {
        controller = new AbortController();
    }
    let response;
    switch (request.action) {
        case 'getModels':
            getModels()
            .then(response => sendResponse(response) )
            .catch(async error => {
                dumpInFrontConsole(`>>> ${manifest.name} - [${getLineNumber()}] - Error: ${error.message}`, error);
                sendResponse({ status: 'error', message: error.toString() });
            });
            break;
        case 'fetchData':
            shouldAbort = false;
            fetchDataAction(request, sender).then(response => {
                sendResponse(response);
            }).catch(async error => {
                dumpInFrontConsole(`>>> ${manifest.name} - [${getLineNumber()}] - Error: ${error.message}`, error);
                sendResponse({ status: 'error', message: error.toString() });
            });
            break;
        case "getHooks":
            getHooks()
            .then(response => sendResponse(response) )
            .catch(async error => {
                dumpInFrontConsole(`>>> ${manifest.name} - [${getLineNumber()}] - Error: ${error.message}`, error);
                sendResponse({ status: 'error', message: error.toString() });
            });
            break;
        case 'abortFetch':
            shouldAbort = true;
            break;
        case 'extractText':
            convertFileToText(request.fileContent)
                .then(response => sendResponse(response))
                .catch(async e => {
                    dumpInFrontConsole(`>>> ${manifest.name} - [${getLineNumber()}] - Error: ${e.message}`, e);
                    sendResponse({ status: 'error', message: e.toString() });
                });
            break;
        case "openOptionsPage":
            chrome.tabs.create({url: chrome.runtime.getURL('options.html')});
            break;
        default:
            console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Unrecognized action:`, request?.action);
    }
    return true;
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    switch (info.menuItemId) {
        case "sendSelectedText":
            if (!info.selectionText.length) { return; }
            if (!tab.id) {  return;  }
            await chrome.tabs.sendMessage(tab.id, {
                action: "activePageSelection",
                selection: info.selectionText
            });
            break;
        case "askAiExplanation":
            await askAIExplanation(info, tab);
            break;
        case "sendPageContent":
            await chrome.tabs.sendMessage(tab.id, { action: "activePageContent" });
            break;
        case "selectAndSendElement":
            if (!tab?.id) {
                console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Expected tab.id; received ${tab?.id}`, tab);
                return;
            }
            await chrome.tabs.sendMessage(tab.id, {
                action: "toggleSelectElement",
                selection: true
            });
            break;
        case "openOptions":
            chrome.tabs.create({url: chrome.runtime.getURL('options.html')});
            break;
        default:
            console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Unknown menu id: ${info?.menuItemId}`);
        }
});

function init(){
    composeContextMenu()
}

function composeContextMenu() {
    chrome.contextMenus.removeAll();

    chrome.contextMenus.create({
        id: "sendToLocalAi",
        title: "Local AI",
        contexts: ["all"]
    });

    chrome.contextMenus.create({
        id: "selectAndSendElement",
        title: "Select and Send Element",
        parentId: "sendToLocalAi",
        contexts: ["all"]
    });

    chrome.contextMenus.create({
        id: "askAiExplanation",
        title: "Ask AI to Explain Selected",
        parentId: "sendToLocalAi",
        contexts: ["selection"]
    });

    chrome.contextMenus.create({
        id: "sendSelectedText",
        title: "Send Selected",
        parentId: "sendToLocalAi",
        contexts: ["selection"]
    });

    chrome.contextMenus.create({
        id: "sendPageContent",
        title: "Entire Page",
        parentId: "sendToLocalAi",
        contexts: ["all"]
    });

    chrome.contextMenus.create({
        id: "separatorBeforeOptions",
        type: "separator",
        parentId: "sendToLocalAi",
        contexts: ["all"]
    });

    chrome.contextMenus.create({
        id: "openOptions",
        title: "Options",
        parentId: "sendToLocalAi",
        contexts: ["all"]
    });
}

function extractEnhancedContent() {
    return getPageTextContent();
}

// Ollama returns several json object in a single response which invalidates the JSON
function processTextChunk(textChunk) {
    if(textChunk.indexOf('\n{"model"') > -1){
        return `[${textChunk.replace(/\n{"model"/g, ',\n{"model"')}]`;
    }

    textChunk = textChunk.replace(/^data:\s+/i, '').trim();
    textChunk = textChunk.replace(/data:\s+\[DONE\]$/i, '').trim();

    if(textChunk.indexOf("\ndata:") > -1) {
        textChunk = `[${textChunk.replace(/\ndata:\s+/ig, ',')}]`;
        return textChunk;
    }

    return textChunk;
}

async function handleStreamingResponse(reader, senderTabId) {
    if (!reader || !reader.read) { return; }
    const aiResponseData = [];

    const read = async () => {
        if (shouldAbort) {
            await reader.cancel();
            chrome.tabs.sendMessage(senderTabId, { action: "streamAbort" })
                .catch(async e => await showUIMessage(e.message, 'error'));
            return;
        }
        try {
            const { done, value } = await reader.read();
            if (done) {
                await dumpInFrontConsole(`${manifest.name} - [${getLineNumber()}] - response completed`, {"role": "assistent", "content": aiResponseData}, 'log');
                chrome.tabs.sendMessage(senderTabId, { action: "streamEnd" })
                    .catch(async e => await showUIMessage(e.message, 'error'));
                return;
            }
            const textChunk = new TextDecoder().decode(value);
            let data = processTextChunk(textChunk);
            try {
                data = JSON.parse(data);
            } catch (e) {
                await showUIMessage(e.message, 'error');
                await dumpInFrontConsole(`${manifest.name} - [${getLineNumber()}] - Error: ${e.message}`, e, 'error');
                console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
                console.log(`>>> ${manifest.name} - [${getLineNumber()}] - textChunk`, textChunk);
                console.log(`>>> ${manifest.name} - [${getLineNumber()}] - data`, data);
                shouldAbort = true;
            }

            if (Array.isArray(data)) {
                data.forEach(el => chrome.tabs.sendMessage(senderTabId, { action: "streamData", data: JSON.stringify(el) }));
            } else {
                chrome.tabs.sendMessage(senderTabId, { action: "streamData", data: JSON.stringify(data) })
                    .catch(async e => await showUIMessage(e.message, 'error'));
            }
            await read();
        } catch (error) {
            if (!shouldAbort) {
                chrome.tabs.sendMessage(senderTabId, { action: "streamError", error: error.toString() })
                    .catch(async e => await showUIMessage(e.message, 'error'));
            }
        }
    };

    await read();
}

async function askAIExplanation(info, tab) {
    try {
        await chrome.tabs.sendMessage(tab.id, {
            action: "explainSelection",
            selection: info.selectionText
        });
    } catch (e) {
        await showUIMessage(e.message, 'error');
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    }
}

function getLastConsecutiveUserRecords(messages) {
    if (!messages || messages.length === 0 || messages[messages.length - 1].role !== 'user') {
        return '';
    }

    const result = [];
    while (messages.length > 0) {
        const last = messages.pop();
        if (last.role !== 'user') {  break;  }
        result.unshift(last.content || '');
    }

    return result.join('\n');
}


async function fetchDataAction(request, sender) {
    let messages = await getChatHistory() || [];
    if(messages.length < 1){  return {"status": "warning", "message": "Empty prompt"};  }

    if(Object.keys(laiOptions ?? {}).length < 1){  laiOptions = await getOptions();  }

    if(!laiOptions?.aiUrl){
        let msg = 'Missing API endpoint!';
        await showUIMessage(`${msg} - ${laiOptions?.aiUrl || 'missing aiUrl'}`, 'error', sender.tab);
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${msg}`, laiOptions);
        return {"status": "error", "message": msg};
    }

    const url = request?.url ?? laiOptions?.aiUrl;
    if(!url){
        let msg = `Faild to compose the request URL - ${url}`;
        await showUIMessage(msg, 'error', sender.tab);
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${msg};  request.url: ${request?.url};  laiOptions.aiUrl: ${laiOptions?.aiUrl}`);
        return {"status": "error", "message": msg};
    }

    const controller = new AbortController();

    if(laiOptions?.aiModel){
        request.data['model'] = laiOptions?.aiModel || '';
    }

    request.data.messages = messages;
    await dumpInFrontConsole(`[${getLineNumber()}] - request.data.messages: ${request.data.messages.length}`, request.data.messages, 'log', sender.tab);

    try{
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request.data),
            signal: controller.signal,
        });

        if(response.status > 299){  throw new Error(`${response.status}: ${response.statusText}`);  }

        if(shouldAbort && controller){
            controller.abort();
            chrome.tabs.sendMessage(sender.tab, { action: "streamAbort" });
            return  {"status": "aborted", "message": "Aborted"};
        }

        await handleStreamingResponse(response?.body?.getReader(), sender.tab.id);
    }
    catch(e) {
        if (e.name === 'AbortError') {
            chrome.tabs.sendMessage(sender.tab.id, { action: "streamAbort"});
        } else {
            chrome.tabs.sendMessage(sender.tab.id, { action: "streamError", error: e.toString()});
            await dumpInFrontConsole(`[${getLineNumber()}] Error: ${e.message}`, e, 'error', sender.tab);
            return {"status": "error", "message": e.message};
        }
    }
    finally {
      chrome.tabs.sendMessage(sender.tab.id, {action: "userPrompt", data: JSON.stringify(request.data)});
    }

    return {"status": "success", "message": "Request sent. Awaiting response."};
}

async function convertFileToText(fileAsB64) {
    if (!fileAsB64) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Invalid file provided`);
        return '';
    }

    let url = laiOptions.tika?.trim();
    if (!url) {
        await showUIMessage('Missing document converter endpoint!', 'error');
        return '';
    }

    // Ensure the URL ends with /tika
    url = `${url}${url.lastIndexOf('tika') < 0 ? '/tika' : ''}`.replace(/\/{2,}/g, '/');
    const binaryFile = Uint8Array.from(atob(fileAsB64), c => c.charCodeAt(0));

    const options = {
        method: "PUT",
        headers: {
            "Content-Type": "application/octet-stream",
            'Accept': 'text/plain'
        },
        body: binaryFile
    };

    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Error: Network response was not ok (${response.status}: ${response.statusText})`);
            return '';
        }
        const res = typeof response === 'string' ? response : (typeof response.text === 'function' ? await response.text() : '');
        return res;
    } catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Error fetching text from file: ${e.message}`, e);
        console.log(`Failed request to ${url} with file:`, fileAsB64);
        return '';
    }
}

function addPersonalInfoToSystemMessage(systemContent){
    if(!systemContent){  return systemContent;  }
    const personalInfo = getPersonalInfo();
    if(!personalInfo)  {  return systemContent;  }
    let strPersonalInfo = '';
    try {
        strPersonalInfo = JSON.stringify(personalInfo);
    } catch (e) {
        strPersonalInfo = '';
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] -${e.message}`, e);
    }
    if(systemContent.indexOf('[personal information:') < 0){
        systemContent += ` [personal information: ${strPersonalInfo}]`
    } else {
        systemContent = systemContent.replace(/\s{0,}\[personal information: .*?\]/gm, ` [personal information: ${strPersonalInfo}]`);
    }

    return systemContent
}

function getPersonalInfo(){
    if(!laiOptions || Object.keys(laiOptions) < 1){
        return;
    }

    if(!laiOptions.personalInfo) {  return;  }

    const personalInfo = {};
    const keyValuePairs = laiOptions.personalInfo.split(/;|\n/);
    keyValuePairs.forEach(pair => {
        const [key, value] = pair.split(/[\s;,-:](.*)/s).filter(Boolean);
        personalInfo[key.trim()] = value.trim();
    });

    return personalInfo;
}

async function getOptions() {
    const defaults = {
        "openPanelOnLoad": false,
        "aiUrl": "",
        "aiModel": "",
        "closeOnClickOut": true,
        "closeOnCopy": false,
        "closeOnSendTo": true,
        "showEmbeddedButton": false,
        "loadHistoryOnStart": false,
        "systemInstructions": '',
        "personalInfo": ''
    };

    let obj = {};
    try {
        obj = await chrome.storage.sync.get(storageOptionKey);
    } catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    }

    return Object.assign({}, defaults, obj.laiOptions);
}

async function getChatHistory(){
    try {
        obj = await chrome.storage.local.get(sessionHistoryKey);
        return obj.sessionHistory || [];
    } catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    }
}

async function setChatHistory(newObj){
    let sessionHistory = [];
    try {
        sessionHistory = await getChatHistory();
        if(Array.isArray(newObj)){
            sessionHistory.push(...newObj);
        } else {
            sessionHistory.push(newObj);
        }
        await chrome.storage.local.set({ [sessionHistoryKey]: sessionHistory });
    } catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    }

    return sessionHistory || [];
}

async function showUIMessage(message, type = '', tab) {
    if(!tab) {  tab = await getCurrentTab();  }
    if (!/^http/i.test(tab.url)) { return; }
    chrome.tabs.sendMessage(tab.id, {"action": "showMessage", message: message, messageType: type})
        .catch(e => console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e));
}

async function dumpInFrontConsole(message, obj, type = 'log', tab){
    if(!tab) {  tab = await getCurrentTab();  }
    if (!/^http/i.test(tab.url)) { return; }
    try {
        await chrome.tabs.sendMessage(tab.id, {"action": "dumpInConsole", message: message, obj: JSON.stringify(obj), type: type});
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    }
}

async function getCurrentTab() {
    let queryOptions = { active: true, lastFocusedWindow: true };
    // `tab` will either be a `tabs.Tab` instance or `undefined`.
    let [tab] = await chrome.tabs.query(queryOptions);

    return tab;
}

async function getModels(){
    if(!laiOptions) {  laiOptions = await getOptions();  }
    let urlVal = laiOptions?.aiUrl;
    if(!urlVal){
        await showUIMessage(`No API endpoint found - ${urlVal}!`, 'error');
        return false;
    }

    if(!urlVal.startsWith('http')){
        await showUIMessage(`Invalid API endpoint - ${urlVal}!`, 'error');
        return false;
    }

    if(urlVal.indexOf('/api/') < 0){  return;  }

    let response;
    let models;
    try {
        urlVal = new URL('/api/tags', (new URL(urlVal)).origin).href;
        response = await fetch(urlVal, {
            headers: {
            'Content-Type': 'application/json; charset=utf-8',
            },
        });

      models = await response.json();
      if(models.models && Array.isArray(models.models)) {  return {"status":"success", "models": models.models};  }
    } catch (e) {
      console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
      return {"status": "error", "message": e.message};
    }
}

async function getHooks(){
    if(!laiOptions) {  laiOptions = await getOptions();  }
    let urlVal = laiOptions?.webHook;
    if(!urlVal){
        let msg = `No API endpoint found - ${urlVal}!`;
        return {"status":"error", "messsage": msg};
    }

    if(!urlVal.startsWith('http')){
        let msg = `Invalid API endpoint - ${urlVal}!`;
        return {"status":"error", "messsage": msg};
    }

    let response;
    let hooks;
    try {
        urlVal = (new URL(urlVal)).origin
        response = await fetch(urlVal);

        hooks = await response.text();
        if(!hooks) {  return {"status":"error", "messsage": "No hooks returned. Is server running?"};  }
        return {"status":"success", "hooks": hooks};
    } catch (err) {
        return {"status":"error", "messsage": `webHook seems invalud - ${urlVal}! Error: ${err.message}`};
    }
}

function tryReloadExtension() {
    try {
        console.log(`>>> ${manifest.name} - [${getLineNumber()}] - trying to reload`);
        chrome.runtime.reload();
    } catch (err) {
        if(chrome.runtime.lastError){  console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Error:`, chrome.runtime.lastError);  }
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${err.message}`, err);
    }
}

function getLineNumber() {
    const e = new Error();
    return e.stack.split("\n")[2].trim().replace(/\s{0,}at (.+)/, "[$1]");
}