function createSidebarChannel(port, handleRequest, onDisconnect = () => {}) {
    let sequence = 0;
    let disconnected = false;
    const pending = new Map();

    port.onDisconnect.addListener(() => {
        disconnected = true;
        for (const request of pending.values()) {
            clearTimeout(request.timeout);
            request.reject(new Error('Sidebar connection closed.'));
        }
        pending.clear();
        onDisconnect();
    });

    port.onMessage.addListener(async message => {
        if (!Number.isSafeInteger(message?.id)) { return; }
        if (typeof message.ok === 'boolean') {
            const request = pending.get(message.id);
            if (!request) { return; }
            pending.delete(message.id);
            clearTimeout(request.timeout);
            if (message.ok) { request.resolve(message.result); }
            else { request.reject(new Error(message.error)); }
            return;
        }
        if (typeof message.action !== 'string') { return; }
        let reply;
        try {
            const result = await handleRequest(message.action, message.payload ?? {});
            reply = { id: message.id, ok: true, result };
        } catch (error) {
            reply = { id: message.id, ok: false, error: error.message };
        }
        if (!disconnected) { port.postMessage(reply); }
    });

    return {
        request(action, payload) {
            return new Promise((resolve, reject) => {
                if (disconnected) { reject(new Error('Sidebar connection closed.')); return; }
                const id = ++sequence;
                const timeout = setTimeout(() => {
                    pending.delete(id);
                    reject(new Error('Sidebar request timed out.'));
                }, 15000);
                pending.set(id, { resolve, reject, timeout });
                try {
                    port.postMessage({ id, action, payload });
                } catch (error) {
                    pending.delete(id);
                    clearTimeout(timeout);
                    reject(error);
                }
            });
        }
    };
}
