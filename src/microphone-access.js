const allowMicrophone = document.getElementById('allowMicrophone');
const microphoneStatus = document.getElementById('microphoneStatus');

allowMicrophone.addEventListener('click', async () => {
    allowMicrophone.disabled = true;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        microphoneStatus.textContent = 'Microphone access is enabled. Close this tab and click the microphone in the sidebar again.';
        allowMicrophone.hidden = true;
    } catch (error) {
        logSpeechError('Microphone access failed: ' + error.name);
        microphoneStatus.textContent = error.name === 'NotAllowedError'
            ? 'Check microphone permissions in Chrome settings, then try again.'
            : 'Could not access a microphone. Check that it is connected and enabled, then try again.';
        allowMicrophone.disabled = false;
    }
});
