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
    let elements = document.getElementsByTagName('*');
    let highestZIndex = 0;
    let highestElement = null;

    for (let i = 0; i < elements.length; i++) {
        let zIndex = window.getComputedStyle(elements[i]).zIndex;
        if (zIndex === 'auto') { continue; }
        if (highestZIndex > zIndex) { continue; }

        highestZIndex = zIndex;
        highestElement = elements[i];
    }

    let intZIndex = parseInt(highestZIndex, 10);

    return isNaN(intZIndex) ? highestZIndex : intZIndex + 10;
}