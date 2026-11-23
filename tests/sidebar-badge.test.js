import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '../src/jslib/sidebar-badge.js'), 'utf8');
const { setSidebarBlockedBadge, clearSidebarBlockedBadge, attachSidebarBadgeCleanup } = new Function(`${source}; return { setSidebarBlockedBadge, clearSidebarBlockedBadge, attachSidebarBadgeCleanup };`)();

function createActionApi() {
    return {
        setBadgeText: vi.fn(async () => { }),
        setBadgeBackgroundColor: vi.fn(async () => { }),
        setTitle: vi.fn(async () => { })
    };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('sidebar badge', () => {
    it('sets a per-tab badge and explanatory title', async () => {
        const actionApi = createActionApi();

        await setSidebarBlockedBadge(actionApi, 7);

        expect(actionApi.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: '!' });
        expect(actionApi.setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 7, color: '#c0392b' });
        expect(actionApi.setTitle).toHaveBeenCalledWith({ tabId: 7, title: expect.stringContaining('removed the panel repeatedly') });
    });

    it('clears the badge and title', async () => {
        const actionApi = createActionApi();

        await clearSidebarBlockedBadge(actionApi, 7);

        expect(actionApi.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: '' });
        expect(actionApi.setTitle).toHaveBeenCalledWith({ tabId: 7, title: '' });
    });

    it('ignores a missing tab or API', async () => {
        const actionApi = createActionApi();

        await setSidebarBlockedBadge(actionApi, null);
        await clearSidebarBlockedBadge(null, 7);

        expect(actionApi.setBadgeText).not.toHaveBeenCalled();
    });

    it('clears the badge when a new document starts loading', async () => {
        const actionApi = createActionApi();
        const listeners = {};
        const tabs = { onUpdated: { addListener: listener => { listeners.updated = listener; } } };
        attachSidebarBadgeCleanup(actionApi, tabs);

        listeners.updated(7, { status: 'loading' });
        await flush();

        expect(actionApi.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: '' });

        actionApi.setBadgeText.mockClear();
        listeners.updated(7, { status: 'complete' });
        await flush();

        expect(actionApi.setBadgeText).not.toHaveBeenCalled();
    });
});
