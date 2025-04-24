async function handleImageFile(file) {
    try {
        const reader = new FileReader();
        reader.onload = () => {
            images.push(reader.result.split(',').pop());
            showAttachment(file.name);
        };
        reader.readAsDataURL(file);
    } catch (err) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Image read failed: ${err.message}`, err);
        showMessage(`Failed to read image ${file.name}`, 'error');
    }
}

async function handleImageFile(file) {
    try {
        const reader = new FileReader();
        reader.onload = () => {
            images.push(reader.result.split(',').pop());
            showAttachment(file.name);
        };
        reader.readAsDataURL(file);
    } catch (err) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Image read failed: ${err.message}`, err);
        showMessage(`Failed to read image ${file.name}`, 'error');
    }
}

async function handleGenericFile(file) {
    const fileContent = await readFileContent(file);
    if (!fileContent) {
        showMessage(`Failed to get content of ${file.name}.`, 'error');
        return;
    }

    let response;
    try {
        response = await chrome.runtime.sendMessage({
            action: 'extractText',
            fileName: file.name,
            fileContent: btoa(String.fromCharCode(...new Uint8Array(fileContent)))
        });
        if (chrome.runtime.lastError) {
            throw new Error(`${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`);
        }
    } catch (err) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${err.message}`, err);
        return;
    }

    const docText = typeof response === 'string' ? response : (typeof response.text === 'function' ? await response.text() : '');
    if (docText) {
        attachments.push(`File name is ${file.name}. Its content is between [FILE_${file.name}] and [/FILE_${file.name}]:\n[FILE_${file.name}] ${docText} [/FILE_${file.name}]. Use this as a context of your respond.`);
        showAttachment(file.name);
    } else {
        showMessage(`${file.name} is either empty or extraction of its content failed!`, 'error');
    }
}

async function handlePlainTextFile(file) {
    const text = await file.text();
    if (text) {
        attachments.push(`File name is ${file.name}. Its content is between [FILE_${file.name}] and [/FILE_${file.name}]:\n[FILE_${file.name}] ${text} [/FILE_${file.name}]. Use this as a context of your respond.`);
        showAttachment(file.name);
    } else {
        showMessage(`${file.name} appears to be empty.`, 'error');
    }
}

function readFileContent(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(event) {
            resolve(event.target.result);
        };
        reader.onerror = function(error) {
            reject(error); // Reject with the error
        };
        reader.readAsArrayBuffer(file);
    });
}

async function onUserInputFileDropped(e) {
    e.preventDefault();
    e.stopPropagation();

    try {
        const shadowRoot = getShadowRoot();
        if (!shadowRoot) return;

        const dropzone = shadowRoot.getElementById('dropzone');
        dropzone.classList.remove('hover');
        setTimeout(() => dropzone.classList.add('invisible'), 750);

        console.log(`>>> ${manifest.name} - [${getLineNumber()}] - event files:`, e?.dataTransfer?.files);

        for (let i = 0; i < e.dataTransfer.files.length; i++) {
            const file = e.dataTransfer.files[i];
            console.log(`>>> ${manifest.name} - [${getLineNumber()}] - File ${i}: Name: ${file.name}; Type: ${file.type}; Size: ${file.size}`);

            if (file.type.startsWith('image/')) {
                await handleImageFile(file);
            } else if (file.type.startsWith('text/') || /\.(txt|xml|csv|json|html?|md|py|js|ts|java|c|cpp)$/i.test(file.name)) {
                await handlePlainTextFile(file);
            } else {
                await handleGenericFile(file);
            }
        }
    } catch (err) {
        showMessage(err.message, 'error');
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - error: ${err.message}`, err);
    }
}
