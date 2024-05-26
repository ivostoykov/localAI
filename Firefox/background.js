var controller;
var shouldAbort = false;
var laiOptions;

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {

    if(tab.url && !tab.url.startsWith('http')) {  return;  }

    if (changeInfo.status === 'complete' && tab.url) {
        laiOptions = await getOptions();
    }
});


browser.action.onClicked.addListener((tab) => {
    if(tab.url.startsWith('http')) {
        browser.tabs.sendMessage(tab.id, { action: "toggleSidebar" });
    }
});

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!controller) {
        controller = new AbortController();
    }
    switch (request.action) {
        case 'fetchData':
            shouldAbort = false;
            fetchDataAction(request, sender);
            break;
        case 'abortFetch':
            shouldAbort = true;
            break;
        case "openOptionsPage":
            browser.tabs.create({url: browser.runtime.getURL('options.html')});
            break;
        default:
            console.error('Unrecognized action:', request?.action);
    }
    return true;
});

browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
        id: "sendToLocalAi",
        title: "Local AI",
        contexts: ["all"]
    });

    browser.contextMenus.create({
        id: "selectElement",
        title: "Select and Send Element",
        parentId: "sendToLocalAi",
        contexts: ["all"]
    });

    browser.contextMenus.create({
        id: "sendSelectedText",
        title: "Send Selected",
        parentId: "sendToLocalAi",
        contexts: ["selection"]
    });

    browser.contextMenus.create({
        id: "sendPageContent",
        title: "Entire Page",
        parentId: "sendToLocalAi",
        contexts: ["all"]
    });
});

browser.contextMenus.onClicked.addListener((info, tab) => {
    switch (info.menuItemId) {
        case "sendSelectedText":
            if (!info.selectionText.length) { return; }
            if (!tab.id) {  return;  }
            browser.tabs.sendMessage(tab.id, {
                action: "activePageSelection",
                selection: info.selectionText
            });
            break;
        case "sendPageContent":
            if(tab.id){
                browser.scripting.executeScript({
                    target: {tabId: tab.id},
                    function: extractEnhancedContent
                }, (response) => {
                    const pageContent = response?.[0]?.result ?? '';
                    if (!pageContent) {  return;  }
                        browser.tabs.sendMessage(tab.id, {
                            action: "activePageContent",
                            selection: pageContent
                        });
                });
            }
            break;
        case "selectElement":
            if (!tab.id) {  return;  }
            browser.tabs.sendMessage(tab.id, {
                action: "toggleSelectElement",
                selection: true
            });
            break;
        default:
            console.error(`Unknown menu id: ${info.menuItemId}`);
        }
});

function fetchUserCommandResult(command, sender) {
    return new Promise((resolve, reject) => {
        switch (command) {
            case 'page':
                browser.scripting.executeScript({
                    target: {tabId: sender.tab.id},
                    function: extractEnhancedContent
                }, (response) => {
                    if (browser.runtime.lastError) {
                        reject(new Error(browser.runtime.lastError.message));
                        return;
                    }
                    resolve(response?.[0]?.result ?? '');
                });
                break;
            case 'now':
                resolve((new Date()).toISOString());
                break
            case 'today':
                resolve((new Date()).toISOString().split('T')[0]);
                break
            case 'time':
                resolve((new Date()).toISOString().split('T')[1]);
                break
            case 'url':
                resolve(sender.url);
            default:
                resolve('');
        }
    });
}

function extractEnhancedContent() {
    const bodyClone = document.body.cloneNode(true);

    // Selector for common elements not directly related to the main content
    const unwantedSelectors = [
        'script', 'style', 'code', 'header', 'footer', 'nav', 'aside',
        'form', 'iframe', 'video', '[id*="ad"]',
        '[class*="sidebar"]', '[class*="ad"]', '[class*="side-nav"]',
        '.sidebar', '.widget', 'button'
    ];

    // Remove elements based on the selectors
    unwantedSelectors.forEach(selector => {
        const elements = bodyClone.querySelectorAll(selector);
        elements.forEach(el => el.remove());
    });

    // Remove HTML comments
    const removeComments = (node) => {
        for (let i = 0; i < node.childNodes.length; i++) {
            const child = node.childNodes[i];
            if (child.nodeType === 8 || (child.nodeType === 3 && !/\S/.test(child.nodeValue))) {
                node.removeChild(child);
                i--;
            } else if (child.nodeType === 1) {
                removeComments(child);
            }
        }
    };
    removeComments(bodyClone);

    return bodyClone.textContent.trim();
}

function handleStreamingResponse(reader, senderTabId) {
    // const reader = response.body.getReader();
    if(!reader || !reader.read){ return; }

    const read = () => {
        if(shouldAbort) {
            reader.cancel();
            browser.tabs.sendMessage(senderTabId, { action: "streamAbort" });
            return;
        }
        reader.read().then(({ done, value }) => {
            if (done) {
                browser.tabs.sendMessage(senderTabId, { action: "streamEnd" });
                return;
            }
            const textChunk = new TextDecoder().decode(value);
            browser.tabs.sendMessage(senderTabId, { action: "streamData", data: textChunk});
            read();
        }).catch(error => {
            if (!shouldAbort) {
                browser.tabs.sendMessage(senderTabId, { action: "streamError", error: error.toString() });
            }
        });
    };

    read();
}

// depreciated
/* function updateSystemMessageDate(messages){
    let idx = messages.findIndex(el => el.role === "system");
    const sysIntruct = laiOptions?.systemInstructions || '';
    if(idx < 0){
        messages.unshift({ role: "system", content: '' });
        idx = 0;
    }

    // const currentDate = `[local date and time: ${( new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString())}]`;

    // if(!messages[idx].content){
    //     messages[idx].content = `${sysIntruct} ${currentDate}`;
    // } else if(messages[idx].content.indexOf('[local date and time: ') < 0){
    //     messages[idx].content += ` ${currentDate}`;
    // } else {
    //     messages[idx].content = messages[idx].content.replace(/\[local date and time: \d{4}-\d{1,2}-\d{1,2}T\d{1,2}:\d{1,2}:\d{1,2}\.\d{1,3}Z\]/gm, currentDate);
    // }

    messages[idx].content = addPersonalInfoToSystemMessage(messages[idx].content);
    return messages;
} */

async function fetchDataAction(request, sender) {
    const controller = new AbortController();
    let messages = request?.data?.messages || [];
    let data = messages.slice(-1)[0]?.content || '';
    data = await laiComposeUerImput(data, sender);
    request.data.messages.splice(-1, 1, { "role": "user", "content": data});
    request.data.messages = request.data.messages.filter(msg => msg.content.trim());
    // messages = updateSystemMessageDate(messages);

    const url = `http://localhost:${request.port}${request.path}`;
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.data),
        signal: controller.signal,
    })
    .then(response => {
        if(shouldAbort && controller){
            controller.abort();
            browser.tabs.sendMessage(senderTabId, { action: "streamAbort" });
            return;
        }
        handleStreamingResponse(response?.body?.getReader(), sender.tab.id);
    })
    .catch(error => {
        if (error.name === 'AbortError') {
            browser.tabs.sendMessage(sender.tab.id, { action: "streamAbort"});
        } else {
            browser.tabs.sendMessage(sender.tab.id, { action: "streamError", error: error.toString()});
        }
        delete controller;
    });
}

async function laiComposeUerImput(userInputText, sender) {
    if (!userInputText) return '';

    var combinedResult = [];
    let userCommands = [];
    if (Array.isArray(userInputText)) {
        userInputText.forEach(txt => {
            txt = txt.replace("📃", '');
            userCommands = [...txt.matchAll(/@\{\{([\s\S]+?)\}\}/gm)]
        });
    } else {
        userInputText = userInputText.replace("📃", '');
        userCommands = [...userInputText.matchAll(/@\{\{([\s\S]+?)\}\}/gm)];
    }

    if (userCommands.length < 1) return userInputText;

    for (const cmd of userCommands) {
        if (cmd && cmd.length > 1 && cmd[1]) {
            let additionalInfo = await fetchUserCommandResult(cmd[1], sender);
            if(cmd[1] && cmd[1] === 'page'){
                additionalInfo = `This is the content of the ${cmd[1]}:\n${additionalInfo}`
            }
            combinedResult.push(additionalInfo);
            userInputText = userInputText.replace(`@{{${cmd[1]}}}`, ``);
        }
    }

    combinedResult.push(userInputText);
    return combinedResult.join('\n');
}

function addPersonalInfoToSystemMessage(systemContent){
    if(!systemContent){  return systemContent;  }
    const personalInfo = getPersonalInfo();
    if(!personalInfo)  {  return systemContent;  }
    let strPersonalInfo = '';
    try {
        strPersonalInfo = JSON.stringify(personalInfo);
    } catch (e) {
        strPersonalInfo = '';
        console.error(e);
    }
    if(systemContent.indexOf('[personal information:') < 0){
        systemContent += ` [personal information: ${strPersonalInfo}]`
    } else {
        systemContent = systemContent.replace(/\s{0,}\[personal information: .*?\]/gm, ` [personal information: ${strPersonalInfo}]`);
    }

    return systemContent
}

function getPersonalInfo(){
    if(!laiOptions || Object.keys(laiOptions) < 1){
        return;
    }

    if(!laiOptions.personalInfo) {  return;  }

    const personalInfo = {};
    const keyValuePairs = laiOptions.personalInfo.split(/;|\n/);
    keyValuePairs.forEach(pair => {
        const [key, value] = pair.split(/[\s;,-:](.*)/s).filter(Boolean);
        personalInfo[key.trim()] = value.trim();
    });

    return personalInfo;
}

function getOptions() {
    return new Promise((resolve, reject) => {
      const defaults = {
        "openPanelOnLoad": false,
        "localPort": "1234",
        "chatHistory": 25,
        "closeOnClickOut": true,
        "closeOnCopy": false,
        "closeOnSendTo": true,
        "showEmbeddedButton": false,
        "loadHistoryOnStart": false,
        "systemInstructions": '',
        "personalInfo": ''
      };
      browser.storage.sync.get('laiOptions', function (obj) {
        if (browser.runtime.lastError) {
          return reject(browser.runtime.lastError);
        }

        const laiOptions = Object.assign({}, defaults, obj.laiOptions);

        resolve(laiOptions);
      });
    });
  }