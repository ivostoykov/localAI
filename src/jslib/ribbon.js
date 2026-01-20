async function initRibbon() {

    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - tempInput not found!`, shadowRoot); }

    const ribbon = getRibbon();
    if (!ribbon) { console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - tempInput not found!`, ribbon); }

    const laiOptions = await getLaiOptions();
    if (!laiOptions) { console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - tempInput not found!`, laiOptions); }

    ribbon?.querySelector('#errorMsgBtn')?.addEventListener('click', showLastErrorMessage);

    const tempInput = ribbon?.querySelector('#tempInput');
    if (tempInput) {
        const temp = laiOptions?.tempInput || "0.5";
        tempInput.value = temp;
        tempInput.title = parseFloat(temp) < 0.5 ? 'Stricter' : (temp > 0.5 ? 'More Createive' : 'Neutral');
    } else {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - tempInput not found!`, tempInput);
    }

    ribbon?.querySelectorAll('img').forEach(el => laiSetImg(el));

    const modelLabel = shadowRoot.getElementById('modelNameContainer');
    if (modelLabel) {
        modelLabel.addEventListener('click', async (e) => await modelLabelClicked(e));
        laiSetImg(modelLabel.querySelector('img'));
    }

    shadowRoot?.querySelector('#addUsrCmdMenu').addEventListener('click', e => {
        shadowRoot?.querySelector('#cogBtn').click();
        popUserCommandEditor();
    });

    shadowRoot?.querySelector('#listUsrCmdMenu').addEventListener('click', e => {
        shadowRoot?.querySelector('#cogBtn').click();
        popUserCommandList(e);
    });
    shadowRoot?.querySelector('#listSysCmdMenu').addEventListener('click', e => {
        shadowRoot?.querySelector('#cogBtn').click();
        showHelp();
    });
    shadowRoot?.querySelector('#createSessionCmdMenu').addEventListener('click', e => {
        shadowRoot?.querySelector('#cogBtn').click();
        ribbon?.querySelector('#newSession')?.click();
    });
    shadowRoot?.querySelector('#delSessionsCmdMenu').addEventListener('click', e => {
        shadowRoot?.querySelector('#cogBtn').click();
        const element = shadowRoot?.getElementById('recycleCurrentSessionBtn');
        if (!element) { return; }
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        element.dispatchEvent(event);
    });

    shadowRoot?.querySelector('#mainHelpMenu').addEventListener('click', async (e) => {
        try {
            await chrome.runtime.sendMessage({ action: "openMainHelpMenu" })
            if (chrome.runtime.lastError) { throw new Error(`${manifest?.name || 'Unknown'} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        } catch (e) {
            if (e.message.indexOf('Extension context invalidated.') > -1) {
                showMessage(`${e.message}. Please reload the page.`, 'warning');
            }
            console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${e.message}`, e);
        }
    });

    shadowRoot?.querySelector('#modifiersHelp').addEventListener('click', async (e) => {
        try {
            await chrome.runtime.sendMessage({ action: "openModifiersHelpMenu" })
            if (chrome.runtime.lastError) { throw new Error(`${manifest?.name || 'Unknown'} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        } catch (e) {
            if (e.message.indexOf('Extension context invalidated.') > -1) {
                showMessage(`${e.message}. Please reload the page.`, 'warning');
            }
            console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${e.message}`, e);
        }
    });

    shadowRoot?.querySelector('#optionsMenu')?.addEventListener('click', async function (e) {
        if (!checkExtensionState()) { return; }
        const cogMenu = shadowRoot?.querySelector('#cogMenu');
        if (!cogMenu.classList.contains('invisible')) {
            cogMenu.classList.add('invisible');
        }

        try {
            updateStatusBar('Opening Option Page ...');
            await chrome.runtime.sendMessage({ action: "openOptionsPage" })
            if (chrome.runtime.lastError) { throw new Error(`${manifest?.name || 'Unknown'} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        } catch (e) {
            if (e.message.indexOf('Extension context invalidated.') > -1) {
                showMessage(`${e.message}. Please reload the page.`, 'warning');
            }
            console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${e.message}`, e);
        }
        finally {
            resetStatusbar();
            shadowRoot?.getElementById('laiUserInput')?.focus();
        }
    });

    const toolFunctions = ribbon?.querySelector('#toolFunctions');
    toolFunctions?.addEventListener('click', async e => onToolFunctionsBtnClick(e), false);
    ribbon?.querySelector('#systemIntructions').addEventListener('click', laiShowSystemInstructions, false);
    ribbon?.querySelector('#newSession').addEventListener('click', async e => await createNewSessionClicked(e, shadowRoot), false);
    ribbon?.querySelector('#sessionHistory').addEventListener('click', async e => await openCloseSessionHistoryMenu(e), false);
    ribbon?.querySelector('#apiUrlList').addEventListener('change', async e => await selectMenuChanged(e));
    ribbon?.querySelector('#modelList').addEventListener('change', async e => await modelChanged(e), false);
    ribbon?.querySelector('#hookList').addEventListener('change', async e => await selectMenuChanged(e), false);
    ribbon?.querySelector('#laiModelName').addEventListener('mouseenter', e => {
        updateStatusBar('Click to toggle the list with available models.');
        setTimeout(resetStatusbar, 10000);
    }, false);
    ribbon?.querySelector('#cogBtn')?.addEventListener('click', async function (e) {
        const el = e.target;
        e.stopPropagation();
        await closeAllDropDownRibbonMenus(e);
        shadowRoot.querySelector('#cogMenu').classList.toggle('invisible');
        el.classList.toggle('js-menu-is-open');
    }, false);

    ribbon?.querySelector('#modelThinking')?.addEventListener('click', async e => {
        const el = e.target;
        const model = await getAiModel();
        const url = await getAiUrl()
        const canThink = await modelCanThink(model, url);
        if(!canThink){
            showMessage(`The model ${model} does not support thinking mode.`);
            return;
        }
        el.classList.toggle('disabled')
        updateStatusBar(`Thinking ${el.classList.contains('disabled') ? 'disabled' : 'enabled'}.`);
        setTimeout(() => { resetStatusbar(); }, 1000);
    });
    await adjustThinkingStatus(ribbon?.querySelector('#modelThinking'));
    await adjustToolsStatus(ribbon?.querySelector('#toolFunctions'));

    shadowRoot?.getElementById('recycleCurrentSessionBtn').addEventListener('click', async e => await recycleActiveSession(e, shadowRoot), false);
    shadowRoot?.querySelector('#closeSidebarBtn')?.addEventListener('click', async e => await onCloseSidebarClick(e, shadowRoot), false);

    shadowRoot?.getElementById('laiAbort').addEventListener('click', async e => await laiAbortRequest(e), false);
    if (laiOptions && laiOptions.openPanelOnLoad) {
        await laiSwapSidebarWithButton();
    }

    shadowRoot?.getElementById('laiSessionHistoryMenu').querySelectorAll('img').forEach(el => laiSetImg(el));

    const sysIntructInput = shadowRoot?.querySelector('#laiSysIntructInput');
    sysIntructInput.value = laiOptions.systemInstructions || '';

    shadowRoot?.getElementById('laiPinned').querySelectorAll('img').forEach(el => {
        el.addEventListener('click', async e => await laiPushpinClicked(e));
    });

}

async function closeAllDropDownRibbonMenus(e) {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - shadowRoot element not found!`, shadowRoot);
        return;
    }

    const openMenus = Array.from(shadowRoot.querySelectorAll('.js-menu-is-open'));
    if (openMenus.length < 1) { return; }

    const compPath = e.composedPath(); // check for sidebar - if not in there, head button is clicked
    if (compPath?.findIndex(e => e.id === 'laiMainButton') > -1) { return; } // ext main buttono was clicked

    const originator = compPath?.[0]; // e?.target;

    openMenus.forEach(el => {
        if (el === originator) { return; }
        if (compPath?.findIndex(p => p === el) > 0) { return; } // clicked inside the menu
        el?.click();
    });
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

async function createNewSessionClicked(e, shadowRoot) {
    shadowRoot.getElementById('laiChatMessageList').replaceChildren();
    const userInput = shadowRoot.getElementById('laiUserInput')
    if (userInput) {
        userInput.value = '';
        userInput.focus();
    } else {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ['laiUserInput'] element not found!`, userInput);
    }
    removeLocalStorageObject(activeSessionIdStorageKey);
    showMessage('New session created.', 'success');
}

async function openCloseSessionHistoryMenu(e) {
    const el = e.target;
    e.preventDefault();
    e.stopPropagation();
    await closeAllDropDownRibbonMenus(e);

    const shadowRoot = getShadowRoot();
    const headerSection = shadowRoot.querySelector('.lai-header');
    const sessionList = headerSection.querySelector('#sessionHistMenu');
    if (sessionList && !sessionList.classList.contains('invisible')) { // only close it
        el.classList.remove('js-menu-is-open');
        headerSection.querySelector('#sessionHistMenu')?.remove();
        return;
    }

    const allSessions = await getAllSessions();
    if (allSessions.length < 1) {
        showMessage('No stored sessions found.');
        return;
    }

    el.classList.add('js-menu-is-open');
    headerSection.querySelector('#sessionHistMenu')?.remove(); // if hidden remove it
    const template = shadowRoot.getElementById('histMenuTemplate').content.cloneNode(true);
    const sessionHistMenu = template.children[0];
    sessionHistMenu.id = "sessionHistMenu";
    sessionHistMenu.classList.add('hist-top-menu', 'invisible');

    headerSection.appendChild(sessionHistMenu);

    const menuItemContent = allSessions
        .filter(a => a && a.title)
        .map(a => ({ id: a.id, title: a.title }));
    if (allSessions.length > 0 && menuItemContent.length < 1) {
        showMessage(`${allSessions.length} sessions found but failed to list them!`);
        return;
    }
    else if (menuItemContent.length < 1) {
        showMessage('No stored sessions found.');
        return;
    }

    menuItemContent.push({ "title": "---" });
    menuItemContent.push({ "title": "Delete all sessions" });
    const histDelBtn = buildElements([{
        "span": {
            "class": "hist-btn", "data-type": "delete", "title": "Delete",
            "children": [{ "img": { "src": chrome.runtime.getURL('img/remove-all.svg') } }]
        }
    }]);
    const scrollable = buildElements([{ "div": { "class": "scrollable" } }]);
    const histBootom = buildElements([{ "div": { "class": "fixed-bottom" } }]);

    for (let i = 0, l = menuItemContent.length; i < l; i++) {
        const userEl = menuItemContent[i];
        let menuItem = document.createElement(userEl.title === '---' ? 'hr' : 'div');
        if (userEl.title !== '---') {
            menuItem.className = 'menu-item';
            menuItem.textContent = `${(userEl?.title?.substring(0, 35)) || 'Noname'}${userEl?.title?.length > 35 ? '...' : ''}`;
            menuItem.title = userEl?.title || 'Noname';
            if (i === l - 1) {
                menuItem.addEventListener('click', async (e) => deleteAllHistorySessionsClicked(e), false);
            } else {
                menuItem.addEventListener('click', async (e) => restoreHistorySessionClicked(e, userEl.id), false);
            }
        }

        if (i < l - 2) {
            const delBtn = histDelBtn.cloneNode(true);
            delBtn.setAttribute('data-sessionId', userEl.id);
            delBtn.addEventListener('click', async (e) => deleteHistoryMenuItemClicked(e), false);
            menuItem.appendChild(delBtn);
            scrollable.appendChild(menuItem)
        } else {
            // menuItem.replaceChildren();
            histBootom.appendChild(menuItem);
        }
        // sessionHistMenu.appendChild(menuItem);
    }

    sessionHistMenu.appendChild(scrollable);
    sessionHistMenu.appendChild(histBootom);
    sessionHistMenu.classList.remove('invisible');
    sessionHistMenu.style.cssText = `top: ${e.clientY + 10}px;; left: ${e.clientX - (sessionHistMenu.offsetWidth / 4)}px;`;
}

async function modelChanged(e) {
    const laiOptions = await getLaiOptions();
    const oldModelName = laiOptions.aiModel;
    const newModelName = e.target.options[e.target.selectedIndex].value;
    try {
        await chrome.runtime.sendMessage({ action: "prepareModels", modelName: oldModelName, unload: true });
        if (chrome.runtime.lastError) {
            console.error(`${manifest?.name || 'Unknown'} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`, chrome.runtime.lastError);
            // throw new Error(`${manifest?.name || 'Unknown'} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`);
        }
        await chrome.runtime.sendMessage({ action: "prepareModels", modelName: newModelName, unload: false });
        if (chrome.runtime.lastError) { throw new Error(`${manifest?.name || 'Unknown'} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
    } catch (err) {
        console.log(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}]`, err);
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
            console.log(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${id} is not implemented yet`);
            break;
    }
}

// function hideActiveSessionMenu() { // or hideInactiveSessionMenu ???
//     const shadowRoot = getShadowRoot();
//     if (!shadowRoot) { return; }
//     const headerSection = shadowRoot.querySelector('.lai-header');
//     headerSection?.querySelector('#sessionHistMenu')?.remove();
// }

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
                .catch(e => console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${e.message}`, e));
            break;
        default:
            console.warn(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Unknown action - ${action}`);
    }

    if (action !== 'edit') {
        hidePopups(e);
        userInput.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
    }
}

function showLastErrorMessage(e) {
    e.stopPropagation();
    showMessage(lastRegisteredErrorMessage.toReversed().slice(0, 5), 'error');
}

async function modelLabelClicked(e) {
    e.stopPropagation();
    e.preventDefault();
    let container = e?.currentTarget; // e.target;
    if (container.id !== 'modelNameContainer') { container = e.target.closest('div#modelNameContainer'); }
    if (!container) { return; }
    await closeAllDropDownRibbonMenus(e);

    const isOpen = container.classList.contains('open');
    if (!isOpen) {
        await getAndShowModels();
        container.classList.add('open', 'js-menu-is-open');
        return;
    }

    const shadowRoot = getShadowRoot();
    const availableModelsList = shadowRoot.querySelector('#availableModelList');
    availableModelsList?.classList.add('invisible');
    container.classList.remove('open', 'js-menu-is-open');
}

async function getAndShowModels() {
    const laiOptions = await getLaiOptions();
    let response;
    updateStatusBar('Loading model list...')
    try {
        response = await chrome.runtime.sendMessage({ action: "getModels" });
        if (chrome.runtime.lastError) { throw new Error(`${manifest?.name || 'Unknown'} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        if (typeof (response) === 'boolean') { return; }
        if (!response) { throw new Error(`[${getLineNumber()}] - Server does not respond!`); }
        if (response.status !== 'success') { throw new Error(response?.message || 'Unknown error!'); }
        laiOptions.modelList = response.models?.map(m => m.name).sort() || [];
        await setOptions(laiOptions);
        await fillAndShowModelList(response.models?.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
        showMessage(e.message, 'error');
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ERROR: ${e.message}`, e, response);
    } finally { resetStatusbar(); }

}

async function fillAndShowModelList(models) {
    const shadowRoot = getShadowRoot();
    const modelNameContainer = shadowRoot.querySelector('#modelNameContainer');
    const modelList = shadowRoot.querySelector('#availableModelList');
    const modelsDropDown = shadowRoot.querySelector('#modelList');
    let opt = modelsDropDown.options[0];
    if (!modelList) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ERROR: Failed to find model list!`, e, modelList);
        showMessage('Failed to find model list!', 'error');
        return;
    }

    modelList.replaceChildren();
    modelsDropDown.replaceChildren();
    modelsDropDown.appendChild(opt);
    const laiOptions = await getOptions();
    models.forEach(async (model, idx) => {
        const m = document.createElement('div');
        m.textContent = `${model.name}${model.name === laiOptions.aiModel ? ' ✔' : ''}`;
        m.addEventListener('click', async e => {
            e.stopPropagation();
            await closeAllDropDownRibbonMenus(e);
            modelsDropDown.selectedIndex = idx + 1; // there is an extra empty option
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

async function swapActiveModel(e, modelName) {
    e.stopPropagation();
    const activatedModel = e.target;
    const parent = activatedModel.parentElement;
    const laiOptions = await getOptions();
    const oldModel = laiOptions.aiModel;
    if (!activatedModel) { return; }
    try {
        showSpinner();
        updateStatusBar(`Trying to remove ${oldModel} from the memory...`);
        let response = await chrome.runtime.sendMessage({ action: "prepareModels", modelName: oldModel, unload: true });
        if (chrome.runtime.lastError) {
            console.error(`${manifest?.name || 'Unknown'} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`, chrome.runtime.lastError);
            // throw new Error(`${manifest?.name || 'Unknown'} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`);
        }
        if (response.status !== 200) { showMessage(`Problem occured when unloading the ${oldModel} model!`, 'warning'); }

        updateStatusBar(`Trying to load ${modelName} into the memory...`);
        response = await chrome.runtime.sendMessage({ action: "prepareModels", modelName: modelName, unload: false });
        if (chrome.runtime.lastError) { throw new Error(`${manifest?.name || 'Unknown'} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        if (response.status !== 200) {
            showMessage(`Failed to load ${modelName} model!`, 'error');
            return;
        }

        laiOptions.aiModel = modelName;
        await setOptions(laiOptions);
        await adjustThinkingStatus();
        await adjustToolsStatus();

        setModelNameLabel({ "model": modelName });
        Array.from(parent.children).forEach(child => child.textContent = child.textContent.replace(/ ✔/g, ''));
        activatedModel.textContent = `${activatedModel.textContent} ✔`;
        parent.classList.add('invisible');
        const sideBar = getSideBar();
        sideBar.querySelector('div#modelNameContainer')?.classList.remove('open')
        showMessage(`${oldModel} model was replaced with ${modelName}.`, 'success');
    } catch (error) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Error occured while changing the model`);
    } finally { hideSpinner(); }
}

async function onToolFunctionsBtnClick(e) {
    const el = e.target;

    const model = await getAiModel();
    const canUseTools = await modelCanUseTools(model);
    if(!canUseTools){
        showMessage(`The model ${model} does not support tools.`);
        return;
    }

    el.classList.toggle('disabled');
    if (el.classList.contains('disabled')) {
        el.title = el.alt = el.alt.replace(/Disable/g, 'Enable');
    } else {
        el.title = el.alt = el.alt.replace(/Enable/g, 'Disable');
    }
    updateStatusBar(`Tools are ${el.classList.contains('disabled') ? 'disabled' : 'enabled'}.`)
    setTimeout(() => resetStatusbar(), 3000);
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

function isPinned() {
    const pinned = getShadowRoot()?.getElementById('laiPinned');
    const pinImg = pinned?.querySelector('img[data-type="black_pushpin"]');
    return !pinImg?.classList.contains('invisible');
}

async function restoreHistorySessionClicked(e, sessionIdx) {
    e.stopPropagation();
    e.stopImmediatePropagation();
    // const el = e.target;
    const shadowRoot = getShadowRoot();
    await closeAllDropDownRibbonMenus(e);
    const session = await getActiveSessionById(sessionIdx);
    console.log(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Retrieved session:`, session);
    console.log(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - session.data length:`, session?.data?.length);

    if (!session || !session.data || session.data.length === 0) {
        showMessage(`No session data found on session ${sessionIdx}`, "warning");
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - No data found in current session.`, session);
        return;
    }

    await setActiveSessionId(sessionIdx);
    clearChatHistoryUI();

    console.log(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - About to restore ${session.data.length} messages`);
    for (const [i, msg] of session.data.entries()) {
        console.log(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Restoring message ${i}:`, msg);
        if(!msg.role || (msg.role !== 'user' && msg.role !== 'assistant'))  {  continue;  }
        if(!msg.content || msg.content.trim() === '')  {  continue;  }
        if(msg?.tool_calls)  {  continue;  }
        const role = msg?.role?.replace(/assistant/i, 'ai');
        if (!role) {
            console.warn(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Skipping message ${i} - no role found`);
            continue;
        }

        const aiReplyTextElement = await addInputCardToUIChatHistory('', role, i);
        await parseAndRender(msg.content, aiReplyTextElement, { streamReply: false });
    }

    const laiChatMessageList = shadowRoot.querySelector('#laiChatMessageList');
    laiChatMessageList.scrollTop = laiChatMessageList.scrollHeight;

    showMessage(`session "${session.title}" restored.`, 'info');
}

async function deleteHistoryMenuItemClicked(e) {
    e.stopPropagation();
    e.stopImmediatePropagation();
    const btn = e.currentTarget;
    const sessionId = btn.getAttribute('data-sessionId');
    const menuItem = btn.closest('div.menu-item');
    const title = menuItem?.textContent.trim() || '';
    try {
        await deleteSessionById(sessionId);
        if (menuItem) { menuItem.remove(); }
        updateStatusBar(`Deleted session "${title}"`);
        setTimeout(() => resetStatusbar(), 1500);
    } catch (error) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${error.message}`, error);
        showMessage(`Failed to delete session: ${error.message}`, 'error');
    }
}

async function deleteAllHistorySessionsClicked(e) {
    e.stopPropagation();
    e.stopImmediatePropagation();
    const el = e.target;
    try {
        await recycleAllSessions();
    } catch (error) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${error.message}`, error);
    }
    el.closest('div#sessionHistMenu').remove();
    showMessage('All sessions deleted.');
}

function modifiersClicked(e) {
    let el = e.target;
    let menu = el?.querySelector('.session-menu');
    if (!menu) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - .session-menu element not found`);
        return;
    }

    e.stopPropagation();

    if (menu.classList.contains('invisible')) {
        menu.classList.remove('invisible');
        el.classList.add('js-menu-is-open');
    } else {
        el.classList.remove('js-menu-is-open');
        menu.classList.add('invisible');
    }
}

function getModelModifiers() {
    const shadowRoot = getShadowRoot();
    const elements = Array.from(shadowRoot?.querySelectorAll('#modifiers input'))?.filter(el => el.value);
    if (elements.length < 1) { return; }
    const settings = {};
    elements.forEach(el => {
        const { name, value, type, step } = el;
        if (!value) { return; }

        let parsed = value;
        if (type === 'number') {
            parsed = step && step.includes('.')
                ? parseFloat(value)
                : parseInt(value, 10);
        }
        settings[name] = parsed;
    });
    return settings;
}

async function adjustThinkingStatus(thinkingIconEl) {
    if (!thinkingIconEl) {
        let shadowRoot = getShadowRoot();
        thinkingIconEl = shadowRoot?.querySelector('#modelThinking');
        if (!thinkingIconEl) { return; }
    }
    const model = await getAiModel();
    const url = await getAiUrl()
    if (await modelCanThink(model, url)) {
        thinkingIconEl.classList.remove('disabled');
    } else {
        thinkingIconEl.classList.add('disabled');
    }
    updateStatusBar(`Thinking ${thinkingIconEl.classList.contains('disabled') ? 'disabled' : 'enabled'}.`);
    setTimeout(() => { resetStatusbar(); }, 1000);
}

async function adjustToolsStatus(el) {
    if (!el) {
        let shadowRoot = getShadowRoot();
        el = shadowRoot?.querySelector('#toolFunctions');
        if (!el) { return; }
    }

    const model = await getAiModel();
    if (await modelCanUseTools(model)) {
        el.classList.remove('disabled');
    } else {
        el.classList.add('disabled');
    }
    updateStatusBar(`Tools ${el.classList.contains('disabled') ? 'disabled' : 'enabled'}.`);
    setTimeout(() => { resetStatusbar(); }, 1000);
}