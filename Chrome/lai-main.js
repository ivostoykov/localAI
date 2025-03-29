const laiWordEndings = /(?:\w+'(?:m|re|ll|s|d|ve|t))\s/;  // 'm, 're, 's, 'd, 'll, 've, 't
const laiWordFormations = /(?:'(?:clock|til|bout|cause|em))/; // 'clock, 'til, 'bout, 'cause, 'em
const manifest = chrome.runtime.getManifest();
let restartCounter = 0;
const RESTART_LIMIT = 5;

function getRootElement() {
    return document.getElementById('localAI');
}

function getShadowRoot() {
    return document.getElementById('localAI')?.shadowRoot;
}

function getSideBar() {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }

    return shadowRoot.getElementById('laiSidebar');
}

function getMainButton(){
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }

    return shadowRoot.getElementById('laiMainButton');
}

function laiInitSidebar() {
    if(!chrome.runtime.id){  chrome.runtime.reload();  }
    const root = getRootElement();
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) {
        if(restartCounter < RESTART_LIMIT){
            restartCounter++;
            console.log(`>>> ${manifest.name} - [${getLineNumber()}] - restarting: ${restartCounter}`);
            start();
        }
        return;
    }

    shadowRoot.querySelector('#feedbackMessage').addEventListener('click', e => {
        let feedbackMessage = e.target;
        if(feedbackMessage?.id !== 'feedbackMessage'){
            feedbackMessage = e.target.closest('div#feedbackMessage');
        }
        lastRegisteredErrorMessage = Array.from(e.target.children).map(el => el.textContent);
        handleErrorButton();
        feedbackMessage.replaceChildren();
        feedbackMessage.classList.remove('feedback-message-active')
    });

    shadowRoot.querySelector('#version').textContent = `${manifest.name} - ${manifest.version}`;
    const ribbon = shadowRoot.querySelector('div.lai-ribbon');
    ribbon.addEventListener('mouseenter', e => e.target.querySelector('#version')?.classList.remove('invisible'));
    ribbon.addEventListener('mouseleave', e => e.target.querySelector('#version')?.classList.add('invisible'));
    ribbon.querySelector('#errorMsgBtn')?.addEventListener('click', showLastErrorMessage);

    const tempInput = ribbon.querySelector('#tempInput');
    const temp = laiOptions?.tempIntput || "0.5";
    tempInput.value = temp;
    tempInput.title = parseFloat(temp) < 0.5 ? 'Stricter' : (temp > 0.5 ? 'More Createive' : 'Neutral');

    const userInput = shadowRoot.getElementById('laiUserInput');
    userInput.addEventListener('keydown', async e => await onPromptTextAreaKeyDown(e));
    userInput.addEventListener('click', userInputClicked);
    userInput.addEventListener('blur', e => e.target.closest('div.lai-user-area').classList.remove('focused'));

    if (root) {
        root.addEventListener('dragenter', onUserInputDragEnter);
        root.addEventListener('dragleave', onUserInputDragLeave);
        root.addEventListener('dragover', function (e) {
            e.preventDefault();
            return false;
        });
        root.addEventListener('drop', async e => await onUserInputFileDropped(e));
    }

    ribbon.querySelectorAll('img').forEach(el => laiSetImg(el));
    shadowRoot.querySelector('#cogBtn')?.addEventListener('click', function (e) {
        shadowRoot.querySelector('#cogMenu').classList.toggle('invisible');
    });

    shadowRoot.querySelector('#addUsrCmdMenu').addEventListener('click', e => {
        shadowRoot.querySelector('#cogBtn').click();
        popUserCommandEditor();
    });
    shadowRoot.querySelector('#listUsrCmdMenu').addEventListener('click', e => {
        shadowRoot.querySelector('#cogBtn').click();
        popUserCommandList(e);
    });
    shadowRoot.querySelector('#listSysCmdMenu').addEventListener('click', e => {
        shadowRoot.querySelector('#cogBtn').click();
        showHelp();
    });
    shadowRoot.querySelector('#createSessionCmdMenu').addEventListener('click', e => {
        shadowRoot.querySelector('#cogBtn').click();
        ribbon.querySelector('#newSession')?.click();
    });
    shadowRoot.querySelector('#delSessionsCmdMenu').addEventListener('click', e => {
        shadowRoot.querySelector('#cogBtn').click();
        const element = shadowRoot.getElementById('laiRecycleAll');
        if (!element) {  return; }
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        element.dispatchEvent(event);
    });

    shadowRoot.querySelector('#optionsMenu')?.addEventListener('click', function (e) {
        if (!checkExtensionState()) { return; }
        const cogMenu = shadowRoot.querySelector('#cogMenu');
        if (!cogMenu.classList.contains('invisible')) {
            cogMenu.classList.add('invisible');
        }

        try {
            updateStatusBar('Opening Option Page ...');
            chrome.runtime.sendMessage({ action: "openOptionsPage" })
                .then()
                .catch(e => {
                    console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
                })
                .finally(() => resetStatusbar());
        } catch (e) {
            if (e.message.indexOf('Extension context invalidated.') > -1) {
                showMessage(`${e.message}. Please reload the page.`, 'warning');
            }
            console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
        }
        shadowRoot.getElementById('laiUserInput')?.focus();
    });

    ribbon.querySelector('#systemIntructions').addEventListener('click', laiShowSystemInstructions);
    ribbon.querySelector('#newSession').addEventListener('click', e => createNewSession(e, shadowRoot));
    ribbon.querySelector('#sessionHistry').addEventListener('click', showSessionHistoryMenu);
    ribbon.querySelector('#apiUrlList').addEventListener('change', selectMenuChanged);
    ribbon.querySelector('#modelList').addEventListener('change', async e => await modelChanged(e) );
    // ribbon.querySelector('#modelList').addEventListener('change', selectMenuChanged);
    ribbon.querySelector('#hookList').addEventListener('change', selectMenuChanged);
    ribbon.querySelector('#laiModelName').addEventListener('mouseenter', e => {
      updateStatusBar('Click to toggle the list with available models.');
      setTimeout(resetStatusbar, 10000);
    });

    shadowRoot.getElementById('laiRecycleAll').addEventListener('click', async e => await recycleSession(e, shadowRoot));
    shadowRoot.querySelector('#closeSidebarBtn')?.addEventListener('click', e => onCloseSidebarClick(e, shadowRoot));

    shadowRoot.getElementById('laiAbort').addEventListener('click', laiAbortRequest);
    if (laiOptions && laiOptions.openPanelOnLoad) {
        laiSwapSidebarWithButton();
    }

    shadowRoot.getElementById('laiSessionHistryMenu').querySelectorAll('img').forEach(el => laiSetImg(el));

    const sysIntructInput = shadowRoot.querySelector('#laiSysIntructInput');
    sysIntructInput.value = laiOptions.systemInstructions || '';
    // sysIntructInput.addEventListener('change', e => onSystemInstructionsChange(e));

    shadowRoot.getElementById('laiPinned').querySelectorAll('img').forEach(el => {
        el.addEventListener('click', laiPushpinClicked);
    });

    const laiChatMessageList = shadowRoot.getElementById('laiChatMessageList');
    laiChatMessageList.addEventListener('click', hidePopups);
    laiChatMessageList.addEventListener('scroll', () => {
        const fromBottom = laiChatMessageList.scrollHeight - laiChatMessageList.scrollTop - laiChatMessageList.clientHeight;
        userScrolled = fromBottom > 10 ? true : false;
    });

    const resizeHandle = shadowRoot.querySelector('.lai-resize-handle');
    laiSetImg(resizeHandle.querySelector('img'));

    resizeHandle.addEventListener('mousedown', e => laiResizeContainer(e));

    if (laiOptions.loadHistoryOnStart) {
        restoreLastSession();
    }

    const modelLabel = shadowRoot.getElementById('modelNameContainer');
    if(modelLabel){
        modelLabel.addEventListener('click', async (e) => await modelLabelClicked(e));
        laiSetImg(modelLabel.querySelector('img'));
    }

    shadowRoot.querySelectorAll('img.mic').forEach(img => {
        img.closest('div.mic-container').addEventListener('click', micClicked);
        laiSetImg(img);
    });

    laiSetImg(shadowRoot.querySelector('#spinner'));

    setModelNameLabel({ "model": laiOptions.aiModel });
    buildMenuDropdowns();
};

// TODO: remove
function addSystemPrompt(){
    const shadowRoot = getShadowRoot();
    if(!shadowRoot){  return '';  }
    const value = `${shadowRoot.querySelector('#laiSysIntructInput')?.value || ''}; timestamp: ${new Date().toISOString()}`;

    const index = messages.findIndex(message => message.role === "system");

    if (index !== -1) {
        messages[index].content = value;
    } else {
        messages.unshift({ role: "system", content: value });
    }
}

function getCurrentSystemInstructions(){
    const shadowRoot = getShadowRoot();
    if(!shadowRoot){  return '';  }
    const value = `${shadowRoot.querySelector('#laiSysIntructInput')?.value || ''}; timestamp: ${new Date().toISOString()}`;

    return value || '';
}

function createNewSession(e, shadowRoot) {
    aiSessions.push([]);
    activeSessionIndex = aiSessions.length - 1;
    shadowRoot.getElementById('laiChatMessageList').replaceChildren();
    messages = [];
    shadowRoot.getElementById('laiUserInput')?.focus();
    showMessage('New session created.', 'success');
}

function onCloseSidebarClick(e, shadowRoot) {
    const pinned = shadowRoot.getElementById('laiPinned');
    const pinImg = pinned.querySelector('img[data-type="black_pushpin"]');
    const isPinned = !pinImg.classList.contains('invisible');
    if (isPinned) {
        pinImg?.click();
    }
    laiSwapSidebarWithButton(true);
}

async function recycleSession(e, shadowRoot) {
    aiSessions.splice(activeSessionIndex, 1);
    createNewSession(e, shadowRoot)
    try {
        await chrome.storage.local.remove(sessionHistoryKey);
        await chrome.storage.sync.remove(sessionHistoryKey);
        res = await setAiSessions();
        if(res){
            showMessage('Session history deleted.', 'success');
        }
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    }
}

function laiShowSystemInstructions(e) {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const sysIntructContainer = shadowRoot.getElementById('laiSysIntructContainer');
    const sysIntructInput = sysIntructContainer.querySelector('#laiSysIntructInput');
    sysIntructContainer.classList.toggle('active');
    if (sysIntructContainer.classList.contains('active')) {
        sysIntructInput.focus();
    }
}

function laiPushpinClicked(e) {
    const container = e.target.closest('div');
    let isPinned = false;

    container.querySelectorAll('img').forEach(img => {
        img.classList.toggle('invisible');
        if (img.getAttribute('data-type') === 'black_pushpin') {
            isPinned = !img.classList.contains('invisible');
        }
    });

    laiOptions.closeOnClickOut = !isPinned;
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    shadowRoot.getElementById('laiUserInput')?.focus();
}

function checkForDump(userText) {
    if (userText.indexOf('@{{dump}}') > -1 || userText.indexOf('@{{dumpStream}}') > -1) {
        dumpStream = true;
    }

    return userText.replace('@{{dump}}', '').replace('@{{dumpStream}}', '');
}

function laiInsertCommandText(text) {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const textarea = shadowRoot.querySelector('textarea');
    const cursorPosition = textarea.selectionStart;
    const textBeforeCursor = textarea.value.substring(0, cursorPosition);
    const textAfterCursor = textarea.value.substring(cursorPosition);

    const prefixEnd = textBeforeCursor.lastIndexOf('@{{');
    textarea.value = textBeforeCursor.substring(0, prefixEnd) + text + textAfterCursor;
    textarea.selectionStart = textarea.selectionEnd = prefixEnd + text.length;
    textarea.focus();
    laiHideSuggestions();
}

function laiShowSuggestions(input) {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const suggestionBox = shadowRoot.getElementById('laiSuggestionBox');
    suggestionBox.innerHTML = ''; // Clear previous suggestions
    Object.keys(commandPlacehoders).forEach(cmd => {
        if (cmd.startsWith(input)) {
            const suggestion = document.createElement('div');
            suggestion.textContent = `${cmd} - ${commandPlacehoders.cmd}th`;
            suggestion.onclick = function () { laiInsertCommandText(cmd); };
            suggestionBox.appendChild(suggestion);
        }
    });
    suggestionBox.classList.remove('invisible');
}

function laiHideSuggestions() {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const suggestionBox = shadowRoot.getElementById('laiSuggestionBox');
    suggestionBox.classList.add('invisible');
}

// user input
function onUserInputDragEnter(e) {
    e.stopImmediatePropagation()
    e.preventDefault();

    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const dropzone = shadowRoot.getElementById('dropzone');
    dropzone.classList.remove('invisible');
    setTimeout(() => dropzone.classList.add('hover'), 50);
}

function onUserInputDragLeave(e) {
    e.stopImmediatePropagation()
    e.preventDefault();

    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const dropzone = shadowRoot.getElementById('dropzone');
    dropzone.classList.remove('hover');
    setTimeout(() => dropzone.classList.add('invisible'), 750); // wait transition to complete
}

function handleFileRead(fileName, result, isImageFile) {
    if (isImageFile) {
        const base64String = result.split(',')[1];
        images.push(base64String);
    } else {
        attachments.push(`Attached file name is: ${fileName}; The file content is:\n[FILE] ${result} [/FILE]`);
    }
    showAttachment(fileName);
}

function processAttachmentFile(file) {
    const fileName = file.name.split(/\\\//).pop();
    const reader = new FileReader();
    const isImageFile = isImage(file.type);

    reader.onload = function (e) {
        handleFileRead(fileName, e.target.result, isImageFile);
    };

    if (isImageFile) {  reader.readAsDataURL(file); }
    else {  reader.readAsText(file);  }
}

function readFileContent(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(event) {
            resolve(event.target.result);
        };
        reader.onerror = function(error) {
            reject(error); // Reject with the error
        };
        reader.readAsArrayBuffer(file);
    });
}

async function onUserInputFileDropped(e) {
    e.preventDefault();
    e.stopPropagation();
    try{
        const shadowRoot = getShadowRoot();
        if (!shadowRoot) { return; }

        const dropzone = shadowRoot.getElementById('dropzone');
        dropzone.classList.remove('hover');
        setTimeout(() => dropzone.classList.add('invisible'), 750);

        console.log(`>>> ${manifest.name} - [${getLineNumber()}] - event files:`, e?.dataTransfer?.files);

        for (let i = 0; i < e.dataTransfer.files.length; i++) {
            const file = e.dataTransfer.files[i];
            console.log(`>>> ${manifest.name} - [${getLineNumber()}] - File ${i}: Name: ${file.name}; Type: ${file.type}; Size: ${file.size}`);

            if (file.type.startsWith('image/')) {
                try {
                  const reader = new FileReader();
                  reader.onload = () => {
                    images.push(reader.result.split(',').pop());
                    showAttachment(file.name);
                  };
                  reader.readAsDataURL(file);
                } catch (imgErr) {
                  console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Image read failed: ${imgErr.message}`, imgErr);
                  showMessage(`Failed to read image ${file.name}`, 'error');
                }

                continue;
            }

            const fileContent = await readFileContent(file);
            if (!fileContent) {
                showMessage(`Failed to get content of ${file.name}.`, 'error');
                continue;
            }
            let response;
            try {
                response = await chrome.runtime.sendMessage( {
                        action: 'extractText',
                        fileName: file.name,
                        fileContent: btoa(String.fromCharCode(...new Uint8Array( fileContent)))});
            } catch (be) {
                console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${be.message}`, be);
                return;
            }

            const docText = typeof response === 'string' ? response : (typeof response.text === 'function' ? await response.text() : '');
            if (docText) {
                attachments.push(`File name is ${file.name}. Its content is between [FILE_${file.name}] and [/FILE_${file.name}]:\n[FILE_${file.name}] ${docText} [/FILE_${file.name}]. Use this as a context of your respond.`);
                showAttachment(file.name);
            } else {
                showMessage(`${file.name} is either empty or extraction of its content failed!`, 'error');
            }
        }
    } catch (err){
        showMessage(err.message, 'error');
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - error: ${err.message}`, err);
    }
}

function showAttachment(title) {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }

    const attachmentContainer = shadowRoot.querySelector('#attachContainer');
    if (!attachmentContainer.classList.contains('active')) {
        attachmentContainer.classList.add('active');
    }

    const img = createAttachmentImage(title);
    if (img) {
        attachmentContainer.appendChild(img);
    }
}

function createAttachmentImage(title) {
    if (!checkExtensionState()) { return; }
    const img = document.createElement('img');
    img.src = chrome.runtime.getURL('img/attachment.svg');
    img.style.cursor = `url('${chrome.runtime.getURL('img/del.svg')}'), auto`;
    img.setAttribute('alt', 'Attachment');
    img.setAttribute('title', title);
    img.setAttribute('data-index', attachments.length - 1);
    img.classList.add('attached');
    img.addEventListener('click', (e) => {
        e.preventDefault();
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        if (!isNaN(idx) && idx >= 0) {
            attachments.splice(idx, 1);
        }

        attachmentDeleted();
        e.target.remove();
    });

    return img;
}

function attachmentDeleted() {
    if (attachments.length > 0) { return; }

    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    shadowRoot.querySelector('#attachContainer')?.classList.remove('active');
}

function clearAttachments() {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const attachmentContainer = shadowRoot.querySelector('#attachContainer');
    if (!attachmentContainer) { return; }
    attachmentContainer.replaceChildren();
    attachmentContainer.classList.remove('active');
    attachments = [];
}

function adjustHeight(userInput) {
    if (!userInput) { return; }
    var initialRows = parseInt(userInput.getAttribute('rows'), 10);
    var lineHeight = parseFloat(window.getComputedStyle(userInput).lineHeight);
    if (isNaN(lineHeight)) { lineHeight = 1.2; }
    var maxAllowedHeight = lineHeight * initialRows * 2;

    userInput.style.height = 'auto'; // Reset the height to auto
    var newHeight = userInput.scrollHeight + 'px';

    if (userInput.scrollHeight <= maxAllowedHeight) {
        userInput.style.height = newHeight;
        userInput.style.transform = 'translateY(0)';
    } else {
        userInput.style.height = maxAllowedHeight + 'px';
        var heightDiff = maxAllowedHeight - (lineHeight * initialRows);
        userInput.style.transform = `translateY(-${heightDiff}px)`;
    }
}

function userInputClicked(e) {
    e.target.closest('div.lai-user-area')?.classList.add('focused');
    hidePopups(e);
}

function hidePopups(e) {
    const shadowRoot = getShadowRoot();

    shadowRoot.querySelector('#cogMenu')?.classList.add('invisible');
    shadowRoot.querySelectorAll('#helpPopup').forEach(el => el.remove());
    shadowRoot.querySelector('#commandListContainer')?.classList.add('invisible');
}

async function onPromptTextAreaKeyDown(e) {
    const elTarget = e.target;
    e.stopImmediatePropagation();
    e.stopPropagation();

    if (e.key === 'Enter' && e.code !== 'NumpadEnter' && !e.shiftKey) {

        if (isAskingForHelp(e) || checkCommandHandler(e)) {
            e.preventDefault();
            return false;
        }

        e.preventDefault();
        const shadowRoot = getShadowRoot();
        if (!shadowRoot) { return; }
        shadowRoot.getElementById('laiSysIntructContainer').classList.remove('active');

        if (elTarget?.value?.trim() === '') {
            showMessage('It looks like there is no propt yet.', 'warning');
            return;
        }

        messages = []; // each prompt starts a new array. ???
        checkForDump(elTarget.value);

        // update UI
        addInputCardToUIChatHistory(elTarget.value, 'user', messages.length - 1);
        addInputCardToUIChatHistory('', 'ai');

        // update data
        addCommandPlacehodersValues(elTarget.value);
        addAttachmentsToUserInput();
        addUserInputIntoMessageQ(elTarget.value);

        messages = [{"role": "user", "content": messages.map(e => e.content).join('\n')}];
        if(images.length > 0){  messages[0]["images"] = images;  }

        try {
            dumpInConsole(`${[getLineNumber()]} - messages collected are ${messages.length}`, messages);
            queryAI();
        } catch (e) {
            showMessage(`ERROR: ${e.message}`, error);
        } finally {
            clearAttachments();
            elTarget.value = '';
            elTarget.classList.add('invisible');
            shadowRoot.getElementById('laiAbort')?.classList.remove('invisible');
        }
    }
}

function addAttachmentsToUserInput() {
    if (attachments.length < 1) { return false; }
    const l = attachments.length;
    const content = [];

    for (let i = 0; i < l; i++) {
        content.push(`ATTACHMENT START ${attachments[i]} ATTACHMENT END\n`);
    }
    if(content.length < 1){ return;  }

    content.push(`PAGE URL: ${document.location.href}\n`);
    messages.push({ "role": "user", "content": content.join('\n') });
}

function addCommandPlacehodersValues(userInputValue){
    const userCommands = [...userInputValue.matchAll(/@\{\{([\s\S]+?)\}\}/gm)];
    const content = [];
    userCommands.forEach(cmd => {
        let cmdText = ''
        if(Array.isArray(cmd)) {  cmdText = cmd.pop().trim();  }
        switch(cmdText){
            case 'page':
                content.push(getPageTextContent());
                break;
            case 'now':
                content.push(`current date and time or timestamp is: ${(new Date()).toISOString()}`);
                break;
            case "today":
                content.push(`current date is: ${(new Date()).toISOString().split('T')[0]}`);
                break;
            case "time":
                content.push(`current time is: ${(new Date()).toISOString().split('T')[1]}`);
                break;
        }
    });
    if(content.length > 0){ attachments.push(...content);  }
}

function addUserInputIntoMessageQ(inputChunks, omitFromSession = false) {
    const content = Array.isArray(inputChunks) ? inputChunks.join('\n') : inputChunks;
    messages.push({ "role": "user", "content": content });
    if (omitFromSession) { return; }
    if (aiSessions.length < 1) {
        activeSessionIndex = 0;
        aiSessions[activeSessionIndex] = [];
    }
    aiSessions[activeSessionIndex].push({ "role": "user", "content": content });
}

function transformTextInHtml(inputText) {
    const lastChatText = document.createElement('span');
    lastChatText.className = "lai-input-text";

    const lines = inputText.split(/\n/).map(line => document.createTextNode(line));
    lines.forEach((line, index) => {
        lastChatText.appendChild(line);
        if (index < lines.length - 1) {
            lastChatText.appendChild(document.createElement('br'));
        }
    });

    return lastChatText;
}

/**
 * Recursively builds and returns a DocumentFragment containing the specified elements.
 *
 * @param {Object|Object[]} elements - An object or an array of objects representing HTML elements to create.
 * Each object should have a tag name as its key and an optional attributes object as its value.
 * @returns {DocumentFragment|HTMLElement|null} A DocumentFragment containing the created elements,
 * a single HTMLElement if only one element is provided, or null if no elements are provided.
 *
 * @example
 * // Example usage:
 * const elements = [
 *   {
 *     "span": {
 *       "class": "lai-edit-item-action",
 *       "data-type": "edit",
 *       "data-index": 0,
 *       "children": [
 *         { "img": { "src": "img/edit.svg" } }
 *       ]
 *     }
 *   }
 * ];
 * const fragment = buildElements(elements);
 * document.body.appendChild(fragment);
 */
function buildElements(elements) {
    if (!elements) { return; }
    if (!Array.isArray(elements)) { elements = [elements]; }
    let fragment = document.createDocumentFragment();

    for (let i = 0; i < elements.length; i++) {
        let el = elements[i];
        let tagName = Object.keys(el)[0];
        let attributes = el[tagName];

        let newElement = document.createElement(tagName);

        for (let attribute in attributes) {
            if (attribute === 'children') {
                newElement.appendChild(buildElements(attributes[attribute]));
            } else {
                newElement.setAttribute(attribute, attributes[attribute]);
            }
        }

        fragment.appendChild(newElement); // Append the newly created element to a document fragment
    }

    return fragment.childNodes.length === 1 ? fragment.firstChild : fragment;
}

function addInputCardToUIChatHistory(inputText, type, index = -1) {
    if (!checkExtensionState()) { return; }

    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const messageList = shadowRoot.getElementById('laiChatMessageList');
    const lastChatElement = Object.assign(document.createElement('div'), {
        className: `lai-${type}-input lai-chat-history`
    });

    if (type === 'ai') {
        shadowRoot.querySelector('#laiPreviousAiInput')?.removeAttribute('id');
        shadowRoot.querySelectorAll("#laiActiveAiInput")?.forEach(el => {
            el?.removeAttribute("id");
        });
    }
    const lastChatlabel = Object.assign(document.createElement('span'), {
        className: "lai-input-label",
        innerHTML: `${type === 'ai' ? type.toUpperCase() : type}:&nbsp;`
    });
    const lastChatText = transformTextInHtml(inputText);
    const arrButtons = [
        {
            "span": {
                "class": "lai-chat-item-button", "data-type": "delete", "title": "Delete",
                "children": [{ "img": { "src": chrome.runtime.getURL('img/remove-all.svg') } }]
            }
        },
        {
            "span": {
                "class": "lai-chat-item-button", "data-type": "copy", "title": "Copy",
                "children": [{ "img": { "src": chrome.runtime.getURL('img/paste.svg') } }]
            }
        },
        {
            "span": {
                "class": "lai-chat-item-button", "data-type": "insert", "title": "Insert in page",
                "children": [{ "img": { "src": chrome.runtime.getURL('img/insert.svg') } }]
            }
        },
        {
            "span": {
                "class": "lai-chat-item-button", "data-type": "increase", "title": "Increase font",
                "children": [{ "img": { "src": chrome.runtime.getURL('img/fontup.svg') } }]
            }
        },
        {
            "span": {
                "class": "lai-chat-item-button", "data-type": "decrease", "title": "Decrease font",
                "children": [{ "img": { "src": chrome.runtime.getURL('img/fontdown.svg') } }]
            }
        }
    ];
    const arrEditButton = [{
        "span": {
            "class": "lai-chat-item-button", "data-type": "edit", "data-index": index, "title": "Edit",
            "children": [{ "img": { "src": chrome.runtime.getURL('img/edit.svg') } }]
        }
    }, {
        "span": {
            "class": "lai-chat-item-button", "data-type": "add", "title": "Add this prompt as User Command",
            "children": [{ "img": { "src": chrome.runtime.getURL('img/new.svg') } }]
        }
    }];

    const actionIconsDiv = document.createElement('div');
    if(type === 'ai'){  actionIconsDiv.rawContent = '';  } // add custom attribute to keep the raw content
    actionIconsDiv.classList.add('lai-action-icons', 'invisible');
    actionIconsDiv.appendChild(buildElements(type !== 'ai' ? [...arrButtons, ...arrEditButton] : arrButtons));
    // actionIconsDiv.appendChild(buildElements(type !== 'ai' && index > -1 ? [...arrButtons, ...arrEditButton] : arrButtons));
    lastChatElement.appendChild(lastChatlabel)
    lastChatElement.appendChild(lastChatText)
    lastChatElement.appendChild(actionIconsDiv);
    messageList.appendChild(lastChatElement);

    lastChatElement.addEventListener('mouseenter', function (e) {
        const el = e.target.querySelector('.lai-action-icons');
        if (!el) { return; }
        const elHist = el.closest('.lai-chat-history');
        const elIdx = Array.from(el.closest('#laiChatMessageList').children).indexOf(elHist);
        el.classList.remove('invisible');
        if (elIdx > 0) {
            el.style.top = `-${el.getBoundingClientRect().height}px`;
        } else {
            el.style.bottom = `-${el.getBoundingClientRect().height}px`;
        }
    });
    lastChatElement.addEventListener('mouseleave', function (e) {
        const el = e.target.querySelector('.lai-action-icons');
        el?.classList.add('invisible');
    });

    lastChatElement.querySelectorAll('.lai-chat-item-button').forEach(el => {
        el.addEventListener('click', function (e) {
            let action = e.target.getAttribute('data-type');
            if (!action) {
                action = e.target.parentElement.getAttribute('data-type');
            }
            if (!action) { return; }
            switch (action) {
                case "add":
                    const thisPromptContainer = e.target.closest('.lai-chat-history');
                    prompt2UserCommand(thisPromptContainer.querySelector('.lai-input-text').textContent);
                    break;
                case 'copy':
                    laiCopyElementContent(e, type);
                    break;
                case 'delete':
                    e.target.closest(`.lai-${type}-input`)?.remove();
                    break;
                case 'edit':
                    editUserInput(e, type);
                    break;
                case 'insert':
                    insertIntoDocument(e, type)
                    break;
                case "increase":
                case "decrease":
                    adjustFontSize(e.target.closest('.lai-chat-history'), action === 'increase' ? 1 : -1);
                    break;
                default:
                    break;
            }
        });
    });
    // redundant?
    if (type === 'ai') {
        lastChatText.addEventListener('click', function (e) { laiSourceTextClicked(e); });
    }

    messageList.scrollTop = messageList.scrollHeight;
}

function insertIntoDocument(e, type){
    const txt = e.target.closest(`.lai-${type}-input`)?.querySelector('.lai-input-text');
    showMessage('Copied. Click on the target to paste.');

    const insertIntoDocumentClickListener = event => {
        click2insert(event, txt, () => document.removeEventListener('click', insertIntoDocumentClickListener));
    };

    document.addEventListener('click', insertIntoDocumentClickListener);
}

function click2insert(e, textEl, callback){
    const shadowRoot = getShadowRoot();
    if (!document.hasFocus() || document.visibilityState !== 'visible') {
        console.warn(`>>> ${manifest.name} - [${getLineNumber()}] - Page is not active.`);
        return;
    }

    if (shadowRoot && (e.target.shadowRoot === shadowRoot || shadowRoot.contains(e.target))) {
        if(typeof(callback) === 'function'){
            setTimeout(callback, 60000);
        }
        return;
    }

    try {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            e.target.value += textEl.innerText;
        }else if (e.target.isContentEditable) {
            const lines = textEl.innerText.split('\n');
            lines.forEach((line, index) => {
                const p = document.createElement('p');
                if(!line){
                    p.appendChild(document.createElement('br'));
                } else {
                    p.textContent = line;
                }
                e.target.appendChild(p);
            });
        }
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - error: ${error.message}`, error);
    } finally{
        if(typeof(callback) === 'function'){
            callback();
        }
    }
}

function laiShowCopyHint(e) {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const hint = shadowRoot.getElementById('laiCopyHint');

    hint.style.cssText = 'right: ""; left: ""; opacity: 0; z-index: 10';
    hint.classList.remove('invisible');

    var hintWidth = hint.offsetWidth;
    var viewportWidth = window.innerWidth;

    // Calculate available space on the left and right
    var spaceOnLeft = e.clientX;
    var spaceOnRight = viewportWidth - e.clientX;

    if (spaceOnRight < hintWidth + 20 && spaceOnLeft >= hintWidth + 20) {
        hint.style.right = (viewportWidth - e.clientX - 20) + 'px';
        hint.style.left = 'auto';
    } else {
        hint.style.left = Math.min(e.clientX, viewportWidth - hintWidth - 20) + 'px';
        hint.style.right = 'auto';
    }

    hint.style.top = e.clientY + 'px';

    setTimeout(() => hint.style.opacity = 1, 10);  // Show the hint with a slight delay for opacity transition

    setTimeout(function () {
        hint.style.opacity = 0;
        hint.classList.add('invisible');
    }, 2500);
}

function laiCopyElementContent(e, type) {
    const element = e.target.closest(`.lai-${type}-input`)?.querySelector('.lai-input-text');

    let textContent;
    if(type === 'user'){
        textContent = element.rawContent.messages.map(e => e.content).join('\n');
    } else {
        textContent = element?.rawContent || element?.innerText || 'Failed to copy the content!';
    }

    navigator.clipboard.writeText(textContent)
        .then(() => laiShowCopyHint(e))
        .catch(err => console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Failed to copy text: ${err.message}`, err));
}

function editUserInput(e, type) {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) {
        console.error(`[${getLineNumber()}]: Base element not found!`);
        return;
    }

    const container = shadowRoot.getElementById("laiChatMessageList");
    const chatHistoryEl = e.target.closest('.lai-chat-history');
    if(!chatHistoryEl){
        console.error(`[${getLineNumber()}]: chat-history element not found!`);
        return;
    }

    const idx = Array.from(container.children).indexOf(chatHistoryEl);

    const userInputField = shadowRoot.getElementById('laiUserInput')
    // const activeChild = e.target.closest('.lai-chat-history');
    userInputField.value = chatHistoryEl.querySelector('.lai-input-text').innerText || '';
    let children = Array.from(container.querySelectorAll('.lai-chat-history'));
    // let activeIndex = children.indexOf(activeChild);
    if (idx > -1) {
        children.slice(idx).forEach(child => child.remove());
    }
    aiSessions[0].length = idx + 1;
    userInputField.focus();
}

// handle code snippets clicks in AI response
function laiSourceTextClicked(e) {
    const clickedSourceTitle = e.target.closest('.lai-source-title');
    if (!clickedSourceTitle) { return; }
    const thePre = clickedSourceTitle.closest('pre');
    if (!thePre) { return; }
    const theCode = thePre.cloneNode(true);
    theCode.querySelector('span')?.remove();
    const parser = new DOMParser();
    const parsedEl = parser.parseFromString(theCode.textContent, 'text/html');
    const textToCopy = parsedEl.documentElement.textContent;

    navigator.clipboard.writeText(textToCopy)
        .then(() => {
            clickedSourceTitle.classList.toggle('copied');
            setTimeout(() => clickedSourceTitle.classList.toggle('copied'), 3000);
        })
        .catch(err => console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Failed to copy text: ${err.message}`, err));
}

function laiSwapSidebarWithButton(forceClose = false) {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const slideElement = shadowRoot.getElementById('laiSidebar');
    if (!slideElement) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Slidebar not found!`);
        return;
    }

    laiUpdateMainButtonStyles();

    const isSidebarActive = slideElement.classList.contains('active');
    if (!forceClose && isSidebarActive && !laiOptions?.closeOnClickOut) { return; }
    slideElement.classList.toggle('active');
    if (slideElement.classList.contains('active')) {
        slideElement.querySelector('textarea#laiUserInput').focus();
    }
}

function laiUpdateMainButtonStyles() {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    var btn = shadowRoot.getElementById('laiMainButton');
    if (!btn) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Main button not found!`);
        return;
    }

    const isButtonVisible = !btn.classList.contains('invisible');

    if (!isButtonVisible && laiOptions?.showEmbeddedButton) { // if not visible but should be - show it
        btn.classList.toggle('invisible');
    } else {
        btn.classList.toggle('invisible'); // hide if visible
    }
}

function laiOnRibbonButtonClick(e) {
    e.stopPropagation();
    e.preventDefault();
    const clickedButton = this || e.target;
    const type = clickedButton.getAttribute('data-type').toLowerCase();
    if (!type) { return; }
    switch (type) {
        default:
            showMessage(`Unknown type ${type}`);
    }
}

function laiAbortRequest(e) {
    if (checkExtensionState()) {
        chrome.runtime.sendMessage({ action: "abortFetch" })
            .then()
            .catch(e => {
                console.error(`>>> ${manifest.name} - [${getLineNumber()}] - error: ${e.message}`, e);
            });
    }

    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    shadowRoot?.getElementById('laiAbort')?.classList.add('invisible');
    shadowRoot?.getElementById('laiUserInput')?.classList.remove('invisible');
}


function queryAI() {
    if (!checkExtensionState()) {
        setTimeout(laiAbortRequest, 1000);
        return;
    }

    if (laiOptions.aiUrl.trim() === '') {
        showMessage('Please choose API endpoint');
        return;
    }

    const shadowRoot = getShadowRoot();
    let temp = 0.5;
    if(shadowRoot){
        const tempInput = shadowRoot.querySelector('#tempInput');
        temp = tempInput?.value;
    }

    const data = {
        "messages": messages,
        // "stream": true,
        "options": {
            "temperature": parseFloat(temp || "0.5" )
          }
    }

    if (laiOptions.aiUrl.indexOf('api') > -1) {
        if (laiOptions.aiModel.trim() === '') {
            showMessage('Please choose a model from the list!');
            return;
        } else {
            data['model'] = laiOptions.aiModel.trim();
        }
    }

    const sysInstruct = getCurrentSystemInstructions();
    const requestData = {
        action: "fetchData",
        systemInstructions: sysInstruct || '',
        url: laiOptions.aiUrl,
        data: data, // TODO remove - get from storage
    };

    updateStatusBar('Prompt sent to the model, awaiting response...');
    chrome.runtime.sendMessage(requestData, (response) => {
        if(response?.status === 'error' && response?.message){
            showMessage(response.message, 'error');
            resetStatusbar();
        }
    });
}

function setModelNameLabel(data) {
    if (!data) { return; }
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const modelName = shadowRoot.getElementById('laiModelName');
    const model = data?.model;
    if (!model) { return; }
    modelName.textContent = (/\\|\//.test(model) ? model.split(/\\|\//).pop().split('.').slice(0, -1).join('.') : model) ?? '';
    resetStatusbar();
}

function laiFinalPreFormat() {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const chatList = shadowRoot.getElementById('laiChatMessageList');
    if (!chatList) { return; }

    chatList.querySelectorAll('pre.lai-source').forEach(preElement => {
        const replacedHtml = preElement.innerHTML.replace(/<code class="lai-code">(.*?)<\/code>/g, "'$1'");
        preElement.innerHTML = replacedHtml.replace(/<br\/?>/g, '\n');
    });
}

function laiExtractDataFromResponse(response) {
    // {status: result, content: resp}
/*     const parts = (response?.data?.split(': ') || []).slice(-1);
    const jsonPart = parts[0];
    if (jsonPart.toUpperCase() === '[DONE]') { return  ''; } */
    // let data = '';
    const responseJson = response.response;
    try {
        response = JSON.parse(responseJson);
        // if(response?.message?.content){
        //     data = JSON.parse(response?.message?.content | "{}");
        // }
        // if(response.status === 'error'){  throw new Error(response.content);  }
        // data = JSON.parse(response?.data || `{"content": null}`);
    } catch (err) {
        showMessage(err.message, 'error');
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${err.message}`, err);
        return '';
    }

/*     if (data?.error && data.error.length > 0) {
        showMessage(data.error, 'error');
        return '';
    } */

    setModelNameLabel(response.model || 'unknown');
    return response?.message?.content || "Empty content!";
}

/* function laiExtractDataFromResponse(response) {
    const parts = (response?.data?.split(': ') || []).slice(-1);
    const jsonPart = parts[0];
    if (jsonPart.toUpperCase() === '[DONE]') { return  ''; }
    let data = '';
    try {
        const responseData = JSON.parse(response?.data || "{}");
        if(responseData?.error){  throw new Error(responseData.error);  }
        data = JSON.parse(jsonPart);
    } catch (err) {
        showMessage(err.message, 'error');
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${err.message}`, err);
        return '';
    }

    if (data?.error && data.error.length > 0) {
        showMessage(data.error, 'error');
        return '';
    }

    setModelNameLabel(data);
    return (data?.choices?.[0]?.delta?.content || data?.message?.content || '');
} */

chrome.runtime.onMessage.addListener((response) => {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) {
        if(restartCounter < RESTART_LIMIT){
            restartCounter++;
            console.log(`>>> ${manifest.name} - [${getLineNumber()}] - restarting: ${restartCounter}`);
            start();
        }
        return;
    }

    let recipient = shadowRoot.getElementById('laiActiveAiInput');
    if (!recipient) {
        recipient = Array.from(shadowRoot.querySelectorAll('.lai-ai-input .lai-input-text')).pop();
        recipient?.setAttribute("id", "laiActiveAiInput");
    }
    if (!recipient && ['toggleSidebar', 'activePageSelection', 'activePageContent', 'toggleSelectElement', 'explainSelection'].indexOf(response.action) < 0) {
        console.log(`>>> ${manifest.name} - [${getLineNumber()}] - no recipient`);
        return;
    }


    switch (response.action) {
        case "streamData":

            let dataChunk;
            try {
                dataChunk = laiExtractDataFromResponse(response);
                if (!dataChunk) { return; }
                aiRawResponse.push(dataChunk);
                updateStatusBar('Receiving and processing data...');
                StreamMarkdownProcessor.processStreamChunk(dataChunk, laiGetRecipient());
            } catch (err) {
                resetStatusbar();
                laiHandleStreamActions(`${err}`, recipient)
                console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${err.message}`, err);
                console.log(`>>> ${manifest.name} - [${getLineNumber()}] - dataChunk`, response);
            }
            break;
        case "streamEnd":
            resetStatusbar();
            laiHandleStreamActions("Stream Ended", recipient);
            break;
        case "streamError":
            laiHandleStreamActions("Stream Error", recipient);
            break;
        case "streamAbort":
            laiHandleStreamActions("Stream Aborted", recipient, '... Aborted');
            break;
        case "toggleSidebar":
            laiSwapSidebarWithButton(true);
            break;
        case "activePageSelection":
            attachments.push(response.selection);
            showAttachment(`${selection?.split(/\s+/).slice(0, 5).join(' ')}...`);
            showMessage('Element picked up successfully.', 'info')
            updateStatusBar('Selected content added to the context.');
            break;
        case "activePageContent":
            attachments.push(getPageTextContent());
            showAttachment(document?.title || 'Current page');
            showMessage('Element picked up successfully.', 'info')
            updateStatusBar('Selected content added to the context.');
            break;
        case 'explainSelection':
            ask2ExplainSelection(response);
            break;
        case "toggleSelectElement":
            isElementSelectionActive = response.selection;
            break;
        case "showMessage":
            if(response.message){  showMessage(response.message, response.messageType);  }
            break;
        case "updateStatusbar":
            if(response.message){  updateStatusBar(response.message);  }
            break;
        case "dumpInConsole":
            dumpInConsole(response.message, response.obj, response.type);
            break;
        case "userPrompt":
            storeLastGeneratedPrompt(response.data)
            break;
        default:
            laiHandleStreamActions(`Unknown action: ${response.action}`, recipient);
            break;
    }

    if (!userScrolled) {
        const laiChatMessageList = shadowRoot.getElementById('laiChatMessageList');
        laiChatMessageList.scrollTop = laiChatMessageList.scrollHeight;
    }

    if (response.error) {
        showMessage(response.error, 'error');
        resetStatusbar();
    }
});

function laiHandleStreamActions(logMessage, recipient, abortText = '') {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    let textAres = shadowRoot.getElementById('laiUserInput');
    const laiAbortElem = shadowRoot.getElementById('laiAbort');
    recipient.removeAttribute("id");
    const streamData = StreamMarkdownProcessor.getRawContent();

    if (laiAbortElem) {  laiAbortElem.classList.add('invisible');  }
    if (textAres) {
        textAres.classList.remove('invisible');
        textAres.focus();
    } else {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - User input area not found!`);
    }

    if (streamData) {
        messages.push({ "role": "assistant", "content": streamData });
        aiSessions[activeSessionIndex].push({ "role": "assistant", "content": streamData });
    }

    if (abortText && recipient) {
        recipient.innerHTML += `<span class="lai-aborted-text">${abortText}</span>`;
    }

    if (dumpStream) {
        console.log(`>>> ${manifest.name} - [${getLineNumber()}] - Dumping stream content:\n${StreamMarkdownProcessor.getRawContent()}`);
        dumpStream = false;
    }
    recipient.rawContent = StreamMarkdownProcessor.getRawContent();
    setTimeout(async () => await setChatHistory({"role": "assitent", "content": recipient.rawContent}, 100));

    StreamMarkdownProcessor.dispose();
    setAiSessions().then().catch(e => console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e));
}

function laiGetRecipient() {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    let recipient = shadowRoot.querySelector('#laiActiveAiInput');
    if (!recipient) { recipient = shadowRoot.querySelectorAll('span.lai-ai-input'); }
    if (!recipient) { throw Error('No recipient found!'); }
    return recipient;
}

function getPageTextContent() {
    const bodyClone = document.body.cloneNode(true);
    ['local-ai', 'script', 'link', 'select', 'style', 'svg', 'code', 'img', 'fieldset', 'aside'].forEach(selector => {
        bodyClone.querySelectorAll(selector).forEach(el => el.remove());
    });

    let content = bodyClone.textContent.replace(/[ \t]+/g, ' ')
    content = content.replace(/\s+/g, '\n');
    return ` PAGE URL: ${document.location.url}\nPAGE CONTENT START: ${content.trim()} PAGE CONTENT ENDED`;
}

function ask2ExplainSelection(response) {
    if (!response) {
        showMessage('Nothing received to explain!', 'warning');
        console.warn(`>>> ${manifest.name} - [${getLineNumber()}] - response: `, response);
        return;
    }

    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }

    const sideBar = getSideBar();
    if (!sideBar) {
        console.error(`>>> ${manifest.name} - ${[getLineNumber()]}: Sidebar not found!`);
        return;
    }

    const userInput = shadowRoot.getElementById('laiUserInput');
    if (!userInput) { return; }

    const selection = response.selection.replace(/\s{1,}/g, ' ').replace(/\n{1,}/g, '\n');
    attachments.push(getPageTextContent());

    const enterEvent = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter'
    });

    if (!sideBar.classList.contains('active')) {
        laiSwapSidebarWithButton();
    }

    userInput.value = `Focusing on abbreviations or non common content, explain briefly the meaning of the next snippet:\n- ${selection}`;
    userInput.dispatchEvent(enterEvent);
}

function laiResizeContainer(e) {
    e.preventDefault();
    const resizableDiv = e.target.closest('.lai-fixed-parent');
    const sidebar = resizableDiv.closest('.active');
    let isResizing = true;
    let prevX = e.clientX;
    let originalWidth = resizableDiv.getBoundingClientRect().width;

    function onMouseMove(e) {
        if (!isResizing) { return; }
        sidebar?.classList.add('dragging');
        const newX = e.clientX;
        const deltaX = newX - prevX;

        let newWidth = originalWidth - deltaX;

        newWidth = Math.min(newWidth, window.innerWidth);

        newWidth = Math.max(newWidth, 10);

        resizableDiv.style.width = `${newWidth}px`;

        if (newWidth >= window.innerWidth || newWidth <= 10) {
            stopResizing();
        }
    }

    function onMouseUp() {
        sidebar?.classList.remove('dragging');
        stopResizing();
    }

    function stopResizing() {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        isResizing = false;
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
}

function checkForHooksCmd(e){
    const userInput = e.target?.value?.trim() || '';
    if (!userInput || !/(?<!\\)\/(web)?hooks?\s*/i.test(userInput.toLowerCase())) {  return false;  }
    e.target.value = userInput.replace(/(?<!\\)\/(web)?hooks?\s*/g, '');
    updateStatusBar('Loading defined hooks...');
    chrome.runtime.sendMessage({ action: "getHooks" })
    .then(res => {
        showHooks(res);
        return true;
    })
    .catch(e => {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    })
    .finally(() => resetStatusbar());
    return true;
}

function showHooks(res){
    if(!res || !res?.hooks) {  return;  }
    if(res && res?.status !== 'success'){
        showMessage(`${res.status}: ${res?.message || "Unknow error"}`);
        return;
    }

    const container = document.createElement('div');
    container.id = 'hookContainer';

    const hooks = res.hooks;
    const hookArray = hooks.split('\n');

    hookArray.forEach(hook => {
      const p = document.createElement('p');
      p.textContent = hook.trim();
      container.appendChild(p);
    });

    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.onclick = () => container.remove();
    container.appendChild(closeButton);

    const sideBar = getSideBar();
    sideBar.appendChild(container);
    closeButton?.focus();
}

function getRegExpMatches(regex, userInput) {
    if (!regex instanceof RegExp) { return; }

    const matches = [];
    let match;

    while ((match = regex.exec(userInput.value)) !== null) {
        if (match) {
            matches.push(match);
        }
    }

    return matches;
}

function checkCommandHandler(e) {
    let res = false;
    const userInput = e.target;
    if (!userInput || (userInput?.value?.trim() || '') === '') { return res; }

    if(checkForHooksCmd(e)){  return true;  }

    const matches = getRegExpMatches(/\/(\w+)(?:\((\w+)\))?[\t\n\s]?/gi, userInput);
    if (matches.length < 1) { return res; }

    let continueLoop = true;
    for (let i = 0; i < matches.length; i++) {
        const cmd = matches[i][1]?.toLowerCase();
        const param = matches[i][2]?.toLowerCase();
        switch (cmd) {
            case 'add':
                popUserCommandEditor();
                continueLoop = false;
                res = true;
                break;
            case 'error':
            case 'lasterror':
                showMessage(lastRegisteredErrorMessage.toReversed().slice(0, 5), 'error');
                continueLoop = false;
                res = true;
                break;
            case 'hooks':
                showHooks();
                break;
            case 'list':
                continueLoop = false;
                popUserCommandList(e);
                res = true;
                break;
            case 'edit':
                continueLoop = false;
                if (!param) {
                    showMessage('Command name to edit is required.', 'error')
                } else {
                    const idx = aiUserCommands.findIndex(el => el.commandName.toLowerCase() === param);
                    if (idx < 0) {
                        showMessage(`${param} custom command not found.`, 'error');
                    } else {
                        popUserCommandEditor(idx);
                    }
                }
                res = true;
                break;
            case 'dump':
                let pos = parseInt(param, 10);
                dumpRawContent('ai', isNaN(pos) ? undefined : pos);
                res = true;
                break;
            case 'udump':
                let i = parseInt(param, 10);
                dumpRawContent('user', isNaN(i) ? undefined : i);
                res = true;
                break;
            default:
                const idx = aiUserCommands.findIndex(el => el.commandName.toLowerCase() === cmd);
                if (idx > -1) {
                    userInput.value = `${userInput.value}${userInput.value?.trim().length > 0 ? ' ' : ''}${aiUserCommands[idx]?.commandBody || ''}`;
                }
                res = idx > -1;
                break;
        }

        if (res) {
            userInput.value = userInput.value?.replace(matches[i][0], '');
        }
        if (!continueLoop) { break; }
    }

    return res;
}

// popup
function popUserCommandEditor(idx = -1) {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const theSidebar = shadowRoot.querySelector('#laiSidebar');
    const template = shadowRoot.getElementById('editorTemplate').content.cloneNode(true);
    var editor = template.getElementById('userCommandEditor');
    const closeBtn = editor.querySelector('.help-close-btn');

    editor.querySelector('#commandName').addEventListener('input', e => e.target.value = e.target.value.replace(/\s/g, '_'));
    closeBtn.addEventListener('click', (e) => { e.target.closest('div#userCommandEditor').remove() });
    const saveButton = editor.querySelector('button');
    saveButton.setAttribute('data-cmd-idx', idx);
    saveButton?.addEventListener('click', e => {
        const cmdIdx = parseInt(e.target.getAttribute('data-cmd-idx') || '-1', 10);
        e.target?.removeAttribute('data-cmd-idx');
        const inputs = editor.querySelectorAll('input, textarea');
        const cmdData = {};
        inputs.forEach(el => {
            cmdData[el.id] = el.value || '';
        })

        if (!cmdData.commandName || !cmdData.commandBody) {
            showMessage('Command must have name and boddy!', 'error');
            return;
        }

        addToUserCommands(cmdData, cmdIdx);
        closeBtn?.click();
    })

    editor = loadUserCommandIntoEditor(idx, editor);
    theSidebar.appendChild(editor);
    editor.focus();

    return editor;

}

function loadUserCommandIntoEditor(idx = -1, editor) {
    if (idx < 0 || !editor) { return editor; }
    if (aiUserCommands.length < idx) { return editor; }

    const cmd = aiUserCommands[idx];
    if (!cmd) { return editor; }

    const cmdName = editor.querySelector('#commandName');
    if (cmdName) { cmdName.value = cmd.commandName; }
    const cmdDesc = editor.querySelector('#commandDescription');
    if (cmdDesc) { cmdDesc.value = cmd.commandDescription; }
    const cmdBody = editor.querySelector('#commandBody');
    if (cmdBody) { cmdBody.value = cmd.commandBody; }

    return editor;
}

function addToUserCommands(cmdData, idx = -1) {
    if (!cmdData || !cmdData.commandName || !cmdData.commandBody) { return; }

    if (idx < 0) {
        aiUserCommands.push(cmdData);
    } else {
        aiUserCommands[idx] = cmdData;
    }

    setAiUserCommands()
        .then(e => showMessage('Successfully saved.', 'success'))
        .catch(e => {
            if (e.message.indexOf('Extension context invalidated.') > -1) {
                showMessage(`${e.message}. Please reload the page.`, 'error');
            }
            console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
        });
}

function prompt2UserCommand(prompt = '') {
    if (!prompt) { return; }
    const editor = popUserCommandEditor();
    if (!editor) { return; }
    const cmdBody = editor.querySelector('#commandBody')
    if (!cmdBody) { return; }
    cmdBody.value = prompt;
}

function showHelp() {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const theSidebar = shadowRoot.querySelector('#laiSidebar');
    const template = shadowRoot.getElementById('helpTemplate').content.cloneNode(true);
    const helpPopup = template.getElementById('helpPopup');
    const ul = template.querySelector('ul');

    for (const command in commandPlacehoders) {
        const li = document.createElement('li');
        li.innerHTML = `<strong>${command}</strong>: ${commandPlacehoders[command]}`;
        ul.appendChild(li);
        li.addEventListener('click', e => {
            const userInput = shadowRoot.getElementById('laiUserInput');
            if (userInput) {
                userInput.value = (`${userInput.value.trim()} ${command}`).trim();
            }
        });
    }

    helpPopup.querySelector('.help-close-btn').addEventListener('click', (e) => { e.target.closest('div#helpPopup').remove() })
    theSidebar.appendChild(helpPopup);
    helpPopup.style.display = 'block';
}

function isAskingForHelp(e) {
    const userInput = e.target;
    if (!userInput) { return false; }

    const regex = /(@\{\{help\}\}|\/help|\/\?)[\t\n]?/gi;
    if (regex.test(userInput.value.trim().toLowerCase())) {
        const usrVal = userInput.value.replace(regex, '').trim();
        userInput.value = usrVal;
        showHelp();
        return true;
    }

    return false;
}

function restoreLastSession(sessionIdx) {
    const session = sessionIdx ? aiSessions[sessionIdx] : aiSessions.slice(-1)[0];
    activeSessionIndex = sessionIdx ?? aiSessions.length - 1;
    if (!session || session.length < 1) {
        return;
    }
    session.forEach((msg, i) => {
        addInputCardToUIChatHistory(msg.content, msg.role.replace(/assistant/i, 'ai'), i);
    });
    showMessage(`session #${sessionIdx} restored.`, 'info');
}

function showSessionHistoryMenu(e) {
    e.preventDefault();
    if (aiSessions.length < 1) {
        showMessage('No stored sessions found.');
        return;
    }

    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const headerSection = shadowRoot.querySelector('.lai-header');
    headerSection.querySelector('#sessionHistMenu')?.remove();

    const template = shadowRoot.getElementById('histMenuTemplate').content.cloneNode(true);
    const sessionHistMenu = template.children[0];
    sessionHistMenu.id = "sessionHistMenu";
    sessionHistMenu.classList.add('hist-top-menu', 'invisible');

    headerSection.appendChild(sessionHistMenu);

    const menuItemContent = aiSessions.map(innerArray => innerArray.find(obj => obj.role === 'user')).filter(Boolean);
    if (menuItemContent.length < 1) {
        showMessage('No stored sessions found.');
        return;
    }

    menuItemContent.push({ "role": "user", "content": "---" });
    menuItemContent.push({ "role": "user", "content": "Delete all sessions" });
    for (let i = 0, l = menuItemContent.length; i < l; i++) {
        const userEl = menuItemContent[i];
        let menuItem = document.createElement(userEl.content === '---' ? 'hr' : 'div');
        if (userEl.content !== '---') {
            menuItem.className = 'menu-item';
            menuItem.textContent = `${userEl.content.substring(0, 35)}${userEl.content.length > 35 ? '...' : ''}`;
            if (i === l - 1) {
                menuItem.addEventListener('click', (e) => {
                    aiSessions = [];
                    setAiSessions().then().catch(e => console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e));
                    e.target.closest('div#sessionHistMenu').remove();
                    showMessage('All sessions deleted.');
                });
            } else {
                menuItem.addEventListener('click', (e) => {
                    restoreLastSession(i);
                    e.target.closest('div#sessionHistMenu').remove();
                });
            }
        }

        sessionHistMenu.appendChild(menuItem);
    }

    sessionHistMenu.classList.remove('invisible');
    sessionHistMenu.style.cssText = `top: ${e.clientY + 10}px;; left: ${e.clientX - (sessionHistMenu.offsetWidth / 4)}px;`;
}

async function modelChanged(e){
    const oldModelName = laiOptions.aiModel;
    const newModelName = e.target.options[e.target.selectedIndex].value;
    await chrome.runtime.sendMessage({action: "prepareModels", modelName: oldModelName, unload: true });
    await chrome.runtime.sendMessage({action: "prepareModels", modelName: newModelName, unload: false });

    laiOptions.aiModel = newModelName;
    setModelNameLabel({ "model": laiOptions.aiModel });
}

function selectMenuChanged(e) {
    const id = e.target.id;
    switch (id) {
        case 'apiUrlList':
            laiOptions.aiUrl = e.target.options[e.target.selectedIndex].value;
            break;
/*         case 'modelList':
            laiOptions.aiModel = e.target.options[e.target.selectedIndex].value;
            setModelNameLabel({ "model": laiOptions.aiModel });
            break; */
        case 'hookList':
            console.log(`>>> ${manifest.name} - [${getLineNumber()}] - ${id} is not implemented yet`);
            break;
    }
}

function hideSessionHistoryMenu() {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const headerSection = shadowRoot.querySelector('.lai-header');
    headerSection?.querySelector('#sessionHistMenu')?.remove();
}

function popUserCommandList(e) {
    if (e?.target?.value) {
        e.target.value = e.target.value.replace('/list', '');
    }
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const cmdList = shadowRoot.querySelector('#commandListContainer');
    cmdList.querySelectorAll('img').forEach(img => { laiSetImg(img); });
    const closeBtn = cmdList.querySelector('#cmdListClose')
    closeBtn.addEventListener('click', e => cmdList.classList.add('invisible'));
    const addNewBtn = cmdList.querySelector('#cmdListNew');
    addNewBtn.addEventListener('click', e => {
        closeBtn.click();
        popUserCommandEditor()
    });

    cmdList.querySelector('#cmdImport').addEventListener('click', e => userImport(e));
    cmdList.querySelector('#cmdExport').addEventListener('click', async (e) => await exportAsFile(e));

    const container = cmdList.querySelector('div.user-command-block')

    container.replaceChildren();

    const clickHandler = e => closeBtn.click();
    container.addEventListener('click', clickHandler);

    const allCmds = [...userPredefinedCmd, ...aiUserCommands];

    for (let i = 0; i < allCmds.length; i++) {
        const cmd = allCmds[i];
        const el = document.createElement('div');
        el.setAttribute('data-index', i.toString());

        const cmdItemButtons = addCmdItemButtons(document.createElement('div'), i);
        const cmdItem = document.createElement('div');
        cmdItem.classList.add('user-cmd-item-command');
        cmdItem.innerHTML = `<b>/${cmd.commandName}</b> - ${cmd.commandDescription || 'No description provided.'}`

        el.appendChild(cmdItemButtons);
        el.appendChild(cmdItem);

        container.appendChild(el);
        el.classList.add('user-command-item');
    }

    cmdList.classList.remove('invisible');
    cmdList.focus();
}

function addCmdItemButtons(item, index) {
    if (!checkExtensionState()) { return; }
    if (!item) { return; }
    item.classList.add('user-cmd-item-btn');
    const userPredefinedCmdCount = userPredefinedCmd.length
    Object.keys(userCmdItemBtns).forEach(key => {
        if ((key === 'edit' || key === 'delete') && index < userPredefinedCmdCount) { return; }
        if (!userCmdItemBtns[key]) { userCmdItemBtns[key] = chrome.runtime.getURL(`img/${key}.svg`); }
        const img = document.createElement('img');
        img.src = userCmdItemBtns[key];
        img.setAttribute('title', key);
        img.setAttribute('alt', key);
        img.setAttribute('data-index', (index - userPredefinedCmdCount).toString());
        img.setAttribute('data-action', key);
        item.appendChild(img);
        img.addEventListener('click', userCmdItemBtnClicked);
    });

    return item;
}

function userCmdItemBtnClicked(e) {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }

    const clicked = e.target;
    const action = e.target.getAttribute('data-action').toLowerCase();
    const index = e.target.getAttribute('data-index');
    const userInput = shadowRoot.getElementById('laiUserInput');

    switch (action) {
        case 'edit':
            e.target.closest('#commandListContainer').querySelector('div.help-close-btn').click()
            popUserCommandEditor(index);
            break;
        case 'execute':
            e.target.closest('#commandListContainer').querySelector('div.help-close-btn').click();
            let exVal = index < 0 ? `/${userPredefinedCmd.slice(index)[0]?.commandName}` : aiUserCommands[index]?.commandBody
            userInput.value += exVal === '/' ? '' : exVal;
            const enterEvent = new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Enter'
            });
            userInput.dispatchEvent(enterEvent);
            break;
        case 'paste':
            let val = index < 0 ? `/${userPredefinedCmd.slice(index)[0]?.commandName}` : aiUserCommands[index]?.commandBody
            userInput.value += val === '/' ? '' : val;
            break;
        case 'delete':
            aiUserCommands.splice(index, 1);
            setAiUserCommands()
                .then(() => e.target.closest('#commandListContainer').querySelector('div.help-close-btn').click())
                .catch(e => console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e));
            break;
        default:
            console.warn(`>>> ${manifest.name} - [${getLineNumber()}] - Unknown action - ${action}`);
    }

    if (action !== 'edit') {
        hidePopups(e);
        userInput.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
    }
}

function checkExtensionState() {
    if (!chrome.runtime.id && chrome.runtime.reload) {   chrome.runtime.reload();  }
    if (!chrome.runtime.id) {
        if (typeof (showMessage) === 'function') {
            showMessage(`${manifest.name} - Extension context invalidated. Please reload the tab.`, 'error');
        } else {
            console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Extension context invalidated. Please reload the tab.`);
        }
        return false;
    }

    return true;
}

function showLastErrorMessage(e) {
    e.stopPropagation();
    showMessage(lastRegisteredErrorMessage.toReversed().slice(0, 5), 'error');
}

function adjustFontSize(elm, direction) {
    if (direction === 0) { return; }
    let scaleFactor = direction > 0 ? 1 : -1;
    let currentFontSize = window.getComputedStyle(elm, null).getPropertyValue('font-size');
    let fontSizeNumber = parseFloat(currentFontSize);
    if (isNaN(fontSizeNumber)) { return; }
    elm.style.fontSize = `${fontSizeNumber + scaleFactor}px`;
    Array.from(elm.children).forEach(child => adjustFontSize(child, direction));
}

async function modelLabelClicked(e){
    e.stopPropagation();
    let container = e.target;
    if(container.id !== 'modelNameContainer'){  container = e.target.closest('div#modelNameContainer');  }
    if(!container){  return;  }

    const isOpen = container.classList.contains('open');
    if(!isOpen){
        getAndShowModels();
        container.classList.add('open');
        return;
    }

    const shadowRoot = getShadowRoot();
    const availableModelsList = shadowRoot.querySelector('#availableModelList');
    availableModelsList.classList.add('invisible');
    container.classList.remove('open');
}

async function getAndShowModels(){
    let response;
    updateStatusBar('Loading model list...')
    try {
        response = await chrome.runtime.sendMessage({ action: "getModels" });
        if(typeof(response) === 'boolean' && !response) {  return;  }
        if(response.status !== 'success'){  throw new Error(response?.message || 'Unknown error!');  }
        laiOptions.modelList = response.models?.map(m => m.name).sort() || [];
        await chrome.storage.sync.set({[storageOptionKey]: laiOptions});
        fillAndShowModelList(response.models?.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
        showMessage(e.message, 'error');
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ERROR: ${e.message}`, e);
    } finally {  resetStatusbar();  }

}

function fillAndShowModelList(models){
    const shadowRoot = getShadowRoot();
    const modelList = shadowRoot.querySelector('#availableModelList');
    const modelsDropDown = shadowRoot.querySelector('#modelList');
    let opt = modelsDropDown.options[0];
    if(!modelList){
        showMessage('Failed to find model list!', 'error');
        return;
    }

    modelList.replaceChildren();
    modelsDropDown.replaceChildren();
    modelsDropDown.appendChild(opt);
    models.forEach((model, idx) => {
        const m = document.createElement('div');
        m.textContent = `${model.name}${model.name === laiOptions.aiModel ? ' ✔': ''}`;
        m.addEventListener('click', async e => {
            e.stopPropagation();
            modelsDropDown.selectedIndex = idx+1; // there is an extra empty option
            await swapActiveModel(e, model.name);
        });
        modelList.appendChild(m);

        opt = document.createElement('option');
        opt.text = opt.value = model.name;
        opt.selected = model.name === laiOptions.aiModel;
        modelsDropDown.appendChild(opt);
    });

    modelList.classList.remove('invisible');
}

async function swapActiveModel(e, modelName){
    e.stopPropagation();
    const activatedModel = e.target;
    const oldModel = laiOptions.aiModel;
    if(!activatedModel){  return;  }
    try {
        showSpinner();
        updateStatusBar(`Trying to remove ${oldModel} from the memory...`);
        let response = await chrome.runtime.sendMessage({action: "prepareModels", modelName: oldModel, unload: true });
        if(response.status !== 200){
            showMessage(`Failed to change the model!`, 'error');
            return;
        }

        updateStatusBar(`Trying to load ${modelName} into the memory...`);
        response = await chrome.runtime.sendMessage({action: "prepareModels", modelName: modelName, unload: false });
        if(response.status !== 200){
            showMessage(`Failed to change the model!`, 'error');
            return;
        }

        laiOptions.aiModel = modelName;
        await chrome.storage.sync.set({[storageOptionKey]: laiOptions});

        setModelNameLabel({ "model": modelName });
        const parent = activatedModel.parentElement;
        Array.from(parent.children).forEach(child => child.textContent = child.textContent.replace(/ ✔/g, ''));
        e.target.textContent = `${e.target.textContent} ✔`;
        parent.classList.add('invisible');
        const sideBar = getSideBar();
        sideBar.querySelector('div#modelNameContainer')?.classList.remove('open')
        showMessage(`${oldModel} model was replaced with ${modelName}.`, 'success');
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Error occured while changing the model`);
    } finally{  hideSpinner();  }
}

function updateStatusBar(status){
    if(!status) {  return;  }
    const sidebar = getSideBar();
    const statusbar = sidebar?.querySelector('div.statusbar');
    if(!statusbar) {  return;  }
    const notificationBlock = statusbar.querySelector('.notification');
    if(!notificationBlock) {  return;  }
    notificationBlock.textContent = status;
}

function resetStatusbar(){
    updateStatusBar('Ready.');
}

function micClicked(e) {
    let activeMic = e.target;
    let micContainer;
    if (activeMic.tagName === 'DIV' && activeMic.classList.contains('mic-container')) {
        micContainer = e.target;
        activeMic = activeMic.querySelector(':not(.invisible) img');
    } else {
        micContainer = activeMic.closest('div.mic-container');
    }

    const sideBar = getSideBar();
    const userInput = sideBar.querySelector('#laiUserInput');
    switch (activeMic.getAttribute('data-type') || '') {
        case 'mic':
            updateStatusBar('Working...');
            micContainer.classList.add('recording');
            break;
        case 'mic-off':
            userInput?.focus();
            updateStatusBar('Completed.');
            micContainer.classList.remove('recording');
            setTimeout(() => {  resetStatusbar();  }, 1000);
            break;
        default:
            updateStatusBar('Ready.');
            break;
    }

    if (typeof (toggleRecording) !== 'function') { return; }

    let status = toggleRecording(userInput)
    if (!status) {
        if (!micContainer?.classList?.contains('invisible')) {
            micContainer?.classList?.add('invisible');
        }
        resetStatusbar();
        return;
    }

    micContainer.querySelectorAll('img').forEach(img => {
        if (img.classList.contains('invisible')) {
            img.classList.remove('invisible');
        } else {
            img.classList.add('invisible');
        }
    });
}

/**
 * type may be "ai" or "user" defining which imput will be dumped
 * i is optional zero based index of the required block
 */
function dumpRawContent(type = 'ai', i) {
    const sideBar = getSideBar();
    if (!sideBar) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - SideBar not found!`);
        return;
    }

    const aiInputs = sideBar.querySelectorAll(`.lai-${type}-input .lai-input-text`);
    let content;
    if (i && i >= 0 && i < aiInputs.length) {
        content = aiInputs[i]?.rawContent.messages ? aiInputs[i]?.rawContent.messages.map(e => e.content).join('') : aiInputs[i]?.rawContent || '';
        console.log(`>>> ${manifest.name} - [${getLineNumber()}] - raw content:}`, content);
    } else {
        aiInputs.forEach((el, idx) => {
            content =  el.rawContent.messages ? el.rawContent?.messages.map(e => e.content).join('') : el.rawContent || '';
            console.log(`>>> ${manifest.name} - [${getLineNumber()}] - raw content: ${idx}`, content);
        });
    }
}

function storeLastGeneratedPrompt(data) {
    if (!data) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - No prompt received!`);
        return;
    }

    let promptData;
    try {
        promptData = typeof (data) === 'string' ? JSON.parse(data) : data;
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Error parsing received prompt`, data);
        return;
    }

    const sideBar = getSideBar();
    if (!sideBar) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - SideBar not found!`);
        return;
    }

    let usrInputs = Array.from(sideBar.querySelectorAll('.lai-user-input .lai-input-text'));
    if(usrInputs.length < 0){  return;  }
    usrInputs = usrInputs.slice(-1)[0];
    usrInputs.rawContent = promptData;
}

function dumpInConsole(message = '', obj, consoleAction = 'log'){
    try {
        obj = obj && typeof(obj) === 'string' ? JSON.parse(obj) : obj;
        if (message) {
            console[consoleAction](message, obj);
        }
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Error parsing JSON or logging message: ${error.message}`, error);
    }
}