let recognition;
let sessionId;
let stopping = false;
let started = false;
let heartbeat;

function releaseSpeechInput() {
    clearInterval(heartbeat);
    if (!recognition) { return; }
    recognition.onend = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.abort();
    recognition = undefined;
}

async function reportSpeechEvent(type, details) {
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'speechHostEvent', id: sessionId, type, ...details
        });
        if (!response?.ok) { throw new Error(response?.message || 'The background did not accept the speech event.'); }
    } catch (error) {
        logSpeechError(error.message);
        releaseSpeechInput();
    }
}

function startRecognition() {
    try {
        recognition.start();
        started = true;
    } catch (error) {
        const code = error.name === 'NotAllowedError' ? 'not-allowed' : error.message;
        void reportSpeechEvent('error', { code });
        releaseSpeechInput();
    }
}

async function checkMicrophoneAndStart() {
    try {
        const permission = await navigator.permissions.query({ name: 'microphone' });
        if (stopping) {
            void reportSpeechEvent('end');
            releaseSpeechInput();
            return;
        }
        if (permission.state !== 'granted') {
            void reportSpeechEvent('error', { code: 'not-allowed' });
            releaseSpeechInput();
            return;
        }
        startRecognition();
    } catch (error) {
        void reportSpeechEvent('error', { code: error.message });
        releaseSpeechInput();
    }
}

chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (request.action !== 'speechHostCommand') { return; }
    if (sender.id !== chrome.runtime.id || sender.tab) {
        const message = 'Speech command came from an unrecognised sender.';
        logSpeechError(message);
        respond({ ok: false, message });
        return;
    }
    try {
        if (request.command === 'start') {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition || recognition) { throw new Error('Speech recognition cannot be started in this browser.'); }
            sessionId = request.id;
            recognition = new SpeechRecognition();
            recognition.lang = 'en-GB';
            recognition.onresult = event => {
                const transcript = Array.from(event.results)
                    .slice(event.resultIndex).map(result => result[0].transcript).join(' ');
                void reportSpeechEvent('transcript', { transcript });
            };
            recognition.onerror = event => {
                void reportSpeechEvent('error', { code: event.error });
                releaseSpeechInput();
            };
            recognition.onend = () => {
                if (stopping) {
                    clearInterval(heartbeat);
                    void reportSpeechEvent('end');
                } else {
                    startRecognition();
                }
            };
            heartbeat = setInterval(() => { void reportSpeechEvent('heartbeat'); }, 20000);
            respond({ ok: true });
            void checkMicrophoneAndStart();
        } else {
            if (!recognition || request.id !== sessionId) { throw new Error('The speech session has already ended.'); }
            stopping = true;
            if (started) { recognition.stop(); }
            respond({ ok: true });
        }
    } catch (error) {
        logSpeechError(error.message);
        respond({ ok: false, message: error.message });
    }
});
