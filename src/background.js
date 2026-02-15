
try {
    importScripts('jslib/constants.js');
} catch (e) {
    console.error('>>> Failed to load jslib/constants.js:', e);
}

const controllers = new Map(); // Map to manage AbortControllers per tab for concurrent fetchDataAction calls

try {
    importScripts('jslib/log.js');
} catch (e) {
    console.error('>>> Failed to load jslib/log.js:', e);
}

try {
    importScripts('background-memory.js');
} catch (e) {
    console.error('>>> Failed to load background-memory.js:', e);
}

try {
    importScripts('jslib/sessions.js');
} catch (e) {
    console.error('>>> Failed to load jslib/sessions.js:', e);
}

try {
    importScripts('jslib/session-repository.js');
} catch (e) {
    console.error('>>> Failed to load jslib/session-repository.js:', e);
}

try {
    importScripts('jslib/internal-tools.js');
    console.debug('>>> jslib/internal-tools.js loaded successfully');
} catch (e) {
    console.error('>>> Failed to load jslib/internal-tools.js:', e);
}

init();

globalThis.debugShowMemory = async function() {
    console.debug('=== INDEXEDDB MEMORY DEBUG ===');
    try {
        const activeSession = await getActiveSession();
        console.debug('Active session ID:', activeSession?.id);

        const conversations = await backgroundMemory.query('conversations', 'sessionId', activeSession?.id);
        console.debug('📝 Conversations (' + conversations.length + ' turns):');
        console.table(conversations);

        const context = await backgroundMemory.get('context', activeSession?.id);
        console.debug('📄 Context:');
        console.debug(context);

        const dbs = await indexedDB.databases();
        console.debug('💾 All databases:', dbs);
    } catch (e) {
        console.error('Error fetching memory:', e);
    }
};

chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== 'sync') { return; }
    for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
        if (key === storageOptionKey) {
        }
    }
});

chrome.action.onClicked.addListener(async (tab) => {
    if (tab?.url?.startsWith('http')) {
        try {
            await chrome.tabs.sendMessage(tab?.id, { action: "toggleSidebar" });
            if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        } catch (e) {
            console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${e.message}`, e);
            await showUIMessage(e.message, 'error', tab);
        }
    }
});

chrome.runtime.onUpdateAvailable.addListener(tryReloadExtension);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        try {
            let response;
            const tabId = sender.tab?.id;

            if (request.action === 'fetchData' && tabId != null) {
                controllers.delete(tabId);
            }

            switch (request.action) {
                case 'getModels':
                    response = await getModels();
                    sendResponse(response);
                    break;

                case 'fetchData':
                    response = await fetchDataAction(request, sender);
                    sendResponse(response);
                    break;

                case 'abortFetch':
                    if (tabId != null) {
                        const ctrl = controllers.get(tabId);
                        if (ctrl) {
                            ctrl.abort('User aborted last request.');
                            controllers.delete(tabId);
                        }
                    }
                    sendResponse();
                    break;

                case 'extractText':
                    response = await convertFileToText(request.fileContent);
                    sendResponse(response);
                    break;

                case "openModifiersHelpMenu":
                    chrome.tabs.create({ url: modifiersHelpUrl });
                    sendResponse();
                    break;

                case "openMainHelpMenu":
                    chrome.tabs.create({ url: mainHelpPageUrl });
                    sendResponse();
                    break;

                case "openOptionsPage":
                    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
                    sendResponse();
                    break;

                case "modelCanThink":
                    response = await modelCanThink(request?.model, request?.url);
                    sendResponse({ canThink: response });
                    break;

                case "modelCanUseTools":
                    response = await modelCanUseTools(request?.model, sender?.tab);
                    sendResponse({ canUseTools: response });
                    break;

                case "modelInfo":
                    response = await getModelInfo(request?.model);
                    sendResponse(response);
                    break;

                case "prepareModels":
                    response = await prepareModels(request.modelName, request.unload, sender.tab);
                    sendResponse({ status: response.status, text: response.statusText });
                    break;

                case "storeImage":
                    response = await storeImageHandler(request.base64, request.filename, request.mimeType);
                    sendResponse(response);
                    break;

                case "checkAndSetSessionName":
                    await generateAndUpdateSessionTitle(request?.text ?? '', sender.tab);
                    sendResponse({ status: 'success' });
                    break;

                case "deleteSessionMemory":
                    await backgroundMemory.deleteSession(request.sessionId);
                    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Deleted session ${request.sessionId} from memory`);
                    sendResponse({ status: 'success' });
                    break;

                case "clearAllMemory":
                    await backgroundMemory.clearAll();
                    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Cleared all memory from IndexedDB`);
                    sendResponse({ status: 'success' });
                    break;

                default:
                    console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Unrecognized action:`, request?.action);
                    sendResponse();
            }
        } catch (error) {
            console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error handling message:`, error);
            await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error: ${error.message}`, error, "error", sender?.tab?.id);
            sendResponse({ status: 'error', message: error.toString() });
        }
    })();

    return true;
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    try {
        switch (info.menuItemId) {
            case "sendSelectedText":
                if (!info.selectionText.length) { return; }
                if (!tab?.id) { return; }
                await chrome.tabs.sendMessage(tab?.id, { action: "activePageSelection", selection: info.selectionText });
                if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
                break;
            case "inserSelectedInPrompt":
                if (!info.selectionText.length) { return; }
                if (!tab?.id) { return; }
                await chrome.tabs.sendMessage(tab?.id, { action: "inserSelectedInPrompt", selection: info.selectionText });
                if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
                break;
            case "askAiExplanation":
                await askAIExplanation(info, tab);
                break;
            case "sendPageContent":
                await chrome.tabs.sendMessage(tab?.id, { action: "activePageContent" });
                if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
                break;
            case "selectAndSendElement":
                if (!tab?.id) {
                    console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Expected tab?.id; received ${tab?.id}`, tab);
                    return;
                }
                await chrome.tabs.sendMessage(tab?.id, { action: "toggleSelectElement", selection: true });
                if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
                break;
            case "openOptions":
                chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
                break;
            default:
                console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Unknown menu id: ${info?.menuItemId}`);
        }
    } catch (err) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${err.message}`, err);
    }
});

async function init() {
    if (typeof backgroundMemory === 'undefined') {
        console.error('>>> backgroundMemory is undefined! background-memory.js not loaded properly');
        return;
    }

    try {
        await backgroundMemory.init();

        if (typeof sessionRepository !== 'undefined') {
            sessionRepository.setIndexedDB(backgroundMemory);
        }
    } catch (e) {
        console.error(`>>> ${manifest?.name ?? ''} - Failed to initialise memory system:`, e);
    }

    composeContextMenu();
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

async function handleResponse(responseData = '', senderTabId) {
    try {
        if (!responseData) {
            await chrome.tabs.sendMessage(senderTabId, { action: "streamEnd" });
            if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        }

        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - response (type: ${typeof (responseData)})`, responseData);
        await chrome.tabs.sendMessage(senderTabId, { action: "streamData", response: JSON.stringify(responseData) });
        if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        await chrome.tabs.sendMessage(senderTabId, { action: "streamEnd" });
        if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${error.message}`, error);
        await showUIMessage(error.message, 'error');
    }

    return;
}

async function askAIExplanation(info, tab) {
    try {
        await chrome.tabs.sendMessage(tab?.id, { action: "explainSelection", selection: info.selectionText });
        if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
    } catch (e) {
        await showUIMessage(e.message, 'error');
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${e.message}`, e);
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
    if (!availableTools) { availableTools = await getPromptTools(); }

    if (!call?.function?.name || Object.keys(call.function).length < 1) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - call request is null or empty!`, call);
        return { isValid: false, reason: "Missing or empty call object!" };
    }

    const func = availableTools.find(f => f?.function?.name === call.function.name);
    if (!func) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Fake function call - ${call.function.name}. Instructions to restrict provided.`);
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

async function resolveToolCalls(toolCall, toolBaseUrl, tab, sessionId = null) {
    // const availableTools = await getPromptTools();

    let data;
    let res;
// validation is split into external and internal tools - no need to check everywhere
/*     const validation = await validateToolCall(toolCall, availableTools);
    if (!validation.isValid) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Validation call vailed for ${toolCall.function.name}!`, validation);
        data = validation.reason || 'No reason provided';
        return data;
    } */

    // const funcType = availableTools.find(f => f.function.name === toolCall.function.name)?.type || null;
    const funcType =  isInternalTool(toolCall?.function?.name) ? "tool" : "function";
    const funcUrl = `${toolBaseUrl}/${toolCall.function.name}`;
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${funcType} ${toolCall.function.name} call request`, toolCall);
    await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${funcType} ${toolCall.function.name} call request`, toolCall, 'debug', tab?.id);

    try {
        switch (funcType?.toLowerCase()) {
            case 'tool':
                data = await execInternalTool(toolCall);
                break;
            case 'function':
                res = await fetchExtResponse(funcUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(toolCall.function.arguments),
                }, tab);
                data = await res?.json();
                console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${funcType} ${toolCall.function.name} response`, data);
                await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${funcType} ${toolCall.function.name} response`, data, 'debug', tab?.id);
                if (res?.status !== 200 || data?.status === 'error') {
                    data = `"${toolCall?.function?.name}" call returned error: ${data.message}\nSelect and call another function from the list.\n Continue until a valid response is received or no options remain.`;
                    return data;
                }
                break;
            default:
                throw new Error(`Invalid tool type: ${toolCall.function.type} found in this tool's object: ${JSON.stringify(toolCall || "{}")}`);
        }

        switch (typeof data) {
            case 'undefined':
                data = `Function "${toolCall.function.name}" returned no response.\nThe function name, its parameters, or the server may be invalid or unavailable.\nSelect and call another function from the list.\nContinue until a valid response is received or no options remain.`;
                break;
            case 'object':
                data = JSON.stringify(data);
                break;
        }

        await updateUIStatusBar(`${toolCall.function.name} response received.`, tab);
        await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${funcType} ${toolCall.function.name} response`, data.substr(0,50), 'debug', tab?.id);

    } catch (err) {

        await updateUIStatusBar(`Error occured while calling ${toolCall.function.name}...`, tab);
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - error calling ${toolCall.function.name}`, err, toolCall, res);
        if (err.name === 'TypeError' && err.message.includes('fetch')) {
            showUIMessage(`External tools endpoint (${funcUrl}) seems missing to be down!`, "error");
            data = "Tool execution failed — endpoint unavailable.";
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${funcType} ${toolCall.function.name} response`, data);
            await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${funcType} ${toolCall.function.name} response`, data, 'debug', tab?.id);
            return data;
        }
        throw err;
    }

    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - tool call response`, data);
    return data;
}

async function processCommandPlaceholders(userInputValue, existingAttachments = []) {
    const userCommands = [...userInputValue.matchAll(/@\{\{([\s\S]+?)\}\}/gm)];
    const newAttachments = [];

    const existingCmds = new Set((existingAttachments ?? []).map(att => att.cmd).filter(Boolean));

    for (const cmd of userCommands) {
        let cmdText = '';
        if (Array.isArray(cmd)) { cmdText = cmd[1]?.trim(); }
        if (!cmdText) { continue; }

        if (existingCmds.has(cmdText)) { continue; }

        let attachment;
        switch (cmdText) {
            case 'page':
                const pageData = await getActiveSessionPageData();
                const pageContent = pageData?.pageContent ?? "";
                if (!pageContent) {
                    console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Empty page content for @{{page}}`, pageData);
                } else {
                    attachment = {
                        cmd: 'page',
                        type: "snippet",
                        content: pageContent,
                        sourceUrl: pageData?.url || 'unknown',
                        pageHash: pageData?.pageHash
                    };
                }
                break;
            case 'now':
                attachment = {
                    cmd: 'now',
                    type: "snippet",
                    content: `current date and time or timestamp is: ${(new Date()).toISOString()}`,
                    sourceUrl: 'system'
                };
                break;
            case "today":
                attachment = {
                    cmd: 'today',
                    type: "snippet",
                    content: `current date is: ${(new Date()).toISOString().split('T')[0]}`,
                    sourceUrl: 'system'
                };
                break;
            case "time":
                attachment = {
                    cmd: 'time',
                    type: "snippet",
                    content: `current time is: ${(new Date()).toISOString().split('T')[1]}`,
                    sourceUrl: 'system'
                };
                break;
        }

        if (attachment) {
            attachment.id = crypto.randomUUID();
            newAttachments.push(attachment);
            existingCmds.add(cmdText);
        }
    }

    return newAttachments;
}

function replaceCommandPlaceholders(userInput) {
    const CMD_LABELS = {
        'page': 'page content',
        'now': 'timestamp',
        'today': 'current date',
        'time': 'current time'
    };

    let cleaned = userInput;
    Object.entries(CMD_LABELS).forEach(([cmd, label]) => {
        const regex = new RegExp(`@\\{\\{${cmd}\\}\\}`, 'g');
        cleaned = cleaned.replace(regex, `[see ${label} attachment]`);
    });

    return cleaned;
}

async function processCommandArguments(userInput, attachments) {
    let pageContent = null;
    let pageHash = null;
    const commandAttachments = await processCommandPlaceholders(userInput, attachments);
    if (commandAttachments.length > 0) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Processed ${commandAttachments.length} command placeholder(s)`);
        attachments.push(...commandAttachments);

        const pageAttachment = commandAttachments.find(att => att.cmd === 'page');
        if (pageAttachment) {
            pageContent = pageAttachment.content;
            pageHash = pageAttachment.pageHash;
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Page content added: ${pageContent.length} chars, hash: ${pageHash}`);
        }
    }
    return { pageContent, pageHash };
}

async function fetchDataAction(request, sender) {
    const laiOptions = await getLaiOptions();
    const toolsEnabled = request?.tools || false;
    const promptTools = toolsEnabled ? await getPromptTools() : [];
    console.debug(`>>> [${getLineNumber()}] - promptTools. ${toolsEnabled}`, promptTools)

    let url = request?.url ?? await getAiUrl();
    if (!url) {
        let msg = `Faild to compose the request URL - ${url}`;
        await showUIMessage(msg, 'error', sender.tab);
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${msg};  request.url: ${request?.url};  laiOptions.aiUrl: ${laiOptions?.aiUrl}`);
        return { "status": "error", "message": msg };
    }

    const tabId = sender.tab?.id;
    const controller = new AbortController();
    if (tabId != null) { controllers.set(tabId, controller); }

    let model = await getAiModel()
    if (model) { request.data['model'] = model; }

    request.data["stream"] = false;
    request["format"] = "json";

    const userInput = request?.data?.userInput || "";
    delete request.data.userInput;
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - userInput:`, userInput);

    let activeSession = await getActiveSession();
    const turnNumber = (activeSession?.turnNumber || 0) + 1;
    let attachments = [...(activeSession?.attachments || [])];
    const { pageContent, pageHash } = await processCommandArguments(userInput, attachments);
    const cleanedUserInput = replaceCommandPlaceholders(userInput);
    const systemInstructions = request.systemInstructions || laiOptions?.systemInstructions || '';
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - About to call buildOptimisedContext, backgroundMemory is:`, typeof backgroundMemory);

    const optimisedMessages = await backgroundMemory.buildOptimisedContext(
        activeSession?.id,
        cleanedUserInput,
        turnNumber,
        systemInstructions,
        pageContent,
        attachments,
        pageHash,
        toolsEnabled
    );

    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Turn ${turnNumber}: Built context with ${optimisedMessages.length} messages`);

    const sessionContext = await backgroundMemory.getContext(activeSession.id);
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - sessionContext:`, sessionContext);

    if (sessionContext?.images?.length > 0) {
        // Extract base64 strings directly from the context images
        const base64Images = sessionContext.images
            .map(img => img.base64)
            .filter(b64 => b64); // Filter out any undefined/null values

        if (base64Images.length > 0) {
            // Add images to the first user message (Ollama format)
            const firstUserMessage = optimisedMessages.find(msg => msg.role === 'user');
            if (firstUserMessage) {
                firstUserMessage.images = base64Images;
                console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Added ${base64Images.length} image(s).`);
            } else {
                console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - No user message found to attach images to!`);
            }
        }
    }

    request.data.messages = optimisedMessages;
    activeSession.turnNumber = turnNumber;
    activeSession.messages = structuredClone(request.data.messages);
    await setActiveSession(activeSession);
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - updated request`, request.data);

    if (promptTools.length > 0 && await modelCanUseTools(model, sender?.tab)) {
        request.data["tools"] = promptTools;
        request.data["tool_choice"] = "auto"
    } else {
        await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - tools are disabled in the settings or not supported by the model. Skipping them.`, laiOptions, 'debug', sender?.tab?.id)
        console.debug(`>>> [${getLineNumber()}] - tools are disabled in the settings or not supported by the model. Skipping them.`, laiOptions)
    }

    await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - request.data.messages: ${request.data.messages.length}`, request.data.messages, 'log', sender?.tab?.id);
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - request.data`, request.data);

    var response;
    var body;
    var responseText;
    var responseMessage;
    var reqOpt = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
    };
    try {
        while(true) {
            reqOpt.body = JSON.stringify(request.data);
            response = await fetch(url, reqOpt);
            responseText = await response.clone().text();
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - response received.`, responseText);
            body = await response.json();
            responseMessage = body?.message;
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - response as JSON`, body);
            request.data.messages.push(responseMessage);
            await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - response received.`, { "responseText": responseText, "body": body }, 'log', sender?.tab?.id);
            if (response.status > 299) { throw new Error(`${response.status}: ${response.statusText} - ${body?.error || 'No response error provided...'}`); }

            const requestedTools = body?.message?.tool_calls ?? [];
            if(requestedTools.length < 1){  break;  }

            let sessionUpdatedWithTools = false;

            for (let i = 0, l = requestedTools.length; i < l; i++) {
                const tool = requestedTools[i];
                const toolNamesUsed = tool?.function?.name ?? "";
                console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - requested tools`, toolNamesUsed);

                const toolData = await resolveToolCalls(tool, laiOptions.toolFunc, sender?.tab, activeSession?.id);
                const newMessages = { role: 'tool', tool_name: toolNamesUsed, content: toolData }
                console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - resolved tool call`, newMessages);
                request.data.messages.push(newMessages);
                activeSession.messages.push(newMessages);
                sessionUpdatedWithTools = true;
            }

            if (sessionUpdatedWithTools) {
                await setActiveSession(activeSession);
                // delete request.data.tools;
            }
        };

        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - response after tools as JSON`, body);
        await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - final response received.`, { "responseText": responseText, "body": body }, 'log', sender?.tab?.id);

        await updateUIStatusBar(`Final response received...`, sender?.tab);
        await checkResponseTextAndBody({sender, responseText, body});

        activeSession.messages.push(responseMessage);
        activeSession.attachments = [];
        await setActiveSession(activeSession);

        const assistantResponse = responseMessage?.content || '';

        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - About to store turn: sessionId=${activeSession.id}, turn=${turnNumber}, userInputLength=${userInput?.length}, responseLength=${assistantResponse?.length}`);
        try {
            await backgroundMemory.storeTurn(
                activeSession.id,
                turnNumber,
                userInput,
                assistantResponse
            );
        } catch (memoryError) {
            console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to store turn in memory:`, memoryError);
        }

        await handleResponse(body, sender?.tab?.id);
    }
    catch (e) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - error`, e, response, request?.data, responseText);
        if (e.name === 'AbortError') {
            try {
                await chrome.tabs.sendMessage(sender?.tab?.id, { action: "streamAbort" });
                if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
            } catch (e1) {
                console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${e1.message}`, e1);
            }
        } else {
            try {
                await chrome.tabs.sendMessage(sender?.tab?.id, { action: "streamError", error: e.toString() });
                if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
                await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error: ${e.message}`, e, 'error', sender?.tab?.id);

            } catch (e2) {
                console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${e2.message}`, e2);
            }

            return { "status": "error", "message": e.message };
        }
    }
    finally {
        try {
            await chrome.tabs.sendMessage(sender?.tab?.id, { action: "userPrompt", data: JSON.stringify(request.data) });
            if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        } catch (e3) {
            console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${e3.message}`, e3);
        }
    }

    return { "status": "success", "message": "Request sent. Awaiting response." };
}

async function checkResponseTextAndBody(params){
    const {sender, responseText, body} = params;
    if(body?.message?.tool_calls){
        await updateUIStatusBar(`Response tool call received...`, sender?.tab);
        await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - response tool call received`, null, 'log', sender?.tab?.id);
        return;
    }

    if(body?.message?.content && body?.message?.content?.trim()?.length > 0){
        await updateUIStatusBar(`Response content received...`, sender?.tab);
        await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - response content received`, null, 'log', sender?.tab?.id);
        return;
    }

    const o = {"message": `>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Empty response received. Full body:`,
        "hasMessage": !!body?.message,
        "hasContent": !!body?.message?.content,
        "hasToolCalls": !!body?.message?.tool_calls,
        "messageRole": body?.message?.role,
        "rawBody": body,
        "responseText": responseText
    };
    await dumpInFrontConsole(o.message, o, 'log', sender?.tab?.id);
    console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${o.message}`, o);
    throw new Error(o.message);
}

async function fetchExtResponse(url, options, resentWithoutTools = true, tab) {
    if (!url || !options.method) { throw new Error('Either URL or request options are empty or missing!'); }
    let requestBody;
    try {
        const response = await fetch(url, options);
        if (response.status < 300 || !resentWithoutTools) { return response; }

        const body = await response.clone().json();
        const toolsUnsupported = (body?.error || '').toLowerCase().includes("does not support tools");
        if (toolsUnsupported && options.body) {
            requestBody = JSON.parse(options.body);
            await updateUIStatusBar(`${requestBody.model || 'This model'} does not support tools. It will try without them.`, tab);
            delete requestBody.tools;
            delete requestBody.tool_choice;
            requestBody.messages.push({ role: "tool", content: "Briefly inform the user that you do not support tool usage or web searches. Provide the best answer based solely on your existing knowledge." })
            options.body = JSON.stringify(requestBody);
            return fetchExtResponse(url, options, false, tab);
        }

        return response;
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - External call to ${url} failed!`, error, options);
        throw error;
    }
}

async function convertFileToText(fileAsB64) {
    const laiOptions = await getLaiOptions();

    if (!fileAsB64) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Invalid file provided`);
        return '';
    }

    let urlStr = laiOptions.tika?.trim();
    let url = URL.canParse(urlStr) ? URL.parse(urlStr) : null;
    if (!url) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Missing file conversion endpoint`, laiOptions);
        await showUIMessage('Missing document converter endpoint!', 'error');
        return '';
    }

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
            console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error: Network response was not ok (${response.status}: ${response.statusText})`);
            return '';
        }
        const res = typeof response === 'string' ? response : (typeof response.text === 'function' ? await response.text() : '');
        return res;
    } catch (e) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error fetching text from file: ${e.message}`, e, fileAsB64);
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
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${e.message}`, e);
    }
}

async function showUIMessage(message, type = '', tab) {
    if (!tab) { tab = await getCurrentTab(); }
    if (!/^http/i.test(tab?.url)) { return; }
    try {
        await chrome.tabs.sendMessage(tab?.id, { "action": "showMessage", message: message, messageType: type });
        if (chrome.runtime.lastError) { throw new Error(`[${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
    } catch (err) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${err.message}`, err);
    }
}

async function updateUIStatusBar(message, tab) {
    if (!tab) { tab = await getCurrentTab(); }
    if (!/^http/i.test(tab?.url)) {
        console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - The action is not possible in this tab`, tab);
        return;
    }
    try {
        await chrome.tabs.sendMessage(tab?.id, { "action": "updateStatusbar", message: message });
        if (chrome.runtime.lastError) { throw new Error(`[${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${error.message}`, error);
    }
}

async function dumpInFrontConsole(message, obj, type = 'log', tabId) {
    try {
        if (!tabId) {
            const tab = await getCurrentTab();
            if (!/^http/i.test(tab?.url)) {
                console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - The action is not possible in this tab`, tab);
                return;
            }
            tabId = tab?.id;
            if (!tabId) {
                console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to get tabId`, tab);
                return;
            }
        }
        await chrome.tabs.sendMessage(tabId, { "action": "dumpInConsole", message: message, obj: JSON.stringify(obj ?? {}), type: type });
        if (chrome.runtime.lastError) { throw new Error(`[${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${error.message}`, error);
    }
}

async function getCurrentTab() {
    let queryOptions = { active: true, lastFocusedWindow: true };
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
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${e.message}`, e);
        return { "status": "error", "message": e.message };
    }
}

function tryReloadExtension() {
    try {
        console.log(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - trying to reload`);
        chrome.runtime.reload();
    } catch (err) {
        if (chrome.runtime.lastError) { console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error:`, chrome.runtime.lastError); }
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${err.message}`, err);
    }
}

async function storeImageHandler(base64, filename, mimeType) {
    let session = await sessionRepository.getActiveSession();
    if (!session || !session.id) {
        session = await createNewSession('New session');
    }

    const imageId = crypto.randomUUID();
    const imageData = {
        id: imageId,
        base64: base64,
        thumbnail: null,
        filename: filename,
        mimeType: mimeType || 'image/jpeg',
        addedAt: Date.now()
    };

    await sessionRepository.storeImage(session.id, imageData);

    return { status: 'success', imageId };
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
        await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${err.message}`, err, "error", tab?.id);
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${err.message}`, err);
    }

    await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${modelName} ${remove ? 'un' : ''}loaded successfully.`, response, "log", tab?.id);
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - response`, response);
    return response;
}

/////////// other helpers ///////////

async function getModelInfo(modelName) {
    if (!modelName) { modelName = await getAiModel(); }
    let url = await getAiUrl();
    url = new URL(url);
    url = `${url.protocol}//${url.host}/api/show`;

    const data = { "model": modelName };
    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return await res.json();
    } catch (err) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${err.message}`, err, res);
        return { model: modelName, error: err.message };
    }
}

async function modelCanUseTools(modelName, tab) {
    if (!modelName) { return false; }
    let modelData;

    try {
        modelData = await getModelInfo(modelName);
        if (modelData?.error) { throw new Error(`${manifest?.name ?? ''} - [${getLineNumber()}] - ${modelData?.error ?? "Error!"}`); }
        const canUseTools = (modelData?.capabilities || [])?.some(el => el?.toLowerCase() === 'tools');
        await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - The model ${modelName} ${canUseTools ? '' : 'does not '}support tools.`, null, 'log', tab?.id);
        await updateUIStatusBar(`${modelName} ${canUseTools ? '' : 'does not '}support tools.`, tab);
        return canUseTools;
    } catch (err) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${err.message}`, err, modelData);
        return false;
    }
}

function getLineNumber() {
    const e = new Error();
    const stackLines = e.stack.split("\n").map(line => line.trim());
    let index = stackLines.findIndex(line => line.includes(getLineNumber.name));

    return stackLines[index + 1]
        ?.replace(/\s{0,}at\s+/, '')
        ?.replace(/^.*?\/([^\/]+\/[^\/]+:\d+:\d+)$/, '$1')
        ?.split('/')?.pop().replace(/\)$/, '')
        || "Unknown";
}

async function getAiUrl() {
    const laiOptions = await getLaiOptions();
    if (!laiOptions?.aiUrl) {
        let msg = 'Missing API endpoint!';
        await showUIMessage(`${msg} - ${laiOptions?.aiUrl || 'missing aiUrl'}`, 'error');
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${msg}`, laiOptions);
        return null;
    }

    let url = laiOptions?.aiUrl;
    if (!url) {
        let msg = `Faild to compose the request URL - ${url}`;
        await showUIMessage(msg, 'error', sender.tab);
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${msg};  request.url: ${request?.url};  laiOptions.aiUrl: ${laiOptions?.aiUrl}`);
        return null;
    }

    return url;
}

async function getAiModel() {
    const laiOptions = await getOptions();
    return laiOptions?.aiModel;
}

async function getGenerativeModel() {
    const laiOptions = await getOptions();
    return laiOptions?.generativeHelper || laiOptions?.aiModel;
}

async function generateAndUpdateSessionTitle(text, tab) {
    const titleSeed = await generateSessionTitle(text, tab);
    if (!titleSeed) { return; }
    const activeSession = await getActiveSession();
    let oldTitle = activeSession?.title?.replace(/session/ig, '');
    activeSession["title"] = `${titleSeed}${oldTitle}`;
    await setActiveSession(activeSession);
}

async function generateSessionTitle(text, tab) {
    if (!text || text === '') { return null; }
    let url = await getAiUrl();
    let model = await getGenerativeModel();
    if (!model) { return; }
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${model} model will be used for generating the Session title`);
    await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${model} model will be used for generating the Session title`, null, 'debug', tab?.id);

    url = new URL(url);
    url = `${url.protocol}//${url.host}/api/generate`;
    let jsonPrompt = {
        "model": model,
        "stream": false,
        "raw": true,
        "options": {
            "temperature": 0,
            "top_p": 0,
            "repeat_penalty": 1.2,
            "presence_penalty": 0.0,
            "max_tokens": 5
        },
        "prompt": `Describe in max 5 short words the text below. Ouput only those 5 words - **nothing else**.

Text_to_describe:
“{{${text}}}”
`
    };

    if (await modelCanThink(model, url)) { jsonPrompt["think"] = false; }

    try {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - prompt`, {url, jsonPrompt});
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(jsonPrompt)
        });
        const data = await res.json();
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - response`, data);
        await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - response`, data, 'debug', tab?.id);
        let title = data?.response?.split('\n')?.map(x => x?.trim())?.filter(Boolean)?.slice(-1)?.[0]?.trim() ?? null;
        if(!title)  {  return;  }
        title = title?.replace(/^\n?title:\s{1,}/i, '');
        title = title?.replace(/[^a-z0-9\s]/gi, '')
            ?.trim()
            ?.split(/\s+/)
            ?.slice(0, 5)
            ?.join(' ');
        return title;
    } catch (err) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${err.message}`, err);
        return null;
    }
}

async function modelCanThink(modelName = '', url = '') {
    if (!modelName) { return false; }

    url = new URL(url);
    url = `${url.protocol}//${url.host}/api/show`;

    const data = { "model": modelName };
    let modelData;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        modelData = await res.json();
        const canThink = (modelData?.capabilities || [])?.some(el => el?.toLowerCase() === 'thinking');
        return canThink;
    } catch (err) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${err.message}`, err);
        return false;
    }
}

async function getPromptTools() {
    try {
        const commands = await chrome.storage.local.get([storageToolsKey]);
        const externalTools = commands[storageToolsKey] || [];

        return [...INTERNAL_TOOL_DEFINITIONS, ...externalTools];
    } catch (err) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${err.message}`, err);
        return [];
    }
}
