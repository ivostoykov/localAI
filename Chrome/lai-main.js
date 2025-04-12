const laiWordEndings = /(?:\w+'(?:m|re|ll|s|d|ve|t))\s/;  // 'm, 're, 's, 'd, 'll, 've, 't
const laiWordFormations = /(?:'(?:clock|til|bout|cause|em))/; // 'clock, 'til, 'bout, 'cause, 'em
let restartCounter = 0;
const RESTART_LIMIT = 5;

function getRootElement() {
    return document.getElementById('localAI');
}

function getShadowRoot() {
    const el = document.documentElement.querySelector('localAI') || document.getElementById('localAI')
    return el?.shadowRoot;
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

async function laiInitSidebar() {
    const laiOptions = await getLaiOptions();
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
        const element = shadowRoot.getElementById('recycleCurrentSessionBtn');
        if (!element) {  return; }
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        element.dispatchEvent(event);
    });

    shadowRoot.querySelector('#optionsMenu')?.addEventListener('click', async function (e) {
        if (!checkExtensionState()) { return; }
        const cogMenu = shadowRoot.querySelector('#cogMenu');
        if (!cogMenu.classList.contains('invisible')) {
            cogMenu.classList.add('invisible');
        }

        try {
            updateStatusBar('Opening Option Page ...');
            await chrome.runtime.sendMessage({ action: "openOptionsPage" })
            if (chrome.runtime.lastError) { throw new Error(`${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        } catch (e) {
            if (e.message.indexOf('Extension context invalidated.') > -1) {
                showMessage(`${e.message}. Please reload the page.`, 'warning');
            }
            console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
        }
        finally {
            resetStatusbar();
            shadowRoot.getElementById('laiUserInput')?.focus();
        }
    });

    const toolFunctions = ribbon.querySelector('#toolFunctions');
    if(laiOptions?.toolsEnabled){
        toolFunctions.classList.remove('disabled');
    }else{
        toolFunctions.classList.add('disabled');
    }
    toolFunctions?.addEventListener('click', async e => {
        const el = e.target;
        const options = await getOptions();
        el.classList.toggle('disabled');
        if (el.classList.contains('disabled')) {
            el.alt = el.alt.replace(/Disable/g , 'Enable');
            el.title = el.alt;
            options["toolsEnabled"] = false;
        } else {
            el.alt = el.alt.replace(/Enable/g , 'Disable');
            el.title = el.alt;
            options["toolsEnabled"] = true;
        }
        updateStatusBar(`Tools are ${el.classList.contains('disabled') ? 'disabled' : 'enabled'}.`)
        setTimeout(() => resetStatusbar(), 3000);
        await setOptions(options);
    });
    ribbon.querySelector('#systemIntructions').addEventListener('click', laiShowSystemInstructions);
    ribbon.querySelector('#newSession').addEventListener('click', async e => await createNewSessionClicked(e, shadowRoot));
    ribbon.querySelector('#sessionHistry').addEventListener('click', async e => await showActiveSessionMenu(e));
    ribbon.querySelector('#apiUrlList').addEventListener('change', async e => await selectMenuChanged(e));
    ribbon.querySelector('#modelList').addEventListener('change', async e => await modelChanged(e) );
    ribbon.querySelector('#hookList').addEventListener('change', async e => await selectMenuChanged(e));
    ribbon.querySelector('#laiModelName').addEventListener('mouseenter', e => {
      updateStatusBar('Click to toggle the list with available models.');
      setTimeout(resetStatusbar, 10000);
    });

    shadowRoot.getElementById('recycleCurrentSessionBtn').addEventListener('click', async e => await recycleActiveSession(e, shadowRoot));
    shadowRoot.querySelector('#closeSidebarBtn')?.addEventListener('click', async e => await onCloseSidebarClick(e, shadowRoot));

    shadowRoot.getElementById('laiAbort').addEventListener('click', async e => await laiAbortRequest(e));
    if (laiOptions && laiOptions.openPanelOnLoad) {
        await laiSwapSidebarWithButton();
    }

    shadowRoot.getElementById('laiSessionHistryMenu').querySelectorAll('img').forEach(el => laiSetImg(el));

    const sysIntructInput = shadowRoot.querySelector('#laiSysIntructInput');
    sysIntructInput.value = laiOptions.systemInstructions || '';

    shadowRoot.getElementById('laiPinned').querySelectorAll('img').forEach(el => {
        el.addEventListener('click', async e => await laiPushpinClicked(e));
    });

    const laiChatMessageList = shadowRoot.getElementById('laiChatMessageList');
    laiChatMessageList.dataset.watermark = `${manifest.name} - ${manifest.version}`;
    laiChatMessageList.addEventListener('click', hidePopups);
    laiChatMessageList.addEventListener('scroll', (e) => {
        const fromBottom = laiChatMessageList.scrollHeight - laiChatMessageList.scrollTop - laiChatMessageList.clientHeight;
        userScrolled = fromBottom > 10 ? true : false;
        const chatList = e.target;
        const itemRibbon = chatList.querySelector('.lai-action-icons:not(.invisible)');
        if (!itemRibbon){  return;  }

        const elChatHist = itemRibbon.parentElement;
        const elChatHistRect = elChatHist.getBoundingClientRect();
        const chatListRect = chatList.getBoundingClientRect();
        const offset = elChatHistRect.top - chatListRect.top;

        if (offset < 0) {
            itemRibbon.style.position = 'fixed';
            itemRibbon.style.top = `${chatListRect.top}px`;
            itemRibbon.style.bottom = '';
        } else {
            itemRibbon.style.position = 'absolute';
            itemRibbon.style.top = `-${itemRibbon.getBoundingClientRect().height}px`;
            itemRibbon.style.bottom = '';
        }
    });

    const resizeHandle = shadowRoot.querySelector('.lai-resize-handle');
    laiSetImg(resizeHandle.querySelector('img'));

    resizeHandle.addEventListener('mousedown', e => laiResizeContainer(e));

    if (laiOptions.loadHistoryOnStart) {
        restoreLastSession().catch(er => console.error(er));
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
    await buildMenuDropdowns();
};

function getCurrentSystemInstructions(){
    const shadowRoot = getShadowRoot();
    if(!shadowRoot){  return '';  }
    const value = `${shadowRoot.querySelector('#laiSysIntructInput')?.value || ''}; timestamp: ${new Date().toISOString()}`;

    return value || '';
}

async function createNewSessionClicked(e, shadowRoot) {
    shadowRoot.getElementById('laiChatMessageList').replaceChildren();
    const userInput = shadowRoot.getElementById('laiUserInput')
    if(userInput){
        userInput.value = '';
        userInput.focus();
    } else {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ['laiUserInput'] element not found!`, userInput);
    }
    removeLocalStorageObject(activeSessionIndexStorageKey);
    showMessage('New session created.', 'success');
}

async function onCloseSidebarClick(e, shadowRoot) {
    const pinned = shadowRoot.getElementById('laiPinned');
    const pinImg = pinned.querySelector('img[data-type="black_pushpin"]');
    const isPinned = !pinImg.classList.contains('invisible');
    if (isPinned) {
        pinImg?.click();
    }
    await laiSwapSidebarWithButton(true);
}

async function  recycleActiveSession(e, shadowRoot){
    if(!shadowRoot){  shadowRoot = getShadowRoot();  }
    await deleteActiveSession();
    showMessage("Active session deleted.", "success");
    clearChatHistoryUI();
    const newSessionBtn = shadowRoot.querySelector('#newSession');
    newSessionBtn?.click();
}

async function recycleAllSessions(e, shadowRoot) {
    if(!shadowRoot){  shadowRoot = getShadowRoot();  }
    try {
        await Promise.all([
            removeLocalStorageObject(activeSessionKey),
            removeLocalStorageObject(allSessionsStorageKey),
            chrome.storage.sync.remove(activeSessionKey)
        ]);
        showMessage('Session history deleted.', 'success');
        await createNewSessionClicked(e, shadowRoot);
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${error.message}`, error);
        showMessage(error.message, 'error');
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

async function laiPushpinClicked(e) {
    const el = e.target;
    const laiOptions = await getLaiOptions();
    const container = el.closest('div');
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
    Object.keys(commandPlaceholders).forEach(cmd => {
        if (cmd.startsWith(input)) {
            const suggestion = document.createElement('div');
            suggestion.textContent = `${cmd} - ${commandPlaceholders.cmd}th`;
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
                if (chrome.runtime.lastError) { throw new Error(`${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
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

        if (isAskingForHelp(e) || await checkCommandHandler(e)) {
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

        messages = [];
        checkForDump(elTarget.value);

        // update UI
        addInputCardToUIChatHistory(elTarget.value, 'user', messages.length - 1);
        addInputCardToUIChatHistory('', 'ai');

        // update data
        addcommandPlaceholdersValues(elTarget.value);
        addAttachmentsToUserInput();

        messages = [{"role": "user", "content": `${elTarget.value}\n${messages.map(e => e.content).join('\n')}`}];
        if(images.length > 0){  messages[0]["images"] = images;  }

        try {
            dumpInConsole(`${[getLineNumber()]} - messages collected are ${messages.length}`, messages);
            if(!await getActiveSessionIndex()) {  await createNewSession(elTarget.value);  }
            shadowRoot.getElementById('laiAbort')?.classList.remove('invisible');
            shadowRoot.querySelector('#attachContainer')?.classList.remove('active');
            elTarget.classList.add('invisible');
            elTarget.value = '';
            await queryAI();
        } catch (e) {
            showMessage(`ERROR: ${e.message}`, error);
        } finally {
            clearAttachments();
        }
    }
}

function addAttachmentsToUserInput() {
    if (attachments.length < 1) { return false; }
    const l = attachments.length;
    const content = [];

    for (let i = 0; i < l; i++) {
        content.push(`ATTACHMENT ${i} START ${attachments[i]} ATTACHMENT ${i} END\n`);
    }
    if(content.length < 1){ return;  }

    content.push(`PAGE URL: ${document.location.href}\n`);
    messages.push({ "role": "user", "content": content.join('\n') });
}

function addcommandPlaceholdersValues(userInputValue){
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
    actionIconsDiv.classList.add('lai-action-icons', 'invisible');
    actionIconsDiv.appendChild(buildElements(type !== 'ai' ? [...arrButtons, ...arrEditButton] : arrButtons));
    lastChatElement.appendChild(lastChatlabel)
    lastChatElement.appendChild(lastChatText)
    lastChatElement.appendChild(actionIconsDiv);
    messageList.appendChild(lastChatElement);

    lastChatElement.addEventListener('mouseenter', function (e) {
        let elChatHist = e.target;
        if(!elChatHist.classList.contains('lai-chat-history')){  elChatHist = el.closest('.lai-chat-history');  }
        const el = e.target.querySelector('.lai-action-icons');
        if (!el) return;
        const elChatHistRect = elChatHist.getBoundingClientRect();
        const chatList = elChatHist.closest('#laiChatMessageList');
        const chatListRect = chatList.getBoundingClientRect();

        const offset = elChatHistRect.top - chatListRect.top;

        el.classList.remove('invisible');

        if (offset < 0) {
            el.style.position = 'fixed';
            el.style.top = `${chatListRect.offsetTop}px`;
            el.style.bottom = '';
        } else {
            el.style.position = 'absolute';
            if (elChatHist === chatList.firstElementChild) {
                el.style.top = `${elChatHist.offsetHeight - 4}px`;
                el.style.bottom = '';
            } else {
                el.style.top = `-${el.getBoundingClientRect().height}px`;
                el.style.bottom = '';
            }
        }
    });

    lastChatElement.addEventListener('mouseleave', function (e) {
        const el = e.target.querySelector('.lai-action-icons');
        if (!el) {  return;  }
        el.className = 'lai-action-icons invisible';
    });

    lastChatElement.querySelectorAll('.lai-chat-item-button').forEach(el => {
        el.addEventListener('click', async (e) => {
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
                    await copyChatElementContent(e, type);
                    break;
                case 'edit':
                    await editUserInput(e, type);
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

// index in the UI chat list
async function findElementHistoryIndex(el){
    const shadowRoot = getShadowRoot();
    const chatList = shadowRoot?.querySelector('#laiChatMessageList');
    const allInputText = Array.from(chatList?.querySelectorAll('.lai-input-text')) || [];
    const index = Array.from(allInputText).indexOf(el);
    if(index < 0){
        console.error(`[${getLineNumber()}]: Element not found in the session!`);
        return;
    }

    return index;
}

async function copyChatElementContent(e, type) {
    const evt = e;
    const element = e.target?.closest(`.lai-${type}-input`)?.querySelector('.lai-input-text');
    const textContent = element.innerText || '';
    // let textContent = element ? await getElementSessionContent(element) : '';

    try {
        await navigator.clipboard.writeText(textContent);
        laiShowCopyHint(evt)
    } catch (err) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Failed to copy text: ${err.message}`, err);
    }
}

async function editUserInput(e, type) {
    const element = e.target?.closest(`.lai-${type}-input`)?.querySelector('.lai-input-text');
    const textContent = element.innerText || '';
    // let textContent = element ? await getElementSessionContent(element) : '';
    const container = element.closest("#laiChatMessageList");
    const currentSession = await getActiveSession();
    const idx = await findElementHistoryIndex(element);

    const userInputField = container.parentElement.querySelector('#laiUserInput');
    userInputField.value = textContent;
    let children = Array.from(container?.querySelectorAll('.lai-chat-history'));

    if (idx > -1) {  children.slice(idx).forEach(child => child.remove());  }

    if((currentSession?.data || []).length > 0){
        currentSession.data.splice(idx, 1);
        if (currentSession.data.lengh > 0) {  await setActiveSession(currentSession);  }
        else {  await deleteActiveSession();  }
    }

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

async function laiSwapSidebarWithButton(forceClose = false) {
    const laiOptions = await getLaiOptions();
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) return;

    const slideElement = shadowRoot.getElementById('laiSidebar');
    const button = shadowRoot.getElementById('laiMainButton');
    if (!slideElement || !button) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Sidebar or button not found!`);
        return;
    }

    const isSidebarActive = slideElement.classList.contains('active');

    if (!forceClose && isSidebarActive && !laiOptions?.closeOnClickOut) return;

    slideElement.classList.toggle('active');

    const isNowActive = slideElement.classList.contains('active');
    button.classList.toggle('invisible', isNowActive); // hide button if sidebar shown
    if (isNowActive) {
        slideElement.querySelector('textarea#laiUserInput')?.focus();
    }
}

async function laiUpdateMainButtonStyles() {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) return;

    const laiOptions = await getLaiOptions();
    const btn = shadowRoot.getElementById('laiMainButton');
    if (!btn) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Main button not found!`);
        return;
    }

    btn.classList.toggle('invisible', !laiOptions?.showEmbeddedButton);
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

async function laiAbortRequest(e) {
    const renderingEl = laiGetRecipient();
    if(renderingEl && renderingEl?.dataset?.status) {  return;  } // ai generation completed and rendering has started
    if (checkExtensionState()) {
        try {
            await chrome.runtime.sendMessage({ action: "abortFetch" });
            if (chrome.runtime.lastError) { throw new Error(`${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        } catch (e) {
            console.error(`>>> ${manifest.name} - [${getLineNumber()}] - error: ${e.message}`, e);
        }
    }

    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    shadowRoot?.getElementById('laiAbort')?.classList.add('invisible');
    shadowRoot?.getElementById('laiUserInput')?.classList.remove('invisible');
}

async function queryAI() {
    const laiOptions = await getLaiOptions();
    if (!checkExtensionState()) {
        setTimeout(async () => await laiAbortRequest(), 1000);
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
        data: data,
    };

    try {
        updateStatusBar('Prompt sent to the model, awaiting response...');
        const response = await chrome.runtime.sendMessage(requestData);
        if (chrome.runtime.lastError) { throw new Error(`${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }

        if (response?.status === 'error' && response?.message) {
            showMessage(response.message, 'error');
        }

    } catch (e) {
        if (e.message.indexOf('Extension context invalidated.') > -1) {
            showMessage(`${e.message}. Please reload the page.`, 'warning');
        }
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    }
    finally {
        resetStatusbar();
        shadowRoot.getElementById('laiUserInput')?.focus();
    }
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
    const responseJson = response.response;
    try {
        response = JSON.parse(responseJson);
    } catch (err) {
        showMessage(err.message, 'error');
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${err.message}`, err);
        return '';
    }

    setModelNameLabel(response.model || 'unknown');
    return response?.message?.content || "Empty content!";
}

function createAbortHandler(controller, abortBtn, rootEl) {
    return function abortHandler() {
        controller.abort();
        abortBtn?.removeEventListener('click', abortHandler);
        resetStatusbar();
        laiHandleStreamActions("Stream Aborted", rootEl, '... Aborted');
    };
}

function scrollChatHistoryContainer(e){
    if (userScrolled) {  return; }
    const shadowRoot = getShadowRoot();
    const laiChatMessageList = shadowRoot.querySelector('#laiChatMessageList');
    if(!laiChatMessageList){
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - laiChatMessageList not found!`, laiChatMessageList);
        return;
    }
    laiChatMessageList.scrollTop = laiChatMessageList.scrollHeight;
}

function renderCompleteFired(e){
    const laiChatMessageList = e.target.closest('#laiChatMessageList');
    laiChatMessageList.scrollTop = laiChatMessageList.scrollHeight;
    resetStatusbar();
    laiHandleStreamActions("Streaming response ended", e.target);
}

function getParseAndRenderOptions(rootEl) {
    if (!rootEl) {  throw new Error(`>>> ${manifest.name} - [${getLineNumber()}] - Target element not found!`);  }

    const shadowRoot = getShadowRoot();
    const controller = new AbortController();
    const abortBtn = shadowRoot.getElementById('laiAbort');

    const abortHandler = createAbortHandler(controller, abortBtn, rootEl);

    rootEl.addEventListener('renderComplete', renderCompleteFired);
    rootEl.addEventListener('rendering', scrollChatHistoryContainer);
    abortBtn?.addEventListener('click', abortHandler);

    return {  abortSignal: controller.signal  };
}

chrome.runtime.onMessage.addListener(async (response) => {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) {
        if(restartCounter < RESTART_LIMIT){
            restartCounter++;
            console.log(`>>> ${manifest.name} - [${getLineNumber()}] - restarting: ${restartCounter}`);
            start();
        }
        return;
    }

    let recipient;
    try {
        if(['dumpInConsole'].indexOf(response.action)< 0){
            recipient = shadowRoot.getElementById('laiActiveAiInput');
            if (!recipient) {
                recipient = Array.from(shadowRoot.querySelectorAll('.lai-ai-input .lai-input-text')).pop();
                recipient?.setAttribute("id", "laiActiveAiInput");
            }
            if (!recipient && response.action.toLowerCase().startsWith('stream')) {
            // if (!recipient && ['toggleSidebar', 'activePageSelection', 'activePageContent', 'toggleSelectElement', 'explainSelection'].indexOf(response.action) < 0) {
                console.log(`>>> ${manifest.name} - [${getLineNumber()}] - no recipient`);
                return;
            }
        }
    } catch (error) {
        console.log(`>>> ${manifest.name} - [${getLineNumber()}] - restarting: ${restartCounter}`, error, response);
    }


    switch (response.action) {
        case "streamData":

            let dataChunk;
            let streamDataError;
            try {
                const activeSession = await getActiveSession();
                dataChunk = laiExtractDataFromResponse(response);
                if (!dataChunk) { return; }
                activeSession.data.push(dataChunk);
                await setActiveSession(activeSession);
                updateStatusBar('Receiving and processing data...');
                const rootRecipient = laiGetRecipient();
                if(!rootRecipient) {  throw new Error(`>>> ${manifest.name} - [${getLineNumber()}] - Target element not found!`) }
                await parseAndRender(dataChunk, rootRecipient, getParseAndRenderOptions(rootRecipient) || {});
            } catch (err) {
                streamDataError = err;
                console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${err.message}`, err, dataChunk, response);
            }
            break;
        case "streamEnd":
            break;
        case "streamError":
            laiHandleStreamActions("Stream Error", recipient);
            break;
        case "streamAbort":
            laiHandleStreamActions("Stream Aborted", recipient, '... Aborted');
            break;
        case "toggleSidebar":
            await laiSwapSidebarWithButton(true);
            break;
        case "activePageSelection":
            if(!response.selection){
                showMessage('Element picked up successfully.', 'info')
                console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Selection is missing or empty!: `, response);
                break;
            }
            attachments.push(response.selection);
            showAttachment(`${response.selection?.split(/\s+/).slice(0, 5).join(' ')}...`);
            showMessage('Selection included.', 'info')
            updateStatusBar('Selected content added to the context.');
            break;
        case "activePageContent":
            attachments.push(getPageTextContent());
            showAttachment(document?.title || 'Current page');
            showMessage('Page included.', 'info')
            updateStatusBar('Selected content added to the context.');
            break;
        case 'explainSelection':
            await ask2ExplainSelection(response);
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

    if (response.error) {
        showMessage(response.error, 'error');
        resetStatusbar();
    }
});

function laiHandleStreamActions(logMessage, recipient, abortText = '') {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const renderRootEl = laiGetRecipient();
    console.debug(`[${getLineNumber()}] - rendering status: ${renderRootEl?.dataset.status}`);
    let textAres = shadowRoot.getElementById('laiUserInput');
    const laiAbortElem = shadowRoot.getElementById('laiAbort');
    // recipient.removeAttribute("id");

    if (laiAbortElem) {  laiAbortElem.classList.add('invisible');  }
    if (textAres) {
        textAres.classList.remove('invisible');
        textAres.focus();
    } else {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - User input area not found!`);
    }

    if (abortText && recipient) {
        const span = document.createElement('span');
        if(span){
            span.classList.add("lai-aborted-text");
            span.textContent = abortText;
            recipient.appendChild(span);
        } else { recipient.innerHTML += `<span class="lai-aborted-text">${abortText}</span>`;  }
    }
}

function laiGetRecipient() {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) {
        console.error("Root element not found!", shadowRoot);
        return;
    }

    const aiInputs = shadowRoot.querySelectorAll('.lai-ai-input');
    if (!aiInputs) { throw Error('AI reponse element not found!'); }

    const recipient = aiInputs[aiInputs.length - 1].querySelector('.lai-input-text');
    if (!recipient) { throw Error('No recipient found!'); }

    return recipient;
}

function getPageTextContent() {
    const bodyClone = document.body.cloneNode(true);

    const removed = document.createElement('div');
    removed.style.display = 'none';
    ['local-ai', 'script', 'link', 'button', 'select', 'style', 'svg', 'code', 'img', 'fieldset', 'aside', 'audio', 'video','embed', 'object', 'picture', 'source', 'track', 'canvas'].forEach(selector => {
        bodyClone.querySelectorAll(selector).forEach(el => removed.appendChild(el));
    });

    let content = [];
    const walker = document.createTreeWalker(bodyClone, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node?.nodeValue || !(/[^\n\s\r]/.test(node?.nodeValue))) { continue; }
        content.push(node.nodeValue?.trim());
    }

    return ` PAGE URL: ${document.location.href}\nPAGE CONTENT START: ${content.join('\n')} PAGE CONTENT END`;
}

async function ask2ExplainSelection(response) {
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
        await laiSwapSidebarWithButton();
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

async function checkForHooksCmd(e){
    const userInput = e.target?.value?.trim() || '';
    if (!userInput || !/(?<!\\)\/(web)?hooks?\s*/i.test(userInput.toLowerCase())) {  return false;  }
    e.target.value = userInput.replace(/(?<!\\)\/(web)?hooks?\s*/g, '');
    updateStatusBar('Loading defined hooks...');
    try {
        const res = await chrome.runtime.sendMessage({ action: "getHooks" });
        if (chrome.runtime.lastError) { throw new Error(`${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        showHooks(res);
    } catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    } finally {
        resetStatusbar();
    }

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

async function checkCommandHandler(e) {
    let res = false;
    const userInput = e.target;
    if (!userInput || (userInput?.value?.trim() || '') === '') { return res; }

    if(await checkForHooksCmd(e)){  return true;  }

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

    for (const command in commandPlaceholders) {
        const li = document.createElement('li');
        li.innerHTML = `<strong>${command}</strong>: ${commandPlaceholders[command]}`;
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

async function restoreLastSession(sessionIdx) {
    const allSessions = await getAllSessions();
    if(allSessions.length < 1){
        showMessage('No stored sessions found.');
        return;
    }
    if(isNaN(sessionIdx) || typeof(sessionIdx) !== 'number'){  sessionIdx = Math.max(allSessions.length -1, 0);  }
    const session = allSessions[sessionIdx];
    await setActiveSessionIndex(sessionIdx);
    if (!session || !session.data || session.length < 1) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - No data found in current session.`, session);
        return;
    }
    clearChatHistoryUI();
    session.data?.forEach(async (msg, i) => {
        const role = msg?.role?.replace(/assistant/i, 'ai');
        if(!role) {  return;  }
        if(role === 'ai'){
            addInputCardToUIChatHistory('', role, i);
            const aiReplyTextElement = laiGetRecipient();
            await parseAndRender(msg.content, aiReplyTextElement, {streamReply: false});
        }
        else{  addInputCardToUIChatHistory(msg.content, role, i);  }
    });

    const shadowRoot = getShadowRoot();
    const laiChatMessageList = shadowRoot.querySelector('#laiChatMessageList');
    laiChatMessageList.scrollTop = laiChatMessageList.scrollHeight;

    showMessage(`session #${sessionIdx} restored.`, 'info');
}

function clearChatHistoryUI(){
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const messageList = shadowRoot.getElementById('laiChatMessageList');
    if(messageList){
        messageList.innerHTML = '';
    }
}

async function showActiveSessionMenu(e) {
    const target = e.target;
    e.preventDefault();
    const allSessions = await getAllSessions();
    if (allSessions.length < 1) {
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

    const menuItemContent = allSessions.filter(a => a.title).filter(Boolean)
    if(allSessions.length > 0 && menuItemContent.length < 1){
        showMessage(`${allSessions.length} sessions found but failed to list them!`);
        return;
    }
    else if (menuItemContent.length < 1) {
        showMessage('No stored sessions found.');
        return;
    }

    menuItemContent.push({"title": "---" });
    menuItemContent.push({"title": "Delete all sessions" });
    for (let i = 0, l = menuItemContent.length; i < l; i++) {
        const userEl = menuItemContent[i];
        let menuItem = document.createElement(userEl.title === '---' ? 'hr' : 'div');
        if (userEl.title !== '---') {
            menuItem.className = 'menu-item';
            menuItem.textContent = `${(userEl?.title?.substring(0, 35)) || 'Noname'}${userEl?.title?.length > 35 ? '...' : ''}`;
            if (i === l - 1) {
                menuItem.addEventListener('click', async (e) => {
                    const el = e.target;
                    try {
                        // await chrome.storage.local.remove(allSessionsStorageKey);
                        // await chrome.storage.local.remove(activeSessionKey);
                        await recycleAllSessions();
                    } catch (error) {
                        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${error.message}`, error);
                    }
                    el.closest('div#sessionHistMenu').remove();
                    showMessage('All sessions deleted.');
                });
            } else {
                menuItem.addEventListener('click', async (e) => {
                    const el = e.target;
                    await restoreLastSession(i);
                    el.closest('div#sessionHistMenu').remove();
                });
            }
        }

        sessionHistMenu.appendChild(menuItem);
    }

    sessionHistMenu.classList.remove('invisible');
    sessionHistMenu.style.cssText = `top: ${e.clientY + 10}px;; left: ${e.clientX - (sessionHistMenu.offsetWidth / 4)}px;`;
}

async function modelChanged(e){
    const laiOptions = await getLaiOptions();
    const oldModelName = laiOptions.aiModel;
    const newModelName = e.target.options[e.target.selectedIndex].value;
    try {
        await chrome.runtime.sendMessage({action: "prepareModels", modelName: oldModelName, unload: true });
        if (chrome.runtime.lastError) { throw new Error(`${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        await chrome.runtime.sendMessage({action: "prepareModels", modelName: newModelName, unload: false });
        if (chrome.runtime.lastError) { throw new Error(`${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
    } catch (err) {
        console.log(`>>> ${manifest.name} - [${getLineNumber()}]`, err);
    }
    laiOptions.aiModel = newModelName;
    await setOptions(laiOptions);
    setModelNameLabel({ "model": laiOptions.aiModel });
}

async function selectMenuChanged(e) {
    const laiOptions = await getLaiOptions();
    const id = e.target.id;
    switch (id) {
        case 'apiUrlList':
            laiOptions.aiUrl = e.target.options[e.target.selectedIndex].value;
            break;
        case 'hookList':
            console.log(`>>> ${manifest.name} - [${getLineNumber()}] - ${id} is not implemented yet`);
            break;
    }
}

function hideaictiveSessionMenu() {
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
    const laiOptions = await getLaiOptions();
    let response;
    updateStatusBar('Loading model list...')
    try {
        response = await chrome.runtime.sendMessage({ action: "getModels" });
        if (chrome.runtime.lastError) { throw new Error(`${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        if(typeof(response) === 'boolean') {  return;  }
        if(!response){  throw new Error(`[${getLineNumber()}] - Server does not respond!`);  }
        if(response.status !== 'success'){  throw new Error(response?.message || 'Unknown error!');  }
        laiOptions.modelList = response.models?.map(m => m.name).sort() || [];
        await setOptions(laiOptions);
        fillAndShowModelList(response.models?.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
        showMessage(e.message, 'error');
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ERROR: ${e.message}`, e, response);
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
    models.forEach(async (model, idx) => {
        const laiOptions = await getOptions();
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
    const parent = activatedModel.parentElement;
    const laiOptions = await getOptions();
    const oldModel = laiOptions.aiModel;
    if(!activatedModel){  return;  }
    try {
        showSpinner();
        updateStatusBar(`Trying to remove ${oldModel} from the memory...`);
        let response = await chrome.runtime.sendMessage({action: "prepareModels", modelName: oldModel, unload: true });
        if (chrome.runtime.lastError) { throw new Error(`${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        if(response.status !== 200){
            showMessage(`Failed to change the model!`, 'error');
            return;
        }

        updateStatusBar(`Trying to load ${modelName} into the memory...`);
        response = await chrome.runtime.sendMessage({action: "prepareModels", modelName: modelName, unload: false });
        if (chrome.runtime.lastError) { throw new Error(`${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        if(response.status !== 200){
            showMessage(`Failed to change the model!`, 'error');
            return;
        }

        laiOptions.aiModel = modelName;
        await setOptions(laiOptions);

        setModelNameLabel({ "model": modelName });
        Array.from(parent.children).forEach(child => child.textContent = child.textContent.replace(/ ✔/g, ''));
        activatedModel.textContent = `${activatedModel.textContent} ✔`;
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