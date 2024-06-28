const manifest = chrome.runtime.getManifest();

document.addEventListener('DOMContentLoaded', e => {
    loadSettings(e);
    attachListeners(e);
    attachModelListeners(e);
});

document.querySelector('#aiUrl').addEventListener('blur', loadModels);

document.title = manifest.name || '';
document.getElementById('pageTitle').textContent = `${manifest.name} - ${manifest.version}`;
document.getElementById('laiOptionsForm').addEventListener('submit', saveSettings);
document.getElementById('cancelButton').addEventListener('click', cancelOptions);
document.getElementById('deleteAllSessions').addEventListener('click', deleteAllAiSessions);
document.getElementById('exportSessions').addEventListener('click', exportAsFile);
document.getElementById('importUserCmd').addEventListener('click', importUserCommand);
document.getElementById('exportUserCmd').addEventListener('click', exportAsFile);
document.getElementById('cleartUserCmd').addEventListener('click', deleteUserCommands);
document.getElementById('fileInput').addEventListener('change', importFromFile);

function saveSettings(e) {
    e.preventDefault();

    const optionsData = {};
    const elements = this.elements;

    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        if(['checkbox', 'text', 'textarea'].indexOf(element.type) < 0){
            continue;
        }
        optionsData[element.id || i] = element.type === 'checkbox' ? element?.checked || false : element?.value || '';
    }

    const modelList = document.querySelectorAll('#modelList option') ?? [];
    const attributeValues = Array.from(modelList).map(e => e.getAttribute('value'));
    optionsData['modelList'] = attributeValues ?? [];

    chrome.storage.sync.set({'laiOptions': optionsData}, function() {
        showMessage('Settings saved', 'success');
    });
}

function loadSettings(e) {
    chrome.storage.sync.get('laiOptions', function(obj) {
        const formData = obj.laiOptions || {};

        formData?.modelList?.forEach(model => addModel(e, model));

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
    });
}

function attachListeners(e){
    document.getElementById('showEmbeddedButton').addEventListener('click', onshowEmbeddedButtonClicked);
    document.getElementById('showEmbeddedButton').addEventListener('change', onshowEmbeddedButtonClicked);
    document.querySelector('#advancedSettings img')?.addEventListener('click', toggleFold);
}

function onshowEmbeddedButtonClicked(e){
    const el = e?.target || document.getElementById('showEmbeddedButton');
    const mainButtonIcon = document.getElementById('mainButtonIcon');
    if(document.getElementById('showEmbeddedButton').checked){
        mainButtonIcon.classList.remove('invisible');
    } else {
        mainButtonIcon.classList.add('invisible');
    }
}

function showMessage(message, type){
    const msg = document.querySelector('.message-box');
    msg.innerHTML = message;
    msg.classList.remove('invisible', 'success', 'error', 'warning', 'info');
    msg.classList.add(type || 'info');
    setTimeout(() => msg.classList.add('invisible'), 3000);
}

function cancelOptions() {
    window.close(); // Closes the options page
}

function deleteAllAiSessions(e){
   chrome.storage.local.remove(['aiSessions']).then(() =>{
    showMessage('All sessions have been deleted.', 'success');
   }).catch(e => {
    console.error('>>>', e)
   });
}

function deleteUserCommands(e){
    chrome.storage.local.remove(['aiUserCommands']).then(() =>{
        showMessage('All User commands have been deleted.', 'success');
    }).catch(e => {
        console.error('>>>', e)
    });
}

async function exportAsFile(e) {
    let storageKey;
    let fileName = 'export';
    switch (e.target.id) {
        case 'exportSessions':
            storageKey = 'aiSessions';
            fileName = `session_export_${(new Date).toISOString().split('T')[0].replace(/\D/g, '')}`;
            break;
        case 'exportUserCmd':
            storageKey = 'aiUserCommands';
            fileName = `user_commands_export_${(new Date).toISOString().split('T')[0].replace(/\D/g, '')}`;
            break;
        default:
            break;
    }

    if(!storageKey){  return;  }

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
    const fileInput = document.getElementById('fileInput')
    fileInput.click();
}

function importFromFile(e){
    const file = e.target.files[0];
    var reader = new FileReader();
    reader.onloadend = function() {
        try {
            var json = JSON.parse(reader.result);
            chrome.storage.local.set({['aiUserCommands']: json})
            .then(() => showMessage('User Commands imported successfully.', 'success'))
            .catch(e => console.error('>>>', e));
        } catch (err) {
            console.error('>>>', err);
        }
    };

    reader.readAsText(file);
}


async function loadModels(e){
    const aiUrl = e.target || document.querySelector('#aiUrl');
    if(!aiUrl){
        showMessage(`No API endpoint found - ${aiUrl?.value}!`, 'error');
        return false;
    }

    let urlVal = aiUrl.value.trim();
    if(urlVal === ''){  return;  }
    if(!urlVal.startsWith('http')){
        showMessage(`Invalid API endpoint - ${urlVal}!`, 'error');
        return false;
    }

    if(urlVal.indexOf('/api/') < 0){  return;  }

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
      if(models.models && Array.isArray(models.models)) {  fillModelList( models.models);  }
    } catch (e) {
      console.error(e);
    }
}

function fillModelList(models = []){
    if(models.length < 1){  return;  }
    let modelDataList = document.querySelector('#models');
    if(!modelDataList){
      const el = document.createElement('datalist');
      el.id = 'models'
      document.body.appendChild(el);
      modelDataList = document.querySelector('#models');
    } else {
        modelDataList.replaceChildren();
    }

    for (let i = 0; i < models.length; i++) {
      const option = document.createElement('option');
      option.value = models[i].name;
      modelDataList.appendChild(option);
    }
}

function toggleFold(e){
    const src = e.target.src.indexOf('/unfold') > -1 ? '/unfold' : '/fold';
    const target = src === '/unfold' ? '/fold' : '/unfold';
    e.target.src = e.target.src.replace(src, target);
    e.target.title = `${target === '/fold' ? 'Show' : 'Hide'} advanced settings`;
    const advancedSettingsContainer = document.getElementById('advancedSettingsContainer');
    if(e.target.src.indexOf('/fold') > -1){
        advancedSettingsContainer.classList.add('invisible');
    } else {
        advancedSettingsContainer.classList.remove('invisible');
    }
}

// model field function

function sortDatalist(e, datalist, direction) {
    if(!['asc', 'desc'].includes(direction)){  return;  }
    const options = Array.from(datalist.options);
    if(!options || options?.length === 0)  {  return;  }
    if(direction === 'desc'){
        options.sort((a, b) => b.value.localeCompare(a.value));
    }
    if(direction === 'asc'){
        options.sort((a, b) => a.value.localeCompare(b.value));
    }

    datalist.replaceChildren();

    options.forEach(option => datalist.appendChild(option));
}

function addModel(e, datalist, valueEl){
    if(!valueEl || !datalist){ return;  }
    const op = document.createElement('option');
    op.value = valueEl?.value?.trim();
    datalist.appendChild(op);
    valueEl.value = '';
    valueEl.focus();
}

function removeModel(e, datalist, valueEl){
    if(!valueEl || !datalist){ return;  }
    const options = datalist.querySelectorAll('option');
    if(!options || options.length === 0){
        valueEl.value = '';
        valueEl.focus();
        return;
    }

    for (let i = 0; i < options.length; i++) {
        const option = options[i];
        if(option.value === valueEl){
            datalist.removeChild(option);
            valueEl.value = '';
            valueEl.focus();
            break;
        }
    }
}

function attachModelListeners(e){

    const containers = [];
    const modelButtonsContainer = document.querySelector('#modelButtons');
    if(!modelButtonsContainer) {  return;  }
    containers.push({
        "container": modelButtonsContainer,
        "datalist": document.getElementById('modelList'),
        "valueEl": document.getElementById('aiModel')
    });

    const urlButtons = document.querySelector('#urlButtons');
    if(!urlButtons) {  return;  }
    containers.push({
        "container": urlButtons,
        "datalist": document.getElementById('urlList'),
        "valueEl": document.getElementById('aiUrl')
    });

    for (let i = 0; i < containers.length; i++) {
        containers[i].container.querySelectorAll('img').forEach(b => {
            const action = b.getAttribute('data-action')?.toLowerCase();
            switch (action) {
                case 'add':
                    b.addEventListener('click', e => addModel(e, containers[i].datalist, containers[i].valueEl));
                    break;
                case 'remove':
                    b.addEventListener('click', e => removeModel(e, containers[i].datalist, containers[i].valueEl));
                    break;
                case 'asc':
                case 'desc':
                    b.addEventListener('click', e => sortDatalist(e, action.toLowerCase(), containers[i].datalist));
                    break;
            }
        });
    }
}