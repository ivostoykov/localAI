const manifest = chrome.runtime.getManifest();
var laiOptions = {};

document.addEventListener('DOMContentLoaded', async e => {
    loadSettings(e);
    await attachDataListListeners(e);
    await getAiUserCommands(e);
    attachListeners(e);
});

document.querySelector('#aiUrl').addEventListener('blur', loadModels);

document.title = manifest.name || '';
document.getElementById('pageTitle').textContent = `${manifest.name} - ${manifest.version}`;
document.getElementById('laiOptionsForm').addEventListener('submit', async e => await saveSettings(e));
document.getElementById('cancelButton').addEventListener('click', cancelOptions);
document.getElementById('deleteAllSessions').addEventListener('click', deleteAllAiSessions);
document.getElementById('exportSessions').addEventListener('click', exportAsFile);
document.getElementById('fileInput').addEventListener('change', importFromFile);
document.getElementById('aiUrl').addEventListener('input', loadModels)

document.getElementById("dlgBtnOK").addEventListener('click', closeDialog);
document.getElementById("dlgBtnCancel").addEventListener('click', closeDialog);

document.getElementById("tempRange").addEventListener('input', updateTempValue);
document.getElementById("tempIntput").addEventListener('input', updateTempValue);

async function saveSettings(e) {
    e.preventDefault();

    const optionsData = {};
    const elements = e.target.elements;
    if(!elements){
        showMessage(`Failed to save changes!`, 'error');
        console.error(`Form element not found or empty: ${e.target?.id}`, e.target);
        return;
    }

    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        if (['select', 'checkbox', 'text', 'textarea', 'number', 'range', 'url'].indexOf(element.type) < 0) {
            continue;
        }
        optionsData[element.id || i] = element.type === 'checkbox' ? element?.checked || false : element?.value || '';
    }

    const dataLists = ['modelList', 'urlList'];
    for (let i = 0; i < dataLists.length; i++) {
        const list = dataLists[i];
        const el = document.querySelector(`select[data-list="${list}"]`);
        const options = Array.from(el.options);
        if (/^Select/i.test(options[0].text)) { options.shift(); }
        optionsData[el.id] = el.options[el.selectedIndex].value;
        let attributeValues = Array.from(options)?.map(e => e.getAttribute('value')).sort();
        optionsData[list] = attributeValues ?? [];
    }

    laiOptions = optionsData;
    await chrome.storage.sync.set({ 'laiOptions': optionsData });
    showMessage('Settings saved', 'success');
}

function loadSettings(e) {
    chrome.storage.sync.get('laiOptions', function (obj) {
        const formData = obj.laiOptions || {};
        laiOptions = formData;

        const dataLists = ['modelList', 'urlList', 'toolFuncList'];
        for (let i = 0; i < dataLists.length; i++) {
            const list = dataLists[i];
            if (!formData[list]) { continue; }

            const el = document.querySelector(`select[data-list="${list}"]`);
            if (!el) { continue; }
            const op0 = el.options[0];
            el.replaceChildren();
            el.appendChild(op0);
            formData[list]?.forEach(value => addSelectOptions(el, { "val": value, "isSelected": (value === formData.aiUrl ?? '') }));
            if (el.options.length === 1) { el.selectedIndex = 0; }
        }

        Object.keys(formData)?.forEach(key => {
            const element = document.getElementById(key);
            if (element) {
                if (element.type === 'checkbox') {
                    element.checked = formData[key];
                } else {
                    element.value = formData[key];
                }
            }
        });

        document.getElementById("tempIntput").dispatchEvent(new Event('input', { bubbles: true }));
    });
}

function attachListeners(e) {
    document.getElementById('showEmbeddedButton').addEventListener('click', onshowEmbeddedButtonClicked);
    document.getElementById('showEmbeddedButton').addEventListener('change', onshowEmbeddedButtonClicked);
    document.querySelector('#advancedSettings img')?.addEventListener('click', toggleFold);

    document.querySelectorAll('.navbar-item')?.forEach(item => {  item.addEventListener('click', async (e) => {  await switchSection(e);  });  });
    document.querySelectorAll('.prompt-buttons img')?.forEach(btn => btn.addEventListener('click', async (e) => { await applyPromptCardAction(e); }));
    document.querySelector('#newPromptBtn')?.addEventListener('click', async e => {  await createNewPrompt(e);  })

    document.querySelectorAll('#exportPromptBtn, #exportFuncBtn')?.forEach(btn => {
        btn.addEventListener('click', async e => {  await exportAsFile(e);  });
    });
    document.querySelectorAll('#importPromptBtn, #importFuncBtn')?.forEach(btn => btn.addEventListener('click', importUserCommand));
    document.querySelectorAll('#deletePromptBtn, #deleteFuncBtn')?.forEach(btn => btn.addEventListener('click', async e => await deleteStorageCollection(e)));

    document.querySelector('#newFuncBtn')?.addEventListener('click', async e => await createNewToolFunc(e)  );

    document.getElementById('toolsEnabled')?.addEventListener('change', e => {
        const label = document.querySelector('label[for="toolsEnabled"]');
        label.textContent = `${e.target.checked ? 'Enable' : 'Disable'} tools`;
        document.querySelector('[type="submit"]').click();
    });
}

function onshowEmbeddedButtonClicked(e) {
    const el = e?.target || document.getElementById('showEmbeddedButton');
    const mainButtonIcon = document.getElementById('mainButtonIcon');
    if (document.getElementById('showEmbeddedButton').checked) {
        mainButtonIcon.classList.remove('invisible');
    } else {
        mainButtonIcon.classList.add('invisible');
    }
}

function showMessage(message, type) {
    const msg = document.querySelector('.message-box');
    msg.innerHTML = message;
    msg.classList.remove('invisible', 'success', 'error', 'warning', 'info');
    msg.classList.add(type || 'info');
    setTimeout(() => msg.classList.add('invisible'), 3000);
}

function cancelOptions() {
    window.close(); // Closes the options page
}

function deleteAllAiSessions(e) {
    chrome.storage.local.remove(['aiSessions']).then(() => {
        showMessage('All sessions have been deleted.', 'success');
    }).catch(e => {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e)
    });
}

async function deleteStorageCollection(e) {
    const storageKeys = {"deletePromptBtn": "aiUserCommands", "deleteFuncBtn": "aiTools"};
    const storageKey = storageKeys[e.target?.id];
    const label = `${e.target?.id === 'deletePromptBtn' ? "User Prompts" : "Tool Functions"}`;
    if(!storageKey) {
        showMessage(`${label} not found!`, "error");
        return;
    }
    try {
        await chrome.storage.local.remove([storageKey]);
        showMessage(`All ${label} have been deleted.`, 'success');
        const avtiveMenu = document.querySelector('.active-navebar-item');
        if(avtiveMenu){  avtiveMenu.click();  }
    } catch (err) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${err.message}`, err)
    }
}

async function exportAsFile(e) {
    let storageKey;
    let fileName = 'export';
    switch (e.target.id) {
        case 'exportSessions':
            storageKey = 'aiSessions';
            fileName = `session_export_${(new Date).toISOString().split('T')[0].replace(/\D/g, '')}`;
            break;
        case 'exportFuncBtn':
            storageKey = 'aiTools';
            fileName = `tool_functions_${(new Date).toISOString().split('T')[0].replace(/\D/g, '')}`;
            break;
        case 'exportPromptBtn':
            storageKey = 'aiUserCommands';
            fileName = `user_commands_export_${(new Date).toISOString().split('T')[0].replace(/\D/g, '')}`;
            break;
        default:
            break;
    }

    if (!storageKey) { return; }

    const obj = await chrome.storage.local.get([storageKey]);
    const json = obj[storageKey] || [];
    var blob = new Blob([JSON.stringify(json, null, 4)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = `${fileName}.json`;
    link.click();
}

function importUserCommand(e) {
    const fileInput = document.getElementById('fileInput');;
    fileInput.dataset.key = e.target.id || 'unknown';
    fileInput.click();
}

function importFromFile(e) {
    let storageKey = e.target.dataset.key || 'unknown';
    if (storageKey === 'unknown'){
        showMessage("Failed to locate data storage!", "error");
        console.error(`${getLineNumber()} - Wrong storage key!`, e.target);
        return;
    }

    const file = e.target.files[0];
    if(!file){
        showMessage("No file was selected!", "error");
        return;
    }

    switch (storageKey) {
        case 'importSessions':
            storageKey = 'aiSessions';
            break;
        case 'importFuncBtn':
            storageKey = 'aiTools';
            break;
        case 'importPromptBtn':
            storageKey = 'aiUserCommands';
            break;

        default:
            showMessage("Failed to locate data storage!", "error");
            console.error(`${getLineNumber()} - Wrong storage key!`, e.target);
            return;
            break;
    }

    var reader = new FileReader();
    reader.onloadend = async () => {
        showSpinner();
        try {
            var json = JSON.parse(reader.result);
            await chrome.storage.local.set({ [storageKey]: json });

            showMessage(`${file.name} imported successfully.`, 'success');
            const avtiveMenu = document.querySelector('.active-navebar-item');
            if(avtiveMenu){  avtiveMenu.click();  }
        } catch (err) {
            console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${err.message}`, err);
        } finally {
            hideSpinner();
        }
    };

    reader.readAsText(file);
}


async function loadModels(e) {
    showSpinner();
    const aiUrl = e?.target || document.querySelector('#aiUrl');
    if (!aiUrl) {
        showMessage(`No API endpoint found - ${aiUrl?.value}!`, 'error');
        hideSpinner();
        return false;
    }

    let urlVal = aiUrl.options[aiUrl.selectedIndex].value.trim();
    if (urlVal === '') { return; }
    if (!urlVal.startsWith('http')) {
        showMessage(`Invalid API endpoint - ${urlVal}!`, 'error');
        hideSpinner();
        return false;
    }

    if (urlVal.indexOf('/api/') < 0) {
        hideSpinner();
        return false;
    }

    urlVal = urlVal.replace(/\/api\/.+/i, '/api/tags');
    let response;
    let models;
    try {
        response = await fetch(urlVal, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
            },
        });

        models = await response.json();
        if (models.models && Array.isArray(models.models)) { fillModelList(models.models); }
    } catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - response`, response);
    } finally {
        hideSpinner();
        showMessage("Model list successfully updated.", "success");
    }
}

function fillModelList(models = []) {
    if (models.length < 1) { return; }
    let modelDataList = document.querySelector('#aiModel');
    if (!modelDataList) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Cannot find modelList element!`);
        return;
    }

    let op = modelDataList.options[0];
    modelDataList.replaceChildren();
    modelDataList.appendChild(op);
    op.setAttribute('selected', 'selected');

    for (let i = 0; i < models.length; i++) {
        op = document.createElement('option');
        op.value = op.text = models[i].name;
        if (models[i].name === laiOptions?.aiModel) { op.setAttribute('selected', 'selected'); }
        modelDataList.appendChild(op);
    }
}

function toggleFold(e) {
    const src = e.target.src.indexOf('/unfold') > -1 ? '/unfold' : '/fold';
    const target = src === '/unfold' ? '/fold' : '/unfold';
    e.target.src = e.target.src.replace(src, target);
    e.target.title = `${target === '/fold' ? 'Show' : 'Hide'} advanced settings`;
    const advancedSettingsContainer = document.getElementById('advancedSettingsContainer');
    if (e.target.src.indexOf('/fold') > -1) {
        advancedSettingsContainer.classList.add('invisible');
    } else {
        advancedSettingsContainer.classList.remove('invisible');
    }
}

function sortDatalist(e) {
    let datalist = e.target.closest('div.el-holder');
    datalist = datalist?.querySelector('select');
    if (!datalist) { return; }
    const optionId = datalist?.id;
    const direction = e.target.getAttribute('data-action');
    if (!['asc', 'desc'].includes(direction)) { return; }

    const options = Array.from(datalist.options);
    if (options?.length === 1) { return; }

    var op0;
    if (/^Select/i.test(options[0].text)) { op0 = options.shift(); }

    if (direction === 'desc') {
        options.sort((a, b) => b.value.localeCompare(a.value));
    }
    if (direction === 'asc') {
        options.sort((a, b) => a.value.localeCompare(b.value));
    }

    datalist.replaceChildren();
    datalist.appendChild(op0);
    options.forEach(option => datalist.appendChild(option));
    const idx = options.findIndex(e => e.value === laiOptions[optionId]);
    datalist.selectedIndex = idx < 0 ? idx : idx + 1;
    showMessage("List sorted successfully.", "success");
}

function extenddList(e) {
    //    datalist = datalist ?? e.target.parentElement.nextElementSibling;
    let datalist = e.target.closest('div.el-holder');
    datalist = datalist?.querySelector('select');
    if (!datalist) { return; }
    const options = {};

    options.action = e.target.getAttribute('data-action')?.toLowerCase();
    options.targetId = datalist.id;
    if (options.action === 'edit') {
        options.selectedIndex = datalist.selectedIndex;
        options.selectedValue = datalist.selectedIndex > 0 ? datalist.options[datalist.selectedIndex]?.value : '';
    } else {
        options.selectedValue = '';
    }

    showDialog('test', options);
}

function showDialog(title, options) {
    const dialog = document.getElementById('laiDialog');
    const dlgTitle = document.getElementById('dlgTitle');
    if (dlgTitle) { dlgTitle.textContent = title; }

    const userInput = document.getElementById('dlgValue');
    if (options.selectedValue) { userInput.value = options.selectedValue; };
    userInput.setAttribute("data-options", JSON.stringify(options));

    dialog.showModal();
}

function closeDialog(e) {
    const elId = e.target.id;
    const dialog = document.getElementById('laiDialog');
    const userInput = document.getElementById('dlgValue');
    const dlgIsSelected = document.getElementById('dlgIsSelected');
    if (elId === 'dlgBtnCancel') {
        resetDialog(userInput, dialog);
        return;
    }

    try {
        var options = userInput.getAttribute("data-options");
        options = JSON.parse(options);
        options.newValue = userInput.value.trim();
        options.dlgIsSelected = dlgIsSelected.checked || false;
        refreshTarget(options);
    } catch (e) {
        showMessage(e.message, "error");
        return;
    } finally {
        resetDialog(userInput, dlgIsSelected, dialog);
    }
}

function resetDialog(userInput, dlgIsSelected, dialog) {
    dlgIsSelected.checked = false;
    userInput.value = '';
    userInput.removeAttribute("data-options");
    dialog.close();
}

function refreshTarget(gldValues) {
    if (Object.keys(gldValues).length < 1) { return; }
    const target = document.querySelector(`#${gldValues.targetId || ''}`);
    if (!target || !gldValues?.newValue) { return; }
    if (gldValues?.selectedIndex) {
        target.options[gldValues.selectedIndex].value = gldValues.newValue;
        if(gldValues.dlgIsSelected || false) {
            target.options[gldValues.selectedIndex].setAttribute('selected', 'selected');
        }
    } else {
        const op = document.createElement('option');
        op.text = op.value = gldValues.newValue;
        if(gldValues.dlgIsSelected || false) {
            op.setAttribute('selected', 'selected');
        }
        target.appendChild(op);
        // target.selectedIndex = target.options.lenght - 1;
    }
}

function addSelectOptions(selectEl, objData) {
    try {
        if (!selectEl || !Object.keys(objData).length === 0) { return; }
        const op = document.createElement('option');
        if (!op) { return; }
        op.text = objData?.text ?? objData?.val;
        op.value = objData?.val ?? 'unknown!';
        if (objData?.isSelected) { op.setAttribute('selected', 'selected'); }
        selectEl.appendChild(op);
    } catch (e) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
    }
}

function copyValue(e) {
    let datalist = e.target.closest('div.el-holder');
    datalist = datalist?.querySelector('select');
    const getParentEvent = () => e;
    navigator.clipboard.writeText(datalist.options[datalist.selectedIndex].value || '')
        .then(() => { showHint(getParentEvent()); })
        .catch(err => console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Failed to copy text: ${err.message}`, err));
}

function showHint(e) {
    const hint = document.querySelector('#laiCopyHint');
    if (!hint) { return; }
    hint.style.left = `${e.clientX}px`;
    hint.style.top = `${e.clientY}px`;
    hint.style.opacity = '1';
    hint.classList.remove('invisible');
    setTimeout(() => {
        hint.style.opacity = '0';
        setTimeout(() => { hint.classList.add('invisible'); }, 500);  // 500ms matches the transition duration
    }, 3000);
}

function shrinkList(e) {
    let datalist = e.target.closest('div.el-holder');
    datalist = datalist?.querySelector('select');
    if (!datalist || datalist?.options.lenght < 2) { return; }

    const action = e.target.getAttribute('data-action')?.toLowerCase();
    if (action === 'removeall') {
        const op0 = datalist.options[0];
        datalist.replaceChildren();
        datalist.appendChild(op0);
        showMessage("The whole list was removed.", "success");
    } else {
        const idx = datalist.selectedIndex;
        if (idx < 1) { return; }
        datalist.remove(idx);
        showMessage("The element was removed from the list.", "success");
    }
}

async function attachDataListListeners(e) {

    const containers = ['modelButtons', 'urlButtons', 'hookButtons', 'tikaButtons', 'toolButtons'];
    for (let x = 0; x < containers.length; x++) {
        const container = document.querySelector(`#${containers[x]}`);
        if (!container) { continue; }
        const buttons = container.querySelectorAll('img');

        for (let i = 0; i < buttons.length; i++) {
            const b = buttons[i];
            const action = b.getAttribute('data-action')?.toLowerCase();
            switch (action) {
                case 'add':
                case 'edit':
                    b.addEventListener('click', e => extenddList(e));
                    break;
                case 'copy':
                    b.addEventListener('click', e => copyValue(e));
                    break;
                case 'remove':
                case 'removeall':
                    b.addEventListener('click', e => shrinkList(e));
                    break;
                case 'asc':
                case 'desc':
                    b.addEventListener('click', e => sortDatalist(e));
                    break;
                case 'reload':
                    b.addEventListener('click', async e => await loadModels());
                    break;
                case 'test-connection':
                    b.addEventListener('click', async e => await testConnection(e));
                    break;
            }
        }
    }
}

async function testConnection(e){
    showSpinner();
    let response;
    let url;
    try {
        const container = e.target.closest('.el-holder')
        if(!container){ throw new Error(`Faild to find main element!`); }
        const el = container.querySelector('input[type="url"]') || container.querySelector('select');
        // const tikaEl = document.querySelector('#tika');
        if (!el) { throw new Error(`No API endpoint value found - ${el?.value}!`); }

        url = el.tagName === 'INPUT' ? el.value.trim() : el.options[el.selectedIndex].value;
        if (!url || !url.startsWith('http')) { throw new Error(`Invalid API endpoint - ${url}!`); }
        url = (new URL(url)).origin;

        response = await fetch(url);
        if(isNaN(response.status)){   throw new Error(`Server returned status code ${response.status}`);  }
        showMessage(`Connection to ${url} successfull.`, "success");
    } catch (e) {
        showMessage(`Connection to ${url} failed! - ${e.message}`, "error");
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - response`, response);
    } finally {
        hideSpinner();
    }
}

function showSpinner() {
    const spinner = document.querySelector('#spinner');
    if (!spinner) { return; }
    spinner.classList.remove('invisible');
}

function hideSpinner() {
    const spinner = document.querySelector('#spinner');
    if (!spinner) { return; }
    spinner.classList.add('invisible');
}

async function switchSection(e){
    const el = e.target;
    const navbar = el?.closest('#tabMenu');
    const tabBodyId = el?.getAttribute('data-tabBody');
    if(!el || !navbar){
        showMessage(`Navbar element not found!`);
        return;
    }

    document.querySelector('.active-navebar-item')?.classList?.remove('active-navebar-item');
    el.classList.add('active-navebar-item');

    document.querySelectorAll('#general, #promptRibbon, #toolFunctionsRibbon')?.forEach(el => {
        el.classList.add('invisible');
    });

    document.querySelectorAll('.js-tab-body')?.forEach(el => {
        if(el.id === tabBodyId){  el?.classList.remove('invisible');  }
        else {  el?.classList.add('invisible');  }
    });

    switch (tabBodyId) {
        case 'prompts':
            document.querySelector('#promptRibbon').classList.remove('invisible');
            await showPromptSection();
            break;
        case 'tools':
            document.querySelector('#toolFunctionsRibbon').classList.remove('invisible');
            await showToolSection();
            break;
        case 'general':
            break;
        default:
            console.error(`>>> ${manifest.name} - [${getLineNumber()}] - error: Wrong section Id - ${tabBodyId}!`);
            break;
    }
}

async function showPromptSection() {
    showSpinner();
    try {
        await getAiUserCommands();
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - error: ${error.message}`, error);
    } finally { hideSpinner(); }
}

async function showToolSection() {
    showSpinner();
    try {
        await getTools();
    } catch (error) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - error: ${error.message}`, error);
    } finally { hideSpinner(); }
}

async function getAiUserCommands(){
    const commands = await chrome.storage.local.get(['aiUserCommands']);
    const generalSection = document.getElementById('general');
    const height = generalSection?.offsetHeight || -1;
    const aiUserCommands = commands.aiUserCommands || [];
    const promptContainer = document.querySelector('#prompts');
    if(!promptContainer){
        console.error(`${promptContainer} not found!`, promptContainer)
        return;
    }
    promptContainer.replaceChildren();
    if(aiUserCommands.length < 1){  return;  }

    const promptTemplate = document.getElementById('promptTemplate').content;
    if(!promptTemplate){
        console.error(`${promptTemplate} not found!`, promptTemplate)
        return;
    }
    if(height > 0){  promptContainer.style.height = `${height}px`;  }

    for (let x=0, l=aiUserCommands.length; x<l; x++) {
        const cmd = aiUserCommands[x];
        const clone = document.importNode(promptTemplate, true);
        clone.querySelector('.prompt-title').textContent = cmd.commandName;
        clone.querySelector('.prompt-command').textContent = `/${cmd.commandName.toLowerCase().replace(/\s+/g, '-')}`;
        clone.querySelector('.prompt-description').textContent = cmd.commandDescription || 'No description';
        clone.querySelector('.prompt-body').textContent = cmd.commandBody;
        clone.querySelectorAll('.prompt-buttons img')?.forEach(btn => btn.addEventListener('click', async (e) => { await applyPromptCardAction(e); }));
        promptContainer.appendChild(clone);
    }
}

async function getTools(){
    const commands = await chrome.storage.local.get(['aiTools']);
    const generalSection = document.getElementById('general');
    const height = generalSection?.offsetHeight || -1;
    const aiTools = commands.aiTools || [];
    const toolsContainer = document.querySelector('#tools');
    if(!toolsContainer){
        console.error(`[${getLineNumber()}] - toolsContainer not found!`, toolsContainer);
        return;
    }
    toolsContainer.replaceChildren();
    if(aiTools.length < 1){  return;  }

    const funcTemplate = document.getElementById('functionTemplate').content;
    if(!funcTemplate){
        console.error(`[${getLineNumber()}] - funcTemplate not found!`, funcTemplate);
        return;
    }
    if(height > 0){  toolsContainer.style.height = `${height}px`;  }

    for (let x=0, l=aiTools.length; x<l; x++) {
        const clone = document.importNode(funcTemplate, true);
        clone.querySelector('.prompt-body').textContent = JSON.stringify(aiTools[x], null, 4);
        clone.querySelectorAll('.prompt-buttons img')?.forEach(btn => btn.addEventListener('click', async (e) => { await applyPromptCardAction(e); }));
        toolsContainer.appendChild(clone);
    }
}

async function applyPromptCardAction(e){
    const parent = e.target.closest('.prompt-item');
    const action = e.target.getAttribute('data-action');
    const copyBtn = parent.querySelector('img[src="img/copy.svg"][data-action="copy"]');
    const delBtn = parent.querySelector('img[src="img/remove-all.svg"][data-action="delete"]');
    const undoBtn = parent.querySelector('img[src="img/undo.svg"][data-action="undo"]');
    const editBtn = parent.querySelector('img[src="img/edit2.svg"][data-action="edit"]');
    const saveBtn = parent.querySelector('img[src="img/tick.svg"][data-action="save"]');
    if(delBtn){  delBtn.classList.remove('delete-active');  }
    if(!parent || !action){  return;  }

    switch(action) {
        case 'copy':
            let data = parent.querySelector('.prompt-body');
            const getParentEvent = () => e;
            navigator.clipboard.writeText(data?.textContent || '')
                .then(() => { showHint(getParentEvent()); })
                .catch(err => console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Failed to copy text: ${err.message}`, err));
            break;
        case 'undo':
            copyBtn.classList.remove('invisible');
            undoBtn.classList.add('invisible');
            editBtn.classList.remove('invisible');
            saveBtn.classList.add('invisible');
            parent.classList.remove('prompt-item-edit');
            parent.querySelectorAll('.js-ptompt-card-item').forEach(el => el.setAttribute('contenteditable', false));
            break;
        case 'edit':
            copyBtn.classList.add('invisible');
            undoBtn.classList.remove('invisible');
            parent.classList.add('prompt-item-edit');
            editBtn.classList.add('invisible');
            saveBtn.classList.remove('invisible');
            parent.querySelectorAll('.js-ptompt-card-item').forEach(el => el.setAttribute('contenteditable', true));
            break;
        case 'save':
            undoBtn.classList.add('invisible');
            copyBtn.classList.remove('invisible');
            editBtn.classList.remove('invisible');
            saveBtn.classList.add('invisible');
            parent.classList.remove('prompt-item-edit');
            parent.querySelectorAll('.js-ptompt-card-item').forEach(el => el.setAttribute('contenteditable', false));
            await savePrompts(e);
            break;

        case 'delete':
            if (!e.target.classList.contains('delete-active')) {
                e.target.classList.add('delete-active');
                setTimeout(() => { e.target.classList.remove('delete-active'); }, 30000);
                showMessage('Click the same button again to delete it or wait to dismiss the action.');
            } else {
                parent.classList.remove('prompt-item-edit');
                e.target.classList.remove('delete-active');
                parent.remove();
                await savePrompts(e);
            }
            break;
    }
}

async function savePrompts(e){
    const section = e.target.closest('section');
    const storageData = [];
    let storageKey = '';
    switch (section.id) {
        case 'tools':
            storageKey = 'aiTools';
            section.querySelectorAll('.prompt-item')?.forEach((item, idx) => {
                const jsonString = item.querySelector('.prompt-body').textContent;
                try {
                    const jsonObject = JSON.parse(jsonString);
                    storageData.push(jsonObject);
                } catch (error) {
                    showMessage(`Incalid JSON in card ${idx+1}!`);
                    console.error('Invalid JSON: jsonString', error);
                }
            });
            break;
        case 'prompts':
            storageKey = 'aiUserCommands';
            section.querySelectorAll('.prompt-item')?.forEach(item => {
                const cmd = {};
                cmd['commandName'] = item.querySelector('.prompt-title').textContent.toLowerCase().replace(/\s+/g, '-');
                cmd['commandDescription'] = item.querySelector('.prompt-description').textContent;
                cmd['commandBody'] = item.querySelector('.prompt-body').textContent;
                storageData.push(cmd);
            });
            break;
    }

    await chrome.storage.local.set({[storageKey]: storageData});
    showMessage('Data updated successfully.', 'success');
}

async function createNewPrompt(e){
    const promptSection = document.querySelector('#prompts');
    if(!promptSection){  return;  }

    const promptTemplate = document.getElementById('promptTemplate').content;
    const clone = document.importNode(promptTemplate, true);
    const promptItem1 = promptSection.querySelector('.prompt-item');
    if(promptItem1){
        promptSection.insertBefore(clone, promptItem1);
    } else {
        promptSection.appendChild(clone);
    }
    const newPromptItem = promptSection.querySelector('.prompt-item')
    newPromptItem?.classList.add('prompt-item-edit');
    newPromptItem.querySelectorAll('.prompt-buttons img')
        ?.forEach(btn => {
            btn.classList.remove('invisible');
            if(["edit", "copy"].includes(btn.dataset.action)){  btn.classList.add('invisible');  }
            btn.addEventListener('click', async (e) => { await applyPromptCardAction(e); });
    });
}

function updateTempValue(e){
    const originator = e.target;
    const otherElId = originator.id === "tempRange" ? "tempIntput" : "tempRange";
    const otherEl = document.getElementById(otherElId);
    const tempOutput = document.getElementById("tempOutput");
    if(!otherEl){
        console.log(`${otherElId} element not found`);
        return;
    }

    otherEl.value = originator.value;
    tempOutput.value = parseFloat(originator.value) < 0.5 ? 'Stricter' : (originator.value > 0.5 ? 'More Createive' : 'Neutral');
}

// tools ribbon funxtions
async function applyPromptToolAction(e){
    console.log(e.target);
}

async function createNewToolFunc(e){
    const promptSection = document.querySelector('#tools');
    if(!promptSection){  return;  }
    const promptTemplate = document.getElementById('functionTemplate').content;
    const clone = document.importNode(promptTemplate, true);
    const promptItem1 = promptSection.querySelector('.prompt-item');
    if(promptItem1){
        promptSection.insertBefore(clone, promptItem1);
    } else {
        promptSection.appendChild(clone);
    }
    const newPromptItem = promptSection.querySelector('.prompt-item')
    newPromptItem?.classList.add('prompt-item-edit');
    newPromptItem.querySelectorAll('.prompt-buttons img')
        ?.forEach(btn => {
            btn.classList.remove('invisible');
            if(["edit", "copy"].includes(btn.dataset.action)){  btn.classList.add('invisible');  }
            btn.addEventListener('click', async (e) => { await applyPromptCardAction(e); });
    });
    newPromptItem.querySelector('.prompt-body').setAttribute('contenteditable', true);
}

function getLineNumber() {
    const e = new Error();
    const stackLines = e.stack.split("\n").map(line => line.trim());
    let index = stackLines.findIndex(line => line.includes(getLineNumber.name));

    return stackLines[index + 1]
        ?.replace(/\s{0,}at\s+/, '')
        ?.replace(/^.*?\/([^\/]+\/[^\/]+:\d+:\d+)$/, '$1')
        || "Unknown";
}