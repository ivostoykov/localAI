async function addAttachment(attachment) {
    try {
        if (!attachment) {
            console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Missing or empty attachment parameter!`, attachment);
            return;
        }
        let activeSession = await getActiveSession();
        if (!activeSession || !Array.isArray(activeSession.data)) {
            // Create a session titled "Attachment Session" if none exists
            activeSession = await createNewSession("Attachment Session");
        }
        if (!activeSession.attachments) { activeSession.attachments = []; }
        activeSession.attachments.push(...[].concat(attachment));
        await setActiveSession(activeSession);
    } catch (err) {
        showMessage(err.message, 'error');
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Error occured while adding attachment: ${err.message}`, err, attachment);
    }
}

async function getAttachments() {
    try {
        const activeSession = await getActiveSession();
        return Array.isArray(activeSession?.attachments) ? activeSession.attachments : [];
    } catch (err) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Error occured while getting attachments: ${err.message}`, err);
        return [];
    }
}

async function deleteAttachment(id) {
    try {
        if (!id) { return; }

        const activeSession = await getActiveSession();
        if (!activeSession?.attachments) { return; }

        const updated = activeSession.attachments.filter(att => att.id !== id);
        activeSession.attachments = updated;
        await setActiveSession(activeSession);
    } catch (err) {
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Error occured while deleting attachment id ${id}: ${err.message}`, err);
        showMessage(err.message, 'error');
    }
}

async function handleImageFile(file) {
    try {
        const reader = new FileReader();
        reader.onload = async () => {
            const base64Content = reader.result.split(',').pop();
            if (!base64Content) {
                showMessage(`Failed to read image ${file.name}.`, 'error');
                return;
            }

            images.push(base64Content); // 1. Add to images array for immediate prompt sending

            const attachment = {
                id: crypto.randomUUID(),
                type: 'file',
                filename: file.name,
                contentType: file.type || 'image/*',
                content: base64Content,
                sourceUrl: location.href
            };

            await addAttachment(attachment); // 2. Save it also as an attachment
            showAttachment(file.name);
        };
        reader.readAsDataURL(file);
    } catch (err) {
        showMessage(`Failed to read image ${file.name}: ${err.message}`, 'error');
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Image read failed: ${err.message}`, err);
    }
}

async function handleGenericFile(file) {
    try {
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
                throw new Error(`${manifest?.name || 'Unknown'} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`);
            }
        } catch (err) {
            console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${err.message}`, err);
            return;
        }

        const docText = typeof response === 'string' ? response : (typeof response.text === 'function' ? await response.text() : '');
        if (!docText) {
            showMessage(`${file.name} is either empty or extraction of its content failed!`, 'error');
            return;
        }

        const attachment = {
            id: crypto.randomUUID(),
            type: 'file',
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            content: docText,
            sourceUrl: location.href
        };

        await addAttachment(attachment);
        showAttachment(file.name);
    } catch (err) {
        showMessage(`Failed to process file ${file.name}: ${err.message}`, 'error');
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - error: ${err.message}`, err);
    }
}


async function handlePlainTextFile(file) {
    try {
        const text = await file.text();
        if (!text) {
            showMessage(`${file.name} appears to be empty.`, 'error');
            return;
        }

        const attachment = {
            id: crypto.randomUUID(),
            type: 'file',
            filename: file.name,
            contentType: file.type || 'text/plain',
            content: text,
            sourceUrl: location.href
        };

        await addAttachment(attachment);
        showAttachment(file.name);
    } catch (err) {
        showMessage(`Failed to read plain text file ${file.name}: ${err.message}`, 'error');
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - error: ${err.message}`, err);
    }
}

function readFileContent(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (event) {
            resolve(event.target.result);
        };
        reader.onerror = function (error) {
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

        console.log(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - event files:`, e?.dataTransfer?.files);

        for (let i = 0; i < e.dataTransfer.files.length; i++) {
            const file = e.dataTransfer.files[i];
            console.log(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - File ${i}: Name: ${file.name}; Type: ${file.type}; Size: ${file.size}`);

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
        console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - error: ${err.message}`, err);
    }
}
