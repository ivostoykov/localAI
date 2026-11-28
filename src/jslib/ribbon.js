async function initRibbon() {

    const shadowRoot = getShadowRoot();
    if (!shadowRoot) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - shadowRoot not found!`, shadowRoot);
        return;
    }

    const ribbon = getRibbon();
    if (!ribbon) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ribbon not found!`, ribbon);
        return;
    }

    const laiOptions = await getOptions();
    if (!laiOptions) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - laiOptions not found!`, laiOptions);
        return;
    }

    ribbon?.querySelector('#errorMsgBtn')?.addEventListener('click', showLastErrorMessage);

    const tempInput = ribbon?.querySelector('#tempInput');
    if (tempInput) {
        const temp = laiOptions?.tempInput || "0.5";
        tempInput.value = temp;
        tempInput.title = parseFloat(temp) < 0.5 ? 'Stricter' : (temp > 0.5 ? 'More Createive' : 'Neutral');
    } else {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - tempInput not found!`, tempInput);
    }

    ribbon?.querySelectorAll('img').forEach(el => laiSetImg(el));

    const modelLabel = shadowRoot.getElementById('modelNameContainer');
    if (modelLabel) {
        modelLabel.addEventListener('click', async (e) => await modelLabelClicked(e));
        laiSetImg(modelLabel.querySelector('img'));
    }

    shadowRoot?.querySelector('#addUsrCmdMenu')?.addEventListener('click', e => {
        closeRibbonMenuElement(shadowRoot.querySelector('#cogBtn'), shadowRoot);
        popUserCommandEditor();
    });

    shadowRoot?.querySelector('#listUsrCmdMenu')?.addEventListener('click', e => {
        closeRibbonMenuElement(shadowRoot.querySelector('#cogBtn'), shadowRoot);
        popUserCommandList(e);
    });
    shadowRoot?.querySelector('#listSysCmdMenu')?.addEventListener('click', e => {
        closeRibbonMenuElement(shadowRoot.querySelector('#cogBtn'), shadowRoot);
        showHelp();
    });
    shadowRoot?.querySelector('#createSessionCmdMenu')?.addEventListener('click', async e => {
        closeRibbonMenuElement(shadowRoot.querySelector('#cogBtn'), shadowRoot);
        await createNewSessionClicked(e, shadowRoot);
    });
    shadowRoot?.querySelector('#delSessionsCmdMenu')?.addEventListener('click', e => {
        closeRibbonMenuElement(shadowRoot.querySelector('#cogBtn'), shadowRoot);
        openSessionDeleteConfirm(e);
    });

    shadowRoot?.querySelector('#mainHelpMenu')?.addEventListener('click', async (e) => {
        closeRibbonMenuElement(shadowRoot.querySelector('#cogBtn'), shadowRoot);
        try {
            await chrome.runtime.sendMessage({ action: "openMainHelpMenu" })
            if (chrome.runtime.lastError) { throw new Error(`${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        } catch (e) {
            if (e.message.indexOf('Extension context invalidated.') > -1) {
                showMessage(`${e.message}. Please reload the page.`, 'warning');
            }
            console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${e.message}`, e);
        }
    });

    shadowRoot?.querySelector('#modifiersHelp')?.addEventListener('click', async (e) => {
        closeRibbonMenuElement(shadowRoot.querySelector('#modifiers'), shadowRoot);
        try {
            await chrome.runtime.sendMessage({ action: "openModifiersHelpMenu" })
            if (chrome.runtime.lastError) { throw new Error(`${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        } catch (e) {
            if (e.message.indexOf('Extension context invalidated.') > -1) {
                showMessage(`${e.message}. Please reload the page.`, 'warning');
            }
            console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${e.message}`, e);
        }
    });

    shadowRoot?.querySelector('#optionsMenu')?.addEventListener('click', async function (e) {
        if (!checkExtensionState()) { return; }
        closeRibbonMenuElement(shadowRoot.querySelector('#cogBtn'), shadowRoot);

        try {
            updateStatusBar('Opening Option Page ...');
            await chrome.runtime.sendMessage({ action: "openOptionsPage" })
            if (chrome.runtime.lastError) { throw new Error(`${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        } catch (e) {
            if (e.message.indexOf('Extension context invalidated.') > -1) {
                showMessage(`${e.message}. Please reload the page.`, 'warning');
            }
            console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${e.message}`, e);
        }
        finally {
            resetStatusbar();
            shadowRoot?.getElementById('laiUserInput')?.focus();
        }
    });

    const toolFunctions = ribbon?.querySelector('#toolFunctions');
    toolFunctions?.addEventListener('click', async e => onToolFunctionsBtnClick(e), false);
    ribbon?.querySelector('#systemIntructions')?.addEventListener('click', laiShowSystemInstructions, false);
    ribbon?.querySelector('#laiNewSessionBtn')?.addEventListener('click', async e => await createNewSessionClicked(e, shadowRoot), false);
    ribbon?.querySelector('#laiSessionNameBtn')?.addEventListener('click', async e => await sessionHistoryClicked(e), false);
    ribbon?.querySelector('#laiDeleteSessionBtn')?.addEventListener('click', e => openSessionDeleteConfirm(e), false);
    ribbon?.querySelector('#laiSessionDeleteConfirmBtn')?.addEventListener('click', async e => await confirmDeleteActiveSession(e, shadowRoot), false);
    ribbon?.querySelector('#laiSessionDeleteCancelBtn')?.addEventListener('click', e => cancelSessionDelete(e), false);
    ribbon?.querySelector('#laiSessionControls')?.addEventListener('keydown', sessionDeleteConfirmKeydown, false);
    ribbon?.querySelector('#apiUrlList')?.addEventListener('change', async e => await selectMenuChanged(e));
    // ribbon?.querySelector('#modelList')?.addEventListener('change', async e => await modelChanged(e), false);
    ribbon?.querySelector('#hookList')?.addEventListener('change', async e => await selectMenuChanged(e), false);
    ribbon?.querySelector('#laiModelName').addEventListener('mouseenter', e => {
        updateStatusBar('Click to toggle the list with available models.');
        setTimeout(resetStatusbar, 10000);
    }, false);
    ribbon?.querySelector('#cogBtn')?.addEventListener('click', async function (e) {
        const el = e.composedPath().find(node => node?.id === 'cogBtn');
        e.stopPropagation();
        closeQuickPromptListMenu();
        closeSessionListOnOutsideClick();
        await closeAllDropDownRibbonMenus(e);
        shadowRoot.querySelector('#cogMenu').classList.toggle('invisible');
        el.classList.toggle('js-menu-is-open', !shadowRoot.querySelector('#cogMenu').classList.contains('invisible'));
    }, false);

    ribbon?.querySelector('#refreshCloudModelListBtn')?.addEventListener('click', refreshCloudModelListBtnClick);
    ribbon?.querySelector('#localModelTab')?.addEventListener('click', modelListTabClicked);
    ribbon?.querySelector('#cloudModelTab')?.addEventListener('click', modelListTabClicked);
    await initCloudModelStatus(ribbon);

    ribbon?.querySelector('#modelThinking')?.addEventListener('click', async e => {
        const el = e.target;
        const model = await getAiModel();
        const canThink = await modelCanThinkHelper(model);
        if(!canThink){
            showMessage(`The model ${model} does not support thinking mode.`);
            return;
        }
        el.classList.toggle('disabled')
        updateStatusBar(`Thinking ${el.classList.contains('disabled') ? 'disabled' : 'enabled'}.`);
        setTimeout(() => { resetStatusbar(); }, 1000);
    });
    scheduleModelCapabilityRefresh();

    shadowRoot?.querySelector('#laiSessionControls')?.querySelectorAll('img').forEach(el => laiSetImg(el));
    shadowRoot?.addEventListener('click', closeSessionDeleteConfirmOnOutsideClick);

    shadowRoot?.getElementById('closeSidebarBtn')?.addEventListener('click', async e => await onCloseSidebarClick(e, shadowRoot), false);
    shadowRoot?.getElementById('laiAbort')?.addEventListener('click', async e => await laiAbortRequest(e), false);

    shadowRoot?.getElementById('laiSessionHistoryMenu')?.querySelectorAll('img').forEach(el => laiSetImg(el));

    const sessionListDialog = shadowRoot?.querySelector('#sessionListContainer');
    sessionListDialog?.addEventListener('keydown', sessionListKeydown);
    sessionListDialog?.querySelector('#sessionListClose')?.addEventListener('click', () => closeSessionListDialog());
    sessionListDialog?.querySelector('#sessionListDeleteAll')?.addEventListener('click', sessionListDeleteAllClicked);
    sessionListDialog?.querySelector('#sessionListDeleteAllConfirm')?.addEventListener('click', deleteAllHistorySessionsClicked);
    sessionListDialog?.querySelector('#sessionListDeleteAllCancel')?.addEventListener('click', sessionListDeleteAllCancelClicked);
    shadowRoot?.addEventListener('click', closeSessionListOnOutsideClick);

    const sysIntructInput = shadowRoot?.querySelector('#laiSysIntructInput');
    sysIntructInput.value = laiOptions.systemInstructions || '';

    shadowRoot?.getElementById('laiPinned').querySelectorAll('img').forEach(el => {
        el.addEventListener('click', async e => await laiPushpinClicked(e));
    });

}

function scheduleModelCapabilityRefresh(attempt = 0) {
    if (attempt > 5) {
        console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Model capability refresh retries exhausted.`);
        return;
    }

    const shadowRoot = getShadowRoot();
    const ribbon = getRibbon();
    if (!shadowRoot || !ribbon) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Retrying model capability refresh (${attempt + 1}/6) because the ribbon is not ready yet.`);
        setTimeout(() => scheduleModelCapabilityRefresh(attempt + 1), 500);
        return;
    }

    Promise.allSettled([
        adjustThinkingStatus(ribbon?.querySelector('#modelThinking'), { suppressStatusBar: true, throwOnError: true }),
        adjustToolsStatus(ribbon?.querySelector('#toolFunctions'), { suppressStatusBar: true, throwOnError: true })
    ]).then(results => {
        const failed = results.some(result => result.status === 'rejected');
        if (!failed) { return; }

        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Retrying model capability refresh (${attempt + 1}/6) after a startup capability probe failure.`, results);
        setTimeout(() => scheduleModelCapabilityRefresh(attempt + 1), 1000);
    });
}

function onModelOptionsChanged(changes, areaName) {
    if (areaName !== 'sync' || !changes?.[storageOptionKey]) { return false; }

    const { oldValue, newValue } = changes[storageOptionKey];
    if ((oldValue?.aiModel ?? '') === (newValue?.aiModel ?? '') && (oldValue?.aiUrl ?? '') === (newValue?.aiUrl ?? '')) { return false; }

    setModelNameLabel({ "model": newValue?.aiModel });
    scheduleModelCapabilityRefresh();
    return true;
}

function onSessionsStorageChanged(changes, areaName) {
    if (areaName !== 'local' || !changes?.[allSessionsStorageKey]) { return false; }
    void renderSessionNameLabel();
    return true;
}

async function closeAllDropDownRibbonMenus(e) {
    const shadowRoot = getShadowRoot();
    const openMenus = Array.from(shadowRoot?.querySelectorAll('.js-menu-is-open') ?? []);
    if (openMenus.length < 1) { return; }

    const compPath = e?.composedPath?.() ?? [];
    if (compPath.some(node => node?.id === 'laiMainButton')) { return; }

    openMenus.forEach(el => {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - compPath inside forEach`, compPath);
        if (compPath.includes(el)) { return; }
        const relatedMenuId = el.id === 'cogBtn' ? 'cogMenu' : el.dataset.menuId;
        if (relatedMenuId && compPath.some(node => node?.id === relatedMenuId)) { return; }
        closeRibbonMenuElement(el, shadowRoot);
    });
}

function closeRibbonMenuElement(el, shadowRoot = getShadowRoot()) {
    if (!el) { return; }
    if (el.id === 'modelNameContainer' || el.dataset?.menuId === 'availableModelList') {
        closeModelListMenu(el, shadowRoot);
        return;
    }
    const menu = el.id === 'cogBtn' ? shadowRoot?.querySelector('#cogMenu') : el.querySelector('.session-menu');
    menu?.classList.add('invisible');
    el.classList.remove('js-menu-is-open');
}

function closeModelListMenu(container = null, shadowRoot = getShadowRoot()) {
    const modelContainer = container || shadowRoot?.querySelector('#modelNameContainer');
    shadowRoot?.querySelector('#availableModelList')?.classList.add('invisible');
    modelContainer?.classList.remove('open', 'js-menu-is-open');
}


function laiShowSystemInstructions(e) {
    const shadowRoot = getShadowRoot();
    const sysIntructContainer = shadowRoot?.getElementById('laiSysIntructContainer');
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
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ['laiUserInput'] element not found!`, userInput);
    }
    await deleteActiveSessionId();
    await reportTabBinding({ sessionId: null });
    showMessage('New session created.', 'success');
}

async function sessionHistoryClicked(e) {
    e.preventDefault();
    e.stopPropagation();
    closeQuickPromptListMenu();
    await closeAllDropDownRibbonMenus(e);
    hideSessionDeleteConfirm();
    await popSessionList();
}

function getSessionDeleteConfirm(shadowRoot = getShadowRoot()) {
    return shadowRoot?.querySelector('#laiSessionDeleteConfirm') ?? null;
}

/**
 * Shows the inline delete confirmation beside the session name. The bin is disabled while the
 * active session has no stored record, and the cog item takes the same guarded path.
 */
function openSessionDeleteConfirm(e = null) {
    e?.stopPropagation?.();
    const shadowRoot = getShadowRoot();
    const button = shadowRoot?.querySelector('#laiDeleteSessionBtn');
    const confirm = getSessionDeleteConfirm(shadowRoot);
    if (!button || !confirm) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Session controls: the delete controls are not available.`);
        showMessage('The session controls are not available.', 'error');
        return false;
    }
    if (button.disabled) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Session controls: no stored session to delete.`);
        showMessage('No session to delete.');
        return false;
    }
    confirm.classList.remove('invisible');
    button.setAttribute('aria-expanded', 'true');
    confirm.querySelector('#laiSessionDeleteConfirmBtn')?.focus();
    return true;
}

function hideSessionDeleteConfirm(shadowRoot = getShadowRoot()) {
    const confirm = getSessionDeleteConfirm(shadowRoot);
    if (!confirm || confirm.classList.contains('invisible')) { return false; }
    confirm.classList.add('invisible');
    shadowRoot?.querySelector('#laiDeleteSessionBtn')?.setAttribute('aria-expanded', 'false');
    return true;
}

function cancelSessionDelete(e = null) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    const shadowRoot = getShadowRoot();
    if (!hideSessionDeleteConfirm(shadowRoot)) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Session controls: no delete confirmation is open.`);
        return;
    }
    shadowRoot?.querySelector('#laiDeleteSessionBtn')?.focus();
}

async function confirmDeleteActiveSession(e = null, shadowRoot = getShadowRoot()) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    const confirm = getSessionDeleteConfirm(shadowRoot);
    if (!confirm || confirm.classList.contains('invisible')) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Session controls: no delete confirmation is open.`);
        showMessage('No session deletion is waiting for confirmation.');
        return;
    }
    hideSessionDeleteConfirm(shadowRoot);
    await recycleActiveSession(e, shadowRoot);
}

function sessionDeleteConfirmKeydown(e) {
    if (e?.key !== 'Escape') { return; }
    const confirm = getSessionDeleteConfirm();
    if (!confirm || confirm.classList.contains('invisible')) { return; }
    e.preventDefault();
    e.stopPropagation();
    cancelSessionDelete(e);
}

function closeSessionDeleteConfirmOnOutsideClick(e) {
    const shadowRoot = getShadowRoot();
    const confirm = getSessionDeleteConfirm(shadowRoot);
    if (!confirm || confirm.classList.contains('invisible')) { return; }
    const path = e?.composedPath?.() || [];
    if (path.some(node => node?.id === 'laiSessionControls' || node?.id === 'delSessionsCmdMenu')) { return; }
    hideSessionDeleteConfirm(shadowRoot);
}

/**
 * Builds and shows the sessions dialog (#64): every saved session ordered by last
 * use, its state relative to open tabs, and row actions for load, rename and delete.
 */
async function popSessionList(el = null) {
    if (el?.value) { el.value = el.value.replace('/session', ''); }

    const shadowRoot = getShadowRoot();
    if (!shadowRoot) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Sessions dialog: shadow root not found.`);
        showMessage('The sessions dialog is not available.', 'error');
        return;
    }
    const dialog = shadowRoot.querySelector('#sessionListContainer');
    if (!dialog) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Sessions dialog: #sessionListContainer not found.`);
        showMessage('The sessions dialog is not available.', 'error');
        return;
    }

    dialog.classList.remove('invisible');
    let openSessions = { openSessionIds: [], ownSessionId: null };
    try {
        openSessions = await fetchOpenSessions();
    } catch (error) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Sessions dialog: failed to read the open sessions.`, error);
    }
    const { openSessionIds, ownSessionId } = openSessions ?? {};
    const sessions = (await getAllSessions() ?? [])
        .filter(session => session?.id)
        .sort((a, b) => (b.lastAccessedAt ?? b.createdAt ?? 0) - (a.lastAccessedAt ?? a.createdAt ?? 0));

    if (dialog.classList.contains('invisible')) { return; }
    hideSessionListDeleteAllConfirm(dialog);
    buildSessionListRows(dialog, sessions, ownSessionId, openSessionIds);

    dialog.focus();
}

function buildSessionListRows(dialog, sessions, ownSessionId, openSessionIds) {
    const block = dialog.querySelector('.session-list-block');
    block.replaceWith(block.cloneNode(false));
    const freshBlock = dialog.querySelector('.session-list-block');
    freshBlock.addEventListener('click', e => sessionListBlockClicked(e));

    if (sessions.length < 1) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Sessions dialog: no saved sessions found.`);
        showMessage('No stored sessions found.');
        showSessionListEmptyState(dialog);
        return;
    }

    const openIds = new Set(openSessionIds ?? []);
    for (const session of sessions) {
        freshBlock.appendChild(buildSessionListRow(session, ownSessionId, openIds));
    }
}

function showSessionListEmptyState(dialog) {
    const block = dialog?.querySelector('.session-list-block');
    if (block) {
        block.replaceChildren();
        const empty = document.createElement('div');
        empty.className = 'session-list-empty';
        empty.textContent = 'There are no saved sessions.';
        block.appendChild(empty);
    }
}

function buildSessionListRow(session, ownSessionId, openIds) {
    const title = session?.title || 'Noname';
    const state = session.id === ownSessionId ? 'current' : (openIds.has(session.id) ? 'open' : 'closed');

    const row = document.createElement('div');
    row.className = 'session-list-item';
    row.dataset.sessionId = session.id;
    row.dataset.title = title;
    if (state === 'closed') { row.classList.add('session-list-item-closed'); }

    const firstLine = document.createElement('div');
    firstLine.className = 'session-list-item-first';
    firstLine.appendChild(buildSessionListTitleButton(title));

    const stateTag = document.createElement('span');
    stateTag.className = 'session-list-item-state';
    stateTag.textContent = state;
    firstLine.appendChild(stateTag);

    const lastPage = document.createElement('div');
    lastPage.className = 'session-list-item-last-page';
    lastPage.textContent = session.lastPage?.domain
        ? `${session.lastPage.domain} — ${session.lastPage.title ?? ''}`
        : '';

    const actions = document.createElement('div');
    actions.className = 'session-list-item-actions';
    actions.appendChild(buildSessionListActionButton('rename', `Rename session ${title}`, 'img/edit-pen.svg'));
    actions.appendChild(buildSessionListActionButton('load', `Load session ${title}`, 'img/execute.svg'));
    actions.appendChild(buildSessionListActionButton('delete', `Delete session ${title}`, 'img/remove.svg'));

    row.appendChild(firstLine);
    row.appendChild(lastPage);
    row.appendChild(actions);
    return row;
}

function buildSessionListTitleButton(title) {
    const titleButton = document.createElement('button');
    titleButton.type = 'button';
    titleButton.className = 'session-list-item-title';
    titleButton.dataset.action = 'load';
    titleButton.textContent = title;
    titleButton.title = title;
    titleButton.setAttribute('aria-label', `Load session ${title}`);
    return titleButton;
}

function buildSessionListActionButton(action, accessibleName, iconPath) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action;
    button.title = accessibleName;
    button.setAttribute('aria-label', accessibleName);
    const img = document.createElement('img');
    img.src = chrome.runtime.getURL(iconPath);
    img.alt = '';
    button.appendChild(img);
    return button;
}

async function sessionListBlockClicked(e) {
    const path = e?.composedPath?.() || [];
    const button = path.find(node => node?.tagName === 'BUTTON' && node?.dataset?.action);
    const row = path.find(node => node?.classList?.contains('session-list-item'));

    if (button && row) {
        e.stopPropagation();
        switch (button.dataset.action) {
            case 'load':
                await loadSessionFromSessionList(row);
                break;
            case 'rename':
                await startSessionRename(row, row.dataset.sessionId);
                break;
            case 'delete':
                await deleteSessionFromSessionList(row);
                break;
        }
    }
}

async function loadSessionFromSessionList(row) {
    const sessionId = row.dataset.sessionId;
    const session = (await getAllSessions() ?? []).find(s => s?.id === sessionId);
    if (!session || (session.messages ?? []).length < 1) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Sessions dialog: session "${sessionId}" could not be loaded.`, session);
        showMessage(`Session "${row.dataset.title}" could not be loaded.`, 'error');
        return;
    }

    await restoreHistorySessionClicked(null, sessionId);
    closeSessionListDialog();
}

async function deleteSessionFromSessionList(row) {
    const sessionId = row.dataset.sessionId;
    const title = row.dataset.title || '';
    const wasActiveSession = !!sessionId && (await getActiveSessionId()) === sessionId;
    try {
        await deleteSessionById(sessionId);
        if (wasActiveSession) { await reportTabBinding({ sessionId: null }); }
        row.remove();
        const dialog = getShadowRoot()?.querySelector('#sessionListContainer');
        if (!dialog?.querySelector('.session-list-item')) { showSessionListEmptyState(dialog); }
        updateStatusBar(`Deleted session "${title}"`);
        setTimeout(() => resetStatusbar(), 1500);
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${error.message}`, error);
        showMessage(`Failed to delete session: ${error.message}`, 'error');
    }
}

function sessionListDeleteAllClicked(e) {
    e.stopPropagation();
    const dialog = getShadowRoot()?.querySelector('#sessionListContainer');
    if (!dialog) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Sessions dialog: #sessionListContainer not found.`);
        showMessage('The sessions dialog is not available.', 'error');
        return;
    }
    dialog.querySelector('.session-list-ribbon:not(.session-list-confirm)')?.classList.add('invisible');
    dialog.querySelector('.session-list-confirm')?.classList.remove('invisible');
    dialog.querySelector('#sessionListDeleteAllConfirm')?.focus();
}

function sessionListDeleteAllCancelClicked(e) {
    e?.stopPropagation?.();
    hideSessionListDeleteAllConfirm(getShadowRoot()?.querySelector('#sessionListContainer'));
}

function hideSessionListDeleteAllConfirm(dialog) {
    dialog?.querySelector('.session-list-ribbon:not(.session-list-confirm)')?.classList.remove('invisible');
    dialog?.querySelector('.session-list-confirm')?.classList.add('invisible');
}

function sessionListKeydown(e) {
    if (e?.key === 'Escape') {
        e.stopPropagation();
        closeSessionListDialog();
    }
}

function closeSessionListOnOutsideClick(e) {
    const dialog = getShadowRoot()?.querySelector('#sessionListContainer');
    const path = e?.composedPath?.() || [];
    const isDialogOrTrigger = path.some(node => node?.id === 'sessionListContainer' || node?.id === 'laiSessionNameBtn');
    if (dialog && !dialog.classList.contains('invisible') && !isDialogOrTrigger) {
        closeSessionListDialog(dialog);
    }
}

function closeSessionListDialog(dialog = null) {
    const resolved = dialog || getShadowRoot()?.querySelector('#sessionListContainer');
    if (resolved) {
        hideSessionListDeleteAllConfirm(resolved);
        resolved.classList.add('invisible');
    }
}

async function selectMenuChanged(e) {
    const laiOptions = await getOptions();
    const id = e.target.id;
    switch (id) {
        case 'apiUrlList':
            laiOptions.aiUrl = e.target.options[e.target.selectedIndex].value;
            await setOptions(laiOptions);
            break;
        case 'hookList':
            break;
    }
}

function popUserCommandList(el) {
    if (el?.value) {
        el.value = el?.value?.replace('/list', '');
    }
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { return; }
    const cmdList = shadowRoot.querySelector('#commandListContainer');
    cmdList.querySelectorAll('img').forEach(img => { laiSetImg(img); });

    const closeBtn = cmdList.querySelector('#cmdListClose');
    const addNewBtn = cmdList.querySelector('#cmdListNew');
    const importBtn = cmdList.querySelector('#cmdImport');
    const exportBtn = cmdList.querySelector('#cmdExport');
    const container = cmdList.querySelector('div.user-command-block');

    closeBtn.replaceWith(closeBtn.cloneNode(true));
    addNewBtn.replaceWith(addNewBtn.cloneNode(true));
    importBtn.replaceWith(importBtn.cloneNode(true));
    exportBtn.replaceWith(exportBtn.cloneNode(true));

    const newCloseBtn = cmdList.querySelector('#cmdListClose');
    const newAddNewBtn = cmdList.querySelector('#cmdListNew');
    const newImportBtn = cmdList.querySelector('#cmdImport');
    const newExportBtn = cmdList.querySelector('#cmdExport');

    newCloseBtn.addEventListener('click', () => cmdList.classList.add('invisible'));
    newAddNewBtn.addEventListener('click', () => {
        newCloseBtn.click();
        popUserCommandEditor();
    });
    newImportBtn.addEventListener('click', e => userImport(e));
    newExportBtn.addEventListener('click', async (e) => await exportAsFile(e));

    container.replaceChildren();

    const newContainer = container.cloneNode(false);
    container.replaceWith(newContainer);
    const finalContainer = cmdList.querySelector('div.user-command-block');
    finalContainer.addEventListener('click', () => newCloseBtn.click());

    const allCmds = [...userPredefinedCmd, ...aiUserCommands];

    for (let i = 0; i < allCmds.length; i++) {
        const cmd = allCmds[i];
        const el = document.createElement('div');
        el.setAttribute('data-index', i.toString());

        const cmdItemButtons = addCmdItemButtons(document.createElement('div'), i);
        const cmdItem = document.createElement('div');
        cmdItem.classList.add('user-cmd-item-command');
        const cmdName = document.createElement('b');
        cmdName.textContent = `/${cmd.commandName}`;
        const cmdDescription = document.createTextNode(` - ${cmd.commandDescription || 'No description provided.'}`);
        cmdItem.append(cmdName, cmdDescription);

        el.appendChild(cmdItemButtons);
        el.appendChild(cmdItem);

        finalContainer.appendChild(el);
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
                .catch(e => console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${e.message}`, e));
            break;
        default:
            console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Unknown action - ${action}`);
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
    const container = e.composedPath().find(node => node?.id === 'modelNameContainer');
    if (!container) { return; }
    closeQuickPromptListMenu();
    closeSessionListOnOutsideClick();
    await closeAllDropDownRibbonMenus(e);

    const isOpen = container.classList.contains('open');
    if (!isOpen) {
        container.classList.add('open', 'js-menu-is-open');
        await getAndShowModels();
        return;
    }

    const shadowRoot = getShadowRoot();
    closeModelListMenu(container, shadowRoot);
}

async function initCloudModelStatus(ribbon) {
    const stored = await chrome.storage.local.get(['ollamaCloudModelListUpdate']);
    const lastUpdate = stored?.ollamaCloudModelListUpdate || 0;
    const tab = ribbon?.querySelector('#cloudModelTab');
    if (!tab) { return; }
    if (!lastUpdate) {
        tab.title = 'Cloud models never loaded — click refresh to load';
        return;
    }
    const ageDays = Math.floor((Date.now() - lastUpdate) / 86400000);
    tab.title = ageDays === 0 ? 'Cloud models updated today' : `Cloud models last updated ${ageDays} day${ageDays !== 1 ? 's' : ''} ago`;
}

async function getAndShowModels(forceRefresh = false) {
    const laiOptions = await getOptions();
    let response;
    updateStatusBar(forceRefresh ? 'Refreshing model list...' : 'Loading model list...')
    try {
        response = await chrome.runtime.sendMessage({ action: "getModels", forceRefresh, refreshCloud: true });
        if (chrome.runtime.lastError) { throw new Error(`${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
        if (typeof (response) === 'boolean') { return; }
        if (!response) { throw new Error(`[${getLineNumber()}] - Server does not respond!`); }
        if (response.status !== 'success') { throw new Error(response?.message || 'Unknown error!'); }
        laiOptions.modelList = response.models?.map(m => m.name).filter(Boolean).sort() || [];
        await setOptions(laiOptions);
        await fillAndShowModelList(response);
        const root = getShadowRoot();
        if (!root?.querySelector('#modelNameContainer')?.classList.contains('open')) {
            closeModelListMenu(null, root);
        }
        if ((response.groups?.cloud || []).length > 0 && !response.errors?.cloud) {
            await chrome.storage.local.set({ ollamaCloudModelListUpdate: Date.now() });
            const tab = getShadowRoot()?.querySelector('#cloudModelTab');
            if (tab) { tab.title = 'Cloud models updated today'; }
        } else if (response.errors?.cloud) {
            const tab = getShadowRoot()?.querySelector('#cloudModelTab');
            if (tab) {
                tab.title = response.cloudCatalogueFallbackSource === 'cache'
                    ? 'Cloud catalogue unavailable - showing cached cloud models'
                    : 'Cloud catalogue unavailable - showing locally known cloud models only';
            }
        }
    } catch (e) {
        showMessage(e.message, 'error');
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ERROR: ${e.message}`, e, response);
    } finally { resetStatusbar(); }

}

function modelListTabClicked(event) {
    event.preventDefault();
    event.stopPropagation();
    const tabName = event.composedPath().find(el => el.dataset?.tab)?.dataset.tab;
    if (!tabName) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ERROR: Failed to resolve tab name from event path.`);
        showMessage('Failed to resolve model list tab.', 'error');
        return;
    }
    const modelList = getShadowRoot().querySelector('#availableModelList');
    modelList.dataset.activeTab = tabName;
    modelList.querySelectorAll('.model-list-tab').forEach(button => {
        button.classList.toggle('active', button.dataset.tab === tabName);
    });
    modelList.querySelectorAll('.model-list-panel').forEach(panel => {
        panel.classList.toggle('invisible', panel.dataset.panel !== tabName);
    });
}

async function refreshCloudModelListBtnClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const refreshButton = getShadowRoot().querySelector('#refreshCloudModelListBtn');
    refreshButton.disabled = true;
    refreshButton.classList.add('is-spinning');
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Refreshing Cloud Model List`);
    try {
        await Promise.all([
            getAndShowModels(true),
            new Promise(resolve => setTimeout(resolve, 750))
        ]);
    } finally {
        refreshButton.classList.remove('is-spinning');
        refreshButton.disabled = false;
    }
}

async function fillAndShowModelList(modelPayload = []) {
    const shadowRoot = getShadowRoot();
    const modelList = shadowRoot.querySelector('#availableModelList');
    const modelsDropDown = shadowRoot.querySelector('#modelList');
    const buildComparableNames = (modelName = '') => {
        const variants = [];
        const push = value => {
            if (!value || variants.includes(value)) { return; }
            variants.push(value);
        };

        push(modelName);
        push(modelName.replace(/:latest$/i, ''));
        push(modelName.replace(/-cloud$/i, ''));
        push(modelName.replace(/:cloud$/i, ''));

        return variants.filter(Boolean);
    };
    const getComparableModelNames = (model = {}) => {
        const matchNames = new Set(Array.isArray(model?.matchNames) ? model.matchNames.filter(Boolean) : []);

        [model?.name, model?.model, model?.remoteModel].forEach(value => {
            buildComparableNames(value).forEach(name => matchNames.add(name));
        });

        return [...matchNames];
    };
    const modelMatchesName = (model = {}, modelName = '') => {
        if (!modelName) { return false; }

        const modelNames = new Set(getComparableModelNames(model));
        return buildComparableNames(modelName).some(name => modelNames.has(name));
    };
    let opt = modelsDropDown.options[0];
    if (!modelList) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ERROR: Failed to find model list!`, modelList);
        showMessage('Failed to find model list!', 'error');
        return;
    }

    modelsDropDown.replaceChildren();
    modelsDropDown.appendChild(opt);
    const laiOptions = await getOptions();
    const groups = Array.isArray(modelPayload)
        ? {
            local: (modelPayload || []).filter(model => (model?.source || 'local') !== 'cloud'),
            cloud: (modelPayload || []).filter(model => (model?.source || '') === 'cloud')
        }
        : (modelPayload?.groups || { local: [], cloud: [] });
    const errors = Array.isArray(modelPayload) ? {} : (modelPayload?.errors || {});
    const localGroup = groups?.local || [];
    const cloudGroup = groups?.cloud || [];
    const models = [...localGroup, ...cloudGroup];
    const aiModel = laiOptions.aiModel;
    const selectedModelName = models.find(model => modelMatchesName(model, aiModel))?.name || aiModel;
    const activeTab = localGroup.some(model => model?.name === selectedModelName) ? 'local'
        : cloudGroup.some(model => model?.name === selectedModelName) ? 'cloud'
        : (localGroup.length > 0 || errors?.local) ? 'local'
        : 'cloud';

    modelList.querySelectorAll('.model-list-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === activeTab);
    });

    for (let idx = 0; idx < models.length; idx++) {
        const model = models[idx];
        opt = document.createElement('option');
        opt.text = opt.value = model.name;
        opt.selected = model.name === selectedModelName;
        modelsDropDown.appendChild(opt);
    }

    ['local', 'cloud'].forEach(tabName => {
        const panel = modelList.querySelector(`.model-list-panel[data-panel="${tabName}"]`);
        if (!panel) {
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ERROR: Failed to find model list panel for tab "${tabName}".`);
            showMessage(`Failed to find model list panel for tab "${tabName}".`, 'error');
            return;
        }
        panel.replaceChildren();
        panel.classList.toggle('invisible', tabName !== activeTab);

        const panelModels = tabName === 'local' ? localGroup : cloudGroup;

        if (panelModels.length < 1) {
            const emptyItem = document.createElement('div');
            emptyItem.className = 'model-list-item unavailable';
            emptyItem.textContent = errors?.[tabName]
                ? `${tabName === 'local' ? 'Local' : 'Cloud'} list unavailable`
                : `No ${tabName} models found`;
            panel.appendChild(emptyItem);
            return;
        }

        for (let idx = 0; idx < panelModels.length; idx++) {
            const model = panelModels[idx];
            const item = document.createElement('div');
            item.className = 'model-list-item';
            item.dataset.modelName = model?.name || '';
            item.dataset.modelSource = model?.source || '';

            if (!model?.name) {
                item.classList.add('unavailable');
                panel.appendChild(item);
                continue;
            }

            const label = document.createElement('span');
            label.className = 'model-list-item-label';
            label.textContent = model.name;
            item.appendChild(label);

            if (tabName === 'cloud' && model?.availableLocally) {
                const badge = document.createElement('span');
                badge.className = 'model-list-item-badge';
                badge.textContent = 'Available locally';
                item.appendChild(badge);
            }

            if (model.name === selectedModelName) { item.classList.add('active-model-list-item'); }

            item.addEventListener('click', async event => {
                event.stopPropagation();
                closeModelListMenu();
                const matchingOption = Array.from(modelsDropDown.options).findIndex(option => option.value === model.name);
                if (matchingOption > -1) {
                    modelsDropDown.selectedIndex = matchingOption;
                }
                await swapActiveModel(event, model.name);
            });
            panel.appendChild(item);
        }
    });

    modelList.dataset.activeTab = activeTab;
    modelList.classList.remove('invisible');
}

async function swapActiveModel(e, modelName) {
    e.stopPropagation();
    const laiOptions = await getOptions();
    const oldModel = laiOptions.aiModel;
    if (modelName === oldModel) { return; }

    laiOptions.aiModel = modelName;
    await setOptions(laiOptions);

    setModelNameLabel({ "model": modelName });
    const availableModelList = getShadowRoot()?.querySelector('#availableModelList');
    availableModelList?.querySelectorAll('.model-list-item').forEach(item => {
        item.classList.toggle('active-model-list-item', item.dataset.modelName === modelName);
    });
    showMessage(`${oldModel} replaced with ${modelName}.`, 'success');
}

async function onToolFunctionsBtnClick(e) {
    const el = e.target;

    const model = await getAiModel();
    const canUseTools = await modelCanUseToolsHelper(model);
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

var laiSessionNameRenderSeq = 0;

// Mirrors the active session title at the bottom centre of the ribbon (#130) and enables the
// bin only while the active session has a stored record. textContent keeps titles inert.
async function renderSessionNameLabel() {
    const shadowRoot = getShadowRoot();
    const label = shadowRoot?.getElementById('laiSessionName');
    const nameButton = shadowRoot?.getElementById('laiSessionNameBtn');
    const deleteButton = shadowRoot?.getElementById('laiDeleteSessionBtn');
    if (!label && !nameButton && !deleteButton) { return; }
    const seq = ++laiSessionNameRenderSeq;
    const sessionId = laiActiveSessionId;
    let storedSession = null;
    if (sessionId) {
        const sessions = await getAllSessions();
        if (seq !== laiSessionNameRenderSeq) { return; }
        storedSession = sessions.find(session => session?.id === sessionId) ?? null;
    }
    const title = storedSession?.title?.trim() ?? '';
    if (label) {
        label.textContent = title || 'New session';
        label.title = title;
    }
    if (nameButton) {
        nameButton.setAttribute('aria-label', title ? `Open sessions dialog: ${title}` : 'Open sessions dialog');
    }
    if (deleteButton) {
        deleteButton.disabled = !storedSession;
        const accessibleName = storedSession ? 'Delete Current Session' : 'No session to delete';
        deleteButton.title = accessibleName;
        deleteButton.setAttribute('aria-label', accessibleName);
    }
}

function isPinned() {
    const pinned = getShadowRoot()?.getElementById('laiPinned');
    const pinImg = pinned?.querySelector('img[data-type="black_pushpin"]');
    return !pinImg?.classList.contains('invisible');
}

async function restoreHistorySessionClicked(e = null, sessionIdx = null, { silent = false } = {}) {
    if(e) {
        e.stopPropagation();
        e.stopImmediatePropagation();
    }

    sessionIdx = sessionIdx ?? await getActiveSessionId();
    if(!sessionIdx){  return;  }

    const session = await getActiveSessionById(sessionIdx);
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Retrieved session:`, session);
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - session.messages length:`, session?.messages?.length);

    if (!session || !session.messages || session.messages.length === 0) {
        return;
    }

    await setActiveSessionId(sessionIdx);
    await reportTabBinding({ sessionId: sessionIdx });
    await renderSessionHistoryMessages(session);

    if (!silent) {
        showMessage(`session "${session.title}" restored.`, 'info');
    }
}

function isRenderableSessionMessage(msg) {
    if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) { return false; }
    if (!msg.content || msg.content.trim() === '') { return false; }
    if (msg?.tool_calls) { return false; }
    return true;
}

async function renderSessionHistoryMessage(msg, index = -1) {
    if (!isRenderableSessionMessage(msg)) { return false; }

    if (msg.role === 'user') {
        await renderUserPromptCard(msg.content, index);
        return true;
    }

    const aiReplyTextElement = await addInputCardToUIChatHistory('', 'ai', index);
    await parseAndRender(msg.content, aiReplyTextElement, { streamReply: false });
    setMarkdownSource(aiReplyTextElement, msg.content);
    return true;
}

async function renderSessionHistoryMessages(session, { preserveScroll = false } = {}) {
    if (!getSideBar()?.classList.contains('active')) { return; }
    const viewRevision = panelViewRevision;
    const messageList = getShadowRoot()?.querySelector('#laiChatMessageList');
    if (!messageList) { return; }
    const scrollTop = preserveScroll && userScrolled ? messageList.scrollTop : null;
    if (!preserveScroll) { userScrolled = false; }
    clearChatHistoryUI();

    for (const [i, msg] of (session?.messages ?? []).entries()) {
        if (viewRevision !== panelViewRevision) { return; }
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Restoring message ${i}:`, msg);
        await renderSessionHistoryMessage(msg, i);
    }

    if (viewRevision !== panelViewRevision) { return; }
    if (scrollTop !== null) {
        messageList.scrollTop = scrollTop;
        userScrolled = true;
    } else {
        scrollChatHistoryContainer();
    }
}

async function startSessionRename(row, sessionId) {
    const titleButton = row?.querySelector('.session-list-item-title');
    if (!titleButton) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Sessions dialog: title element not found for session "${sessionId}".`);
        showMessage('The session title could not be found.', 'error');
        return;
    }
    const currentTitle = row.dataset.title || titleButton.textContent;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentTitle;
    input.className = 'session-list-rename-input';
    input.setAttribute('aria-label', `Rename session ${currentTitle}`);

    let committed = false;
    async function commit() {
        if (committed) { return; }
        committed = true;
        const newTitle = input.value.trim();
        const button = buildSessionListTitleButton(newTitle || titleButton.textContent);
        if (newTitle && newTitle !== currentTitle) {
            await renameSession(sessionId, newTitle);
            row.dataset.title = newTitle;
            setSessionRowAccessibleNames(row, newTitle);
        }
        input.replaceWith(button);
    }

    function cancel() {
        if (committed) { return; }
        committed = true;
        input.replaceWith(buildSessionListTitleButton(titleButton.textContent));
    }

    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') { e.stopPropagation(); await commit(); }
        if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
    });
    input.addEventListener('blur', commit);

    titleButton.replaceWith(input);
    input.focus();
    input.select();
}

function setSessionRowAccessibleNames(row, title) {
    row.querySelector('.session-list-item-title')?.setAttribute('aria-label', `Load session ${title}`);
    row.querySelector('[data-action="rename"]')?.setAttribute('aria-label', `Rename session ${title}`);
    row.querySelector('[data-action="load"]:not(.session-list-item-title)')?.setAttribute('aria-label', `Load session ${title}`);
    row.querySelector('[data-action="delete"]')?.setAttribute('aria-label', `Delete session ${title}`);
}

async function deleteAllHistorySessionsClicked(e) {
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (typeof sidebarActionAllowed === 'function' && !sidebarActionAllowed()) { return; }
    const dialog = getShadowRoot()?.querySelector('#sessionListContainer');
    try {
        await recycleAllSessions();
        showMessage('All sessions deleted.');
        closeSessionListDialog(dialog);
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${error.message}`, error);
        showMessage(`Failed to delete all sessions: ${error.message}`, 'error');
        hideSessionListDeleteAllConfirm(dialog);
    }
}

function modifiersClicked(e) {
    const el = e.composedPath()[0];
    if (el?.id !== 'modifiers') { return; }
    const menu = el.querySelector('.session-menu');
    if (!menu) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - .session-menu element not found`);
        return;
    }

    e.stopPropagation();

    if (menu.classList.contains('invisible')) {
        closeQuickPromptListMenu();
        closeSessionListOnOutsideClick();
        closeAllDropDownRibbonMenus(e);
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

async function adjustThinkingStatus(thinkingIconEl, options = {}) {
    const suppressStatusBar = options?.suppressStatusBar || false;
    const throwOnError = options?.throwOnError || false;
    if (!thinkingIconEl) {
        let shadowRoot = getShadowRoot();
        thinkingIconEl = shadowRoot?.querySelector('#modelThinking');
        if (!thinkingIconEl) { return; }
    }
    const model = await getAiModel();
    const canThink = await modelCanThinkHelper(model, { throwOnError });
    if (model !== await getAiModel()) { return; }

    thinkingIconEl.classList.toggle('disabled', !canThink);
    if (!suppressStatusBar) {
        updateStatusBar(`Thinking ${thinkingIconEl.classList.contains('disabled') ? 'disabled' : 'enabled'}.`);
        setTimeout(() => { resetStatusbar(); }, 1000);
    }
}

async function adjustToolsStatus(el, options = {}) {
    const suppressStatusBar = options?.suppressStatusBar || false;
    const throwOnError = options?.throwOnError || false;
    if (!el) {
        let shadowRoot = getShadowRoot();
        el = shadowRoot?.querySelector('#toolFunctions');
        if (!el) { return; }
    }

    const model = await getAiModel();
    const canUseTools = await modelCanUseToolsHelper(model, { throwOnError });
    if (model !== await getAiModel()) { return; }

    el.classList.toggle('disabled', !canUseTools);
    el.title = el.alt = canUseTools ? 'Disable System Tool Functions' : 'Enable System Tool Functions';
    if (!suppressStatusBar) {
        updateStatusBar(`Tools ${el.classList.contains('disabled') ? 'disabled' : 'enabled'}.`);
        setTimeout(() => { resetStatusbar(); }, 1000);
    }
}
