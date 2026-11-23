let sidebarChannel;
let sidebarTabId;
let streamQueue = Promise.resolve();

async function getMyTabId() {
    return sidebarTabId;
}

function getShadowRoot() { return document; }
function getRootElement() { return document.getElementById('laiSidebar'); }
function getSideBar() { return getRootElement(); }

async function applySidebarState(state) {
    const sidebar = getSideBar();
    if (sidebar.classList.contains('active') === state.open) { return; }

    const revision = ++panelViewRevision;
    sidebar.classList.toggle('active', state.open);
    sidebar.hidden = !state.open;
    if (!state.open) { clearChatHistoryUI(); }
    await reportTabBinding({ panelOpen: state.open });
    if (state.open && revision === panelViewRevision) {
        if (state.restoreHistory !== false) { await restoreTabSessionFromBackground(); }
        if (revision === panelViewRevision) { sidebar.querySelector('#laiUserInput')?.focus(); }
    }
}

function showSidebarConnectionFailure() {
    getSideBar().hidden = true;
    clearChatHistoryUI();
    document.getElementById('sidebarFailure').hidden = false;
}

function processSidebarRequest(action, payload) {
    switch (action) {
        case 'hostState': return applySidebarState(payload);
        case 'dismissMenus':
            closeQuickPromptListMenu();
            closeSessionListOnOutsideClick();
            return closeAllDropDownRibbonMenus();
        case 'catchUp':
            return payload.restore ? restoreTabSessionFromBackground() : catchUpActiveSessionFromStorage();
        case 'streamData':
        case 'streamEnd':
        case 'streamAbort':
        case 'streamError': {
            const delivery = streamQueue.then(() => messageProcessor({ ...payload, action }));
            streamQueue = delivery.catch(console.error);
            return delivery;
        }
        case 'activePageSelection':
        case 'inserSelectedInPrompt':
        case 'explainSelection':
        case 'activePageContent':
        case 'attachElement':
        case 'attachCroppedContextMenuImage':
        case 'showMessage':
        case 'updateStatusbar':
        case 'dumpInConsole':
            return messageProcessor({ ...payload, action });
        default: throw new Error('Unknown sidebar operation.');
    }
}

async function startSidebarFrame() {
    const confirmation = await chrome.runtime.sendMessage({ action: 'confirmSidebarFrame' });
    if (!confirmation?.ok || !Number.isInteger(confirmation.tabId)) {
        showSidebarConnectionFailure();
        return;
    }

    sidebarTabId = confirmation.tabId;
    const port = chrome.tabs.connect(sidebarTabId, { frameId: 0, name: 'localai-sidebar' });
    sidebarChannel = createSidebarChannel(port, processSidebarRequest, showSidebarConnectionFailure);
    await getAiUserCommands();
    await initSidebar(Date.now() + 3000);
    await applySidebarState(await sidebarChannel.request('getHostState'));
    await applySidebarState(await sidebarChannel.request('ready'));
    chrome.storage.onChanged.addListener(reconcileActiveSessionWithStorage);
    chrome.storage.onChanged.addListener(onModelOptionsChanged);
    port.onDisconnect.addListener(() => {
        chrome.storage.onChanged.removeListener(reconcileActiveSessionWithStorage);
        chrome.storage.onChanged.removeListener(onModelOptionsChanged);
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
            void sidebarChannel.request('escape').then(applySidebarState).catch(console.debug);
        }
    });
}

startSidebarFrame().catch(error => {
    console.debug('Local AI sidebar could not start.', error);
    showSidebarConnectionFailure();
});
