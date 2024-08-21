function createSpeechRecognizer(resultArea) {
    let recognition;
    try {
        if(typeof(SpeechRecognition) !== 'undefined') {  recognition = new SpeechRecognition();  }
        else if(typeof(window.SpeechRecognition) !== 'undefined') {  recognition = new window.SpeechRecognition();  }
        else if(typeof(window.webkitSpeechRecognition) !== 'undefined') {  recognition = new window.webkitSpeechRecognition();  }
        if(!recognition){
            showMessage('Failed to attach SpeechRecognition', 'error');
            return false;
        }
    } catch (err) {
        showMessage(`SpeechRecognition error: ${err.message}`, 'error');

        return false;
    }

    let isRunning = false;

    recognition.lang = 'en-GB';
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onresult = function (event) {
        const transcript = event.results[0][0].transcript;
        resultArea.value += `${transcript} `;
    };

    recognition.onerror = function (event) {
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