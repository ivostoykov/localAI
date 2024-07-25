var controller;
var shouldAbort = false;
var laiOptions;
const storageOptionKey = 'laiOptions';
const manifest = chrome.runtime.getManifest();

chrome.tabs.onCreated.addListener(tab => {  composeContextMenu();  });

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {

    if(tab.url && !tab.url.startsWith('http')) {  return;  }

    if (changeInfo.status === 'complete' && tab.url) {
        laiOptions = await getOptions();
        composeContextMenu();
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
        chrome.tabs.sendMessage(tab.id, { action: "toggleSidebar" });
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!controller) {
        controller = new AbortController();
    }
    switch (request.action) {
        case 'fetchData':
            shouldAbort = false;
            fetchDataAction(request, sender);
            break;
        case 'abortFetch':
            shouldAbort = true;
            break;
        case "openOptionsPage":
            chrome.tabs.create({url: chrome.runtime.getURL('options.html')});
            break;
        default:
            console.error('Unrecognized action:', request?.action);
    }
    return true;
});

chrome.runtime.onInstalled.addListener(() => {
    composeContextMenu();
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
            if (!tab.id) {  return;  }
            chrome.tabs.sendMessage(tab.id, {
                action: "toggleSelectElement",
                selection: true
            });
            break;
        default:
            console.error(`Unknown menu id: ${info.menuItemId}`);
        }
});

function composeContextMenu() {
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
        'script', 'style', 'code', 'header', 'footer', 'nav', 'aside', 'link', 'select',
        'form', 'iframe', 'video', '[id*="ad"]',
        '[class*="sidebar"]', '[class*="ad"]', '[class*="side-nav"]',
        '.sidebar', '.widget', 'button', 'svg'
    ];

    // Remove elements based on the selectors
    unwantedSelectors.forEach(selector => {
        const elements = bodyClone.querySelectorAll(selector);
        elements.forEach(el => el.remove());
    });

    // Remove HTML comments
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

    return bodyClone.textContent.trim();
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
        console.log(`>>> textChunk: ${textChunk}`,);
        return textChunk;
    }

    return textChunk;
}

function handleStreamingResponse(reader, senderTabId) {
    if(!reader || !reader.read){ return; }

    const read = () => {
        if(shouldAbort) {
            reader.cancel();
            chrome.tabs.sendMessage(senderTabId, { action: "streamAbort" });
            return;
        }
        reader.read().then(({ done, value }) => {
            if (done) {
                chrome.tabs.sendMessage(senderTabId, { action: "streamEnd" });
                return;
            }
            const textChunk = new TextDecoder().decode(value);
            // let data = textChunk.replace(/^data:\s+/i, '').trim();
            let data = processTextChunk(textChunk);
            // data = data.replace(/data:\s+\[DONE\]$/i, '').trim();
            try {
                data = JSON.parse(data);
            } catch (e) {
                console.log(`>>>`, e);
                console.log(`>>> textChunk`, textChunk);
                console.log(`>>> data`, data);
            }

            if(Array.isArray(data)){
                data.forEach(el => chrome.tabs.sendMessage(senderTabId, { action: "streamData", data: JSON.stringify(el)}))
            } else {
                chrome.tabs.sendMessage(senderTabId, { action: "streamData", data: JSON.stringify(data)});
            }
            read();
        }).catch(error => {
            if (!shouldAbort) {
                chrome.tabs.sendMessage(senderTabId, { action: "streamError", error: error.toString() });
            }
        });
    };

    read();
}

async function askAIExplanation(info, tab) {
    try {
        await chrome.tabs.sendMessage(tab.id, {
            action: "explainSelection",
            selection: info.selectionText
        });
    } catch (err) {
        console.error('>>>', err);
    }
}

async function fetchDataAction(request, sender) {
    let messages = request?.data?.messages || [];
    let theExternalResources = request?.externalResources || [];
    let binaryFormData = getBinaryFormData(request?.binaryFormData);
    if(messages.length < 1){  return;  }

    if(Object.keys(laiOptions ?? {}).length < 1){
        laiOptions = await getOptions();
    }

    if(!laiOptions.aiUrl){
        console.error('missing API endpoint!', laiOptions);
        return; // TODO show message || open options
    }

    const controller = new AbortController();
    let data = messages.slice(-1)[0]?.content || '';
    data = await composeUserImput(data, sender);

    if(laiOptions?.aiModel){
        request.data['model'] = laiOptions?.aiModel || '';
    }

    request.data.messages.splice(-1, 1, { "role": "user", "content": data});
    request.data.messages = request.data.messages.filter(msg => msg.content.trim());
    request.data.messages.push(...await addExternalResourcesToUserInput(theExternalResources, binaryFormData));

    const url = request?.url ?? laiOptions.aiUrl;
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.data),
        signal: controller.signal,
    })
    .then(response => {
        if(response.status > 299){
            throw new Error(`${response.status}: ${response.statusText}`);
        }
        if(shouldAbort && controller){
            controller.abort();
            chrome.tabs.sendMessage(senderTabId, { action: "streamAbort" });
            return;
        }
        handleStreamingResponse(response?.body?.getReader(), sender.tab.id);
    })
    .catch(error => {
        if (error.name === 'AbortError') {
            chrome.tabs.sendMessage(sender.tab.id, { action: "streamAbort"});
        } else {
            chrome.tabs.sendMessage(sender.tab.id, { action: "streamError", error: error.toString()});
        }
        delete controller;
    });
}

async function composeUserImput(userInputText, sender) {
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

    if (userCommands.length < 1) return userInputText;

    for (const cmd of userCommands) {
        if (cmd && cmd.length > 1 && cmd[1]) {
            let additionalInfo = await fetchUserCommandResult(cmd[1], sender);
            if(cmd[1] && cmd[1] === 'page'){
                additionalInfo = `This is the content of the ${cmd[1]}:\n${additionalInfo}`
            }
            combinedResult.push(additionalInfo);
            userInputText = userInputText.replace(`@{{${cmd[1]}}}`, ``);
        }
    }

    combinedResult.push(userInputText);
    return combinedResult.join('\n');
}

function getBinaryFormData(formData){
    if(!formData){  return;  }
    const theFormData = new FormData();

    formData?.forEach(item => {
        theFormData.append(item.key, item.value);
    });

    return theFormData;
}

async function addExternalResourcesToUserInput(externalResources, binaryFormData){
    if(!laiOptions?.webHook){  return '';  }
    let messages = [];

    for (let i = 0; i < externalResources.length; i++) {
        const [resource, parameters] = externalResources[i].split('?');
        const formData = addParamsToFormData(parameters, binaryFormData);
        const res = await fetchExternalResource(resource, formData);
        if(!res) {  continue;  }

        let content;
        try {
            content = typeof(res) !== 'string' ? JSON.parse(res) : res;
        } catch (e) {
            content = res;
        }

        const inputChunks = splitInputToChunks(content, 4096);
        for (let x = 0; x < inputChunks.length; x++) {
            if(!inputChunks[i]) {  continue;  }
            messages.push({ "role": "user", "content": inputChunks[i] });
        }

        if(messages.length > 0){
            const re = /\//g;
            const startTag = `${resource.replace(re, '_').toUpperCase()}_RESOURCE_START`;
            const endTag = `${resource.replace(re, '_').toUpperCase()}_RESOURCE_END`;
            messages.unshift({ "role": "user", "content": `The following content, enclosed between "[${startTag}]" and "[${endTag}]" is this extenral resource content: ${resource} ${parameters ? 'called with parameter(s): ': ''}${parameters}. Leverage this information to enhance the quality and relevance of the response to the given prompt.[${startTag}]` });
            messages.push({ "role": "user", "content": `[${endTag}] ` });
        }
    }

    return messages;
}

function splitInputToChunks(str, chunkSize) {
    const chunks = [];
    for (let i = 0; i < str.length; i += chunkSize) {
        chunks.push(str.slice(i, i + chunkSize));
    }
    return chunks;
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
        console.error(`>>> ${manifest.name} - ${e.message}`);
        console.log(`>>> ${manifest.name} - url: ${url}; params`, params ?? '');
        console.log(`>>> ${manifest.name} - error:`, e);
        console.log(`>>> ${manifest.name} - response:`, response);
        return;
    }
}


function addParamsToFormData(parameters, binaryFormData){
    if(!parameters) {  return;  }
    let isBinary = binaryFormData instanceof FormData;
    if(!isBinary){  binaryFormData = {};  }
    // if(!binaryFormData){ binaryFormData = new FormData();  }
    const params = parameters.split('&');
    for (let i = 0; i < params.length; i++) {
        const [key, value] = params[i].split('=');
        if(isBinary){
        binaryFormData.append(key, value);
        } else {
            binaryFormData[key] = value;
        }
    }

    return binaryFormData;
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