
const backgroundRuntimeUrl = chrome.runtime?.getURL?.('') || '';
const shouldImportBackgroundScripts = typeof importScripts === 'function' && backgroundRuntimeUrl.startsWith('chrome-extension://');

function importBackgroundScript(path) {
    if (!shouldImportBackgroundScripts) { return; }

    try {
        importScripts(path);
    } catch (e) {
        console.error(`>>> Failed to load ${path}:`, e);
    }
}

importBackgroundScript('jslib/constants.js');
importBackgroundScript('jslib/utils.js');
importBackgroundScript('jslib/model-catalogue.js');

const controllers = new Map(); // Map to manage AbortControllers per tab for concurrent fetchDataAction calls

importBackgroundScript('jslib/log.js');
importBackgroundScript('background-memory.js');
importBackgroundScript('jslib/sessions.js');
importBackgroundScript('jslib/session-repository.js');
importBackgroundScript('jslib/internal-tools.js');
importBackgroundScript('jslib/search-engines.js');
importBackgroundScript('jslib/web-search.js');

init();
clearLegacyPageContentStorage();

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

chrome.tabs.onRemoved.addListener(async (tabId) => {
    await removeActiveSessionPageData(tabId);

    const allTabs = await chrome.tabs.query({});
    const openTabIds = new Set(allTabs.map(tab => tab.id));

    const allKeys = await chrome.storage.local.get(null);
    const pageDataKeys = Object.keys(allKeys).filter(key =>
        key.startsWith(`${activePageStorageKey}:`)
    );

    const orphanedKeys = pageDataKeys.filter(key => {
        const keyTabId = parseInt(key.split(':')[1], 10);
        return !openTabIds.has(keyTabId);
    });

    if (orphanedKeys.length > 0) {
        await chrome.storage.local.remove(orphanedKeys);
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Cleaned up ${orphanedKeys.length} orphaned page data keys`);
    }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Tab ${activeInfo.tabId} activated`);
});

async function handleRuntimeMessage(request, sender) {
    let response;
    const tabId = sender?.tab?.id;

    if (request.action === 'fetchData' && tabId != null) {
        controllers.delete(tabId);
    }

    switch (request.action) {
        case 'getTabId':
            return { tabId: sender?.tab?.id };

        case 'getModels':
            return await getModels(request?.forceRefresh || false);

        case 'fetchData':
            return await fetchDataAction(request, sender);

        case 'abortFetch':
            if (tabId != null) {
                const ctrl = controllers.get(tabId);
                if (ctrl) {
                    ctrl.abort('User aborted last request.');
                    controllers.delete(tabId);
                }
            }
            return;

        case 'extractText':
            return await convertFileToText(request.fileContent);

        case "openModifiersHelpMenu":
            chrome.tabs.create({ url: modifiersHelpUrl });
            return;

        case "openMainHelpMenu":
            chrome.tabs.create({ url: mainHelpPageUrl });
            return;

        case "openOptionsPage":
            chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
            return;

        case "modelCanThink":
            response = await modelCanThink(request?.model);
            return { canThink: response };

        case "modelCanUseTools":
            response = await modelCanUseTools(request?.model, sender?.tab);
            return { canUseTools: response };

        case "modelInfo":
            return await getModelInfo(request?.model);

        case "getModelInfo":
            return await getModelInfo(request?.modelName, request?.forceRefresh);

        case "prepareModels":
            response = await prepareModels(request.modelName, request.unload, sender?.tab);
            return { status: response?.status ?? 500, text: response?.statusText ?? 'Unknown error' };

        case "storeImage":
            return await storeImageHandler(request.base64, request.filename, request.mimeType);

        case "deleteSessionMemory":
            await backgroundMemory.deleteSession(request.sessionId);
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Deleted session ${request.sessionId} from memory`);
            return { status: 'success' };

        case "clearAllMemory":
            await backgroundMemory.clearAll();
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Cleared all memory from IndexedDB`);
            return { status: 'success' };

        default:
            console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Unrecognized action:`, request?.action);
            return;
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const runtimeUrl = chrome.runtime.getURL('');
    const isFirefoxRuntime = runtimeUrl.startsWith('moz-extension://');

    if (isFirefoxRuntime) {
        return handleRuntimeMessage(request, sender).catch(async error => {
            console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error handling message:`, error);
            await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error: ${error.message}`, error, "error", sender?.tab?.id);
            return { status: 'error', message: error.toString() };
        });
    }

    handleRuntimeMessage(request, sender)
        .then(response => {
            sendResponse(response);
        })
        .catch(async error => {
            console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error handling message:`, error);
            await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error: ${error.message}`, error, "error", sender?.tab?.id);
            sendResponse({ status: 'error', message: error.toString() });
        });

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

        await cleanupOrphanedSessions();
        await refreshModelCatalogueCache();
        await validateModelInfoCache();
    } catch (e) {
        console.error(`>>> ${manifest?.name ?? ''} - Failed to initialise memory system:`, e);
    }

    await composeContextMenu();
}

async function composeContextMenu() {
    await chrome.contextMenus.removeAll();

    await chrome.contextMenus.create({
        id: "sendToLocalAi",
        title: "Local AI",
        contexts: ["all"]
    });

    await chrome.contextMenus.create({
        id: "selectAndSendElement",
        title: "Select And Attach Element",
        parentId: "sendToLocalAi",
        contexts: ["all"]
    });

    await chrome.contextMenus.create({
        id: "askAiExplanation",
        title: "Ask AI to Explain Selected",
        parentId: "sendToLocalAi",
        contexts: ["selection"]
    });

    await chrome.contextMenus.create({
        id: "sendSelectedText",
        title: "Attach Selected",
        parentId: "sendToLocalAi",
        contexts: ["selection"]
    });

    await chrome.contextMenus.create({
        id: "inserSelectedInPrompt",
        title: "Insert Selected into Prompt",
        parentId: "sendToLocalAi",
        contexts: ["selection"]
    });

    await chrome.contextMenus.create({
        id: "sendPageContent",
        title: "Attach Entire Page",
        parentId: "sendToLocalAi",
        contexts: ["all"]
    });

    await chrome.contextMenus.create({
        id: "separatorBeforeOptions",
        type: "separator",
        parentId: "sendToLocalAi",
        contexts: ["all"]
    });

    await chrome.contextMenus.create({
        id: "openOptions",
        title: "Options",
        parentId: "sendToLocalAi",
        contexts: ["all"]
    });
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

function getAssistantMessageText(message = {}) {
    if (typeof message?.thinking === 'string' && message.thinking.trim().length > 0) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - assistant thinking received`, message.thinking);
    }

    if (typeof message?.content === 'string' && message.content.trim().length > 0) {
        return message.content;
    }

    if (typeof message?.thinking === 'string' && message.thinking.trim().length > 0) {
        return message.thinking;
    }

    return '';
}

function sanitizeAssistantMessageForHistory(message = {}) {
    const sanitizedMessage = structuredClone(message);
    delete sanitizedMessage.thinking;

    return isMessagePersistable(sanitizedMessage) ? sanitizedMessage : null;
}

function normaliseStreamLine(rawLine = '') {
    let line = `${rawLine || ''}`.trim();
    if (!line) { return ''; }

    line = line.replace(/^data:\s+/i, '').trim();
    if (/^\[DONE\]$/i.test(line)) { return ''; }

    return line;
}

function mergeStreamChunkBody(body = {}, chunk = {}) {
    const mergedBody = body && typeof body === 'object' ? body : {};
    if (!mergedBody.message || typeof mergedBody.message !== 'object') {
        mergedBody.message = { role: 'assistant', content: '', thinking: '' };
    }

    mergedBody.model = chunk?.model || mergedBody.model || '';
    mergedBody.created_at = chunk?.created_at || mergedBody.created_at;
    mergedBody.done = chunk?.done ?? mergedBody.done ?? false;
    mergedBody.done_reason = chunk?.done_reason || mergedBody.done_reason || '';
    mergedBody.total_duration = chunk?.total_duration ?? mergedBody.total_duration;
    mergedBody.load_duration = chunk?.load_duration ?? mergedBody.load_duration;
    mergedBody.prompt_eval_count = chunk?.prompt_eval_count ?? mergedBody.prompt_eval_count;
    mergedBody.prompt_eval_duration = chunk?.prompt_eval_duration ?? mergedBody.prompt_eval_duration;
    mergedBody.eval_count = chunk?.eval_count ?? mergedBody.eval_count;
    mergedBody.eval_duration = chunk?.eval_duration ?? mergedBody.eval_duration;

    const chunkMessage = chunk?.message || {};
    mergedBody.message.role = chunkMessage?.role || mergedBody.message.role || 'assistant';
    mergedBody.message.content = `${mergedBody.message.content || ''}${typeof chunkMessage?.content === 'string' ? chunkMessage.content : ''}`;
    mergedBody.message.thinking = `${mergedBody.message.thinking || ''}${typeof chunkMessage?.thinking === 'string' ? chunkMessage.thinking : ''}`;
    if (Array.isArray(chunkMessage?.tool_calls) && chunkMessage.tool_calls.length > 0) {
        mergedBody.message.tool_calls = chunkMessage.tool_calls;
    }

    return mergedBody;
}

function getStreamChunkUiPayload(chunk = {}, rawChunk = '') {
    const chunkMessage = chunk?.message || {};

    return {
        model: chunk?.model || '',
        contentDelta: typeof chunkMessage?.content === 'string' ? chunkMessage.content : '',
        thinkingDelta: typeof chunkMessage?.thinking === 'string' ? chunkMessage.thinking : '',
        rawChunk
    };
}

async function sendStreamChunkToUi(senderTabId, payload = {}, debugEnabled = false) {
    if (!senderTabId) { return; }

    const hasVisibleDelta = !!((payload?.contentDelta || '') || (payload?.thinkingDelta || ''));
    if (!hasVisibleDelta && !debugEnabled) { return; }

    await chrome.tabs.sendMessage(senderTabId, {
        action: "streamData",
        model: payload?.model || '',
        contentDelta: payload?.contentDelta || '',
        thinkingDelta: payload?.thinkingDelta || '',
        rawChunk: debugEnabled ? (payload?.rawChunk || '') : ''
    });
    if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
}

async function consumeStreamResponse(response, senderTabId, debugEnabled = false) {
    if (!response?.body || typeof response.body.getReader !== 'function') {
        const responseText = await response.clone().text();
        return {
            responseText,
            body: await response.json()
        };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let responseText = '';
    let body = {};

    while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (let index = 0; index < lines.length; index++) {
            const line = normaliseStreamLine(lines[index]);
            if (!line) { continue; }

            responseText += `${line}\n`;
            const chunk = JSON.parse(line);
            body = mergeStreamChunkBody(body, chunk);
            await sendStreamChunkToUi(senderTabId, getStreamChunkUiPayload(chunk, line), debugEnabled);
        }

        if (done) { break; }
    }

    const trailingLine = normaliseStreamLine(buffer);
    if (trailingLine) {
        responseText += `${trailingLine}\n`;
        const chunk = JSON.parse(trailingLine);
        body = mergeStreamChunkBody(body, chunk);
        await sendStreamChunkToUi(senderTabId, getStreamChunkUiPayload(chunk, trailingLine), debugEnabled);
    }

    return {
        responseText: responseText.trim(),
        body
    };
}

function parsePositiveInteger(value) {
    const parsedValue = Number(value);
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
        return null;
    }

    return Math.floor(parsedValue);
}

async function getAutomaticContextWindow(modelName = '') {
    if (!modelName) { return null; }

    try {
        const modelData = await getModelInfo(modelName);
        if (modelData?.error) { return null; }
        if ((modelData?.source || '').toLowerCase() === 'cloud') { return null; }

        return parsePositiveInteger(modelData?.contextWindow);
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to resolve automatic context window`, error);
        return null;
    }
}

async function applyAutomaticModelOptions(requestData = {}, modelName = '') {
    if (!requestData || typeof requestData !== 'object') { return requestData; }

    const currentOptions = (requestData?.options && typeof requestData.options === 'object')
        ? requestData.options
        : {};
    const explicitNumCtx = parsePositiveInteger(currentOptions?.num_ctx);
    if (explicitNumCtx) {
        currentOptions.num_ctx = explicitNumCtx;
        requestData.options = currentOptions;
        return requestData;
    }

    const automaticNumCtx = await getAutomaticContextWindow(modelName);
    if (!automaticNumCtx) {
        if (Object.keys(currentOptions).length > 0) {
            requestData.options = currentOptions;
        } else {
            delete requestData.options;
        }
        return requestData;
    }

    currentOptions.num_ctx = automaticNumCtx;
    requestData.options = currentOptions;
    return requestData;
}

async function handleResponse(responseData = '', senderTabId) {
    try {
        if (!responseData) {
            await chrome.tabs.sendMessage(senderTabId, { action: "streamEnd" });
            if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
            return;
        }

        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - response (type: ${typeof (responseData)})`, responseData);
        await chrome.tabs.sendMessage(senderTabId, {
            action: "streamEnd",
            response: JSON.stringify(responseData)
        });
        if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${error.message}`, error);
        await showUIMessage(error.message, 'error');
    }

    return;
}

async function handleStreamEnd(responseData = '', senderTabId, rawResponse = '', debugEnabled = false) {
    try {
        await chrome.tabs.sendMessage(senderTabId, {
            action: "streamEnd",
            response: JSON.stringify(responseData),
            rawResponse: debugEnabled ? rawResponse : ''
        });
        if (chrome.runtime.lastError) { throw new Error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${error.message}`, error);
        await showUIMessage(error.message, 'error');
    }
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
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - resolveToolCalls tab:`, tab, 'tab?.id:', tab?.id);
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
                let validatedTabId = tab?.id;
                if (!validatedTabId) {
                    validatedTabId = await validateAndGetTabId(null);
                    if (!validatedTabId) {
                        console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - No valid tab for internal tool execution`);
                    }
                }
                data = await execInternalTool(toolCall, validatedTabId);
                break;
            case 'function':
                res = await fetchExtResponse(funcUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(toolCall.function.arguments),
                }, true, tab);
                data = await res?.json();
                console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${funcType} ${toolCall.function.name} response`, data);
                await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${funcType} ${toolCall.function.name} response`, data, 'debug', tab?.id);
                if (res?.status !== 200 || data?.status === 'error') {
                    data = `"${toolCall?.function?.name}" call returned error: ${data.message}\n\nIMPORTANT: Only use functions from the provided tools list. Do not invent or assume function names.\nSelect and call another function from the list.\nContinue until a valid response is received or no options remain.`;
                    return data;
                }
                break;
            default:
                console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Invalid tool type:`, {
                    toolCallFunctionType: toolCall?.function?.type,
                    toolCallFunctionName: toolCall?.function?.name,
                    funcType,
                    toolCall,
                    availableTypes: ['tool', 'function']
                });
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

        await updateUIStatusBar(`Error occurred while calling ${toolCall.function.name}...`, tab);
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - error calling ${toolCall.function.name}`, err, toolCall, res);
        if (err.name === 'TypeError' && err.message.includes('fetch')) {
            await showUIMessage(`External tools endpoint (${funcUrl}) seems missing to be down!`, "error");
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

async function processCommandPlaceholders(userInputValue, existingAttachments = [], tabId) {
    if (!tabId) {
        const hasPageCommand = /@\{\{page\}\}/.test(userInputValue);
        if (hasPageCommand) {
            console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Page command requires valid tabId, attempting to get active tab`);
            tabId = await validateAndGetTabId(null);
        }
    }

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
            case 'page': {
                const freshContent = await callContentScriptExtractor(tabId, 'getEnhancedPageContent', null);
                if (!freshContent || freshContent.startsWith('Error')) {
                    console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to extract page content for @{{page}}`, freshContent);
                } else {
                    const tab = await chrome.tabs.get(tabId).catch(() => null);
                    const freshHash = await generatePageHash(tab?.url || '', freshContent);
                    attachment = {
                        cmd: 'page',
                        type: "snippet",
                        content: freshContent,
                        sourceUrl: tab?.url || 'unknown',
                        pageHash: freshHash
                    };
                }
                console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Command @{{${cmdText}}} received. Attachment created`, attachment);
                break;
            }
            case 'now':
                attachment = {
                    cmd: 'now',
                    type: "snippet",
                    content: `current date and time or timestamp is: ${(new Date()).toISOString()}`,
                    sourceUrl: 'system'
                };
                console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Command @{{${cmdText}}} received. Attachment created`, attachment);
                break;
            case "today":
                attachment = {
                    cmd: 'today',
                    type: "snippet",
                    content: `current date is: ${(new Date()).toISOString().split('T')[0]}`,
                    sourceUrl: 'system'
                };
                console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Command @{{${cmdText}}} received. Attachment created`, attachment);
                break;
            case "time":
                attachment = {
                    cmd: 'time',
                    type: "snippet",
                    content: `current time is: ${(new Date()).toISOString().split('T')[1]}`,
                    sourceUrl: 'system'
                };
                console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Command @{{${cmdText}}} received. Attachment created`, attachment);
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

async function processCommandArguments(userInput, attachments, tabId) {
    let pageContent = null;
    let pageHash = null;
    const commandAttachments = await processCommandPlaceholders(userInput, attachments, tabId);
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
        let msg = `Failed to compose the request URL - ${url}`;
        await showUIMessage(msg, 'error', sender.tab);
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${msg};  request.url: ${request?.url};  laiOptions.aiUrl: ${laiOptions?.aiUrl}`);
        return { "status": "error", "message": msg };
    }

    let tabId = sender?.tab?.id;
    if (!tabId) {
        tabId = await validateAndGetTabId(null);
        if (!tabId) {
            console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - No valid tab context available`);
        }
    }

    const controller = new AbortController();
    if (tabId != null) { controllers.set(tabId, controller); }

    let model = await getAiModel()
    if (model) { request.data['model'] = model; }
    await applyAutomaticModelOptions(request.data, model);

    request.data["stream"] = true;
    request["format"] = "json";

    const userInput = request?.data?.userInput || "";
    delete request.data.userInput;
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - userInput:`, userInput);

    let activeSession = await getActiveSession();
    const userAssistantMessages = (activeSession?.messages || []).filter(m => m.role === 'user' || m.role === 'assistant');
    const turnNumber = Math.floor(userAssistantMessages.length / 2) + 1;
    let attachments = [...(activeSession?.attachments || [])];
    const { pageContent, pageHash } = await processCommandArguments(userInput, attachments, tabId);
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
        toolsEnabled,
        tabId
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
            if (request.data.stream && response.ok) {
                const streamedResponse = await consumeStreamResponse(response, sender?.tab?.id, laiOptions?.debug ?? false);
                responseText = streamedResponse.responseText;
                body = streamedResponse.body;
            } else {
                responseText = await response.clone().text();
                body = await response.json();
            }
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - response received.`, responseText);
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

                try {
                    await backgroundMemory.storeToolCallEmbedding(
                        activeSession.id,
                        sender?.tab?.id,
                        turnNumber,
                        toolNamesUsed,
                        toolData
                    );
                } catch (embeddingError) {
                    console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to store tool call embedding:`, embeddingError);
                }
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

        const historyMessage = sanitizeAssistantMessageForHistory(responseMessage);
        if (historyMessage) {
            activeSession.messages.push(historyMessage);
        }
        delete activeSession.attachments;
        await setActiveSession(activeSession);

        const assistantResponse = responseMessage?.content || '';

        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - About to store turn: sessionId=${activeSession.id}, turn=${turnNumber}, userInputLength=${userInput?.length}, responseLength=${assistantResponse?.length}`);
        try {
            await backgroundMemory.storeTurnWithEmbeddings(
                activeSession.id,
                sender?.tab?.id,
                turnNumber,
                userInput,
                assistantResponse
            );
        } catch (memoryError) {
            console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to store turn in memory:`, memoryError);
        }

        if (turnNumber === 1 && !activeSession?.titleGenerated) {
            const titleWasGenerated = await generateAndUpdateSessionTitle(cleanedUserInput, sender.tab);
            if (titleWasGenerated) {
                activeSession = await getActiveSession();
                activeSession.titleGenerated = true;
                await setActiveSession(activeSession);
            }
        }

        console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] -  - response body message`, body?.message);
        await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - response body message`, body?.message, 'info', sender?.tab?.id);
        // Only send response to frontend if it has content or tool calls
        // Thinking-only responses are logged in worker console but not displayed
        // const hasContent = typeof body?.message?.content === 'string' && body.message.content.trim().length > 0;
        // const hasToolCalls = Array.isArray(body?.message?.tool_calls) && body.message.tool_calls.length > 0;
        // const hasThinkingOnly = typeof body?.message?.thinking === 'string' && body.message.thinking.trim().length > 0 && !hasContent && !hasToolCalls;

        // if (hasThinkingOnly) {
        //     await updateUIStatusBar(`Thinking completed, awaiting response...`, sender?.tab);
        //     await chrome.tabs.sendMessage(sender?.tab?.id, { action: "streamEnd" });
        // } else {
            if (request.data.stream) {
                await handleStreamEnd(body, sender?.tab?.id, responseText, laiOptions?.debug ?? false);
            } else {
                await handleResponse(body, sender?.tab?.id);
            }
        // }
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
        if (tabId != null) {  controllers.delete(tabId);  }
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

    const assistantMessageText = getAssistantMessageText(body?.message);
    if(assistantMessageText.length > 0){
        const responseType = body?.message?.content?.trim()?.length > 0 ? 'content' : 'thinking';
        await updateUIStatusBar(`Response ${responseType} received...`, sender?.tab);
        await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - response ${responseType} received`, null, 'log', sender?.tab?.id);
        return;
    }

    const o = {"message": `>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Empty response received. Full body:`,
        "hasMessage": !!body?.message,
        "hasContent": !!body?.message?.content,
        "hasThinking": !!body?.message?.thinking,
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
    if (!url || !options.method) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Invalid fetchExtResponse parameters:`, {
            url,
            optionsMethod: options?.method,
            options,
            resentWithoutTools,
            tabId: tab?.id
        });
        throw new Error('Either URL or request options are empty or missing!');
    }
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
    let url = null;
    if(urlStr && URL.canParse(urlStr)) {  url = URL.parse(urlStr);  }
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
        "embedUrl": "",
        "embeddingModel": "",
        "closeOnClickOut": true,
        "closeOnCopy": false,
        "closeOnSendTo": true,
        "showEmbeddedButton": false,
        "loadHistoryOnStart": false,
        "systemInstructions": 'You are a helpful assistant.',
        "personalInfo": '',
        "debug": false
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

async function getModels(forceRefresh = false) {
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

    try {
        const catalogue = await getModelCatalogue(urlVal, forceRefresh);
        return {
            "status": "success",
            "models": catalogue?.models || [],
            "groups": catalogue?.groups || { local: [], cloud: [] }
        };
    } catch (e) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${e.message}`, e);
        return { "status": "error", "message": e.message };
    }
}

function tryReloadExtension() {
    try {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - trying to reload`);
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
        return { status: 500, statusText: err.message || 'Failed to prepare model' };
    }

    if (response) {
        await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${modelName} ${remove ? 'un' : ''}loaded successfully.`, response, "log", tab?.id);
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - response`, response);
    }
    return response;
}

/////////// other helpers ///////////

async function getModelInfo(modelName, forceRefresh = false) {
    if (!modelName) { modelName = await getAiModel(); }
    const apiUrl = await getAiUrl();
    if (!apiUrl) {
        return { model: modelName, error: 'Missing API endpoint' };
    }

    try {
        return await getModelInfoFromApi(apiUrl, modelName, forceRefresh);
    } catch (err) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${err.message}`, err);
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

async function getAiModel() {
    const laiOptions = await getOptions();
    const model = laiOptions?.aiModel;
    return model && model.trim() ? model : null;
}

async function getTitleGenerator() {
    const laiOptions = await getOptions();
    const model = laiOptions?.titleGeneratorModel;
    return model && model.trim() ? model : null;
}

async function generateAndUpdateSessionTitle(text, tab) {
    const titleSeed = await generateSessionTitle(text, tab);
    if (!titleSeed) { return false; }
    const activeSession = await getActiveSession();
    let oldTitle = activeSession?.title?.replace(/session/ig, '');
    activeSession["title"] = `${titleSeed}${oldTitle}`;
    await setActiveSession(activeSession);
    return true;
}

async function generateSessionTitle(text, tab) {
    if (!text || text === '') { return null; }
    let url = await getAiUrl();
    let model = await getTitleGenerator() ?? await getAiModel();
    if (!model) {   return null;   }
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${model} model will be used for generating the Session title`);
    await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${model} model will be used for generating the Session title`, null, 'debug', tab?.id);

    url = new URL(url);
    url = `${url.protocol}//${url.host}/api/generate`;
    let jsonPrompt = {
        "model": model,
        "stream": false,
        "raw": true,
        "options": {
            "temperature": 0.2,
            "top_p": 0.4,
            "repeat_penalty": 1.15,
            "presence_penalty": 0.0,
            "max_tokens": 6
        },
        "prompt": `Create the shortest possibe meaningful title (maximum 5 words). Remove all punctuation. Your response must be **only** the title. This limit must be strictly followed.

Text_to_describe:
“{{${text}}}”
`
    };

    if (await modelCanThink(model)) { jsonPrompt["think"] = false; }

    let res;
    let data;
    let title;
    try {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - prompt`, {url, jsonPrompt});
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(jsonPrompt)
        });
        data = await res.json();
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - response`, data);
        await dumpInFrontConsole(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - response`, data, 'debug', tab?.id);
        title = data?.response?.split('\n')?.map(x => x?.trim())?.filter(Boolean)?.slice(-1)?.[0]?.trim() ?? null;
        if(!title)  {  return null;  }
        title = title?.replace(/^\n?title:\s{1,}/i, '');
        title = title?.replace(/[^a-z0-9\s]/gi, '')
        ?.trim()
        ?.split(/\s+/)
        ?.slice(0, 5)
        ?.join(' ');
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - title: ${title}`);
        return title;
    } catch (err) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${err.message}`, {err, res, data, title});
        return null;
    }
}

async function modelCanThink(modelName = '') {
    if (!modelName) { return false; }

    try {
        const modelData = await getModelInfo(modelName);
        if (modelData?.error) {
            throw new Error(`${manifest?.name ?? ''} - [${getLineNumber()}] - ${modelData?.error ?? "Error!"}`);
        }
        const canThink = (modelData?.capabilities || [])?.some(el => el?.toLowerCase() === 'thinking');
        return canThink;
    } catch (err) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${err.message}`, err);
        return false;
    }
}

async function validateModelInfoCache() {
    try {
        const laiOptions = await getOptions();
        const currentModel = laiOptions?.aiModel;
        const aiUrl = laiOptions?.aiUrl;

        if (!currentModel || !aiUrl) {
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - No active model configured`);
            return;
        }

        const cached = await getCachedModelInfo(aiUrl, currentModel);

        if (!cached?.modelName) {
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Missing cached model info for ${currentModel}. Refreshing cache...`);
            await getModelInfo(currentModel, true);
        } else {
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Model info cache is valid for ${currentModel}`);
        }
    } catch (err) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to validate model cache:`, err);
    }
}

async function refreshModelCatalogueCache(forceRefresh = false) {
    try {
        const laiOptions = await getOptions();
        const aiUrl = laiOptions?.aiUrl;
        if (!aiUrl) { return null; }

        return await getModelCatalogue(aiUrl, forceRefresh);
    } catch (error) {
        console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to refresh model catalogue cache`, error);
        return null;
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
