function logSpeechError(message) {
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${message}`);
}
