const manifest = chrome.runtime.getManifest();
document.title = manifest?.name || 'Unknown' || '';
document.getElementById('pageTitle').textContent = `${manifest?.name || 'Unknown'} - ${manifest.version}`;

document.addEventListener('DOMContentLoaded', async () => {
    document.querySelector('.menu-item')?.click();
    loadSettings();
    await attachDataListListeners();
    await getAiUserCommands();
    attachListeners();
});

document.addEventListener('pendingChanges', () => {
    const btn = document.getElementById('cancelButton');
    btn.textContent = "Cancel";
    btn.onclick = () => location.reload();
});
document.addEventListener('changesSaved', () => {
    const btn = document.getElementById('cancelButton');
    btn.textContent = "Close";
    // btn.onclick = () => window.close();
});

document.getElementById('laiOptionsForm').addEventListener('submit', async e => await saveSettings(e));
setTimeout(() => {
    document.getElementById('laiOptionsForm').addEventListener('input', () => {
        document.dispatchEvent(new CustomEvent('pendingChanges'));
    });
}, 500)
document.getElementById('btnSaveForm').addEventListener('click', () => document.getElementById('laiOptionsForm').requestSubmit());
document.getElementById('cancelButton').addEventListener('click', e => {
    if (e.target.textContent === 'Close') { window.close(); }
});

// Filtering form listeners
document.getElementById('laiFilteringForm').addEventListener('submit', async e => await saveSettings(e));
setTimeout(() => {
    document.getElementById('laiFilteringForm').addEventListener('input', () => {
        document.dispatchEvent(new CustomEvent('pendingChanges'));
    });
}, 500)
document.getElementById('btnSaveFilterForm').addEventListener('click', () => document.getElementById('laiFilteringForm').requestSubmit());
document.getElementById('cancelFilterButton').addEventListener('click', e => {
    if (e.target.textContent === 'Close') { window.close(); }
});

// Auto-save filtering fields on change
['defaultSelectors', 'siteSpecificSelectors', 'contentFilteringEnabled'].forEach(fieldId => {
    const field = document.getElementById(fieldId);
    if (field) {
        field.addEventListener('change', async () => await autoSaveFilteringField(fieldId));
        if (field.type !== 'checkbox') {
            field.addEventListener('blur', async () => await autoSaveFilteringField(fieldId));
        }
    }
});
document.getElementById('tempRange').addEventListener('input', updateTempValue);
document.getElementById('tempInput').addEventListener('input', updateTempValue);

document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', async e => {
        const sectionClicked = e.target?.dataset?.section || '';
        if (!sectionClicked) {
            console.error(`Section [${sectionClicked}] is empty or missing!`);
            return;
        }
        await mainMenuSwitched(sectionClicked);

        document.querySelectorAll('.menu-item')?.forEach(menu => {
            if (menu?.dataset?.section === sectionClicked) { menu.classList.add('active'); }
            else { menu.classList.remove('active'); }
        })

        document.querySelectorAll('.content-section').forEach(section => {
            if (section?.id === sectionClicked) { section.classList.remove('invisible'); }
            else { section.classList.add('invisible'); }
        });
    });
});

function updateTempValue(e) {
    const val = parseFloat(e.target.value);
    document.getElementById('tempRange').value = val;
    document.getElementById('tempInput').value = val;
    document.getElementById('tempOutput').textContent =
        val < 0.5 ? 'Stricter' : val > 0.5 ? 'More Creative' : 'Neutral';
}

function loadSettings(e) {
    chrome.storage.sync.get('laiOptions', function (obj) {
        const formData = obj.laiOptions || {};
        // delete formData?.toolsEnabled; // obsolate and not needed anymore - just to remove from the storage

        laiOptions = formData;

        const dataLists = ['modelList', 'urlList', 'toolFuncList', 'generativeHelperList'];
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

        document.getElementById("tempInput").dispatchEvent(new Event('input', { bubbles: true }));
    });
}

async function saveSettings(e) {
    e.preventDefault();

    const optionsData = {};
    const elements = e.target.elements;
    if (!elements) {
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

    const dataLists = ['modelList', 'urlList', 'generativeHelperList'];
    for (let i = 0; i < dataLists.length; i++) {
        const list = dataLists[i];
        const el = document.querySelector(`select[data-list="${list}"]`);
        const options = Array.from(el.options);
        if (/^Select/i.test(options[0].text) || !options[0].text) { options.shift(); }
        optionsData[el.id] = el.options[el.selectedIndex].value;
        let attributeValues = Array.from(options)?.map(e => e.getAttribute('value')).sort();
        optionsData[list] = attributeValues ?? [];
    }

    laiOptions = optionsData;
    await chrome.storage.sync.set({ 'laiOptions': optionsData });
    showMessage('Settings saved', 'success');
    document.dispatchEvent(new CustomEvent('changesSaved'));
}

async function autoSaveFilteringField(fieldId) {
    try {
        const field = document.getElementById(fieldId);
        if (!field) {
            console.error(`>>> ${manifest?.name || 'Unknown'} - Field ${fieldId} not found`);
            return;
        }

        // Load current options
        const stored = await chrome.storage.sync.get('laiOptions');
        const optionsData = stored.laiOptions || {};

        // Update the specific field (handle checkbox vs text fields)
        optionsData[fieldId] = field.type === 'checkbox' ? field.checked : field.value;

        // Save back to storage
        laiOptions = optionsData;
        await chrome.storage.sync.set({ 'laiOptions': optionsData });

        showMessage('Filtering settings auto-saved', 'success');
    } catch (error) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - Error auto-saving ${fieldId}:`, error);
        showMessage('Failed to save filtering settings', 'error');
    }
}

function cancelOptions() {
    window.close(); // Closes the options page
}

async function mainMenuSwitched(section) {
    if (!section) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Expected section is null or missing - ${section}`);
        return;
    }

    switch (section) {
        case 'prompts':
            await showPromptSection();
            break;
        case 'tools':
            await showToolSection();
            break;
        case 'general':
            break;
        default:
            console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - error: Wrong section Id - ${section}!`);
            break;
    }
}

function attachListeners(e) {
    document.getElementById('showEmbeddedButton').addEventListener('click', onshowEmbeddedButtonClicked);
    document.getElementById('showEmbeddedButton').addEventListener('change', onshowEmbeddedButtonClicked);

    // document.querySelectorAll('.navbar-item')?.forEach(item => {  item.addEventListener('click', async (e) => {  await switchSection(e);  });  });
    document.querySelectorAll('.prompt-buttons img')?.forEach(btn => btn.addEventListener('click', async (e) => { await applyPromptCardAction(e); }));
    document.querySelector('#newPromptBtn')?.addEventListener('click', async e => { await createNewPrompt(e); });
    document.querySelectorAll('#exportPromptBtn, #exportFuncBtn')?.forEach(btn => {
        btn.addEventListener('click', async e => { await exportAsFile(e); });
    });
    document.querySelectorAll('#importPromptBtn, #importFuncBtn')?.forEach(btn => btn.addEventListener('click', importUserCommand));
    document.querySelectorAll('#deletePromptBtn, #deleteFuncBtn')?.forEach(btn => btn.addEventListener('click', async e => await deleteStorageCollection(e)));

    document.querySelector('#newFuncBtn')?.addEventListener('click', async e => await createNewToolFunc(e));
    document.getElementById("dlgBtnOK").addEventListener('click', closeDialog);
    document.getElementById("dlgBtnCancel").addEventListener('click', closeDialog);

    document.getElementById('fileInput').addEventListener('change', importFromFile);
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
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${e.message}`, e);
    }
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

// user commands
async function showPromptSection() {
    showSpinner();
    try {
        await getAiUserCommands();
    } catch (error) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - error: ${error.message}`, error);
    } finally { hideSpinner(); }
}

async function getAiUserCommands() {
    const commands = await chrome.storage.local.get(['aiUserCommands']);
    const generalSection = document.getElementById('general');
    const height = generalSection?.offsetHeight || -1;
    const aiUserCommands = commands.aiUserCommands || [];
    const promptContainer = document.querySelector('#promptsContainer');
    if (!promptContainer) {
        console.error(`${promptContainer} not found!`, promptContainer)
        return;
    }
    promptContainer.replaceChildren();
    if (aiUserCommands.length < 1) { return; }

    const promptTemplate = document.getElementById('promptTemplate')?.content;
    if (!promptTemplate) {
        console.error(`promptTemplate [${promptTemplate}] not found!`);
        return;
    }
    if (height > 0) { promptContainer.style.height = `${height}px`; }

    for (let x = 0, l = aiUserCommands.length; x < l; x++) {
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

// command and tools ribbon
async function attachDataListListeners(e) {

    const containers = ['modelButtons', 'urlButtons', 'hookButtons', 'tikaButtons', 'toolButtons', 'generativeHelperButtons'];
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
                    b.addEventListener('click', async e => await loadModels(e));
                    break;
                case 'test-connection':
                    b.addEventListener('click', async e => await testConnection(e));
                    break;
            }
        }
    }
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


// command and tools card related
//prompts (command)

async function createNewPrompt(e) {
    const promptSection = document.querySelector('#promptsContainer');
    if (!promptSection) { return; }

    const promptTemplate = document.getElementById('promptTemplate').content;
    const clone = document.importNode(promptTemplate, true);
    const promptItem1 = promptSection.querySelector('.prompt-item');
    if (promptItem1) {
        promptSection.insertBefore(clone, promptItem1);
    } else {
        promptSection.appendChild(clone);
    }
    const newPromptItem = promptSection.querySelector('.prompt-item')
    newPromptItem?.classList.add('prompt-item-edit');
    newPromptItem.querySelectorAll('.prompt-buttons img')
        ?.forEach(btn => {
            btn.classList.remove('invisible');
            if (["edit", "copy"].includes(btn.dataset.action)) { btn.classList.add('invisible'); }
            btn.addEventListener('click', async (e) => { await applyPromptCardAction(e); });
        });
}

async function applyPromptCardAction(e) {
    const parent = e.target.closest('.prompt-item');
    const action = e.target.getAttribute('data-action');
    const copyBtn = parent.querySelector('img[src="img/copy.svg"][data-action="copy"]');
    const delBtn = parent.querySelector('img[src="img/remove-all.svg"][data-action="delete"]');
    const undoBtn = parent.querySelector('img[src="img/undo.svg"][data-action="undo"]');
    const editBtn = parent.querySelector('img[src="img/edit2.svg"][data-action="edit"]');
    const saveBtn = parent.querySelector('img[src="img/tick.svg"][data-action="save"]');
    const isDeleteActive = e.target.dataset?.action === 'delete' && e.target.classList.contains('delete-active');
    delBtn?.classList?.remove('delete-active');
    if (!parent || !action) { return; }

    const closestSection = e?.target?.closest('section');

    switch (action) {
        case 'copy':
            let data = parent.querySelector('.prompt-body');
            const getParentEvent = () => e;
            navigator.clipboard.writeText(data?.textContent || '')
                .then(() => { showHint(getParentEvent()); })
                .catch(err => console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Failed to copy text: ${err.message}`, err));
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
            await savePrompts(closestSection);
            // await savePrompts(e);
            break;

        case 'delete':
            if (isDeleteActive) {
                parent.classList.remove('prompt-item-edit');
                e.target.classList.remove('delete-active');
                parent.remove();
                await savePrompts(closestSection);
            } else {
                e.target.classList.add('delete-active');
                setTimeout(() => { e.target.classList.remove('delete-active'); }, 30000);
                showMessage('Click the same button again to delete it or wait to dismiss the action.');
            }
            break;
    }
}

async function savePrompts(section) {
    if (!section) {
        showMessage('No section provided! Save is not possible!', "error");
        return;
    }
    // const section = e.target.closest('section');
    const storageData = [];
    let storageKey = '';
    switch (section?.id) {
        case 'tools':
            storageKey = 'aiTools';
            section.querySelectorAll('.prompt-item')?.forEach((item, idx) => {
                const jsonString = item.querySelector('.prompt-body').textContent;
                try {
                    const jsonObject = JSON.parse(jsonString);
                    storageData.push(jsonObject);
                } catch (error) {
                    showMessage(`Invalid JSON in card ${idx + 1}!`);
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
        default:
            console.err("Missing section id!", section);
            showMessage('Missing section id!', "error");
            return;
    }

    await chrome.storage.local.set({ [storageKey]: storageData });
    showMessage('Data updated successfully.', 'success');
}

// tools
async function showToolSection() {
    showSpinner();
    try {
        await getTools();
    } catch (error) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - error: ${error.message}`, error);
    } finally { hideSpinner(); }
}

async function getTools() {
    const commands = await chrome.storage.local.get(['aiTools']);
    const generalSection = document.getElementById('general');
    const height = generalSection?.offsetHeight || -1;
    const aiTools = commands.aiTools || [];
    const toolsContainer = document.querySelector('#toolsContainer');
    if (!toolsContainer) {
        console.error(`[${getLineNumber()}] - toolsContainer not found!`, toolsContainer);
        return;
    }
    toolsContainer.replaceChildren();
    if (aiTools.length < 1) { return; }

    const funcTemplate = document.getElementById('functionTemplate').content;
    if (!funcTemplate) {
        console.error(`[${getLineNumber()}] - funcTemplate not found!`, funcTemplate);
        return;
    }
    if (height > 0) { toolsContainer.style.height = `${height}px`; }

    for (let x = 0, l = aiTools.length; x < l; x++) {
        const clone = document.importNode(funcTemplate, true);
        clone.querySelector('.prompt-body').textContent = JSON.stringify(aiTools[x], null, 4);
        clone.querySelectorAll('.prompt-buttons img')?.forEach(btn => btn.addEventListener('click', async (e) => { await applyPromptCardAction(e); }));
        toolsContainer.appendChild(clone);
    }
}

async function createNewToolFunc(e) {
    const promptSection = document.querySelector('#toolsContainer');
    if (!promptSection) { return; }
    const promptTemplate = document.getElementById('functionTemplate').content;
    const clone = document.importNode(promptTemplate, true);
    const promptItem1 = promptSection.querySelector('.prompt-item');
    if (promptItem1) {
        promptSection.insertBefore(clone, promptItem1);
    } else {
        promptSection.appendChild(clone);
    }
    const newPromptItem = promptSection.querySelector('.prompt-item')
    newPromptItem?.classList.add('prompt-item-edit');
    newPromptItem.querySelectorAll('.prompt-buttons img')
        ?.forEach(btn => {
            btn.classList.remove('invisible');
            if (["edit", "copy"].includes(btn.dataset.action)) { btn.classList.add('invisible'); }
            btn.addEventListener('click', async (e) => { await applyPromptCardAction(e); });
        });
    newPromptItem.querySelector('.prompt-body').setAttribute('contenteditable', true);
}

// dialog

function showDialog(title, options) {
    const dialog = document.getElementById('laiDialog');
    const dlgTitle = document.getElementById('dlgTitle');
    if (dlgTitle) { dlgTitle.textContent = title; }

    const userInput = document.getElementById('dlgValue');
    if (options.selectedValue) { userInput.value = options.selectedValue; };
    userInput.setAttribute("data-options", JSON.stringify(options));
    document.getElementById('dlgIsSelected').checked = options.selectedIndex > 0;

    dialog.showModal();
}

function closeDialog(e) {
    const elId = e.target.id;
    const dialog = document.getElementById('laiDialog');
    const userInput = document.getElementById('dlgValue');
    const dlgIsSelected = document.getElementById('dlgIsSelected');
    if (elId === 'dlgBtnCancel') {
        resetDialog(userInput, dlgIsSelected, dialog);
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
        if (gldValues.dlgIsSelected || false) {
            target.options[gldValues.selectedIndex].setAttribute('selected', 'selected');
        }
    } else {
        const op = document.createElement('option');
        op.text = op.value = gldValues.newValue;
        if (gldValues.dlgIsSelected || false) {
            op.setAttribute('selected', 'selected');
        }
        target.appendChild(op);
        // target.selectedIndex = target.options.lenght - 1;
    }
}

// utils

function fillModelList(models = [], selector = '') {
    if (models.length < 1) { return; }
    if (!selector) {
        showMessage("Missing selector!", "success");
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Missing selector! ${selector || 'empty string'}`, models);
        return;
    }

    let modelDataList = document.querySelector(selector);
    if (!modelDataList) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Cannot find modelList element!`);
        return;
    }

    let activeModelName = laiOptions?.[selector.replace(/^#/, '')];
    let op = modelDataList.options[0];
    modelDataList.replaceChildren();
    modelDataList.appendChild(op);
    op.setAttribute('selected', 'selected');

    for (let i = 0; i < models.length; i++) {
        op = document.createElement('option');
        op.value = op.text = models[i].name;
        if (models[i].name === activeModelName) { op.setAttribute('selected', 'selected'); }
        // if (models[i].name === laiOptions?.aiModel) { op.setAttribute('selected', 'selected'); }
        modelDataList.appendChild(op);
    }
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

function showMessage(message, type) {
    const msg = document.querySelector('.message-box');
    msg.innerHTML = message;
    msg.classList.remove('invisible', 'success', 'error', 'warning', 'info');
    msg.classList.add(type || 'info');
    setTimeout(() => msg.classList.add('invisible'), 5000);
}

async function testConnection(e) {
    showSpinner();
    let response;
    let url;
    try {
        const container = e.target.closest('.el-holder')
        if (!container) { throw new Error(`Failed to find main element!`); }
        const el = container.querySelector('input[type="url"]') || container.querySelector('select');
        if (!el) { throw new Error(`No API endpoint value found - ${el?.value}!`); }

        url = el.tagName === 'INPUT' ? el.value.trim() : el.options[el.selectedIndex].value;
        if (!url || !url.startsWith('http')) { throw new Error(`Invalid API endpoint - ${url}!`); }
        url = (new URL(url)).origin;

        response = await fetch(url);
        if (isNaN(response.status)) { throw new Error(`Server returned status code ${response.status}`); }
        showMessage(`Connection to ${url} successfull.`, "success");
    } catch (e) {
        showMessage(`Connection to ${url} failed! - ${e.message}`, "error");
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${e.message}`, e);
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - response`, response);
    } finally {
        hideSpinner();
    }
}

async function deleteStorageCollection(e) {
    const storageKeys = { "deletePromptBtn": "aiUserCommands", "deleteFuncBtn": "aiTools" };
    const storageKey = storageKeys[e.target?.id];
    const label = `${e.target?.id === 'deletePromptBtn' ? "User Prompts" : "Tool Functions"}`;
    const container = `${e.target?.id === 'deletePromptBtn' ? "promptsContainer" : "toolsContainer"}`;
    if (!storageKey) {
        showMessage(`${label} not found!`, "error");
        return;
    }
    try {
        await chrome.storage.local.remove([storageKey]);
        document.querySelector(`#${container}`)?.replaceChildren();
        showMessage(`All ${label} have been deleted.`, 'success');
    } catch (err) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${err.message}`, err)
    }
}

async function exportAsFile(e) {
    let storageKey;
    let fileName = 'export';
    switch (e.target.id) {
        case 'exportSessions':
            storageKey = 'aiSessions';
            fileName = `localAI_session_export_${(new Date).toISOString().split('T')[0].replace(/\D/g, '')}`;
            break;
        case 'exportFuncBtn':
            storageKey = 'aiTools';
            fileName = `localAI_tool_functions_${(new Date).toISOString().split('T')[0].replace(/\D/g, '')}`;
            break;
        case 'exportPromptBtn':
            storageKey = 'aiUserCommands';
            fileName = `localAI_user_commands_export_${(new Date).toISOString().split('T')[0].replace(/\D/g, '')}`;
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
    let callback;
    if (storageKey === 'unknown') {
        showMessage("Failed to locate data storage!", "error");
        console.error(`${getLineNumber()} - Wrong storage key!`, e.target);
        return;
    }

    const file = e.target.files[0];
    if (!file) {
        showMessage("No file was selected!", "error");
        return;
    }

    switch (storageKey) {
        case 'importSessions':
            storageKey = 'aiSessions';
            break;
        case 'importFuncBtn':
            storageKey = 'aiTools';
            callback = getTools
            break;
        case 'importPromptBtn':
            storageKey = 'aiUserCommands';
            callback = getAiUserCommands;
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
            if (typeof callback === 'function') { await callback(); }
        } catch (err) {
            console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${err.message}`, err);
        } finally {
            hideSpinner();
        }
    };

    reader.readAsText(file);
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
    if (/^Select/i.test(options[0].text) || !options[0].text) { op0 = options.shift(); }

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

function copyValue(e) {
    let datalist = e.target.closest('div.el-holder');
    datalist = datalist?.querySelector('select');
    const getParentEvent = () => e;
    navigator.clipboard.writeText(datalist.options[datalist.selectedIndex].value || '')
        .then(() => { showHint(getParentEvent()); })
        .catch(err => console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Failed to copy text: ${err.message}`, err));
}

async function loadModels(e) {
    showSpinner();
    // const elTarget = e?.target;
    const aiUrl = document.querySelector('#aiUrl');
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
        if (models.models && Array.isArray(models.models)) {
            models.models.sort((a, b) => a.name.localeCompare(b.name));
            fillModelList(models.models, '#aiModel');
            fillModelList(models.models, '#generativeHelper');
        }
    } catch (e) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${e.message}`, e);
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - response`, response);
    } finally {
        hideSpinner();
        showMessage("Model list successfully updated.", "success");
    }
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