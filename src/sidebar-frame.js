let sidebarChannel;
let sidebarTabId;
let streamQueue = Promise.resolve();
let sidebarGeneration = 0;
let sidebarDraft;
let sidebarVisibility;
let sidebarReconnector;

async function getMyTabId() {
    return sidebarTabId;
}

function getShadowRoot() { return document; }
function getRootElement() { return document.getElementById('laiSidebar'); }
function getSideBar() { return getRootElement(); }

async function applySidebarState(state) {
    const sidebar = getSideBar();
    if (!sidebar) { return; }

    if (sidebarVisibility) {
        if (state.open) { void sidebarVisibility.enable(); } else { sidebarVisibility.disable(); }
    }
    if (sidebar.classList.contains('active') === state.open) { return; }

    const revision = ++panelViewRevision;
    sidebar.classList.toggle('active', state.open);
    sidebar.hidden = !state.open;
    if (!state.open) { clearChatHistoryUI(); }
    await reportTabBinding({ panelOpen: state.open });
    if (state.open && revision === panelViewRevision) {
        if (state.restoreHistory !== false) {
            await restoreTabSessionFromBackground();
            await sidebarDraft?.load();
        }
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

function guardSidebarAction(action) {
    if (!sidebarVisibility) {
        action();
        return true;
    }
    return sidebarVisibility.guard(action);
}

// Precondition form for handlers that keep their body: shows the blocked message
// and returns false when the sidebar is not fully visible.
function sidebarActionAllowed() {
    return guardSidebarAction(() => true);
}

async function clearSidebarDraft() {
    await sidebarDraft?.clear();
}

function connectSidebarPort() {
    const generation = ++sidebarGeneration;
    const port = chrome.runtime.connect({ name: 'localai-sidebar' });
    const channel = createSidebarChannel(port, processSidebarRequest, () => {
        if (generation !== sidebarGeneration) { return; }
        sidebarChannel = undefined;
        void sidebarReconnector?.schedule();
    });
    sidebarChannel = channel;
    return channel;
}

async function connectAndSynchronise({ initial }) {
    const channel = connectSidebarPort();
    if (initial) {
        await getAiUserCommands();
        await initSidebar(Date.now() + 3000);
    } else {
        await channel.request('catchUp', { restore: true });
    }
    await applySidebarState(await channel.request('getHostState'));
    await applySidebarState(await channel.request('ready'));
    await sidebarDraft?.load();
    sidebarReconnector?.reset();
}

function installSidebarListeners() {
    chrome.storage.onChanged.addListener(reconcileActiveSessionWithStorage);
    chrome.storage.onChanged.addListener(onModelOptionsChanged);

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || event.defaultPrevented || !sidebarChannel) { return; }
        void sidebarChannel.request('escape').then(applySidebarState).catch(console.debug);
    });

    document.addEventListener('input', event => {
        if (event.target?.id !== 'laiUserInput') { return; }
        void sidebarDraft?.save(event.target.value);
    });

    document.addEventListener('laiActiveSessionChanged', () => {
        void sidebarDraft?.switchSession();
    });

    window.addEventListener('pagehide', () => {
        void sidebarDraft?.flush();
    });
}

async function startSidebarFrame() {
    const confirmation = await chrome.runtime.sendMessage({ action: 'confirmSidebarFrame' });
    if (!confirmation?.ok || !Number.isInteger(confirmation.tabId)) {
        showSidebarConnectionFailure();
        return;
    }

    sidebarTabId = confirmation.tabId;
    sidebarDraft = createSidebarDraftController({ tabId: sidebarTabId });
    sidebarVisibility = createSidebarVisibilityController({
        getRoot: () => document.getElementById('laiSidebar'),
        showMessage: (message, type) => showMessage(message, type)
    });
    sidebarReconnector = createSidebarReconnector({
        isConfirmed: async () => {
            const status = await chrome.runtime.sendMessage({ action: 'isSidebarFrameConfirmed' });
            return status?.confirmed === true;
        },
        connect: () => connectAndSynchronise({ initial: false }),
        onFailed: showSidebarConnectionFailure
    });

    await connectAndSynchronise({ initial: true });
    installSidebarListeners();
}

startSidebarFrame().catch(error => {
    console.debug('Local AI sidebar could not start.', error);
    showSidebarConnectionFailure();
});
