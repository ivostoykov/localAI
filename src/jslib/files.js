async function addAttachment(attachment) {
    try {
        if (!attachment) {
            console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Missing or empty attachment parameter!`, attachment);
            return;
        }
        let activeSession = await getActiveSession();
        if (!activeSession || !Array.isArray(activeSession.messages)) {
            activeSession = await createNewSession("Attachment Session");
        }
        if (!activeSession.attachments) { activeSession.attachments = []; }
        activeSession.attachments.push(...[].concat(attachment));
        await setActiveSession(activeSession);
    } catch (err) {
        showMessage(err.message, 'error');
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error occured while adding attachment: ${err.message}`, err, attachment);
    }
}

async function getAttachments() {
    try {
        const activeSession = await getActiveSession();
        return Array.isArray(activeSession?.attachments) ? activeSession.attachments : [];
    } catch (err) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error occured while getting attachments: ${err.message}`, err);
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
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error occured while deleting attachment id ${id}: ${err.message}`, err);
        showMessage(err.message, 'error');
    }
}

function detectImageFormat(base64Data) {
    const header = base64Data.substring(0, 16);
    const decoded = atob(header);
    const bytes = new Uint8Array(decoded.split('').map(c => c.charCodeAt(0)));

    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
        return { format: 'PNG', mimeType: 'image/png' };
    }

    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        return { format: 'JPEG', mimeType: 'image/jpeg' };
    }

    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
        (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
        return { format: 'GIF', mimeType: 'image/gif' };
    }

    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return { format: 'WebP', mimeType: 'image/webp' };
    }

    return { format: 'Unknown', mimeType: null };
}

async function handleImageFile(file) {
    try {
        // TODO: Add model vision capability check before accepting image upload
        // Check if active model has projector_info (vision support) via /api/show endpoint
        // If model doesn't support vision, show error message and suggest switching to vision-capable model
        // Reference: projector_info !== null indicates vision support (llava, granite3.2-vision, etc.)

        const reader = new FileReader();
        reader.onload = async () => {
            const base64Content = reader.result.split(',').pop();
            if (!base64Content) {
                showMessage(`Failed to read image ${file.name}.`, 'error');
                return;
            }

            const imageInfo = detectImageFormat(base64Content);
            if (imageInfo.format !== 'PNG' && imageInfo.format !== 'JPEG' && imageInfo.format !== 'GIF') {
                throw new Error(`Image format not supported: ${imageInfo.format}. File ${file.name} appears to be ${imageInfo.format} but only PNG, JPEG and GIF formats are supported.`);
            }

            const response = await chrome.runtime.sendMessage({
                action: 'storeImage',
                base64: base64Content,
                filename: file.name,
                mimeType: imageInfo.mimeType
            });

            if (response.status === 'error') {
                throw new Error(response.message);
            }

            showAttachment(file.name);
        };
        reader.readAsDataURL(file);
    } catch (err) {
        showMessage(`Failed to read image ${file.name}: ${err.message}`, 'error');
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Image read failed: ${err.message}`, err);
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
                throw new Error(`${manifest?.name ?? ''} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`);
            }
        } catch (err) {
            console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${err.message}`, err);
            return;
        }

        const docText = typeof response === 'string' ? response : (typeof response.text === 'function' ? await response.text() : '');
        if (!docText) {
            showMessage(`${file.name} is either empty or extraction of its content failed!`, 'error');
            return;
        }

        // Clean extracted content
        const cleanedContent = cleanFileContent(docText, file.type);

        const attachment = {
            id: crypto.randomUUID(),
            type: 'file',
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            content: cleanedContent,
            sourceUrl: location.href
        };

        await addAttachment(attachment);
        showAttachment(file.name);
    } catch (err) {
        showMessage(`Failed to process file ${file.name}: ${err.message}`, 'error');
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - error: ${err.message}`, err);
    }
}


async function handlePlainTextFile(file) {
    try {
        const text = await file.text();
        if (!text) {
            showMessage(`${file.name} appears to be empty.`, 'error');
            return;
        }

        const cleanedText = cleanSelection(text);

        const attachment = {
            id: crypto.randomUUID(),
            type: 'file',
            filename: file.name,
            contentType: file.type || 'text/plain',
            content: cleanedText,
            sourceUrl: location.href
        };

        await addAttachment(attachment);
        showAttachment(file.name);
    } catch (err) {
        showMessage(`Failed to read plain text file ${file.name}: ${err.message}`, 'error');
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - error: ${err.message}`, err);
    }
}

function readFileContent(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (event) {
            resolve(event.target.result);
        };
        reader.onerror = function (error) { reject(error); };
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

        console.log(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - event files:`, e?.dataTransfer?.files);

        for (let i = 0; i < e.dataTransfer.files.length; i++) {
            const file = e.dataTransfer.files[i];

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
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - error: ${err.message}`, err);
    }
}
