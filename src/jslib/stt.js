let stt = null;

function showSpeechError(message) {
    logSpeechError(message);
    showMessage(message, 'error');
}

async function updateSpeechAvailability(micContainer) {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'speechAvailability' });
        if (typeof response?.available !== 'boolean') { throw new Error('The background did not report speech input availability.'); }
        micContainer.classList.toggle('invisible', !response.available);
    } catch (error) {
        showSpeechError('Could not check speech input availability: ' + error.message);
    }
}

function createSpeechRecognizer(resultArea, micContainer) {
    const id = crypto.randomUUID();
    const setRecording = recording => {
        micContainer.classList.toggle('recording', recording);
        micContainer.querySelector('#mic').classList.toggle('invisible', recording);
        micContainer.querySelector('#micOff').classList.toggle('invisible', !recording);
        updateStatusBar(recording ? 'Listening…' : 'Ready.');
    };

    async function requestSpeech(action) {
        try {
            const response = await chrome.runtime.sendMessage({ action, id });
            if (!response?.ok) { throw new Error(response?.message || 'The background did not accept the speech request.'); }
        } catch (error) {
            if (stt?.id !== id) { return; }
            stt = null;
            setRecording(false);
            showSpeechError(error.message);
        }
    }

    return {
        id,
        stopping: false,
        start() {
            setRecording(true);
            void requestSpeech('startSpeech');
        },
        stop() {
            if (this.stopping) { return; }
            this.stopping = true;
            void requestSpeech('stopSpeech');
        },
        update({ type, transcript, message }) {
            if (type === 'transcript') {
                resultArea.value += (resultArea.value ? ' ' : '') + transcript;
                resultArea.dispatchEvent(new Event('input', { bubbles: true }));
                return;
            }
            stt = null;
            setRecording(false);
            if (type === 'error') { showSpeechError(message); }
            else if (message) { showMessage(message, 'info'); }
        }
    };
}

function toggleRecording(resultArea, micContainer) {
    if (stt) {
        stt.stop();
        resultArea?.focus();
        return;
    }
    if (!resultArea || !micContainer) {
        showSpeechError('The speech input controls are unavailable.');
        return;
    }
    stt = createSpeechRecognizer(resultArea, micContainer);
    stt.start();
}

function stopSidebarSpeech() {
    if (!stt) { return; }
    stt.stop();
    stt.update({ type: 'end' });
}

function updateSidebarSpeech(update) {
    if (update.type === 'access') {
        showMessage(update.message, 'info');
        return { received: true };
    }
    if (update.id !== stt?.id) { return { received: false }; }
    if (update.type !== 'heartbeat') { stt.update(update); }
    return { received: true };
}
