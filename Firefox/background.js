var controller;
var shouldAbort = false;
var laiOptions;
const storageOptionKey = 'laiOptions';
const manifest = chrome.runtime.getManifest();
var chatHistory = [];


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
                console.error(`>>> ${manifest.name}`, e);
                await showUIMessage(tab, e.message, 'error');
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
    switch (request.action) {
        case 'getModels':
            getModels()
            .then(response => sendResponse(response) )
            .catch(error => {
                sendResponse({ status: 'error', message: error.toString() });
            });
            break;
        case 'fetchData':
            shouldAbort = false;
            fetchDataAction(request, sender).then(response => {
                sendResponse(response);
            }).catch(error => {
                sendResponse({ status: 'error', message: error.toString() });
            });
            break;
        case "getHooks":
            getHooks()
            .then(response => sendResponse(response) )
            .catch(error => {
                sendResponse({ status: 'error', message: error.toString() });
            });
            break;
        case 'abortFetch':
            shouldAbort = true;
            break;
        case 'extractText':
            convertFileToText(request.fileContent)
                .then(response => sendResponse(response))
                .catch(e => {
                    sendResponse({ status: 'error', message: e.toString() });
                });
            break;
        case "openOptionsPage":
            chrome.tabs.create({url: chrome.runtime.getURL('options.html')});
            break;
        default:
            console.error('Unrecognized action:', request?.action);
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
            if(tab.id){
                chrome.scripting.executeScript({
                    target: {tabId: tab.id},
                    func: extractEnhancedContent
                }, (response) => {
                    const pageContent = response?.[0]?.result ?? '';
                    if (!pageContent) {  return;  }
                        chrome.tabs.sendMessage(tab.id, {
                            action: "activePageContent",
                            selection: pageContent
                        });
                });
            }
            break;
        case "selectAndSendElement":
            if (!tab?.id) {
                console.error(`>>> Expected tab.id; received ${tab?.id}`, tab);
                return;
            }
            chrome.tabs.sendMessage(tab.id, {
                action: "toggleSelectElement",
                selection: true
            }).catch(async e => {
                console.error(`<<< Failed to send a message`, e);
                await showUIMessage(tab, e.message, 'error')
            });
            break;
        default:
            console.error(`>>> Unknown menu id: ${info?.menuItemId}`);
        }
});

function init(){
    chatHistory = [];
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
}

async function fetchUserCommandResult(command, sender) {
    let res = '';
    switch (command) {
        case 'page':
            const response = await chrome.scripting.executeScript({
                target: {tabId: sender.tab.id},
                func: extractEnhancedContent
            });
            if (chrome.runtime.lastError) {
                console.error(`>>> ${manifest.name}`, chrome.runtime.lastError.message);
                return res;
            }
            res = response?.[0]?.result ?? '';
            break;
        case 'now':
            res = (new Date()).toISOString();
            break;
        case 'today':
            res = (new Date()).toISOString().split('T')[0];
            break;
        case 'time':
            res = (new Date()).toISOString().split('T')[1];
            break;
        case 'url':
            res = sender.url;
            break;
    }

    return res;
}

function extractEnhancedContent() {
    const bodyClone = document.body.cloneNode(true);

    // Selector for common elements not directly related to the main content
    const unwantedSelectors = [
        'meta', 'code', 'script', 'style', 'nav', 'aside', 'link', 'select', 'form', 'iframe', 'video',
        'input', 'button', 'svg', 'img', '[class*="sidebar"]', '[class*="side-nav"]', '.sidebar', '.widget'
    ];

    unwantedSelectors.forEach(selector => {
        const elements = bodyClone.querySelectorAll(selector);
        elements.forEach(el => el.remove());
    });

    // Remove HTML comments - nodeType === 8
    const removeComments = (node) => {
        for (let i = 0; i < node.childNodes.length; i++) {
            const child = node.childNodes[i];
            if (child.nodeType === 8 || (child.nodeType === 3 && !/\S/.test(child.nodeValue))) {
                node.removeChild(child);
                i--;
            } else if (child.nodeType === 1) {
                removeComments(child);
            }
        }
    };
    removeComments(bodyClone);

    return bodyClone.textContent.replace(/[\w\s]+and others in your network/g, '').trim();
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

    const read = async () => {
        if (shouldAbort) {
            await reader.cancel();
            chrome.tabs.sendMessage(senderTabId, { action: "streamAbort" })
                .catch(async e => await showUIMessage(null, e.message, 'error'));
            return;
        }
        try {
            const { done, value } = await reader.read();
            if (done) {
                chrome.tabs.sendMessage(senderTabId, { action: "streamEnd" })
                    .catch(async e => await showUIMessage(null, e.message, 'error'));
                return;
            }
            const textChunk = new TextDecoder().decode(value);
            let data = processTextChunk(textChunk);
            try {
                data = JSON.parse(data);
            } catch (e) {
                await showUIMessage(null, e.message, 'error');
                console.log(`>>>`, e);
                console.log(`>>> textChunk`, textChunk);
                console.log(`>>> data`, data);
            }

            if(data.message){  chatHistory.push(data.message);  }
            if (Array.isArray(data)) {
                data.forEach(el => chrome.tabs.sendMessage(senderTabId, { action: "streamData", data: JSON.stringify(el) }));
            } else {
                chrome.tabs.sendMessage(senderTabId, { action: "streamData", data: JSON.stringify(data) })
                    .catch(async e => await showUIMessage(null, e.message, 'error'));
            }
            await read();
        } catch (error) {
            if (!shouldAbort) {
                chrome.tabs.sendMessage(senderTabId, { action: "streamError", error: error.toString() })
                    .catch(async e => await showUIMessage(null, e.message, 'error'));
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
        await showUIMessage(tab, e.message, 'error');
        console.error('>>>', e);
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
    if((request?.data?.messages || []).length < 1){  return {"status": "warning", "message": "Empty prompt"};  }
    // let theExternalResources = request?.externalResources || [];
    // let binaryFormData = getBinaryFormData(request?.binaryFormData);

    if(Object.keys(laiOptions ?? {}).length < 1){
        laiOptions = await getOptions();
    }

    if(!laiOptions?.aiUrl){
        let msg = 'Missing API endpoint!';
        await showUIMessage(sender.tab, `${msg} - ${laiOptions?.aiUrl || 'missing aiUrl'}`, 'error');
        console.error(msg, laiOptions);
        return {"status": "error", "message": msg};
    }

    const url = request?.url ?? laiOptions?.aiUrl;
    if(!url){
        let msg = `Faild to compose the request URL - ${url}`;
        await showUIMessage(sender.tab, msg, 'error');
        console.error(`${msg};  request.url: ${request?.url};  laiOptions.aiUrl: ${laiOptions?.aiUrl}`);
        return {"status": "error", "message": msg};
    }

    const controller = new AbortController();
    let data = getLastConsecutiveUserRecords(request.data.messages);

    data = await addSystemCommandsToUserInput(data, sender);

    if(laiOptions?.aiModel){
        request.data['model'] = laiOptions?.aiModel || '';
    }

    request.data.messages = builtMessagesWithHistory(data);

    try{
        const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.data),
        signal: controller.signal,
        });

        if(response.status > 299){
            throw new Error(`${response.status}: ${response.statusText}`);
        }

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
            return {"status": "error", "message": e.message};
        }
    }
    finally {
        chrome.tabs.sendMessage(sender.tab.id, {action: "userPrompt", data: JSON.stringify(request.data)});
    }

    return {"status": "success", "message": "Request sent. Awaiting response."};
}

function builtMessagesWithHistory(data){
    let messagesWithHistory = [];
    function calculateTokenCount(msg) {
        // Simple token count based on characters (1 token = ~4 characters, but adjust for your use case)
        let totalTokens = 0;
        msg.forEach(msg => {
            totalTokens += Math.ceil(msg.content.length / 4); // Approximate token calculation
        });
        return totalTokens;
    }

    const maxTokenLimit = 131072; // TODO: to be taken from the LLM if avaliabel on model change. Store it into the local storage with the others

    // Step 1: Add chat history first
    chatHistory.forEach(content => {
        messagesWithHistory.push(content);
    });

    // Step 2: Add current prompt chunks
    const newChunks = splitInputToChunks(data, 4096);
    chatHistory.push(...newChunks);
    messagesWithHistory.push(...newChunks);

    // Step 3: Calculate the total token count
    let totalTokens = calculateTokenCount(messagesWithHistory);

    // Step 4: Trim history if total token count exceeds limit
    while (totalTokens > maxTokenLimit) {
        messagesWithHistory.shift();

        totalTokens = calculateTokenCount(messagesWithHistory); // Recalculate the token count
    }

    return messagesWithHistory;
}

async function addSystemCommandsToUserInput(userInputText, sender) {
    if (!userInputText && resources.length < 1) {  return '';  }

    var combinedResult = [];
    let userCommands = [];
    if (Array.isArray(userInputText)) {
        userInputText.forEach(txt => {
            txt = txt.replace("📃", '');
            userCommands = [...txt.matchAll(/@\{\{([\s\S]+?)\}\}/gm)]
        });
    } else {
        userInputText = userInputText.replace("📃", '');
        userCommands = [...userInputText.matchAll(/@\{\{([\s\S]+?)\}\}/gm)];
    }

    if (userCommands.length < 1){ return userInputText;  }

    for (const cmd of userCommands) {
        if (cmd && cmd.length > 1 && cmd[1]) {
            let additionalInfo = await fetchUserCommandResult(cmd[1], sender);
            if(cmd[1] && cmd[1] === 'page'){
                additionalInfo = `${cmd[1]} content is between [PAGE] and [/PAGE]:\n[PAGE] ${additionalInfo} [/PAGE]. Using this content as a context of your respond.`;
            }
            combinedResult.push(additionalInfo);
        }
    }

    for (let i = 0; i < userCommands.length; i++) {
        const cmd = userCommands[i];
        userInputText = userInputText.replace(cmd[0], combinedResult[i]);
    }

    return userInputText;
}

function splitInputToChunks(str, chunkSize) {
    const chunks = [];
    let currentChunk = "";

    const words = str.split(/\s+/);

    for (let word of words) {
        if ((currentChunk + word).length > chunkSize) {
            chunks.push({ "role": "user", "content": currentChunk.trim() });
            currentChunk = word + " ";
        } else {
            currentChunk += word + " ";
        }
    }

    if (currentChunk.trim().length > 0) {
        chunks.push({ "role": "user", "content": currentChunk.trim() });
    }

    return chunks;
}

async function convertFileToText(fileAsB64) {
    if (!fileAsB64) {
        console.error('Invalid file provided');
        return '';
    }

    let url = laiOptions.tika?.trim();
    if (!url) {
        showUIMessage(null, 'Missing document converter endpoint!', 'error');
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
            console.error(`Error: Network response was not ok (${response.status}: ${response.statusText})`);
            return '';
        }
        const res = typeof response === 'string' ? response : (typeof response.text === 'function' ? await response.text() : '');
        return res;
    } catch (e) {
        console.error(`Error fetching text from file:`, e);
        console.log(`Failed request to ${url} with file:`, fileAsB64);
        return '';
    }
}


async function fetchExternalResource(endpoint, params) {
    if (!endpoint || typeof(endpoint) !== 'string') {  return;  }
    if (!laiOptions?.webHook) {  return;  }

    const url = `${laiOptions.webHook.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`; // Remove duplicate slashes

    let options = {  method: "GET", headers: {}  };

    if (params) {
        let body;
        if (params instanceof FormData) {
            body = params;  // When using FormData, the browser sets the correct Content-Type automatically
        } else if (typeof(params) === 'string') {
            body = params;
            options.headers["Content-Type"] = "text/plain";
        } else {
            try {
                body = JSON.stringify(params);
                options.headers["Content-Type"] = "application/json";
            } catch (e) {
                console.error(`>>> ${manifest.name}`, e);
                body = params;
                options.headers["Content-Type"] = "application/x-www-form-urlencoded";
            }
        }

        options.method = "POST";
        options.body = body;
    }

    let response;
    try {
        response = await fetch(url, options);
        return await response.text();
    } catch (e) {
        await showUIMessage(null, e.message, 'error');
        console.log(`>>> ${manifest.name} - ERROR:`, e);
        console.log(`>>> ${manifest.name} - url: ${url}; params`, params ?? '');
        console.log(`>>> ${manifest.name} - response:`, response);
        return;
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
        console.error(e);
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
        console.error(e);
    }

    return Object.assign({}, defaults, obj.laiOptions);
}

async function showUIMessage(tab, message, type = '') {
    if (!/^http/i.test(tab.url)) { return; }
    if(!tab) {  tab = await getCurrentTab();  }
    chrome.tabs.sendMessage(tab.id, {"action": "showMessage", message: message, messageType: type})
        .catch(e => console.error(`>>> ${manifest.name}`, e));
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
        showUIMessage(`No API endpoint found - ${urlVal}!`, 'error');
        return false;
    }

    if(!urlVal.startsWith('http')){
        showUIMessage(`Invalid API endpoint - ${urlVal}!`, 'error');
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
      console.error(e);
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
        console.log(`>>> ${manifest.name} - trying to reload`);
        chrome.runtime.reload();
    } catch (err) {
        if(chrome.runtime.lastError){  console.error(`${manifest.name}`, chrome.runtime.lastError);  }
        console.error(`>>> ${manifest.name}`, err);
    }
}
