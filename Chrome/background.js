var controller;
var shouldAbort = false;
var laiOptions;
const storageOptionKey = 'laiOptions';
const storageToolsKey = 'aiTools';
const sessionHistoryKey = 'sessionHistory';
const manifest = chrome.runtime.getManifest();

chrome.runtime.onInstalled.addListener(() => {
    init();
});

chrome.tabs.onCreated.addListener(tab => {  init();  });

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {

    if(tab?.url && !tab?.url?.startsWith('http')) {  return;  }

    if (changeInfo.status === 'complete' && tab?.url) {
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
    if(tab?.url?.startsWith('http')) {
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
                await dumpInFrontConsole(`>>> ${manifest.name} - [${getLineNumber()}] - Error: ${error.message}`, error);
                sendResponse({ status: 'error', message: error.toString() });
            });
            break;
        case 'fetchData':
            shouldAbort = false;
            fetchDataAction(request, sender).then(response => {
                sendResponse(response);
            }).catch(async error => {
                await dumpInFrontConsole(`>>> ${manifest.name} - [${getLineNumber()}] - Error: ${error.message}`, error);
                sendResponse({ status: 'error', message: error.toString() });
            });
            break;
        case "getHooks":
            getHooks()
            .then(response => sendResponse(response) )
            .catch(async error => {
                await dumpInFrontConsole(`>>> ${manifest.name} - [${getLineNumber()}] - Error: ${error.message}`, error);
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
                    await dumpInFrontConsole(`>>> ${manifest.name} - [${getLineNumber()}] - Error: ${e.message}`, e);
                    sendResponse({ status: 'error', message: e.toString() });
                });
            break;
        case "openOptionsPage":
            chrome.tabs.create({url: chrome.runtime.getURL('options.html')});
            break;
        case "prepareModels":
            prepareModels(request.modelName, request.unload, sender.tab)
                .then(response => sendResponse({status: response.status, text: response.statusText}))
                .catch(async e => {
                    await dumpInFrontConsole(`>>> ${manifest.name} - [${getLineNumber()}] - Error: ${e.message}`, e);
                    sendResponse({ status: 'error', message: e.toString() });
                });
        break;
        case "getImageBase64":
            getImageAsBase64(request.url)
                .then(base64 => sendResponse({ base64 }))
                .catch(() => sendResponse({ base64: null }));
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

// for responses stream = false - wait the whole response to return
async function handleResponse(responseData = '', senderTabId) {
    if(!responseData){
        chrome.tabs.sendMessage(senderTabId, { action: "streamEnd" })
            .catch(async e => await showUIMessage(e.message, 'error'));
        return;
    }

    console.log(`>>> ${manifest.name} - [${getLineNumber()}] - response (type: ${typeof(responseData)})`, responseData);
    try {
        // const resp = responseData?.message?.content || "Missing or empty reply content!";
        // const result = resp === "Missing or empty reply content!" ? "error" : "success";
        await chrome.tabs.sendMessage(senderTabId, { action: "streamData", response: JSON.stringify(responseData) });
        await chrome.tabs.sendMessage(senderTabId, { action: "streamEnd" });
    } catch (error) {
        await showUIMessage(error.message, 'error');
    }

    return;
}

// for responses stream = true - obsolate
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
                if(data.error){  throw new Error(data.error);  }
            } catch (e) {
                await showUIMessage(e.message, 'error', senderTabId);
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

async function resolveToolCalls(toolCalls, toolBaseUrl) {
    const messages = [];

    for (const call of toolCalls) {
        updateUIStatusBar(`Calling ${call.function.name}...`);
        console.debug(`>>> ${manifest.name} - [${getLineNumber()}] - tool call request`, call);
        const funcUrl = `${toolBaseUrl}/${call.function.name}`;
        let data;

        try {
            const res = await fetchExtResponse(funcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(call.function.arguments),
            });

            data = res.status === 200 ? await res.json() : `There is no registered tool named ${funcUrl.split('/').pop()}`;
            updateUIStatusBar(`${call.function.name} response received.`);

        } catch (err) {
            updateUIStatusBar(`Error occured while calling ${call.function.name}...`);
            console.error(`>>> ${manifest.name} - [${getLineNumber()}] - error calling ${call.function.name}`, err, call);
            if(err.toString().startsWith("TypeError: Failed to fetch")){
                showUIMessage(`External tools endpoint (${funcUrl}) seems missing to be down!`, "error");
                data = "Tool execution failed — endpoint unavailable.";
                messages.push(
                    { role: "assistant", content: "", tool_calls: [call] },
                    { role: "tool", content: JSON.stringify(data) }
                );
                break;
            }
            continue;
        }

        console.debug(`>>> ${manifest.name} - [${getLineNumber()}] - tool call response`, data);
        messages.push(
            { role: "assistant", content: "", tool_calls: [call] },
            { role: "tool", content: JSON.stringify(data) }
        );
    }

    return messages;
}

async function fetchDataAction(request, sender) {
    if(Object.keys(laiOptions ?? {}).length < 1){  laiOptions = await getOptions();  }
    const promptTools = await getPromptTools();

    if(!laiOptions?.aiUrl){
        let msg = 'Missing API endpoint!';
        await showUIMessage(`${msg} - ${laiOptions?.aiUrl || 'missing aiUrl'}`, 'error', sender.tab);
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${msg}`, laiOptions);
        return {"status": "error", "message": msg};
    }

    let url = request?.url ?? laiOptions?.aiUrl;
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

    if(promptTools.length > 0){
        request.data["tools"] = promptTools;
        request.data["stream"] = false;
        request.data["tool_choice"] = "auto"
    }
    request["format"] = "json";

    let chatHist = await getChatHistory() || [];

    let context = chatHist.length > 0 ? chatHist.map(obj => `${obj.role}: ${obj.content}.`).join(' ') : '';
    context = context ? [{"role": "user", "content": `\n\nChat context so far is: ${context}`}] : [];

    let sysInstruct = request.systemInstructions || laiOptions.systemInstructions || '';
    sysInstruct = sysInstruct ? [{ role: "system", content: sysInstruct }] : [];

    const currentPrompt = request?.data?.messages || [];
    if(currentPrompt.length < 1){ throw new Error("No prompt received!");  }

    request.data.messages = [...sysInstruct, ...context, ...currentPrompt];

    await dumpInFrontConsole(`[${getLineNumber()}] - request.data.messages: ${request.data.messages.length}`, request.data.messages, 'log', sender.tab);

    await setChatHistory(currentPrompt);

    let response;
    let body;
    let reqOpt = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.data),
        signal: controller.signal,
    };
    try{
        response = await fetchExtResponse(url, reqOpt);
        body = await response.json();
        if(response.status > 299){  throw new Error(`${response.status}: ${response.statusText} - ${body?.error || 'No response error provided...'}`);  }

        if(shouldAbort && controller){
            controller.abort();
            chrome.tabs.sendMessage(sender.tab, { action: "streamAbort" });
            return  {"status": "aborted", "message": "Aborted"};
        }

        if (body?.message?.tool_calls) {
            const newMessages = await resolveToolCalls(body.message.tool_calls, laiOptions.toolFunc);
            await setChatHistory(newMessages);
            request.data.messages.push(...newMessages);

            response = await fetchExtResponse(url, {
              ...reqOpt,
              body: JSON.stringify(request.data),
            });

            body = await response.json();
        }

        updateUIStatusBar(`Final response received...`);
        await handleResponse(body, sender.tab.id);
        // await handleStreamingResponse(response?.body?.getReader(), sender.tab.id);
    }
    catch(e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - error`, e, response, request?.data);
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


async function fetchExtResponse(url, options){
    if(!url || !options.method){  throw new Error('Either URL or request options are empty or missing!');  }
    try {
        const response = await fetch(url, options);
        return response;
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - External call to ${url} failed!`, error, options);
        throw error;
    }
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

async function getPromptTools(){
    const commands = await chrome.storage.local.get([storageToolsKey]);
    return commands[storageToolsKey] || [];
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
    if (!/^http/i.test(tab?.url)) { return; }
    chrome.tabs.sendMessage(tab.id, {"action": "showMessage", message: message, messageType: type})
        .catch(e => console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e));
}

async function updateUIStatusBar(message, tab) {
    if(!tab) {  tab = await getCurrentTab();  }
    if (!/^http/i.test(tab?.url)) { return; }
    chrome.tabs.sendMessage(tab.id, {"action": "updateStatusbar", message: message})
        .catch(e => console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e));
}

async function dumpInFrontConsole(message, obj, type = 'log', tab){
    if(!tab) {  tab = await getCurrentTab();  }
    if (!/^http/i.test(tab?.url)) { return; }
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
    let urlVal = laiOptions?.toolFunc;
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
        return {"status":"error", "messsage": `toolFunc seems invalud - ${urlVal}! Error: ${err.message}`};
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

async function getImageAsBase64(url) {
    if (!url) {  return null;  }
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      return await new Promise(resolve => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',').pop());
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
}

async function prepareModels(modelName, remove = false, tab){
    let response;
    if(Object.keys(laiOptions ?? {}).length < 1){  laiOptions = await getOptions();  }
    const data = {
        "model": modelName,
        "messages": [],
    };
    if(remove){  data["keep_alive"] = 0;  }
    try {
       response = await fetch(laiOptions?.aiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    } catch (err) {
        await dumpInFrontConsole(err.message, err, "error", tab);
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${err.message}`, err);
    }

    await dumpInFrontConsole(`${modelName} ${remove ? 'un' : ''}loaded successfully.`, response, "success", tab);
    console.debug(`>>> ${manifest.name} - [${getLineNumber()}] - response`, response);
    return response;
}