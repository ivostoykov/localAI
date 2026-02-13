function userImport(e) {
    var fileInput = document.createElement('input');
    fileInput.id = "fileInput"
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.classList.add('invisible');
    fileInput.click();
    fileInput.addEventListener('change', importFromFile);
}

function importFromFile(e) {
    const fileInput = e.target;
    const file = e.target.files[0];
    var reader = new FileReader();
    reader.onloadend = function () {
        try {
            var json = JSON.parse(reader.result);
            chrome.storage.local.set({ ['aiUserCommands']: json })
                .then(() => showMessage('User Commands imported successfully.', 'success'))
                .catch(e => console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${e.message}`, e));
            aiUserCommands = json;
        } catch (err) {
            console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${err.message}`, err);
        } finally {
            fileInput.remove();
        }
    };

    reader.readAsText(file);
}

async function exportAsFile(e) {
    let storageKey = 'aiUserCommands';
    let fileName = `user_commands_export_${(new Date).toISOString().split('T')[0].replace(/\D/g, '')}`;

    const obj = await chrome.storage.local.get([storageKey]);
    const json = obj[storageKey] || [];
    var blob = new Blob([JSON.stringify(json, null, 4)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = `${fileName}.json`;
    link.click();
}

function getHighestZIndex() {
    let elements = document.body.getElementsByTagName('*')
    let highestZIndex = 0;

    for (let i = 0; i < elements.length; i++) {
        let zIndex = parseInt(elements[i]?.style?.zIndex, 10);
        if (isNaN(zIndex)) zIndex = parseInt(window.getComputedStyle(elements[i])?.zIndex, 10);
        if (isNaN(zIndex)) { continue; }
        if (zIndex > highestZIndex) { highestZIndex = zIndex; }
    }

    return highestZIndex + 1000;
}

function getLineNumber() {
    const e = new Error();
    const stackLines = e.stack.split("\n").map(line => line.trim());
    let index = stackLines.findIndex(line => line.includes(getLineNumber.name));

    return stackLines[index + 1]
        ?.replace(/\s{0,}at\s+/, '')
        ?.replace(/^.*?\/([^\/]+\/[^\/]+:\d+:\d+)$/, '$1')
        ?.split('/')?.pop().replace(/\)$/, '')
        || "Unknown";
}

function showSpinner() {
    const sideBar = getSideBar();
    const spinner = sideBar.querySelector('#spinner');
    if (!spinner) { return; }
    spinner.classList.remove('invisible');
}

function hideSpinner() {
    const sideBar = getSideBar();
    const spinner = sideBar.querySelector('#spinner');
    if (!spinner) { return; }
    spinner.classList.add('invisible');
}

function checkExtensionState() {
    reloadRuntime();
    if (!chrome?.runtime?.id) {
        if (typeof (showMessage) === 'function') {
            showMessage(`${manifest?.name ?? ''} - Extension context invalidated. Please reload the tab.`, 'error');
            console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Extension context invalidated. Please reload the tab.`);
        } else {
            console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Extension context invalidated. Please reload the tab.`);
        }
        return false;
    }

    return true;
}

async function checkAndSetSessionName() {
    try {
        const currentSession = await getActiveSession();
        if (!currentSession || !currentSession?.title || !currentSession?.title?.toLowerCase()?.startsWith('session')) { return; }
        const sessionData = currentSession?.messages || [];
        if (sessionData.length < 1) { return; }
        const userInput = sessionData?.filter(el => el?.role === 'user');
        if (userInput.length < 1) { return; }
        if (!userInput[0]?.content) { return; }
        await chrome.runtime.sendMessage({ action: "checkAndSetSessionName", text: userInput[0]?.content });
        return true;
    } catch (err) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${err.message}`, err);
        return false;
    }
}

async function getAiUrl() {
    const laiOptions = await getOptions();
    if (!laiOptions?.aiUrl) {
        let msg = 'Missing API endpoint!';
        showMessage(`${msg} - ${laiOptions?.aiUrl || 'missing aiUrl'}`, 'error');
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${msg}`, laiOptions);
        return null;
    }

    let url = laiOptions?.aiUrl;
    if (!url) {
        let msg = `Faild to compose the request URL - ${url}`;
        showMessage(msg, 'error');
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${msg};  request.url: ${url};  laiOptions.aiUrl: ${laiOptions?.aiUrl}`);
        return null;
    }

    return url;
}

async function getAiModel() {
    const laiOptions = await getOptions();
    return laiOptions?.aiModel;
}

async function modelCanThink(modelName = '', url = '') {
    if (!modelName) { return false; }

    url = new URL(url);
    url = `${url.protocol}//${url.host}/api/show`;

    try {
        const response = await chrome.runtime.sendMessage({ action: 'modelCanThink', model: modelName, url });
        if (response?.error) {
            console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - response error`, response?.error);
            return false;
        }

        return response?.canThink ?? false;
    } catch (err) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${err.message}`, err);
        return false;
    }
}

async function modelCanUseTools(modelName = '') {
    if (!modelName) { return false; }

    try {
        const response = await chrome.runtime.sendMessage({ action: 'modelCanUseTools', model: modelName, });
        if (response?.error) {
            console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - response error`, response?.error);
            return false;
        }

        return response?.canUseTools ?? false;
    } catch (err) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${err.message}`, err);
        return false;
    }
}

function reloadRuntime() {
    try {
        if (!chrome.runtime?.id && chrome.runtime?.reload) {
            chrome.runtime.reload();
        }
    } catch (err) {
        console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Safe runtime reload failed:`, err);
    }
}

async function onImagePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (item.type.startsWith('image/')) {
            e.preventDefault();

            try {
                const blob = item.getAsFile();
                if (!blob) {
                    console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to get image from clipboard`);
                    return;
                }

                if (typeof handleImageFile === 'function') {
                    await handleImageFile(blob);
                    showMessage('Image pasted successfully', 'info');
                } else {
                    console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - handleImageFile function not available`);
                    showMessage('Failed to paste image: Image handler not loaded', 'error');
                }
            } catch (error) {
                console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error handling pasted image:`, error);
                showMessage(`Failed to paste image: ${error.message}`, 'error');
            }

            break;
        }
    }
}

function generatePageHash(url, contentLength) {
    return `${url}:${contentLength}`;
}

function waitForDOMToSettle(settleTime = 1000, maxWait = 10000) {
    return new Promise((resolve) => {
        let timeout;
        let elapsed = 0;
        let isResolved = false;
        const startTime = Date.now();

        const cleanup = () => {
            if (isResolved) return;
            isResolved = true;
            clearTimeout(timeout);
            observer.disconnect();
            resolve();
        };

        const observer = new MutationObserver(() => {
            if (isResolved) return;
            clearTimeout(timeout);
            elapsed = Date.now() - startTime;

            if (elapsed >= maxWait) {
                console.debug(`>>> ${manifest?.name ?? ''} - Max wait time reached (${maxWait}ms), settling now`);
                cleanup();
                return;
            }

            timeout = setTimeout(cleanup, settleTime);
        });

        if(document.body){
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }

        timeout = setTimeout(cleanup, settleTime);
    });
}