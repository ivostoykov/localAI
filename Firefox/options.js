const manifest = chrome.runtime.getManifest();

document.addEventListener('DOMContentLoaded', e => {
    loadSettings(e);
    attachListeners(e);
});

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
        if(['checkbox', 'input', 'textarea'].indexOf(element.type) < 0){
            continue;
        }
        optionsData[element.id || i] = element.type === 'checkbox' ? element?.checked || false : element?.value || '';
    }

    browser.storage.sync.set({'laiOptions': optionsData}, function() {
        showMessage('Settings saved', 'success');
    });
}

function loadSettings() {
    browser.storage.sync.get('laiOptions', function(obj) {
        const formData = obj.laiOptions || {};
        Object.keys(formData).forEach(key => {
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
   browser.storage.local.remove(['aiSessions']).then(() =>{
    showMessage('All sessions have been deleted.', 'success');
   }).catch(e => {
    console.error('>>>', e)
   });
}

function deleteUserCommands(e){
    browser.storage.local.remove(['aiUserCommands']).then(() =>{
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

    const obj = await browser.storage.local.get([storageKey]);
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
            browser.storage.local.set({['aiUserCommands']: json})
            .then(() => showMessage('User Commands imported successfully.', 'success'))
            .catch(e => console.error('>>>', e));
        } catch (err) {
            console.error('>>>', err);
        }
    };

    reader.readAsText(file);
}

