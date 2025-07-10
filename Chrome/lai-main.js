/**
 * TODO (refactor UI):
 *   Event delegation vs. per-element bindings.
 *   We bind dozens of element-specific click handlers. As the UI grows you may hit listener bloat.
 *   Consider delegating through a shared parent when practical (already done for the "feedbackMessage" div).
 */
let restartCounter = 0;
const RESTART_LIMIT = 5;

async function initSidebar() {
    const laiOptions = await getLaiOptions();
    if (!chrome.runtime.id) { chrome.runtime.reload(); }
    const root = getRootElement();
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) {
        if (restartCounter < RESTART_LIMIT) {
            restartCounter++;
            console.log(`>>> ${manifest.name} - [${getLineNumber()}] - restarting: ${restartCounter}`);
            start();
        }
        return;
    }

    shadowRoot.addEventListener('click', async e => await closeAllDropDownRibbonMenus(e));

    shadowRoot.querySelector('#feedbackMessage').addEventListener('click', e => {
        let feedbackMessage = e.target;
        if (feedbackMessage?.id !== 'feedbackMessage') {
            feedbackMessage = e.target.closest('div#feedbackMessage');
        }
        lastRegisteredErrorMessage = Array.from(e.target.children).map(el => el.textContent);
        handleErrorButton();
        feedbackMessage.replaceChildren();
        feedbackMessage.classList.remove('feedback-message-active')
    });

    const ribbon = getRibbon();
    if (!ribbon) { console.log(`>>> ${manifest.name} - [${getLineNumber()}] - Main ribbon not found!`, ribbon); }
    ribbon?.querySelector('#errorMsgBtn')?.addEventListener('click', showLastErrorMessage);
    ribbon?.querySelector('.temp-range-wrapper')?.addEventListener('click', modifiersClicked, true);


    const userInput = shadowRoot.getElementById('laiUserInput');
    if (!userInput) { console.log(`>>> ${manifest.name} - [${getLineNumber()}] - Main ribbon not found!`, userInput); }
    userInput?.addEventListener('keydown', async e => await onPromptTextAreaKeyDown(e), false);
    userInput?.addEventListener('click', userInputClicked);
    userInput?.addEventListener('focus', async e => await userInputFocused(e));
    userInput?.addEventListener('blur', e => { e.target.closest('div.lai-user-area').classList.remove('focused'); }, { capture: false });

    if (root) {
        root.addEventListener('dragenter', onUserInputDragEnter);
        root.addEventListener('dragleave', onUserInputDragLeave);
        root.addEventListener('dragover', function (e) {
            e.preventDefault();
            return false;
        });
        root.addEventListener('drop', async e => await onUserInputFileDropped(e));
    }

    await initRibbon();

    const laiChatMessageList = shadowRoot.getElementById('laiChatMessageList');
    laiChatMessageList.dataset.watermark = `${manifest.name} - ${manifest.version}`;
    laiChatMessageList.addEventListener('click', hidePopups, false);
    laiChatMessageList.addEventListener('scroll', (e) => {
        if (laiChatMessageList.dataset.scrollType === 'auto') {
            delete laiChatMessageList.dataset.scrollType;
            return;
        }

        const fromBottom = laiChatMessageList.scrollHeight - laiChatMessageList.scrollTop - laiChatMessageList.clientHeight;
        userScrolled = fromBottom > 10 ? true : false;
        const chatList = e.target;
        const itemRibbon = chatList.querySelector('.lai-action-icons:not(.invisible)');
        if (!itemRibbon) { return; }

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
        restoreHistorySessionClicked().catch(er => console.error(er));
    }

    shadowRoot.querySelectorAll('img.mic').forEach(img => {
        img.closest('div.mic-container').addEventListener('click', micClicked);
        laiSetImg(img);
    });

    laiSetImg(shadowRoot.querySelector('#spinner'));

    setModelNameLabel({ "model": laiOptions.aiModel });
    await buildMenuDropdowns();

    await setActiveSessionPageData({ "url": document.location.href, "pageContent": getPageTextContent() });
};

function getCurrentSystemInstructions() {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return ''; }
    const value = `${shadowRoot.querySelector('#laiSysIntructInput')?.value || ''}; timestamp: ${new Date().toISOString()}`;

    return value || '';
}

async function createNewSessionClicked(e, shadowRoot) {
    shadowRoot.getElementById('laiChatMessageList').replaceChildren();
    const userInput = shadowRoot.getElementById('laiUserInput')
    if (userInput) {
        userInput.value = '';
        userInput.focus();
    } else {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ['laiUserInput'] element not found!`, userInput);
    }
    removeLocalStorageObject(activeSessionIdStorageKey);
    showMessage('New session created.', 'success');
}

async function onCloseSidebarClick(e, shadowRoot) {
    // const pinned = shadowRoot.getElementById('laiPinned');
    const pinImg = getShadowRoot()?.querySelector('img[data-type="black_pushpin"]');
    // const isPinned = !pinImg.classList.contains('invisible');
    if (isPinned()) { pinImg?.click(); }
    await laiSwapSidebarWithButton(true);
}

async function recycleActiveSession(e, shadowRoot) {
    if (!shadowRoot) { shadowRoot = getShadowRoot(); }
    await deleteActiveSession();
    showMessage("Active session deleted.", "success");
    clearChatHistoryUI();
    const newSessionBtn = shadowRoot.querySelector('#newSession');
    newSessionBtn?.click();
}

async function recycleAllSessions(e, shadowRoot) {
    if (!shadowRoot) { shadowRoot = getShadowRoot(); }
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

function showAttachment(theAttachment) {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }

    const attachmentContainer = shadowRoot.querySelector('#attachContainer');
    if (!attachmentContainer.classList.contains('active')) {
        attachmentContainer.classList.add('active');
    }

    const img = createAttachmentImage(theAttachment);
    if (img) {
        attachmentContainer.appendChild(img);
        img.addEventListener('click', async e => await attachmentImgClicked(e), { capture: true });
    }
}

async function attachmentImgClicked(e) {
    e.preventDefault();
    let el = e.target;
    let attachemtnId = el.getAttribute('data-index');
    if (!attachemtnId) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Attachment Id not found`);
        console.error(el);
        return;
    }

    await deleteAttachment(attachemtnId);
    await attachmentDeleted();
    el.remove();
}

function createAttachmentImage(theAttachment) {
    if (!checkExtensionState()) { return; }
    const img = document.createElement('img');
    img.src = chrome.runtime.getURL('img/attachment.svg');
    img.style.cursor = `url('${chrome.runtime.getURL('img/del.svg')}'), auto`;
    img.setAttribute('alt', 'Attachment');
    img.setAttribute('title', theAttachment?.title || `${theAttachment?.content?.split(/\s+/)?.slice(0, 5).join(' ')}...` || 'Noname');
    img.setAttribute('data-index', theAttachment?.id);
    img.classList.add('attached');

    return img;
}

async function attachmentDeleted() {
    let attachments = await getAttachments()
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
    // attachments = [];
}

function adjustHeight(userInput) {
    if (!userInput) { return; }
    var initialRows = parseInt(userInput?.getAttribute('rows'), 10);
    var lineHeight = parseFloat(window.getComputedStyle(userInput).lineHeight);
    if (isNaN(lineHeight)) { lineHeight = 1.2; }
    var maxAllowedHeight = lineHeight * initialRows * 2;

    userInput.style.height = 'auto'; // Reset the height to auto
    var newHeight = userInput?.scrollHeight + 'px';

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

async function userInputFocused(e) {
    try {
        let attachments = await getAttachments();
        if (attachments.lengh < 1) { return; }
        clearAttachments();
        attachments.forEach(a => showAttachment(a));
    } catch (err) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${err.message}`, err);
    }
}

function hidePopups(e) {
    const shadowRoot = getShadowRoot();

    shadowRoot?.querySelectorAll('#helpPopup').forEach(el => el.remove());
    shadowRoot?.querySelector('#commandListContainer')?.classList.add('invisible');
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

        // update UI
        await addInputCardToUIChatHistory(elTarget.value, 'user', messages.length - 1);
        await addInputCardToUIChatHistory('', 'ai');

        // update data
        await addcommandPlaceholdersValues(elTarget.value);

        messages = [{ "role": "user", "content": `${elTarget.value}\n${messages.map(e => e.content).join('\n')}` }];
        if (images.length > 0) { messages[0]["images"] = images; }

        try {
            dumpInConsole(`${[getLineNumber()]} - messages collected are ${messages.length}`, messages);
            const idx = await getActiveSessionId();
            if (!idx) { await createNewSession(elTarget.value); }

            shadowRoot.getElementById('laiAbort')?.classList.remove('invisible');
            shadowRoot.querySelector('#attachContainer')?.classList.remove('active');
            elTarget.classList.add('invisible');
            elTarget.value = '';
            await queryAI();
        } catch (e) {
            showMessage(`ERROR: ${e.message}`, e);
        } finally {
            clearAttachments();
        }
    }
}

async function addcommandPlaceholdersValues(userInputValue) {
    const userCommands = [...userInputValue.matchAll(/@\{\{([\s\S]+?)\}\}/gm)];
    const content = [];
    const attachments = await getAttachments();
    let attachment;
    userCommands.forEach(cmd => {
        let cmdText = ''
        if (Array.isArray(cmd)) { cmdText = cmd.pop().trim(); }
        switch (cmdText) {
            case 'page':
                attachment = {
                    id: crypto.randomUUID(),
                    type: "snippet",
                    content: getPageTextContent(),
                    sourceUrl: location.href
                };
                break;
            case 'now':
                attachment = {
                    id: crypto.randomUUID(),
                    type: "snippet",
                    content: `current date and time or timestamp is: ${(new Date()).toISOString()}`,
                    sourceUrl: location.href
                };
                break;
            case "today":
                attachment = {
                    id: crypto.randomUUID(),
                    type: "snippet",
                    content: `current date is: ${(new Date()).toISOString().split('T')[0]}`,
                    sourceUrl: location.href
                };
                break;
            case "time":
                attachment = {
                    id: crypto.randomUUID(),
                    type: "snippet",
                    content: `current time is: ${(new Date()).toISOString().split('T')[1]}`,
                    sourceUrl: location.href
                };
                break;
        }
        if (attachments && attachments.length > 0) {
            const isIn = attachments.some(el => el?.type === attachment?.type && el?.sourceUrl === attachment?.sourceUrl && el?.content === attachment?.content);
            if (!isIn) { content.push(attachment); }
        }
    });
    if (content.length > 0) {
        await addAttachment(content);
        content.forEach(att => showAttachment(att));
    }
}

function transformTextInHtml(inputText) {
    const lastChatText = document.createElement('span');
    lastChatText.className = "lai-input-text";

    const lines = inputText?.split(/\n/)?.map(line => document.createTextNode(line)) || [];
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

async function addInputCardToUIChatHistory(inputText, type, index = -1) {
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

    //experimental
    // if(type !== 'ai'){
    //     // lastChatText.innerHTML = '';
    //     // await parseAndRender(inputText, lastChatText, {streamReply: false});
    //     const pre = document.createElement('pre');
    //     pre.textContent = inputText;
    //     lastChatText.innerHTML = '';
    //     lastChatText.appendChild(pre);
    // }
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
        if (!elChatHist.classList.contains('lai-chat-history')) { elChatHist = el.closest('.lai-chat-history'); }
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
        if (!el) { return; }
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

    return lastChatText;
}

function insertIntoDocument(e, type) {
    const txt = e.target.closest(`.lai-${type}-input`)?.querySelector('.lai-input-text');
    showMessage('Copied. Click on the target to paste.');

    const insertIntoDocumentClickListener = event => {
        click2insert(event, txt, () => document.removeEventListener('click', insertIntoDocumentClickListener));
    };

    document.addEventListener('click', insertIntoDocumentClickListener);
}

function click2insert(e, textEl, callback) {
    const shadowRoot = getShadowRoot();
    if (!document.hasFocus() || document.visibilityState !== 'visible') {
        console.warn(`>>> ${manifest.name} - [${getLineNumber()}] - Page is not active.`);
        return;
    }

    if (shadowRoot && (e.target.shadowRoot === shadowRoot || shadowRoot.contains(e.target))) {
        if (typeof (callback) === 'function') {
            setTimeout(callback, 60000);
        }
        return;
    }

    try {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            e.target.value += textEl.innerText;
        } else if (e.target.isContentEditable) {
            const lines = textEl.innerText.split('\n');
            lines.forEach((line, index) => {
                const p = document.createElement('p');
                if (!line) {
                    p.appendChild(document.createElement('br'));
                } else {
                    p.textContent = line;
                }
                e.target.appendChild(p);
            });
        }
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - error: ${error.message}`, error);
    } finally {
        if (typeof (callback) === 'function') {
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
async function findElementHistoryIndex(el) {
    const shadowRoot = getShadowRoot();
    const chatList = shadowRoot?.querySelector('#laiChatMessageList');
    const allInputText = Array.from(chatList?.querySelectorAll('.lai-input-text')) || [];
    const index = Array.from(allInputText).indexOf(el);
    if (index < 0) {
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

    if (idx > -1) { children.slice(idx).forEach(child => child.remove()); }

    if ((currentSession?.data || []).length > 0) {
        currentSession.data.splice(idx, 1);
        if (currentSession.data.lengh > 0) { await setActiveSession(currentSession); }
        else { await deleteActiveSession(); }
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
    if (!shadowRoot) { return; }

    const sideBar = shadowRoot.getElementById('laiSidebar');
    const mainButton = shadowRoot.getElementById('laiMainButton');
    if (!sideBar || !mainButton) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Sidebar or button not found!`);
        return;
    }

    const isSidebarActive = sideBar.classList.contains('active');

    if (!forceClose && isSidebarActive && !laiOptions?.closeOnClickOut) { return; }

    sideBar.classList.toggle('active');

    const isNowActive = sideBar.classList.contains('active');
    mainButton.classList.toggle('invisible', isNowActive); // hide button if sidebar shown
    if (isNowActive) {
        sideBar.querySelector('textarea#laiUserInput')?.focus();
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
    if (renderingEl && renderingEl?.dataset?.status) { return; } // ai generation completed and rendering has started
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
    const tempInput = shadowRoot?.querySelector('#tempInput');
    let temp = tempInput?.value || 0.5;

    const data = { "messages": messages, };
    let options = getModelModifiers();
    if (options) { data["options"] = options; }

    if (shadowRoot?.querySelector('#modelThinking')?.classList?.contains('disabled') || false) {
        data["think"] = false;
    }

    if (laiOptions.aiUrl.indexOf('api') > -1) {
        if (laiOptions.aiModel.trim() === '') {
            showMessage('Please choose a model from the list!');
            return;
        } else {
            data['model'] = laiOptions.aiModel.trim();
        }
    }

    const toolFunctions = !shadowRoot?.querySelector('#toolFunctions')?.classList?.contains('disabled') || false;
    const sysInstruct = getCurrentSystemInstructions();
    const requestData = {
        action: "fetchData",
        systemInstructions: sysInstruct || '',
        url: laiOptions.aiUrl,
        data: data,
        tools: toolFunctions
    };

    try {
        updateStatusBar('Prompt sent to the model, awaiting response...');
        const response = await chrome.runtime.sendMessage(requestData);
        if (chrome.runtime.lastError) { throw new Error(`${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }

        if (response?.status === 'error' && response?.message) {
            showMessage(response.message, 'error');
            throw new Error(`${manifest.name} - [${getLineNumber()}] - Response error: ${response.message}`, response);
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

function scrollChatHistoryContainer(e) {
    if (userScrolled) { return; }
    const shadowRoot = getShadowRoot();
    const laiChatMessageList = shadowRoot?.querySelector('#laiChatMessageList');
    if (!laiChatMessageList) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - laiChatMessageList not found!`, laiChatMessageList);
        return;
    }
    laiChatMessageList.dataset.scrollType = 'auto';
    laiChatMessageList.scrollTop = laiChatMessageList.scrollHeight;
}

function renderCompleteFired(e) {
    const laiChatMessageList = e.target.closest('#laiChatMessageList');
    laiChatMessageList.scrollTop = laiChatMessageList.scrollHeight;
    resetStatusbar();
    laiHandleStreamActions("Streaming response ended", e.target);
}

function getParseAndRenderOptions(rootEl) {
    if (!rootEl) { throw new Error(`>>> ${manifest.name} - [${getLineNumber()}] - Target element not found!`); }

    const shadowRoot = getShadowRoot();
    const controller = new AbortController();
    const abortBtn = shadowRoot.getElementById('laiAbort');

    const abortHandler = createAbortHandler(controller, abortBtn, rootEl);

    rootEl.addEventListener('renderComplete', renderCompleteFired);
    rootEl.addEventListener('rendering', scrollChatHistoryContainer);
    abortBtn?.addEventListener('click', abortHandler);

    return { abortSignal: controller.signal };
}

chrome.runtime.onMessage.addListener(async (response, sender, sendResponse) => {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) {
        if (restartCounter < RESTART_LIMIT) {
            restartCounter++;
            console.log(`>>> ${manifest.name} - [${getLineNumber()}] - restarting: ${restartCounter}`);
            start();
        }
        return;
    }

    let recipient;
    // TODO: is this still needed?
    try {
        if (['dumpInConsole'].indexOf(response.action) < 0) {
            recipient = shadowRoot.getElementById('laiActiveAiInput');
            if (!recipient) {
                recipient = Array.from(shadowRoot.querySelectorAll('.lai-ai-input .lai-input-text')).pop();
                recipient?.setAttribute("id", "laiActiveAiInput");
            }
            if (!recipient && response.action.toLowerCase().startsWith('stream')) {
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
                // const activeSession = await getActiveSession();
                dataChunk = laiExtractDataFromResponse(response);
                if (!dataChunk) { return; }
                // activeSession.data.push(dataChunk);
                // await setActiveSession(activeSession);
                updateStatusBar('Receiving and processing data...');
                const rootRecipient = laiGetRecipient();
                if (!rootRecipient) { throw new Error(`>>> ${manifest.name} - [${getLineNumber()}] - Target element not found!`) }
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
            if (!response.selection) {
                showMessage('Element picked up successfully.', 'info')
                console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Selection is missing or empty!: `, response);
                break;
            }
            let newActivePageSelectionAttachment = {
                id: crypto.randomUUID(),
                type: "snippet",
                content: response.selection ?? '',
                sourceUrl: location.href
            };
            await addAttachment(newActivePageSelectionAttachment);
            showAttachment(newActivePageSelectionAttachment);
            showMessage('Selection included.', 'info')
            updateStatusBar('Selected content added to the context.');
            break;
        case "inserSelectedInPrompt":
            if (!response.selection) {
                showMessage('Element picked up successfully.', 'info')
                console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Selection is missing or empty!: `, response);
                break;
            }
            const isSidebarActive = getSideBar()?.classList.contains('active');
            if (!isSidebarActive) { await laiSwapSidebarWithButton(); }
            const promptVal = shadowRoot?.getElementById('laiUserInput')?.value;
            shadowRoot.getElementById('laiUserInput').value += `${promptVal.length > 0 ? "\n" : ""}${response.selection}`;
            break;
        case "activePageContent":
            let newActivePageContentAttachment = {
                id: crypto.randomUUID(),
                type: "snippet",
                content: getPageTextContent(),
                sourceUrl: location.href
            };
            await addAttachment(newActivePageContentAttachment);
            showAttachment(newActivePageContentAttachment);
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
            if (response.message) { showMessage(response.message, response.messageType); }
            break;
        case "updateStatusbar":
            if (response.message) { updateStatusBar(response.message); }
            break;
        case "dumpInConsole":
            dumpInConsole(response.message, response.obj, response.type);
            break;
        case "userPrompt":
            storeLastGeneratedPrompt(response.data);
            await checkAndSetSessionName();
            break;
        default:
            laiHandleStreamActions(`Unknown action: ${response.action}`, recipient);
            break;
    }

    if (response.error) {
        showMessage(response.error, 'error');
        resetStatusbar();
    }

    return true;
});

function laiHandleStreamActions(logMessage, recipient, abortText = '') {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    let textAres = shadowRoot.getElementById('laiUserInput');
    const laiAbortElem = shadowRoot.getElementById('laiAbort');

    if (laiAbortElem) { laiAbortElem.classList.add('invisible'); }
    if (textAres) {
        textAres.classList.remove('invisible');
        textAres.focus();
    } else {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - User input area not found!`);
    }

    if (abortText && recipient) {
        const span = document.createElement('span');
        if (span) {
            span.classList.add("lai-aborted-text");
            span.textContent = abortText;
            recipient.appendChild(span);
        } else { recipient.innerHTML += `<span class="lai-aborted-text">${abortText}</span>`; }
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
    userInput?.dispatchEvent(enterEvent);
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

function getRegExpMatches(regex, userInput) {
    if (!regex instanceof RegExp) { return; }

    const matches = [];
    let match;

    while ((match = regex.exec(userInput?.value)) !== null) {
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

    // if(await checkForHooksCmd(e)){  return true;  }

    const matches = getRegExpMatches(/\/(\w+)(?:\((\w+)\))?[\t\n\s]?/gi, userInput);
    if (matches.length < 1) { return res; }

    const shadowRoot = getShadowRoot();
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
            case 'error':
            case 'lasterror':
                showMessage(lastRegisteredErrorMessage.toReversed().slice(0, 5), 'error');
                continueLoop = false;
                res = true;
                break;
            case 'lastmessage':
                continueLoop = false;
                let lastMsg = '';
                try {
                    const hist = JSON.parse(shadowRoot?.querySelector('#feedbackMessage')?.dataset?.history ?? "[]");
                    lastMsg = `${hist[hist.length-1] ?? 'Unknown'}`;
                } catch (err) {
                    lastMsg = "Error getting message history!";
                    console.log(`${manifest?.name} - [${getLineNumber()}] Error getting message history!`, err)
                }
                showMessage(lastMsg, 'info', 10000);
                res = true;
                break;
            case 'list':
                continueLoop = false;
                popUserCommandList(e);
                res = true;
                break;
            case 'model':
                continueLoop = false;
                try {
                    const model = getActiveModel();
                    updateStatusBar(`Awaiting information about ${model}...`);
                    const response = await chrome.runtime.sendMessage({ action: "modelInfo", model: model });
                    if (chrome.runtime.lastError) { throw new Error(`${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }

                    if (response?.status === 'error' && response?.message) {
                        showMessage(response.message, 'error');
                        throw new Error(`${manifest.name} - [${getLineNumber()}] - Response error: ${response.message}`, response);
                    }

                    showMessage(`${model} capabilities: ${response?.capabilities?.join(', ') ?? 'unknown'}`, 'info', 10000);
                } catch (e) {
                    if (e.message.indexOf('Extension context invalidated.') > -1) {
                        showMessage(`${e.message}. Please reload the page.`, 'warning');
                    }
                    console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
                }
                finally {
                    resetStatusbar();
                    shadowRoot?.getElementById('laiUserInput')?.focus();
                }
                res = true;
                break;
            default:
                const idx = aiUserCommands.findIndex(el => el.commandName.toLowerCase() === cmd);
                if (idx > -1) {
                    userInput.value = `${userInput?.value}${userInput?.value?.trim().length > 0 ? ' ' : ''}${aiUserCommands[idx]?.commandBody || ''}`;
                }
                res = idx > -1;
                break;
        }

        if (res) {
            userInput.value = userInput?.value?.replace(matches[i][0], '');
            if(userInput.value === '\n'){  userInput.value = '';  }
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
        });
        if (!cmdData.commandName || !cmdData.commandBody) {
            showMessage('Command must have name and boddy!', 'error');
            return;
        }

        addToUserCommands(cmdData, cmdIdx);
        closeBtn?.click();
    });
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
                userInput.value = (`${userInput?.value.trim()} ${command}`).trim();
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
    if (regex.test(userInput?.value.trim().toLowerCase())) {
        const usrVal = userInput?.value.replace(regex, '').trim();
        userInput.value = usrVal;
        showHelp();
        return true;
    }

    return false;
}

function clearChatHistoryUI() {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const messageList = shadowRoot.getElementById('laiChatMessageList');
    if (messageList) {
        messageList.innerHTML = '';
    }
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

function updateStatusBar(status) {
    if (!status) { return; }
    const sidebar = getSideBar();
    const statusbar = sidebar?.querySelector('div.statusbar');
    if (!statusbar) { return; }
    const notificationBlock = statusbar.querySelector('.notification');
    if (!notificationBlock) { return; }
    notificationBlock.textContent = status;
}

function resetStatusbar() {
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
            setTimeout(() => { resetStatusbar(); }, 1000);
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
            content = el.rawContent.messages ? el.rawContent?.messages.map(e => e.content).join('') : el.rawContent || '';
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
    if (usrInputs.length < 0) { return; }
    usrInputs = usrInputs.slice(-1)[0];
    usrInputs.rawContent = promptData;
}

function dumpInConsole(message = '', obj, consoleAction = 'log') {
    try {
        obj = obj && typeof (obj) === 'string' ? JSON.parse(obj) : obj;
        if (message) {
            console[consoleAction](message, obj);
        }
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Error parsing JSON or logging message: ${error.message}`, error);
    }
}

