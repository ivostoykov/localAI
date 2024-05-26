const laiWordEndings = /(?:\w+'(?:m|re|ll|s|d|ve|t))\s/;  // 'm, 're, 's, 'd, 'll, 've, 't
const laiWordFormations = /(?:'(?:clock|til|bout|cause|em))/; // 'clock, 'til, 'bout, 'cause, 'em
const manifest = chrome.runtime.getManifest();

function getRootElement(){
    return document.getElementById('localAI');
}

function getShadowRoot() {
    return document.getElementById('localAI')?.shadowRoot;
}

function laiInitSidebar() {
    const root = getRootElement();
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }

    shadowRoot.querySelector('#feedbackMessage').addEventListener('click', e => e.target.classList.remove('feedback-message-active'));

    shadowRoot.querySelector('#version').textContent = `${manifest.name} - ${manifest.version}`;
    const ribbon = shadowRoot.querySelector('div.lai-ribbon');
    ribbon.addEventListener('mouseenter', e => e.target.querySelector('#version')?.classList.remove('lai-invisible'));
    ribbon.addEventListener('mouseleave', e => e.target.querySelector('#version')?.classList.add('lai-invisible'));

    const userInput = shadowRoot.getElementById('laiUserInput');
    userInput.addEventListener('keydown', onLaiTextAreaKeyUp);
    userInput.addEventListener('click', e => e.target.closest('div.lai-user-area').classList.add('focused'));
    userInput.addEventListener('blur', e => e.target.closest('div.lai-user-area').classList.remove('focused'));

    if(root) {
        root.addEventListener('dragenter', onUserInputDragEnter);
        root.addEventListener('dragleave', onUserInputDragLeave);
        root.addEventListener('dragover', function(e) {
            e.preventDefault();
            return false;
        });
        root.addEventListener('drop', onUserInputFileDropped);
    }

    ribbon.querySelectorAll('img').forEach(el => laiSetImg(el));
    shadowRoot.querySelector('#cogBtn')?.addEventListener('click', function (e) {
        chrome.runtime.sendMessage({ action: "openOptionsPage" });
        shadowRoot.getElementById('laiUserInput')?.focus();
    });

    ribbon.querySelector('#systemIntructions').addEventListener('click', laiShowSystemInstructions);
    ribbon.querySelector('#newSession').addEventListener('click', e => createNewSession(e, shadowRoot));
    ribbon.querySelector('#sessionHistry').addEventListener('click', showSessionHistoryMenu);

    shadowRoot.getElementById('laiRecycleAll').addEventListener('click', e => recycleSession(e, shadowRoot));
    shadowRoot.querySelector('#closeSidebarBtn')?.addEventListener('click', e => onCloseSidebarClick(e, shadowRoot));

    shadowRoot.getElementById('laiAbort').addEventListener('click', laiAbortRequest);
    if (laiOptions && laiOptions.openPanelOnLoad) {
        laiSwapSidebarWithButton();
    }

    shadowRoot.getElementById('laiSessionHistryMenu').querySelectorAll('img').forEach(el => laiSetImg(el));

    const sysIntructInput = shadowRoot.querySelector('#laiSysIntructInput');
    sysIntructInput.value = laiOptions.systemInstructions || '';
    sysIntructInput.addEventListener('change', e => onSystemInstructionsChange(e));

    shadowRoot.getElementById('laiPinned').querySelectorAll('img').forEach(el => {
        el.addEventListener('click', laiPushpinClicked);
    });

    const laiChatMessageList = shadowRoot.getElementById('laiChatMessageList');
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
};

function onSystemInstructionsChange(e) {
    const value = e.target.value;
    if (!value) {
        return;
    }

    const index = messages.findIndex(message => message.role === "system");
    if (index !== -1) {
        messages[index].content += value;
    } else {
        messages.push({ role: "system", content: value });
    }
}

function createNewSession(e, shadowRoot) {
    aiSessions.push([]);
    activeSessionIndex = aiSessions.length - 1;
    shadowRoot.getElementById('laiChatMessageList').replaceChildren();
    messages = [];
    shadowRoot.getElementById('laiUserInput')?.focus();
}

function onCloseSidebarClick(e, shadowRoot) {
    const pinned = shadowRoot.getElementById('laiPinned');
    const pinImg = pinned.querySelector('img[data-type="black_pushpin"]');
    const isPinned = !pinImg.classList.contains('lai-invisible');
    if (isPinned) {
        pinImg?.click();
    }
    laiSwapSidebarWithButton(true);
}

function recycleSession(e, shadowRoot) {
    aiSessions.splice(activeSessionIndex, 1);
    createNewSession(e, shadowRoot)
    setAiSessions().then().catch(e => console.error('>>>', e));
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
        img.classList.toggle('lai-invisible');
        if (img.getAttribute('data-type') === 'black_pushpin') {
            isPinned = !img.classList.contains('lai-invisible');
        }
    });

    laiOptions.closeOnClickOut = !isPinned;
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    shadowRoot.getElementById('laiUserInput')?.focus();
}

function laiCheckForDump(userText) {
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
    suggestionBox.classList.remove('lai-invisible');
}

function laiHideSuggestions() {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const suggestionBox = shadowRoot.getElementById('laiSuggestionBox');
    suggestionBox.classList.add('lai-invisible');
}

// user input
function onUserInputDragEnter(e) {
    e.stopImmediatePropagation()
    e.preventDefault();

    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const dropzone = shadowRoot.getElementById('dropzone');
    dropzone.classList.remove('lai-invisible');
    setTimeout(() => dropzone.classList.add('hover'), 50);
}

function onUserInputDragLeave(e) {
    e.stopImmediatePropagation()
    e.preventDefault();

    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const dropzone = shadowRoot.getElementById('dropzone');
    dropzone.classList.remove('hover');
    setTimeout(() => dropzone.classList.add('lai-invisible'), 750); // wait transition to complete
}

function onUserInputFileDropped(e) {
    e.stopImmediatePropagation()
    e.preventDefault();

    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const userInput = shadowRoot.getElementById('laiUserInput');
    const dropzone = shadowRoot.getElementById('dropzone');
    dropzone.classList.remove('hover');
    setTimeout(() => dropzone.classList.add('lai-invisible'), 750);

    const files = e.dataTransfer.files;
    for (const file of files) {
        const fileName = file.name.split(/\\\//).pop();
        const reader = new FileReader();
        reader.onload = function(e) {
            if(!Array.isArray(attachments)){  attachments = [];  }
            attachments.push(`file name: ${fileName}; file content: ${e.target.result}`);
            showAttachment(fileName);
        };
        reader.readAsText(file);
    }
}

function showAttachment(title){
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }

    const attachmentContainer = shadowRoot.querySelector('#attachContainer');
    if(!attachmentContainer.classList.contains('active')){
        attachmentContainer.classList.add('active');
    }

    const img = createAttachmentImage(title);
    if(img){
        attachmentContainer.appendChild(img);
    }
}

function createAttachmentImage(title) {
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

function attachmentDeleted(){
    if (attachments.length > 0) {  return;  }

    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    shadowRoot.querySelector('#attachContainer')?.classList.remove('active');
}

function clearAttachments(){
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const attachmentContainer = shadowRoot.querySelector('#attachContainer');
    if(!attachmentContainer) {  return;  }
    attachmentContainer.replaceChildren();
    attachmentContainer.classList.remove('active');
    attachments = [];
}

/* function laiHandleUserInput(e) {
    // const shadowRoot = getShadowRoot();
    // if (!shadowRoot) { return; }
    // const value = e.target.value;
    // adjustHeight(e.target);
    // const cursorPosition = e.target.selectionStart;
    // const textUpToCursor = value.substring(0, cursorPosition);
    // const commandMatch = textUpToCursor.match(/@\{\{[^\{\}]*$/);
} */

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

function onLaiTextAreaKeyUp(e) {
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

        const inputChunks = splitInputToChunks(e.target.value, 4096);
        laiCheckForDump(e.target.value);
        addUserInputIntoMessageQ(inputChunks);

        laiUpdateChatHistoryWithUserInput(e.target.value, 'user', messages.length - 1);
        laiUpdateChatHistoryWithUserInput('', 'ai');
        addAttachmentsToUserInput();
        laiQueryAI();
        clearAttachments();
        e.target.value = '';
        e.target.classList.add('lai-invisible');
        shadowRoot.getElementById('laiAbort')?.classList.remove('lai-invisible');
    }
}

function addAttachmentsToUserInput(){
    if(attachments.length < 1){  return false;  }
    for (let i = 0; i < attachments.length; i++) {
        const inputChunks = splitInputToChunks(attachments[i], 4096);
        for (let i = 0; i < inputChunks.length; i++) {
            messages.push({ "role": "user", "content": inputChunks[i] });
        }
    }
}

function addUserInputIntoMessageQ(inputChunks, omitFromSession = false) {
    if(aiSessions.length < 1){  aiSessions[0] = [];  }
    for (let i = 0; i < inputChunks.length; i++) {
        messages.push({ "role": "user", "content": inputChunks[i] });
        if(omitFromSession)  {  continue;  }
        aiSessions[activeSessionIndex].push({ "role": "user", "content": inputChunks[i] });
    }
}

function splitInputToChunks(str, chunkSize) {
    const chunks = [];
    for (let i = 0; i < str.length; i += chunkSize) {
        chunks.push(str.slice(i, i + chunkSize));
    }
    return chunks;
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

function laiUpdateChatHistoryWithUserInput(inputText, type, index = -1) {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const chatHist = shadowRoot.getElementById('laiChatMessageList');
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
    let buttons = '<span class="lai-delete-chat-item-action" data-type="delete"></span><span class="lai-copy-chat-item-action" data-type="copy"></span>';
    if (type !== 'ai' && index > -1) {
        buttons += `<span class="lai-edit-item-action" data-type="edit" data-index=${index}><img src="${chrome.runtime.getURL('img/edit.svg')}"></span>`;
    }
    const actionIconsDiv = Object.assign(document.createElement('div'), {
        // id: `${type === 'ai' ? 'laiActiveAiInput' : ''}`,
        className: 'lai-action-icons lai-invisible',
        innerHTML: buttons
    });

    lastChatElement.appendChild(lastChatlabel)
    lastChatElement.appendChild(lastChatText)
    lastChatElement.appendChild(actionIconsDiv);
    chatHist.appendChild(lastChatElement);
    lastChatElement.addEventListener('mouseenter', function (e) {
        const el = e.target.querySelector('.lai-action-icons');
        el?.classList.remove('lai-invisible');
    });
    lastChatElement.addEventListener('mouseleave', function (e) {
        const el = e.target.querySelector('.lai-action-icons');
        el?.classList.add('lai-invisible');
    });

    lastChatElement.querySelectorAll('.lai-copy-chat-item-action, .lai-delete-chat-item-action, .lai-edit-item-action').forEach(el => {
        el.addEventListener('click', function (e) {
            let action = e.target.getAttribute('data-type');
            if (!action) {
                action = e.target.parentElement.getAttribute('data-type');
            }
            if (!action) { return; }
            switch (action) {
                case 'copy':
                    laiCopyElementContent(e, type);
                    // navigator.clipboard.writeText(e.target.closest(`.lai-${type}-input`)?.querySelector('.lai-input-text')?.textContent || '');
                    break;
                case 'delete':
                    e.target.closest(`.lai-${type}-input`)?.remove();
                    break;
                case 'edit':
                    editUserInput(e, type);
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

    chatHist.scrollTop = chatHist.scrollHeight;
}

function laiShowCopyHint(e) {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const hint = shadowRoot.getElementById('laiCopyHint');

    hint.style.right = '';
    hint.style.left = '';
    hint.style.opacity = 0;
    hint.classList.remove('lai-invisible');

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
        hint.classList.add('lai-invisible');
    }, 2500);
}

function laiCopyElementContent(e, type) {
    const element = e.target.closest(`.lai-${type}-input`)?.querySelector('.lai-input-text');

    let htmlContent = element.innerHTML;
    const modifiedHtml = htmlContent.replace(/<br\s*\/?>/gi, '\n');

    const tempElement = document.createElement('div');
    tempElement.innerHTML = modifiedHtml;

    const textToCopy = tempElement.textContent;

    navigator.clipboard.writeText(textToCopy)
        .then(() => laiShowCopyHint(e))
        .catch(err => console.error('Failed to copy text: ', err));
}

function editUserInput(e, type) {
    let el = e.target.closest('span[data-index]');
    const idx = el.getAttribute('data-index') || -1;
    if (idx < 0) { return; }
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const userInputField = shadowRoot.getElementById('laiUserInput')
    userInputField.value = messages[idx].content;
}

// handle code snippets clicks in AI response
function laiSourceTextClicked(e) {
    const clickedSourceTitle = e.target.closest('.lai-source-title');
    if (!clickedSourceTitle) { return; }
    const thePre = clickedSourceTitle.closest('pre');
    if (!thePre) { return; }
    const theCode = thePre.cloneNode(true);
    theCode.querySelector('span')?.remove();
    const textToCopy = theCode.innerHTML.replace(/<br\s*\/?>/gi, '\n');

    navigator.clipboard.writeText(textToCopy)
        .then(() => {
            clickedSourceTitle.classList.toggle('copied');
            setTimeout(() => clickedSourceTitle.classList.toggle('copied'), 3000);
        })
        .catch(err => console.error('Failed to copy text: ', err));
}

function laiSwapSidebarWithButton(forceClose = false) {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const slideElement = shadowRoot.getElementById('laiSidebar');
    if (!slideElement) {
        console.error('Slidebar not found!');
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
        console.error('Main button not found!');
        return;
    }

    const isButtonVisible = !btn.classList.contains('lai-invisible');

    if (!isButtonVisible && laiOptions?.showEmbeddedButton) { // if not visible but should be - show it
        btn.classList.toggle('lai-invisible');
    } else {
        btn.classList.toggle('lai-invisible'); // hide if visible
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
            laiShowMessage(`Unknown type ${type}`);
    }
}

function laiAbortRequest(e) {
    chrome.runtime.sendMessage({ action: "abortFetch" }, () => {
        console.log("Abort message sent");
    });
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    shadowRoot?.getElementById('laiAbort')?.classList.add('lai-invisible');
    shadowRoot?.getElementById('laiUserInput')?.classList.remove('lai-invisible');
}


function laiQueryAI() {

    const requestData = {
        action: "fetchData",
        port: laiOptions.localPort || '1234',
        path: '/v1/chat/completions',
        data: {
            "messages": messages,
            "temperature": 0.5,
            "max_tokens": 1024,
            "stream": true
        }
    };

    chrome.runtime.sendMessage(requestData, (response) => {
        if (response?.error) {
            console.error("Fetch error:", response.error);
        }
    });
}

function laiSetModelName(data) {
    if (!data) { return; }
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const modelName = shadowRoot.getElementById('laiModelName');
    const model = data?.model;
    if (!model) { return; }
    modelName.textContent = model.split(/\\|\//).pop().split('.').slice(0, -1).join('.');
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
    const parts = (response?.data?.split(': ') || []).slice(-1);
    const jsonPart = parts[0];
    if (jsonPart.toUpperCase() === '[DONE]') { return; }
    let data = '';
    try {
        data = JSON.parse(jsonPart);
    } catch (err) {
        throw err;
    }

    laiSetModelName(data);
    return (data?.choices?.[0]?.delta?.content || '');
}

chrome.runtime.onMessage.addListener((response) => {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    let recipient = shadowRoot.getElementById('laiActiveAiInput');
    if (!recipient) {
        recipient = Array.from(shadowRoot.querySelectorAll('.lai-ai-input .lai-input-text')).pop();
        recipient?.setAttribute("id", "laiActiveAiInput");
    }
    if (!recipient && ['toggleSidebar', 'activePageSelection', 'activePageContent', 'toggleSelectElement'].indexOf(response.action) < 0) {
        console.log("no recipient");
        return;
    }

    switch (response.action) {
        case "streamData":

            try {
                let dataChunk = laiExtractDataFromResponse(response);
                if (!dataChunk) { return; }
                StreamMarkdownProcessor.processStreamChunk(dataChunk, laiGetRecipient);
            } catch (err) {
                laiHandleStreamActions(`${err}`, recipient)
                console.error(err);
                console.log(response);
            }
            break;
        case "streamEnd":
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
            laiAppendSelectionToUserImput(response.selection);
            break;
        case "activePageContent":
            laiAppendSelectionToUserImput(response.selection.replace(/\s{1,}/gm, ' '));
            break;
        case "toggleSelectElement":
            isElementSelectionActive = response.selection;
            break;
        default:
            laiHandleStreamActions(`Unknown action: ${response.action}`, recipient);
            break;
    }

    if (!userScrolled) {
        const laiChatMessageList = shadowRoot.getElementById('laiChatMessageList');
        laiChatMessageList.scrollTop = laiChatMessageList.scrollHeight;
    }
});

function laiHandleStreamActions(logMessage, recipient, abortText = '') {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    let textAres = shadowRoot.getElementById('laiUserInput');
    const laiAbortElem = shadowRoot.getElementById('laiAbort');
    recipient.removeAttribute("id");
    const streamData = StreamMarkdownProcessor.getRawContent();

    if (laiAbortElem) laiAbortElem.classList.add('lai-invisible');
    if (textAres) {
        textAres.classList.remove('lai-invisible');
        textAres.focus();
    } else {
        console.error('User input area not found!');
    }

    if (streamData) {
        messages.push({ "role": "assistant", "content": streamData });
        aiSessions[activeSessionIndex].push({ "role": "assistant", "content": streamData });
        /*         if(messages.length > laiOptions.chatHistory){
                    messages.split(1, 1);
                } */
    }

    if (abortText && recipient) {
        recipient.innerHTML += `<span class="lai-aborted-text">${abortText}</span>`;
    }

    if (dumpStream) {
        console.log(`Dumping stream content:\n${StreamMarkdownProcessor.getRawContent()}`);
        dumpStream = false;
    }
    StreamMarkdownProcessor.dispose();
    setAiSessions().then().catch(e => console.error(e));
}

function laiGetRecipient() {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    let recipient = shadowRoot.querySelector('#laiActiveAiInput');
    if (!recipient) { recipient = shadowRoot.querySelectorAll('span.lai-ai-input'); }
    if (!recipient) { throw Error('No recipient found!'); }
    return recipient;
}

function laiAppendSelectionToUserImput(text) {
    const currentSelection = window.getSelection().toString() || text;
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const sideBar = shadowRoot.getElementById('laiSidebar');
    if (!sideBar) {
        console.err('Sidebar not found!');
        return;
    }

    if (!sideBar.classList.contains('active')) {
        laiSwapSidebarWithButton();
    }
    const userInput = sideBar.querySelector('#laiUserInput');
    userInput.value += `${currentSelection}`;
    // userInput.value += `\n\n===========\n${text}`;
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

function checkCommandHandler(e){
    const regex = /\/(\w+)[\t\n\s]?/gi;
    const userInput = e.target;
    if (!userInput) { return false; }

    // const matches = userInput.value.match(regex);
    const matches = [];
    let match;

    while ((match = regex.exec(userInput.value)) !== null) {
        if(match){
            matches.push(match);
        }
    }

    if(matches.length < 1) { return false; }
    let res = true;

    for (let i = 0; i < matches.length; i++) {
        const cmd = matches[i][1].toLowerCase();
        userInput.value = userInput.value.replace(matches[i][0], '');
        switch (cmd) {
            case 'add':
                userInput.value = userInput.value.replace(matches[i], '');
                popUserCommandEditor();
                break;
            case 'list': // TODO similar to @{{help}}
                popUserCommandList(e);
                break;
            default:
                const idx = aiUserCommands.findIndex(el => el.commandName.toLowerCase() === cmd);
                userInput.value = `${userInput.value}${userInput.value.trim().length > 0 ? ' ' : ''}${aiUserCommands[idx].commandBody}`;
                res = false;
                break;
        }
    }

    return res;
}

// popup
function popUserCommandEditor(idx = -1){
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const theSidebar = shadowRoot.querySelector('#laiSidebar');
    const template = shadowRoot.getElementById('editorTemplate').content.cloneNode(true);
    var editor = template.getElementById('userCommandEditor');
    const closeBtn = editor.querySelector('.help-close-btn');

    editor.querySelector('#commandName').addEventListener('input', e => e.target.value = e.target.value.replace(/\s/g, '_'));
    closeBtn.addEventListener('click', (e) => { e.target.closest('div#userCommandEditor').remove() })
    editor.querySelector('button').addEventListener('click', e => {
        const inputs = editor.querySelectorAll('input, textarea');
        const cmdData = {};
        inputs.forEach(el => {
            cmdData[el.id] = el.value || '';
        })

        if(!cmdData.commandName || !cmdData.commandBody){
            laiShowMessage('Command must have name and boddy!', 'error');
            return;
        }

        addToUserCommands(cmdData);
        closeBtn?.click();
    })

    editor = loadUserCommandIntoEditor(idx, editor);
    theSidebar.appendChild(editor);
}

function loadUserCommandIntoEditor(idx = -1, editor){
    if(idx < 0 || !editor){  return;  }
    if(aiUserCommands.length < idx){  return;  }

    const cmd = aiUserCommands[idx];
    if(!cmd){  return;  }

    const cmdName = editor.querySelector('#commandName');
    if(cmdName){  cmdName.value = cmd.commandName;  }
    const cmdDesc = editor.querySelector('#commandDescription');
    if(cmdDesc) {  cmdDesc.value = cmd.commandDescription;  }
    const cmdBody = editor.querySelector('#commandBody');
    if(cmdBody)  {  cmdBody.value = cmd.commandBody;  }

    return editor;
}

function addToUserCommands(cmdData) {
    if(!cmdData || !cmdData.commandName || !cmdData.commandBody ){  return;  }

    const idx = aiUserCommands.findIndex(el => el.commandName.toLowerCase() === cmdData.commandName.toLowerCase());
    if (idx < 0) {
        aiUserCommands.push(cmdData);
    } else {
        aiUserCommands[idx].commandBody = cmdData.commandBody;
        aiUserCommands[idx].commandDescription = cmdData.commandDescription;
    }
    setAiUserCommands().then().catch(e => console.error('>>>', e));
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
            if(userInput) {
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
    if (regex.test( userInput.value.trim().toLowerCase())) {
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
        laiUpdateChatHistoryWithUserInput(msg.content, msg.role.replace(/assistant/i, 'ai'), i);
    });
    laiShowMessage(`session #${sessionIdx} restored.`, 'info');
}

function showSessionHistoryMenu(e) {
    e.preventDefault();
    if(aiSessions.length < 1)  {
        laiShowMessage('No stored sessions found.');
        return;
    }

    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const headerSection = shadowRoot.querySelector('.lai-header');
    headerSection.querySelector('#sessionHistMenu')?.remove();

    const template = shadowRoot.getElementById('histMenuTemplate').content.cloneNode(true);
    const sessionHistMenu = template.children[0];
    sessionHistMenu.id = "sessionHistMenu";
    sessionHistMenu.classList.add('hist-top-menu', 'lai-invisible');

    headerSection.appendChild(sessionHistMenu);

    const menuItemContent = aiSessions.map(innerArray => innerArray.find(obj => obj.role === 'user')).filter(Boolean);
    if(menuItemContent.length < 1)  {
        laiShowMessage('No stored sessions found.');
        return;
    }

    menuItemContent.push({"role": "user", "content": "---"});
    menuItemContent.push({"role": "user", "content": "Delete all sessions"});
    for (let i = 0, l = menuItemContent.length; i < l; i++) {
        const userEl = menuItemContent[i];
        let menuItem = document.createElement(userEl.content === '---' ? 'hr' :'div');
        if(userEl.content !== '---'){
            menuItem.className = 'menu-item';
            menuItem.textContent = `${userEl.content.substring(0, 35)}${userEl.content.length > 35 ? '...' : ''}`;
            if (i === l - 1) {
                menuItem.addEventListener('click', (e) => {
                    aiSessions = [];
                    setAiSessions().then().catch(e => console.error('>>>', e));
                    e.target.closest('div#sessionHistMenu').remove();
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

    sessionHistMenu.classList.remove('lai-invisible');
    sessionHistMenu.style.cssText = `top: ${e.clientY + 10}px;; left: ${e.clientX - (sessionHistMenu.offsetWidth / 4)}px;`;
}

function hideSessionHistoryMenu() {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const headerSection = shadowRoot.querySelector('.lai-header');
    headerSection.querySelector('#sessionHistMenu')?.remove();
}

function popUserCommandList(e){
    e.target.value = e.target.value.replace('/list', '');
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const cmdList = shadowRoot.querySelector('#commandListContainer');
    const closeBtn = cmdList.querySelector('div.lai-close-button')
    closeBtn.addEventListener('click', e => cmdList.classList.add('lai-invisible'));
    const container = cmdList.querySelector('div.user-command-block')

    container.replaceChildren();

    const clickHandler = e => closeBtn.click();
    if(aiUserCommands.length < 1){
        container.textContent = 'No commands found. Use /add to add some commands.';
        container.addEventListener('click', clickHandler);
    } else {
        container.textContent = '';
        container.removeEventListener('click', clickHandler);
    }

    const userInput = shadowRoot.getElementById('laiUserInput');

    for (let i = 0; i < aiUserCommands.length; i++) {
        const cmd = aiUserCommands[i];
        const el = document.createElement('div');
        el.setAttribute('data-index', i.toString());
        // let cmdItemButtons = document.createElement('div');
        const cmdItemButtons = addCmdItemButtons(document.createElement('div'), i);
        const cmdItem = document.createElement('div');
        cmdItem.classList.add('user-cmd-item-command');
        cmdItem.innerHTML = `<b>/${cmd.commandName}</b> - ${cmd.commandDescription || 'No description provided.'}`

        el.appendChild(cmdItemButtons);
        el.appendChild(cmdItem);

        container.appendChild(el);
        el.classList.add('user-command-item');
/*         el.addEventListener('click', e => {
            userInput.value = cmd.commandBody;
        }); */
    }

    cmdList.classList.remove('lai-invisible');
}

function addCmdItemButtons(item, index){
    if(!item) {  return;  }
    item.classList.add('user-cmd-item-btn');
    Object.keys(userCmdItemBtns).forEach(key => {
        if(!userCmdItemBtns[key]){  userCmdItemBtns[key] = chrome.runtime.getURL(`img/${key}.svg`);  }
        const img = document.createElement('img');
        img.src = userCmdItemBtns[key];
        img.setAttribute('title', key);
        img.setAttribute('alt', key);
        img.setAttribute('data-index', index.toString());
        img.setAttribute('data-action', key);
        item.appendChild(img);
        img.addEventListener('click', userCmdItemBtnClicked);
    });

    return item;
}

function userCmdItemBtnClicked(e){
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }

    const clicked = e.target;
    const action = e.target.getAttribute('data-action').toLowerCase();
    const index = e.target.getAttribute('data-index');
    const userInput = shadowRoot.getElementById('laiUserInput');

    switch (action) {
        case 'edit':
            e.target.closest('#commandListContainer').querySelector('div.lai-close-button').click()
            popUserCommandEditor(index);
            break;
        case 'execute':
            e.target.closest('#commandListContainer').querySelector('div.lai-close-button').click()
            userInput.value += aiUserCommands[index].commandBody;
            const enterEvent = new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Enter'
            });
            userInput.dispatchEvent( enterEvent );
            break;
        case 'paste':
            userInput.value += aiUserCommands[index].commandBody;
            break;
        case 'delete':
            aiUserCommands.splice(index, 1);
            setAiUserCommands()
            .then(() => e.target.closest('#commandListContainer').querySelector('div.lai-close-button').click())
            .catch(e => console.error('>>>', e));
            break;
        default:
            console.warn(`Unknown action - ${action}`);
    }

    console.log(`>>> clicked #${e.target.getAttribute('data-index')}`, e.target);
}