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
                .catch(e => console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e));
            aiUserCommands = json;
        } catch (err) {
            console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${err.message}`, err);
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
        if (isNaN(zIndex)) {  continue;  }
        if (zIndex > highestZIndex) {  highestZIndex = zIndex;  }
    }

    return highestZIndex + 1000;
}

function getLineNumber() {
    const e = new Error();
    const stackLines = e.stack.split("\n").map(line => line.trim());
    let index = stackLines.findIndex(line => line.includes(getLineNumber.name));

    // return stackLines[index + 1]?.replace(/\s{0,}at\s+/, '') || "Unknown";
    return stackLines[index + 1]
        ?.replace(/\s{0,}at\s+/, '')
        ?.replace(/^.*?\/([^\/]+\/[^\/]+:\d+:\d+)$/, '$1')
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

async function checkAndSetSessionName(){
    const currentSession = await getActiveSession();
    if(!currentSession || !currentSession?.title || !currentSession?.title?.toLowerCase()?.startsWith('session')){  return;  }
    const sessionData = currentSession?.data || [];
    if(sessionData.length < 1){  return;  }
    const userInput = sessionData?.filter(el => el?.role === 'user');
    if(userInput.length < 1){  return;  }
    if(!userInput[0]?.content){  return;  }
    await chrome.runtime.sendMessage({ action: "checkAndSetSessionName", text: userInput[0]?.content });
}

async function getAiUrl(){
    const laiOptions = await getLaiOptions();
    if (!laiOptions?.aiUrl) {
        let msg = 'Missing API endpoint!';
        showMessage(`${msg} - ${laiOptions?.aiUrl || 'missing aiUrl'}`, 'error');
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${msg}`, laiOptions);
        return null;
    }

    let url = laiOptions?.aiUrl;
    if (!url) {
        let msg = `Faild to compose the request URL - ${url}`;
        showMessage(msg, 'error');
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${msg};  request.url: ${request?.url};  laiOptions.aiUrl: ${laiOptions?.aiUrl}`);
        return null;
    }

    return url;
}

async function getAiModel(){
    const laiOptions = await getOptions();
    return laiOptions?.aiModel;
}

async function modelCanThink(modelName = '', url = '') {
    if(!modelName){  return false;  }

    url = new URL(url);
    url = `${url.protocol}//${url.host}/api/show`;

    try {
        const response = await chrome.runtime.sendMessage({ action: 'modelCanThink', model: modelName, url });
        if (response?.error) {
            console.error(`>>> ${theManifest.name} - [${getLineNumber()}] - response error`, response?.error);
            return false;
        }

        return response?.canThink ?? false;
    } catch (err) {
        console.error(`>>> ${theManifest.name} - [${getLineNumber()}] - ${err.message}`, err);
        return false;
    }
}

async function modelCanUseTools(modelName = ''){
    if(!modelName){  return false;  }

    try {
        const response = await chrome.runtime.sendMessage({ action: 'modelCanUseTools', model: modelName,});
        if (response?.error) {
            console.error(`>>> ${theManifest.name} - [${getLineNumber()}] - response error`, response?.error);
            return false;
        }

        return response?.canUseTools ?? false;
    } catch (err) {
        console.error(`>>> ${theManifest.name} - [${getLineNumber()}] - ${err.message}`, err);
        return false;
    }
}