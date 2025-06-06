/* Unreleased Changes:
 * - Switched to per‑tab AbortControllers (using controllers Map) instead of a single global controller/shouldAbort flag.
 * - Scoped fetchDataAction AbortController per tab, cleared old controller on new requests; abortFetch now cancels only the current tab’s request.
 * - Removed obsolete handleStreamingResponse and global shouldAbort logic.
 * - Enhanced session management: lazy creation of a new session on first user command; robust getActiveSession/getActiveSessionId/getAllSessions/createNewSession with fallbacks.
 * - Refactored session storage helpers: setAllSessions persists empty arrays; getAllSessions returns [] on storage errors; createNewSession and getActiveSession return fallback session objects on error.
 * - Fixed setOptions storage call signature (chrome.storage.sync.set({ [key]: value })).
 */
const controllers = new Map(); // Map to manage AbortControllers per tab for concurrent fetchDataAction calls
const storageOptionKey = 'laiOptions';
const storageUserCommandsKey = 'aiUserCommands';
const activeSessionKey = 'activeSession';
const allSessionsStorageKey = 'aiSessions';
const storageToolsKey = 'aiTools';
const activeSessionIdStorageKey = 'activeSessionId';
const activePageStorageKey = 'activePage';

const manifest = chrome.runtime.getManifest();

chrome.runtime.onInstalled.addListener(() => {
    init();
});

/* chrome.tabs.onCreated.addListener(tab => { init(); });

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {

    if (tab?.url && !tab?.url?.startsWith('http')) { return; }

    if (changeInfo.status === 'complete' && tab?.url) {
        init();
    }
}); */

chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== 'sync') {  return; }
    for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
        if(key === storageOptionKey){
        }
    }
});

chrome.action.onClicked.addListener(async (tab) => {
    if (tab?.url?.startsWith('http')) {
        try {
            const res = await chrome.tabs.sendMessage(tab.id, { action: "toggleSidebar" });
            if (chrome.runtime.lastError) {  throw new Error(`>>> ${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`);  }
        } catch (e) {
                console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
                await showUIMessage(e.message, 'error', tab);
        }
    }
});


chrome.runtime.onConnect.addListener(function (port) {
    port.onDisconnect.addListener(function () {
      tryReloadExtension();
    });
});

chrome.runtime.onUpdateAvailable.addListener(function (details) { tryReloadExtension(); });

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    let response;
    const tabId = sender.tab?.id;
    // Clear any previous controller for this tab before new fetch requests
    if (request.action === 'fetchData' && tabId != null) {
        controllers.delete(tabId);
    }
    switch (request.action) {
        case 'getModels':
            getModels()
            .then(response => sendResponse(response) )
            .catch(async error => {
                await dumpInFrontConsole(`>>> ${manifest.name} - [${getLineNumber()}] - Error: ${error.message}`, error, "error", sender.tab.id);
                sendResponse({ status: 'error', message: error.toString() });
            });
            break;
        case 'fetchData':
            fetchDataAction(request, sender)
            .then(response => { sendResponse(response);  })
            .catch(async error => {
                await dumpInFrontConsole(`>>> ${manifest.name} - [${getLineNumber()}] - Error: ${error.message}`, error, "error", sender.tab.id);
                sendResponse({ status: 'error', message: error.toString() });
            });
            break;
        // case "getHooks":
        //     getHooks()
        //     .then(response => sendResponse(response) )
        //     .catch(async error => {
        //         await dumpInFrontConsole(`>>> ${manifest.name} - [${getLineNumber()}] - Error: ${error.message}`, error, "error", sender.tab.id);
        //         sendResponse({ status: 'error', message: error.toString() });
        //     });
        //     break;
        case 'abortFetch':
            // Abort the in-flight fetchDataAction for this tab
            if (tabId != null) {
                const ctrl = controllers.get(tabId);
                if (ctrl) {
                    ctrl.abort();
                    controllers.delete(tabId);
                }
            }
            sendResponse();
            break;
        case 'extractText':
            convertFileToText(request.fileContent)
                .then(response => sendResponse(response))
                .catch(async e => {
                    await dumpInFrontConsole(`>>> ${manifest.name} - [${getLineNumber()}] - Error: ${e.message}`, e, "error", sender.tab.id);
                    sendResponse({ status: 'error', message: e.toString() });
                });
            break;
        case "openOptionsPage":
            chrome.tabs.create({url: chrome.runtime.getURL('options.html')});
            sendResponse();
            break;
        case "prepareModels":
            prepareModels(request.modelName, request.unload, sender.tab)
                .then(response => sendResponse({status: response.status, text: response.statusText}))
                .catch(async e => {
                    await dumpInFrontConsole(`>>> ${manifest.name} - [${getLineNumber()}] - Error: ${e.message}`, e, "error", sender.tab.id);
                    sendResponse({ status: 'error', message: e.toString() });
                });
        break;
        case "getImageBase64":
            getImageAsBase64(request.url)
                .then(base64 => sendResponse({ base64 }))
                .catch(() => sendResponse({ base64: null }));
            break;
        case "CHECK_ACTIVE_TAB":
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                sendResponse(!!sender.tab?.id && tabs[0]?.id === sender.tab.id );
                // sendResponse(tabs[0]?.id === sender.tab?.id);
            });
            break;
        default:
            console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Unrecognized action:`, request?.action);
            sendResponse();
    }
    return true;
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    try {
    switch (info.menuItemId) {
        case "sendSelectedText":
            if (!info.selectionText.length) { return; }
                if (!tab.id) { return; }
                await addAttachment({
                    id: crypto.randomUUID(),
                    type: "snippet",
                    content: info.selectionText,
                    sourceUrl: tab?.url || ""
                });
                await chrome.tabs.sendMessage(tab.id, { action: "activePageSelection", selection: info.selectionText });
                // await chrome.tabs.sendMessage(tab.id, { action: "activePageSelection", selection: info.selectionText });
                if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
            break;
        case "inserSelectedInPrompt":
            if (!info.selectionText.length) { return; }
                if (!tab.id) { return; }
                await chrome.tabs.sendMessage(tab.id, { action: "inserSelectedInPrompt", selection: info.selectionText });
                if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
            break;
        case "askAiExplanation":
            await askAIExplanation(info, tab);
            break;
        case "sendPageContent":
            await chrome.tabs.sendMessage(tab.id, { action: "activePageContent" });
                if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
            break;
        case "selectAndSendElement":
            if (!tab?.id) {
                console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Expected tab.id; received ${tab?.id}`, tab);
                return;
            }
                await chrome.tabs.sendMessage(tab.id, { action: "toggleSelectElement", selection: true });
                if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
            break;
        case "openOptions":
                chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
            break;
        default:
            console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Unknown menu id: ${info?.menuItemId}`);
        }
    } catch (err) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${err.message}`, err);
    }
});

function init() {
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
        title: "Select And Attach Element",
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
        title: "Attach Selected",
        parentId: "sendToLocalAi",
        contexts: ["selection"]
    });

    chrome.contextMenus.create({
        id: "inserSelectedInPrompt",
        title: "Inser Selected into Prompt",
        parentId: "sendToLocalAi",
        contexts: ["selection"]
    });

    chrome.contextMenus.create({
        id: "sendPageContent",
        title: "Attach Entire Page",
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
    if (textChunk.indexOf('\n{"model"') > -1) {
        return `[${textChunk.replace(/\n{"model"/g, ',\n{"model"')}]`;
    }

    textChunk = textChunk.replace(/^data:\s+/i, '').trim();
    textChunk = textChunk.replace(/data:\s+\[DONE\]$/i, '').trim();

    if (textChunk.indexOf("\ndata:") > -1) {
        textChunk = `[${textChunk.replace(/\ndata:\s+/ig, ',')}]`;
        return textChunk;
    }

    return textChunk;
}

// for responses stream = false - wait the whole response to return
async function handleResponse(responseData = '', senderTabId) {
    try {
        if (!responseData) {
            await chrome.tabs.sendMessage(senderTabId, { action: "streamEnd" });
            if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
    }

        console.log(`>>> ${manifest.name} - [${getLineNumber()}] - response (type: ${typeof (responseData)})`, responseData);
        await chrome.tabs.sendMessage(senderTabId, { action: "streamData", response: JSON.stringify(responseData) });
        if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        await chrome.tabs.sendMessage(senderTabId, { action: "streamEnd" });
        if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${error.message}`, error);
        await showUIMessage(error.message, 'error');
    }

    return;
}

// handleStreamingResponse is deprecated and removed

async function askAIExplanation(info, tab) {
    try {
        await chrome.tabs.sendMessage(tab.id, { action: "explainSelection", selection: info.selectionText });
        if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
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
        if (last.role !== 'user') { break; }
        result.unshift(last.content || '');
    }

    return result.join('\n');
}

async function validateToolCall(call = {}, availableTools) {
    if (!availableTools) {  availableTools = await getPromptTools(); }

    if (!call?.function?.name || Object.keys(call.function).length < 1) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - call request is null or empty!`, call);
        return { isValid: false, reason: "Missing or empty call object!" };
    }

    const func = availableTools.find(f => f?.function?.name === call.function.name);
    if (!func) {
        console.debug(`>>> ${manifest.name} - [${getLineNumber()}] - Fake function call - ${call.function.name}. Instructions to restrict provided.`);
        return {
            isValid: false,
            reason: `Invalid function call.\nThere is no function named ${call.function.name} in the provided list.\nYou must only call functions from the available list.\nDo not guess, do not invent function names.\nRetry using exactly one valid function from the list.\nContinue this process until a correct call is made or no function applies.`
        };
    }

    const requiredParams = func.function.parameters?.required || [];
    const properties = func.function.parameters?.properties || {};
    const args = call.function.arguments || {};

    for (const param of requiredParams) {
        const value = args[param];
        const expectedType = properties[param]?.type;

        if (value === undefined || value === null || value === '') {
            return {
                isValid: false,
                reason: `Missing or invalid parameter: "${param}". All required parameters must be provided.\nDo not leave parameters blank or undefined.\nIf required data is unavailable, do not make the call.`
            };
        }

        if (expectedType && typeof value !== expectedType) {
            return {
                isValid: false,
                reason: `Type mismatch for parameter: "${param}". Expected "${expectedType}", got "${typeof value}". Ensure correct types are used.`
            };
        }

        if (typeof value === 'string' && availableTools.some(t => t.function.name === value)) {
            return {
                isValid: false,
                reason: `Provided parameter "${param}" looks like an existing function name: "${value}", which is not a valid value for "${call.function.name}". Make another call explicitly requesting "${value}" first and use its result as input.`
            };
        }
    }

    return { isValid: true };
}

async function resolveToolCalls(toolCalls, toolBaseUrl) {
    const availableTools = await getPromptTools();
    const messages = [];


    for (const call of toolCalls) {
        const validation = await validateToolCall(call, availableTools);
        if(!validation.isValid){
            console.debug(`>>> ${manifest.name} - [${getLineNumber()}] - Validation call vailed for ${call.function.name}!`, validation);
            messages.push(
                { role: "assistant", content: "", tool_calls: [call] },
                { role: "tool", content: validation.reason || 'No reason provided' }
            );
            break;
        }

        const funcType = availableTools.find(f => f.function.name === call.function.name)?.type || null;
        const funcUrl = `${toolBaseUrl}/${call.function.name}`;
        updateUIStatusBar(`Calling ${call.function.name}...`);
        console.debug(`>>> ${manifest.name} - [${getLineNumber()}] - ${funcType} ${call.function.name} call request`, call);
        await dumpInFrontConsole(`>>> ${manifest.name} - [${getLineNumber()}] - ${funcType} ${call.function.name} call request`, call, 'debug');
        let data;
        let res;

        try {
            switch (funcType?.toLowerCase()) {
                case 'tool':
                    res = await execInternalTool(call);
                    console.debug(`>>> ${manifest.name} - [${getLineNumber()}] - ${funcType} ${call.function.name} response`, data);
                    await dumpInFrontConsole(`>>> ${manifest.name} - [${getLineNumber()}] - ${funcType} ${call.function.name} response`, data, 'debug');
                    if(res?.result !== "success"){
                        data = `"${call?.function?.name}" call returned error: ${res?.content}\nSelect the next best candidate function from the list.\n Continue until a valid response is received or no options remain.`;
                        messages.push(
                            { role: "assistant", content: "", tool_calls: [call] },
                            { role: "user", content: data }
                        );
                        continue;
                    }
                    data = res?.content || 'No content returned!';
                    break;
                case 'function':
                    res = await fetchExtResponse(funcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(call.function.arguments),
            });
                    data = await res?.json();
                    console.debug(`>>> ${manifest.name} - [${getLineNumber()}] - ${funcType} ${call.function.name} response`, data);
                    await dumpInFrontConsole(`>>> ${manifest.name} - [${getLineNumber()}] - ${funcType} ${call.function.name} response`, data, 'debug');
                    if (res?.status !== 200 || data?.status === 'error') {
                        data = `"${call?.function?.name}" call returned error: ${data.message}\nSelect and call another function from the list.\n Continue until a valid response is received or no options remain.`;
                        messages.push(
                            { role: "assistant", content: "", tool_calls: [call] },
                            { role: "user", content: data }
                        );
                        continue;
                    }
                    break;
                default:
                    throw new Error(`Invalid tool type: ${call.function.type} found in this tool's object: ${JSON.stringify(call || "{}")}`);
            }

            switch (typeof res) {
              case 'undefined':
                data = `Function "${call.function.name}" returned no response.\nThe function name, its parameters, or the server may be invalid or unavailable.\nSelect and call another function from the list.\nContinue until a valid response is received or no options remain.`;
                break;
            case 'object':
                data = JSON.stringify(data);
                break;
            }

            updateUIStatusBar(`${call.function.name} response received.`);
            console.debug(`>>> ${manifest.name} - [${getLineNumber()}] - ${funcType} ${call.function.name} response`, data);
            await dumpInFrontConsole(`>>> ${manifest.name} - [${getLineNumber()}] - ${funcType} ${call.function.name} response`, data, 'debug');

        } catch (err) {

            updateUIStatusBar(`Error occured while calling ${call.function.name}...`);
            console.error(`>>> ${manifest.name} - [${getLineNumber()}] - error calling ${call.function.name}`, err, call, res);
            if (err.name === 'TypeError' && err.message.includes('fetch')) {
                showUIMessage(`External tools endpoint (${funcUrl}) seems missing to be down!`, "error");
                data = "Tool execution failed — endpoint unavailable.";
                console.debug(`>>> ${manifest.name} - [${getLineNumber()}] - ${funcType} ${call.function.name} response`, data);
                await dumpInFrontConsole(`>>> ${manifest.name} - [${getLineNumber()}] - ${funcType} ${call.function.name} response`, data, 'debug');
                messages.push(
                    { role: "assistant", content: "", tool_calls: [call] },
                    { role: "user", content: data }
                );
                break;
            }
            continue;
        }

        messages.push(
            { role: "assistant", content: "", tool_calls: [call] },
            { role: "tool", content: data }
        );
    }

    if (messages.length < 1) { messages.push({ role: "tool", content: `None of these - ${toolCalls.map(t => t.function?.name).join(", ")} - are existing tool functions. Please rely on your internal knowledge instead.` }); }
    console.debug(`>>> ${manifest.name} - [${getLineNumber()}] - merged tool call responses`, messages);
    return messages;
}

async function fetchDataAction(request, sender) {
    const laiOptions = await getLaiOptions();
    const promptTools = await getPromptTools();
    const remainingTools = new Set(promptTools.map(t => t.function.name));

    if (!laiOptions?.aiUrl) {
        let msg = 'Missing API endpoint!';
        await showUIMessage(`${msg} - ${laiOptions?.aiUrl || 'missing aiUrl'}`, 'error', sender.tab);
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${msg}`, laiOptions);
        return { "status": "error", "message": msg };
    }

    let url = request?.url ?? laiOptions?.aiUrl;
    if (!url) {
        let msg = `Faild to compose the request URL - ${url}`;
        await showUIMessage(msg, 'error', sender.tab);
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${msg};  request.url: ${request?.url};  laiOptions.aiUrl: ${laiOptions?.aiUrl}`);
        return { "status": "error", "message": msg };
    }

    // Initialize a new AbortController for this tab's request
    const tabId = sender.tab?.id;
    const controller = new AbortController();
    if (tabId != null) {
        controllers.set(tabId, controller);
    }

    if (laiOptions?.aiModel) {
        request.data['model'] = laiOptions?.aiModel || '';
    }

    if (laiOptions.toolsEnabled && promptTools.length > 0) {
        request.data["tools"] = promptTools;
        request.data["tool_choice"] = "auto"
    } else {
        await dumpInFrontConsole(`[${getLineNumber()}] - tools are disabled in the settings. Skipping them.`, laiOptions, 'debug', sender.tab.id)
        console.debug(`[${getLineNumber()}] - tools are disabled in the settings. Skipping them.`, laiOptions)
    }
    request.data["stream"] = false;
    request["format"] = "json";

    // Extract incoming user prompt messages
    const currentPrompt = request?.data?.messages || [];
    if (currentPrompt.length < 1) {
        throw new Error("No prompt received!");
    }
    const userInput = `\n\n# Question: '''${currentPrompt.map(el => el.content).join('')}'''`;

    // Ensure an active session exists; if not, create one on first use
    let activeSession = await getActiveSession();
    if (!activeSession || !Array.isArray(activeSession.data)) {
        // Use concatenated prompt content as session title seed
        const titleSeed = currentPrompt.map(m => m.content).join(' ').substring(0, 80);
        activeSession = await createNewSession(titleSeed);
    }

    // Prepend existing conversation context
    let context = activeSession.data.length > 0
        ? activeSession.data.filter(obj => obj.role && obj.content).map(obj => `${obj.role}: ${obj.content}.\n\n`).join('')
        : '';
    // context = context
    //     ? [{ role: "user", content: `\n\nUse the following pieces of context to answer the question at the end. If you don't know the answer, just say that you don't know, don't try to make up an answer:\n\n ${context}\n\nQuestion: ` }]
    //     : [];
    if(context) {
        context = `\n\n# Context\n\n'''${context}'''\n\n# Instructions\n\nUse the context above to answer the question below. If you don't know, say "I don't know".\n\n`;
    }
    // attachments if any
    let attachmentsContext = (activeSession.attachments || []).map(attachment => {
        let header = `[ATTACHMENT ${attachment.type.toUpperCase()}]`;
        if (attachment.filename) {
            header += ` (${attachment.filename})`;
        } else if (attachment.sourceUrl) {
            const urlParts = attachment.sourceUrl.split('/');
            const shortUrl = urlParts.slice(-2).join('/') || attachment.sourceUrl;
            header += ` (from ${shortUrl})`;
        }
        return {
            role: "user",
            content: `${header}:\n${attachment.content}`
        };
    });

    attachmentsContext = attachmentsContext.length > 0
        ? `\n\n##Attachmenta\n\n'''${attachmentsContext.map(a => a.content).join('\n\n')}'''\n\n# Instructions\n\nUse the attachments for a better answer. If unsure, say "I" don't know."\n\n`
        : '';

    const userMessage = [{
        role: "user",
        content: `${attachmentsContext}\n\n${context}\n\n${userInput}`.replace(/\n{2,}/g, '\n\n')
    }];

    // System instructions (if any)
    let sysInstruct = request.systemInstructions || laiOptions.systemInstructions || '';
    sysInstruct = sysInstruct ? [{ role: "system", content: sysInstruct }] : [];

    // Append the new user messages to session
    activeSession.data.push(...currentPrompt);
    await setActiveSession(activeSession);

    // Build final message list
    // request.data.messages = [...sysInstruct, ...attachmentsContext, ...context, ...currentPrompt];
    // request.data.messages = [...sysInstruct, ...contextMessages, ...currentPrompt];
    request.data.messages = [...sysInstruct, ...userMessage];

    await dumpInFrontConsole(`[${getLineNumber()}] - request.data.messages: ${request.data.messages.length}`, request.data.messages, 'log', sender.tab.id);

    let response;
    let body;
    let responseText;
    let reqOpt = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.data),
        signal: controller.signal,
    };
    try {
        response = await fetchExtResponse(url, reqOpt);
        responseText = await response.clone().text();
        body = await response.json();
        if (response.status > 299) { throw new Error(`${response.status}: ${response.statusText} - ${body?.error || 'No response error provided...'}`); }


        while (body?.message?.tool_calls && remainingTools.size > 0) {
            const toolNamesUsed = body.message.tool_calls.map(tc => tc.function.name);
            toolNamesUsed.forEach(name => remainingTools.delete(name));

            const newMessages = await resolveToolCalls(body.message.tool_calls, laiOptions.toolFunc);
            request.data.messages.push(...newMessages);
            const lastRole = request.data.messages.at(-1)?.role;
            await setActiveSession(newMessages);

            if(lastRole !== 'tool') {   // Inject updated tool list to LLM if needed
                if (remainingTools.size > 0) {
                    request.data.messages.push({
                        role: "user",
                        content: `Use nothing else but the best candidate from the available functions here: ${[...remainingTools].join(", ")}. Always call one at a time.`,
                    });
                } else {
                    request.data.messages.push({
                        role: "user",
                        content: `All tools have been tried. Provide a final response based on what you know.`,
                    });
                    break;
                }
            }

            response = await fetchExtResponse(url, {
              ...reqOpt,
              body: JSON.stringify(request.data),
            });

            responseText = await response.clone().text();
            body = await response.json();
        }

        updateUIStatusBar(`Final response received...`);
        activeSession.data.push(body.message); // ai reply is stored raw
        await setActiveSession(activeSession);
        await handleResponse(body, sender.tab.id);
    }
    catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - error`, e, response, request?.data, responseText);
        if (e.name === 'AbortError') {
            try {
                await chrome.tabs.sendMessage(sender.tab.id, { action: "streamAbort" });
                if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
            } catch (e1) {
                console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e1.message}`, e1);
            }
        } else {
            try {
                await chrome.tabs.sendMessage(sender.tab.id, { action: "streamError", error: e.toString() });
                if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
                await dumpInFrontConsole(`[${getLineNumber()}] Error: ${e.message}`, e, 'error', sender.tab.id);

            } catch (e2) {
                console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e2.message}`, e2);
            }

            return { "status": "error", "message": e.message };
        }
    }
    finally {
        try {
            await chrome.tabs.sendMessage(sender.tab.id, { action: "userPrompt", data: JSON.stringify(request.data) });
            if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        } catch (e3) {
            console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e3.message}`, e3);
        }
    }

    return { "status": "success", "message": "Request sent. Awaiting response." };
}


async function fetchExtResponse(url, options, resentWithoutTools = true) {
    if (!url || !options.method) { throw new Error('Either URL or request options are empty or missing!'); }
    let requestBody;
    try {
        const response = await fetch(url, options);
        if (response.status < 300 || !resentWithoutTools) { return response; }

        const body = await response.clone().json(); // clone to allow reading twice if needed
        const toolsUnsupported = (body?.error || '').toLowerCase().includes("does not support tools");
        if (toolsUnsupported && options.body) {
            requestBody = JSON.parse(options.body); // to remove tools if errors occurs
            updateUIStatusBar(`${requestBody.model || 'This model'} does not support tools. It will try without them.`);
            delete requestBody.tools;
            delete requestBody.tool_choice;
            requestBody.messages.push({ role: "tool", content: "Briefly inform the user that you do not support tool usage or web searches. Provide the best answer based solely on your existing knowledge." })
            options.body = JSON.stringify(requestBody);
            return fetchExtResponse(url, options, false);
        }

        return response;
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - External call to ${url} failed!`, error, options);
        throw error;
    }
}

async function convertFileToText(fileAsB64) {
    const laiOptions = await getLaiOptions();

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

async function getLaiOptions() {
    const defaults = {
        "openPanelOnLoad": false,
        "aiUrl": "",
        "aiModel": "",
        "closeOnClickOut": true,
        "closeOnCopy": false,
        "closeOnSendTo": true,
        "showEmbeddedButton": false,
        "loadHistoryOnStart": false,
        "systemInstructions": 'You are a helpful assistant.',
        "personalInfo": ''
    };

    try {
        const obj = await getOptions();
        const laiOptions = Object.assign({}, defaults, obj ?? {});
        return laiOptions;
    } catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    }
}

async function showUIMessage(message, type = '', tab) {
    if (!tab) { tab = await getCurrentTab(); }
    if (!/^http/i.test(tab?.url)) { return; }
    try {
        await chrome.tabs.sendMessage(tab.id, { "action": "showMessage", message: message, messageType: type });
        if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
    } catch (err) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${err.message}`, err);
    }
}

async function updateUIStatusBar(message, tab) {
    if (!tab) { tab = await getCurrentTab(); }
    if (!/^http/i.test(tab?.url)) { return; }
    try {
        await chrome.tabs.sendMessage(tab.id, { "action": "updateStatusbar", message: message });
        if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${error.message}`, error);
    }
}

async function dumpInFrontConsole(message, obj, type = 'log', tabId) {
    try {
        if(!tabId){
            const tab = await getCurrentTab();
            if (!/^http/i.test(tab?.url)) { return; }
            tabId = tab?.id;
            if(!tabId){
                console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Failed to get tabId`, tab);
                return;
            }
        }
        await chrome.tabs.sendMessage(tabId, { "action": "dumpInConsole", message: message, obj: JSON.stringify(obj), type: type });
        if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${error.message}`, error);
    }
}

async function getCurrentTab() {
    let queryOptions = { active: true, lastFocusedWindow: true };
    // `tab` will either be a `tabs.Tab` instance or `undefined`.
    let [tab] = await chrome.tabs.query(queryOptions);

    return tab;
}

async function getModels() {
    const laiOptions = await getLaiOptions();
    let urlVal = laiOptions?.aiUrl;
    if (!urlVal) {
        await showUIMessage(`No API endpoint found - ${urlVal}!`, 'error');
        return false;
    }

    if (!urlVal.startsWith('http')) {
        await showUIMessage(`Invalid API endpoint - ${urlVal}!`, 'error');
        return false;
    }

    if (urlVal.indexOf('/api/') < 0) { return; }

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
        if (models.models && Array.isArray(models.models)) { return { "status": "success", "models": models.models }; }
    } catch (e) {
      console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
        return { "status": "error", "message": e.message };
    }
}

// async function getHooks() {
//     const laiOptions = await getLaiOptions();
//     let urlVal = laiOptions?.toolFunc;
//     if (!urlVal) {
//         let msg = `No API endpoint found - ${urlVal}!`;
//         return { "status": "error", "message": msg };
//     }

//     if (!urlVal.startsWith('http')) {
//         let msg = `Invalid API endpoint - ${urlVal}!`;
//         return { "status": "error", "message": msg };
//     }

//     let response;
//     let hooks;
//     try {
//         urlVal = (new URL(urlVal)).origin
//         response = await fetch(urlVal);

//         hooks = await response.text();
//         if (!hooks) { return { "status": "error", "message": "No hooks returned. Is server running?" }; }
//         return { "status": "success", "hooks": hooks };
//     } catch (err) {
//         return { "status": "error", "message": `toolFunc seems invalud - ${urlVal}! Error: ${err.message}` };
//     }
// }

function tryReloadExtension() {
    try {
        console.log(`>>> ${manifest.name} - [${getLineNumber()}] - trying to reload`);
        chrome.runtime.reload();
    } catch (err) {
        if (chrome.runtime.lastError) { console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Error:`, chrome.runtime.lastError); }
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${err.message}`, err);
    }
}

async function getImageAsBase64(url) {
    if (!url) { return null; }
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

async function prepareModels(modelName, remove = false, tab) {
    let response;
    const laiOptions = await getLaiOptions();
    const data = {
        "model": modelName,
        "messages": [],
    };
    if (remove) { data["keep_alive"] = 0; }
    try {
       response = await fetch(laiOptions?.aiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    } catch (err) {
        await dumpInFrontConsole(err.message, err, "error", tab.id);
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${err.message}`, err);
    }

    await dumpInFrontConsole(`${modelName} ${remove ? 'un' : ''}loaded successfully.`, response, "log", tab.id);
    console.debug(`>>> ${manifest.name} - [${getLineNumber()}] - response`, response);
    return response;
}

/////////// internal function defined in the prompt tools section ///////////

async function execInternalTool(call = {}){
    let res;
    const data = await getActiveSessionPageData();
    switch (call?.function?.name.toLowerCase()) {
        case "get_current_tab_url":
            res = {"result": "success", "content": `${call?.function?.name} response is: ${data.url}`};
            break;
        case "get_current_date":
        case "get_current_time":
        case "get_date_time":
        case "get_date":
        case "get_time":
            res = {"result": "success", "content": `${call?.function?.name} response is: ${new Date().toISOString()}`};
            break;
        case "get_tab_info":
        case "get_current_tab_info":
        case "get_current_tab_page_content":
            res = {"result": "success", "content": `${call?.function?.name} response is: ${data.pageContent}`};
            break;
        default:
            res = {"result": "error", "content": `No tool named ${call?.function?.name} was found!`};
            break;
    }

    return res;
}

/////////// other helpers ///////////

function getLineNumber() {
    const e = new Error();
    return e.stack.split("\n")[2].trim().replace(/\s{0,}at (.+)/, "[$1]");
}

/////////// storage helpers ///////////

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
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
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

async function getActiveSession() {
    let model;
    try {
        const sessionId = await getActiveSessionId();
        if (!sessionId) {  return await createNewSession();  }

        const laiOptions = await getOptions();
        model = laiOptions?.aiModel || 'unknown';
        const sessions = await getAllSessions();

        const session = sessions.find(sess => sess.id === sessionId);
        if (!session) {  return await createNewSession();  }

        return session;
    } catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
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
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - getActiveSessionId error: ${error.message}`, error);
        return null;
    }
}

async function getAllSessions() {
    try {
        let sessions = await chrome.storage.local.get([allSessionsStorageKey]);
        if(Object.keys(sessions).length < 1){  sessions = []; }
        while (sessions && typeof sessions === 'object' && allSessionsStorageKey in sessions) {
            sessions = sessions[allSessionsStorageKey]; // unwrap if needed
        }
        // migration code
        if (sessions && Array.isArray(sessions) && sessions.length > 0) {
            sessions?.forEach(session => {
                if (!session.id) {
                    session.id = crypto.randomUUID();
                }
            });
            await setAllSessions(sessions);
        }
        // end of migration
        return sessions || [];
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${error.message}`, error);
        return [];
    }
}

async function setActiveSession(session) {
    try {
        if (!session?.id) {  throw new Error('Session object is missing a valid id!');  }

        const sessions = await getAllSessions();
        const idx = sessions.findIndex(s => s.id === session.id);

        if (idx < 0) {  throw new Error(`Session with id ${session.id} not found!`);  }

        sessions[idx] = session;
        await setAllSessions(sessions);
    } catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - setActiveSession error: ${e.message}`, e);
    }
}

async function setAllSessions(obj = []) {
    try {
        while(obj && typeof obj === 'object' && allSessionsStorageKey in obj){
            obj = obj[allSessionsStorageKey];
        }

        await chrome.storage.local.set({ [allSessionsStorageKey]: obj });
    } catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    }
    return true;
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
        await chrome.storage.sync.set({ [storageOptionKey]: options });
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${error.message}`, error, options);
    }
}

async function getPromptTools(){
    const commands = await chrome.storage.local.get([storageToolsKey]);
    return commands[storageToolsKey] || [];
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

