const allowMicrophone = document.getElementById('allowMicrophone');
const microphoneStatus = document.getElementById('microphoneStatus');
const requestId = new URLSearchParams(location.search).get('requestId');

async function reportMicrophoneAccess(result, error) {
    const response = await chrome.runtime.sendMessage({ action: 'microphoneAccessResult', requestId, result, error });
    if (!response?.ok) { throw new Error(response?.message || 'Local AI could not confirm the microphone access result.'); }
}

allowMicrophone.addEventListener('click', async () => {
    allowMicrophone.disabled = true;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
    } catch (error) {
        logSpeechError('Microphone access failed: ' + error.name);
        microphoneStatus.textContent = error.name === 'NotAllowedError'
            ? 'Check microphone permissions in Chrome settings, then try again.'
            : 'Could not access a microphone. Check that it is connected and enabled, then try again.';
        await reportMicrophoneAccess('failed', error.name).catch(error => logSpeechError(error.message));
        allowMicrophone.disabled = false;
        return;
    }

    try {
        await reportMicrophoneAccess('granted');
    } catch (error) {
        logSpeechError(error.message);
        microphoneStatus.textContent = 'Microphone access is enabled. Close this window, return to the sidebar and click the microphone again.';
    }
});
