const laiWordEndings = /(?:\w+'(?:m|re|ll|s|d|ve|t))\s/;  // 'm, 're, 's, 'd, 'll, 've, 't
const laiWordFormations = /(?:'(?:clock|til|bout|cause|em))/; // 'clock, 'til, 'bout, 'cause, 'em

function initSidebar() {

    if(!theShadowRootReady){
        setTimeout(() => initSidebar(), 1000);
        return;
    }

    const userInput = theShadowRoot.querySelector('#laiUserInput');
    userInput.addEventListener('keydown', onLaiTextAreaKeyUp);
    // userInput.addEventListener('input', laiHandleUserInput);

    theSideBar.querySelectorAll('img').forEach(pic => {
        const theSrc = pic.getAttribute('data-resource');
        if(theSrc){
            pic.src = getExtURL(theSrc);
        }
    });

    theShadowRoot.querySelector('.lai-cog-menu-button')?.addEventListener('click', function (e) {
        chrome.runtime.sendMessage({action: "openOptionsPage"});
        theShadowRoot.querySelector('#laiUserInput')?.focus();
    });

    theShadowRoot.querySelector('#laiRecycleAll').addEventListener('click', function(e) {
        theShadowRoot.querySelector('#laiChatMessageList').innerHTML = '';
        messages = [];
        currentStreamData = '';
        theShadowRoot.querySelector('#laiUserInput')?.focus();
    });

    theShadowRoot.querySelector('.lai-close-button')?.addEventListener('click', function (e) {
        const pinned = theShadowRoot.querySelector('#laiPinned');
        const pinImg = pinned.querySelector('img[data-type="black_pushpin"]');
        const isPinned = !pinImg.classList.contains('lai-invisible');
        if(isPinned) {
            pinImg?.click();
        }
        laiSwapSidebarWithButton(true);
    });

    theShadowRoot.querySelector('#laiAbort').addEventListener('click', laiAbortRequest);
    if(laiOptions && laiOptions.openPanelOnLoad){
        laiSwapSidebarWithButton();
    }

    theShadowRoot.querySelector('#laiSysIntruct').querySelectorAll('img').forEach(el => {
        el.addEventListener('click', laiShowSystemInstructions);
    });

    const sysIntructInput = theShadowRoot.querySelector('#laiSysIntructInput');
    sysIntructInput.value = laiOptions.systemInstructions || '';
    sysIntructInput.addEventListener('change', function(e){
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
    });

    theShadowRoot.querySelector('#laiPinned').querySelectorAll('img').forEach(el => {
        el.addEventListener('click', laiPushpinClicked);
    });

    const laiChatMessageList = theShadowRoot.querySelector('#laiChatMessageList');
    laiChatMessageList.addEventListener('scroll', () => {
        const fromBottom = laiChatMessageList.scrollHeight - laiChatMessageList.scrollTop - laiChatMessageList.clientHeight;
        userScrolled = fromBottom > 10 ? true : false;
    });

    const resizeHandle = theShadowRoot.querySelector('.lai-resize-handle');

    resizeHandle.addEventListener('mousedown', function(e) {
      laiResizeContainer(e/* , resizableDiv */);
    });
};

function laiShowSystemInstructions(e){
    const sysIntructContainer = theShadowRoot.querySelector('#laiSysIntructContainer');
    const sysIntructInput = sysIntructContainer.querySelector('#laiSysIntructInput');
    sysIntructContainer.classList.toggle('active');
    if(sysIntructContainer.classList.contains('active')) {
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
    theShadowRoot.querySelector('#laiUserInput')?.focus();
}

function laiCheckForDump(userText){
    if(userText.indexOf('@{{dump}}') > -1 || userText.indexOf('@{{dumpStream}}') > -1){
        dumpStream = true;
    }

    return userText.replace('@{{dump}}', '').replace('@{{dumpStream}}', '');
}

function laiInsertCommandText(text) {
    const textarea = theShadowRoot.querySelector('textarea');
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
    const suggestionBox = theShadowRoot.querySelector('#laiSuggestionBox');
    suggestionBox.innerHTML = ''; // Clear previous suggestions
    Object.keys(commands).forEach(cmd => {
        if (cmd.startsWith(input)) {
            const suggestion = document.createElement('div');
            suggestion.textContent = `${cmd} - ${commands.cmd}th`;
            suggestion.onclick = function() { laiInsertCommandText(cmd); };
            suggestionBox.appendChild(suggestion);
        }
    });
    suggestionBox.classList.remove('lai-invisible');
}

function laiHideSuggestions() {
    const suggestionBox = theShadowRoot.querySelector('#laiSuggestionBox');
    suggestionBox.classList.add('lai-invisible');
}

/* function laiHandleUserInput(e){
    const value = e.target.value;
} */

function onLaiTextAreaKeyUp(e) {
    e.stopImmediatePropagation();
    e.stopPropagation();

    if (e.key === 'Enter' && e.code !== 'NumpadEnter' && !e.shiftKey) {
        e.preventDefault();
        theShadowRoot.querySelector('#laiSysIntructContainer').classList.remove('active');
        const idx = messages.push({ "role": "user", "content": laiCheckForDump(e.target.value) });
        laiUpdateChatHistoryWithUserInput(e.target.value, 'user', idx-1);
        laiUpdateChatHistoryWithUserInput('', 'ai');
        laiQueryAI(e.target.value);
        e.target.value = '';
        e.target.classList.add('lai-invisible');
        theShadowRoot.querySelector('#laiAbort')?.classList.remove('lai-invisible');
    }
}

function transformTextInHtml(inputText){
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

function laiUpdateChatHistoryWithUserInput(inputText, type, index=-1){
    // const theShadowRoot = document.getElementById('localAI').theShadowRoot;
    const chatHist = theShadowRoot.querySelector('#laiChatMessageList');
    const lastChatElement = Object.assign(document.createElement('div'), {
        className: `lai-${type}-input lai-chat-history`
    });

    if(type === 'ai'){
        theShadowRoot.querySelector('#laiPreviousAiInput')?.removeAttribute('id');
        theShadowRoot.querySelectorAll("#laiActiveAiInput")?.forEach(el => {
            el?.removeAttribute("id");
        });
    }
    const lastChatlabel = Object.assign(document.createElement('span'), {
        className: "lai-input-label",
        innerHTML: `${type === 'ai' ? type.toUpperCase() : type}:&nbsp;`
    });
    const lastChatText = transformTextInHtml(inputText);
    let buttons = '<span class="lai-delete-chat-item-action" data-type="delete"></span><span class="lai-copy-chat-item-action" data-type="copy"></span>';
    if(type !== 'ai' && index > -1){
        buttons += `<span class="lai-edit-item-action" data-type="edit" data-index=${index}><img src="${chrome.runtime.getURL('img/edit.svg')}"></span>`;
    }
    const actionIconsDiv = Object.assign(document.createElement('div'), {
        // id: `${type === 'ai' ? 'laiActiveAiInput' : ''}`,
        className: 'lai-action-icons',
        innerHTML: buttons
    });

    lastChatElement.appendChild(lastChatlabel)
    lastChatElement.appendChild(lastChatText)
    lastChatElement.appendChild(actionIconsDiv);
    chatHist.appendChild(lastChatElement);

    lastChatElement.querySelectorAll('.lai-copy-chat-item-action, .lai-delete-chat-item-action, .lai-edit-item-action').forEach(el => {
        el.addEventListener('click', function(e) {
            let action = e.target.getAttribute('data-type');
            if(!action) {
                action = e.target.parentElement.getAttribute('data-type');
            }
            if(!action) {  return;  }
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
    if(type === 'ai'){
        lastChatText.addEventListener('click', function(e){  laiSourceTextClicked(e);  });
    }

    chatHist.scrollTop = chatHist.scrollHeight;
}

function laiShowCopyHint(e){
    // const theShadowRoot = document.getElementById('localAI').theShadowRoot;
    const hint = theShadowRoot.querySelector('#laiCopyHint');

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

    setTimeout(function() {
      hint.style.opacity = 0;
      hint.classList.add('lai-invisible');
    }, 2500);
  }

function laiCopyElementContent(e, type){
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

function editUserInput(e, type){
    let el = e.target.closest('span[data-index]');
    const idx = el.getAttribute('data-index') || -1;
    if(idx < 0){  return;  }
    // const theShadowRoot = document.getElementById('localAI').theShadowRoot;
    const userInputField = theShadowRoot.querySelector('#laiUserInput')
    userInputField.value = messages[idx].content;
}

// handle code snippets clicks in AI response
function laiSourceTextClicked(e){
    const clickedSourceTitle = e.target.closest('.lai-source-title');
    if(!clickedSourceTitle) {  return;  }
    const thePre = clickedSourceTitle.closest('pre');
    if(!thePre){  return;  }
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
  // const theShadowRoot = document.getElementById('localAI').theShadowRoot;
    const slideElement = theShadowRoot.querySelector('#laiSidebar');
    if(!slideElement){
        console.error('Slidebar not found!');
        return;
    }

    laiUpdateMainButtonStyles();

    const isSidebarActive = slideElement.classList.contains('active');
    if(!forceClose && isSidebarActive && !laiOptions?.closeOnClickOut){  return;  }
    slideElement.classList.toggle('active');
    if(slideElement.classList.contains('active')){
        slideElement.querySelector('textarea#laiUserInput').focus();
    }
}

function laiUpdateMainButtonStyles(){
    // const theShadowRoot = document.getElementById('localAI').theShadowRoot;
    var btn = theShadowRoot.querySelector('#laiMainButton');
    if(!btn){
        console.error('Main button not found!');
        return;
    }

    const isButtonVisible = !btn.classList.contains('lai-invisible');

    if(!isButtonVisible && laiOptions?.showEmbeddedButton){ // if not visible but should be - show it
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
    chrome.runtime.sendMessage({action: "abortFetch"}, () => {
        console.log("Abort message sent");
    });
    // const theShadowRoot = document.getElementById('localAI').theShadowRoot;
    theShadowRoot?.getElementById('laiAbort')?.classList.add('lai-invisible');
    theShadowRoot?.getElementById('laiUserInput')?.classList.remove('lai-invisible');
}


function laiQueryAI(inputText) {

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
        // } else {
            // console.log("Data:", response.data);
        }
    });
}

function laiSetModelName(data){
    if(!data) {  return;  }
    // const theShadowRoot = document.getElementById('localAI').theShadowRoot;
    const modelName = theShadowRoot.querySelector('#laiModelName');
    const model = data?.model;
    if(!model) {  return;  }
    modelName.textContent = model.split(/\\|\//).pop().split('.').slice(0,-1).join('.');
}

function laiFinalPreFormat(){
    // const theShadowRoot = document.getElementById('localAI').theShadowRoot;
    const chatList = theShadowRoot.querySelector('#laiChatMessageList');
    if(!chatList) {  return;  }

    chatList.querySelectorAll('pre.lai-source').forEach(preElement => {
        const replacedHtml = preElement.innerHTML.replace(/<code class="lai-code">(.*?)<\/code>/g, "'$1'");
        preElement.innerHTML = replacedHtml.replace(/<br\/?>/g, '\n');
  });
}

function laiExtractDataFromResponse(response){
    const parts = (response?.data?.split(': ') || []).slice(-1);
    const jsonPart = parts[0];
    if(jsonPart.toUpperCase() === '[DONE]') {  return;  }
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
    // const theShadowRoot = document.getElementById('localAI').theShadowRoot;
    let recipient = theShadowRoot.querySelector('#laiActiveAiInput');
    if(!recipient){
        recipient = Array.from(theShadowRoot.querySelectorAll('.lai-ai-input .lai-input-text')).pop();
        recipient?.setAttribute("id", "laiActiveAiInput");
    }
    if(!recipient && ['toggleSidebar', 'activePageSelection', 'activePageContent', 'toggleSelectElement'].indexOf(response.action) < 0){
        console.log("no recipient");
        return;
    }

    switch (response.action) {
        case "streamData":

            try {
                let dataChunk = laiExtractDataFromResponse(response);
                if(!dataChunk) {  return;  }
                StreamMarkdownProcessor.processStreamChunk(dataChunk, laiGetRecipient);
                // laiProcessResponseDataChunk(dataChunk);
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
            laiAppendSelectionToUserInput(response.selection);
            break;
        case "activePageContent":
            laiAppendSelectionToUserInput(response.selection.replace(/\s{1,}/gm, ' '));
            break;
        case "toggleSelectElement":
            isElementSelectionActive = response.selection;
            break;
        default:
            laiHandleStreamActions(`Unknown action: ${response.action}`, recipient);
            break;
    }

    if (!userScrolled) {
        const laiChatMessageList = theShadowRoot.querySelector('#laiChatMessageList');
        laiChatMessageList.scrollTop = laiChatMessageList.scrollHeight;
    }
});

function laiHandleStreamActions(logMessage, recipient, abortText = '') {
    // const theShadowRoot = document.getElementById('localAI').theShadowRoot;
    let textAres = theShadowRoot.querySelector('#laiUserInput');
    console.log(logMessage);
    const laiAbortElem = theShadowRoot.querySelector('#laiAbort');
    recipient.removeAttribute("id");
    currentStreamData = ''; // obsolate
    const streamData = StreamMarkdownProcessor.getRawContent();

    if (laiAbortElem) laiAbortElem.classList.add('lai-invisible');
    if (textAres) {
        textAres.classList.remove('lai-invisible');
        textAres.focus();
    } else {
        console.error('User input area not found!');
    }

    if (streamData) {
        messages.push({"role": "assistant", "content": streamData});
    }

    if (abortText && recipient) {
        recipient.innerHTML += `<span class="lai-aborted-text">${abortText}</span>`;
    }

    if(dumpStream){
        console.log(`Dumping stream content:\n${StreamMarkdownProcessor.getRawContent()}`);
        dumpStream = false;
    }
    StreamMarkdownProcessor.dispose();
}

function laiGetRecipient(){
    // const theShadowRoot = document.getElementById('localAI').theShadowRoot;
    let recipient = theShadowRoot.querySelector('#laiActiveAiInput');
    if(!recipient){  recipient = theShadowRoot.querySelectorAll('span.lai-ai-input');  }
    if(!recipient){  throw Error('No recipient found!');  }
    return recipient;
}

function laiAppendSelectionToUserInput(text){
    // const theShadowRoot = document.getElementById('localAI').theShadowRoot;
    const sideBar = theShadowRoot.querySelector('#laiSidebar');
    if(!sideBar){
        console.err('Sidebar not found!');
        return;
    }

    if(!sideBar.classList.contains('active')){
        laiSwapSidebarWithButton();
    }
    const userInput = sideBar.querySelector('#laiUserInput');
    userInput.value += `\n${text}`;
}

function laiResizeContainer(e) {
    e.preventDefault();
    const resizableDiv = e.target.closest('.lai-fixed-parent');
    const sidebar = resizableDiv.closest('.active');
    let isResizing = true;
    let prevX = e.clientX;
    let originalWidth = resizableDiv.getBoundingClientRect().width;

    function onMouseMove(e) {
        if (!isResizing) {  return;  }
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

const isDispatched = document.dispatchEvent(new CustomEvent('mainScriptLoaded'));