function createSpeechRecognizer(resultArea) {
    const recognition = new (SpeechRecognition || window.SpeechRecognition || window.webkitSpeechRecognition)();
    let isRunning = false;

    recognition.lang = 'en-GB';
    recognition.interimResults = false;
    recognition.continuous = false;

    // Handle speech recognition results
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
    } else {
        stt = createSpeechRecognizer(resultArea); // Create a new instance
        stt.start();
    }
}