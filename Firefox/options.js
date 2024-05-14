document.addEventListener('DOMContentLoaded', e => {
    loadSettings(e);
    attachListeners(e);
});
document.getElementById('laiOptionsForm').addEventListener('submit', saveSettings);
document.getElementById('cancelButton').addEventListener('click', cancelOptions);

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

    chrome.storage.sync.set({'laiOptions': optionsData}, function() {
        showMessage('Settings saved', 'success');
    });
}

function loadSettings() {
    chrome.storage.sync.get('laiOptions', function(obj) {
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
