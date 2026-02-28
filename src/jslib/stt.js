function createSpeechRecognizer(resultArea) {
    if (!resultArea) {
        if (typeof(showMessage) === 'function') {
            showMessage('Invalid result area for speech recognition', 'error');
        }
        return false;
    }

    let recognition;
    try {
        if(typeof(SpeechRecognition) !== 'undefined') {  recognition = new SpeechRecognition();  }
        else if(typeof(window.SpeechRecognition) !== 'undefined') {  recognition = new window.SpeechRecognition();  }
        else if(typeof(window.webkitSpeechRecognition) !== 'undefined') {  recognition = new window.webkitSpeechRecognition();  }
        if(!recognition){
            if (typeof(showMessage) === 'function') {
                showMessage('Failed to attach SpeechRecognition', 'error');
            }
            return false;
        }
    } catch (err) {
        if (typeof(showMessage) === 'function') {
            showMessage(`SpeechRecognition error: ${err.message}`, 'error');
        }
        return false;
    }

    let isRunning = false;

    recognition.lang = 'en-GB';
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onresult = function (event) {
        const transcript = event.results[0][0].transcript;
        resultArea.value += `${(resultArea.value?.length || 0) > 0 ? ' ' : ''}${transcript}`;
    };

    recognition.onerror = function (event) {
        // Non-recoverable errors that should stop the recognition
        const fatalErrors = [
            'not-allowed',         // User denied permission
            'service-not-allowed', // Browser doesn't allow speech recognition
            'audio-capture',       // No microphone available
            'no-speech'            // Optional: might want to keep trying
        ];

        if (fatalErrors.includes(event.error)) {
            isRunning = false;  // Prevent automatic restart
        }

        if(typeof(showMessage) === 'function'){
            showMessage(`Error occurred in recognition: ${event.error}`, 'error');
        }
    };

    recognition.onend = function () {
        if (isRunning) {  recognition.start();  }
    };

    return {
        start: function () {
            if (!isRunning) {
                isRunning = true;
                recognition.start();
            }
        },
        stop: function () {
            if (isRunning) {
                isRunning = false;
                recognition.stop();
            }
        },
        isRunning: function () {
            return isRunning;
        }
    };
}

let stt = null;

function toggleRecording(resultArea) {
    if (stt && stt.isRunning()) {
        stt.stop();
        stt = null;
        return true;
    }

    stt = createSpeechRecognizer(resultArea);
    if (!stt) { return false; }
    stt.start();
    return true;
}