import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '../src/jslib/sessions.js'), 'utf8');

function loadSessions() {
    const chrome = { runtime: { getManifest: () => ({ name: 'test' }) }, storage: { local: {}, sync: {} } };
    return new Function('chrome', 'notifyTabBindingChanged', `${source}; return { setActiveSessionId, deleteActiveSessionId, notifyActiveSessionChanged };`)(chrome, vi.fn());
}

describe('active session change announcement', () => {
    const listeners = [];
    const record = event => listeners.push(event.detail.sessionId);

    afterEach(() => {
        document.removeEventListener('laiActiveSessionChanged', record);
        listeners.length = 0;
    });

    it('announces a changed session only once', async () => {
        document.addEventListener('laiActiveSessionChanged', record);
        const { setActiveSessionId } = loadSessions();

        await setActiveSessionId('session-1');
        await setActiveSessionId('session-1');
        await setActiveSessionId('session-2');

        expect(listeners).toEqual(['session-1', 'session-2']);
    });

    it('announces the cleared session', async () => {
        document.addEventListener('laiActiveSessionChanged', record);
        const { setActiveSessionId, deleteActiveSessionId } = loadSessions();
        await setActiveSessionId('session-1');

        await deleteActiveSessionId();
        await deleteActiveSessionId();

        expect(listeners).toEqual(['session-1', null]);
    });
});
