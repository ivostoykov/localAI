function createSpeechSessionController(browser, isConfirmedSender) {
    const hostUrl = browser.runtime.getURL('speech-host.html');
    const grantUrl = browser.runtime.getURL('microphone-access.html');
    const grantKey = 'speechMicrophoneAccess';
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

    async function openGrantWindow(session) {
        const storage = browser.storage.session;
        const pending = (await storage.get(grantKey))[grantKey];
        if (pending) {
            await browser.windows.update(pending.windowId, { focused: true });
            return;
        }

        const requestId = crypto.randomUUID();
        const url = grantUrl + '?requestId=' + encodeURIComponent(requestId);
        const win = await browser.windows.create({ url, type: 'popup', width: 560, height: 360, focused: true });
        try {
            const tabId = win.tabs?.[0]?.id ?? (await browser.tabs.query({ windowId: win.id }))[0]?.id;
            if (!Number.isInteger(tabId)) { throw new Error('The microphone access window has no tab.'); }
            await storage.set({ [grantKey]: { requestId, url, windowId: win.id, tabId, session } });
        } catch (error) {
            await browser.windows.remove(win.id).catch(error => logSpeechError(error.message));
            throw error;
        }
    }

    async function notifyGrantResult(session, message) {
        if (!await isConfirmedSender(session.sender)) {
            logSpeechError('The sidebar that requested microphone access is no longer available.');
            return;
        }
        await notify(session, { type: 'access', message });
    }

    async function handleGrantResponse(request, sender) {
        const storage = browser.storage.session;
        const pending = (await storage.get(grantKey))[grantKey];
        if (!pending || request.requestId !== pending.requestId || sender?.id !== browser.runtime.id
            || sender.url !== pending.url || sender.tab?.id !== pending.tabId
            || sender.tab.windowId !== pending.windowId || sender.frameId !== 0) {
            return fail('Rejected microphone access response from an unrecognised page.');
        }
        if (request.result === 'failed') {
            logSpeechError('Microphone access was not granted: ' + request.error);
            return { ok: true };
        }
        if (request.result !== 'granted') { return fail('Unrecognised microphone access result.'); }

        const { session, windowId } = pending;
        await storage.remove(grantKey);
        await browser.windows.remove(windowId).catch(error => logSpeechError(error.message));
        await browser.windows.update(session.windowId, { focused: true }).catch(error => logSpeechError(error.message));
        await browser.tabs.update(session.tabId, { active: true }).catch(error => logSpeechError(error.message));
        await notifyGrantResult(session, 'Microphone enabled. Click the microphone to dictate.');
        return { ok: true };
    }

    async function handle(request, sender) {
        if (request.action === 'speechAvailability') { return { available: available() }; }
        if (request.action === 'microphoneAccessResult') { return handleGrantResponse(request, sender); }
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
                        message = 'Allow microphone access in the Local AI pop-up, then click the microphone again.';
                        try {
                            await openGrantWindow(active);
                        } catch (error) {
                            logSpeechError(error.message);
                            message = 'Could not open the microphone access window. Try clicking the microphone again.';
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
        active = {
            tabId, frameId, documentId, id, windowId: sender.tab.windowId,
            sender: { id: sender.id, url: sender.url, tab: { id: tabId }, frameId, documentId }
        };
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
        removeWindow(windowId) {
            return enqueue(async () => {
                const storage = browser.storage.session;
                const pending = (await storage.get(grantKey))[grantKey];
                if (pending?.windowId !== windowId) { return; }
                await storage.remove(grantKey);
                await notifyGrantResult(pending.session, 'Microphone access was not granted.');
            });
        },
        removeTab(tabId) {
            if (!available()) { return; }
            return enqueue(async () => {
                if (active?.tabId === tabId) { await finish(); }
            });
        }
    };
}
