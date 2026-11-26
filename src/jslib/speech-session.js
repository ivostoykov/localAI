function createSpeechSessionController(browser, isConfirmedSender) {
    const hostUrl = browser.runtime.getURL('speech-host.html');
    const grantUrl = browser.runtime.getURL('microphone-access.html');
    let active;
    let queue = Promise.resolve();

    const available = () => Boolean(browser.offscreen?.createDocument && browser.runtime.getContexts);

    function enqueue(operation) {
        const result = queue.then(operation);
        queue = result.catch(error => logSpeechError(error.message));
        return result;
    }

    async function closeHost() {
        const contexts = await browser.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
            documentUrls: [hostUrl]
        });
        if (contexts.length) { await browser.offscreen.closeDocument(); }
    }

    async function notify(session, event) {
        try {
            const response = await browser.tabs.sendMessage(session.tabId, {
                action: 'speechUpdate', id: session.id, ...event
            }, { frameId: 0 });
            if (!response?.received) { throw new Error('The originating speech sidebar is unavailable.'); }
            return true;
        } catch (error) {
            logSpeechError(error.message);
            return false;
        }
    }

    async function finish(event) {
        const session = active;
        active = undefined;
        clearTimeout(session?.stopTimeout);
        try {
            await closeHost();
        } catch (error) {
            logSpeechError(error.message);
            if (session && !event?.message) {
                event = { type: 'error', message: 'Could not close speech input: ' + error.message };
            }
        }
        if (session && event) { await notify(session, event); }
    }

    function fail(message) {
        logSpeechError(message);
        return { ok: false, message };
    }

    async function handle(request, sender) {
        if (request.action === 'speechAvailability') { return { available: available() }; }
        if (request.action === 'speechHostEvent') {
            if (sender.id !== browser.runtime.id || sender.url !== hostUrl || sender.tab) {
                return fail('Speech event came from an unrecognised host.');
            }
            if (!active || request.id !== active.id) {
                const response = fail('The speech session is no longer active.');
                if (!active) { await finish(); }
                return response;
            }
            switch (request.type) {
                case 'heartbeat':
                    if (!await notify(active, { type: 'heartbeat' })) {
                        await finish();
                        return fail('The originating speech sidebar disconnected.');
                    }
                    return { ok: true };
                case 'transcript':
                    if (!await notify(active, { type: 'transcript', transcript: request.transcript })) {
                        await finish();
                        return fail('Could not deliver the speech transcript.');
                    }
                    return { ok: true };
                case 'end':
                    await finish({ type: 'end' });
                    return { ok: true };
                case 'error': {
                    let message = 'Speech recognition failed: ' + request.code;
                    logSpeechError(message);
                    if (request.code === 'not-allowed') {
                        message = 'Allow microphone access in the Local AI tab, then click the microphone again.';
                        try {
                            await browser.tabs.create({ url: grantUrl });
                        } catch (error) {
                            logSpeechError(error.message);
                            message = 'Could not open the microphone access tab. Try clicking the microphone again.';
                        }
                    }
                    await finish({ type: 'error', message });
                    return { ok: true };
                }
                default:
                    return fail('Unrecognised speech event.');
            }
        }

        if (!available()) { return fail('Speech input is unavailable in this browser.'); }
        if (!await isConfirmedSender(sender)) { return fail('Speech input requires a confirmed sidebar.'); }

        const { tab: { id: tabId }, frameId, documentId } = sender;
        const { id } = request;
        if (typeof id !== 'string' || !id) { return fail('Invalid speech session.'); }

        if (request.action === 'stopSpeech') {
            if (active?.id !== id || active.tabId !== tabId || active.frameId !== frameId
                || active.documentId !== documentId) {
                return fail('The speech session has already ended.');
            }
            try {
                const response = await browser.runtime.sendMessage({ action: 'speechHostCommand', command: 'stop', id });
                if (!response?.ok) { throw new Error(response?.message || 'The speech host did not respond.'); }
                active.stopTimeout ??= setTimeout(() => {
                    void enqueue(async () => {
                        if (active?.id !== id) { return; }
                        const { message } = fail('Speech input did not stop in time.');
                        await finish({ type: 'error', message });
                    });
                }, 5000);
                return { ok: true };
            } catch (error) {
                await finish();
                return fail('Could not stop speech input: ' + error.message);
            }
        }

        await finish(active && { type: 'end', message: 'Speech input started in another sidebar.' });
        active = { tabId, frameId, documentId, id };
        try {
            await browser.offscreen.createDocument({
                url: 'speech-host.html',
                reasons: ['USER_MEDIA'],
                justification: 'Record microphone input for Local AI dictation.'
            });
            const response = await browser.runtime.sendMessage({ action: 'speechHostCommand', command: 'start', id });
            if (!response?.ok) { throw new Error(response?.message || 'The speech host did not respond.'); }
            return { ok: true };
        } catch (error) {
            await finish();
            return fail('Could not start speech input: ' + error.message);
        }
    }

    return {
        handle(request, sender) { return enqueue(() => handle(request, sender)); },
        removeTab(tabId) {
            if (!available()) { return; }
            return enqueue(async () => {
                if (active?.tabId === tabId) { await finish(); }
            });
        }
    };
}
