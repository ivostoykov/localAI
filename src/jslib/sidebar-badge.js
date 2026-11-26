/**
 * Toolbar badge for a sidebar that the page keeps removing (#104).
 *
 * The content script stops recreating the host after repeated removals and asks the
 * background for an out-of-page notification instead. The badge is cleared on the
 * next successful open and on navigation.
 */

const laiSidebarBlockedTitle = 'Local AI: the page removed the panel repeatedly. Reopen it from the toolbar button.';

async function setSidebarBlockedBadge(actionApi, tabId) {
    if (!actionApi || tabId == null) { return; }
    try {
        await actionApi.setBadgeText?.({ tabId, text: '!' });
        await actionApi.setBadgeBackgroundColor?.({ tabId, color: '#c0392b' });
        await actionApi.setTitle?.({ tabId, title: laiSidebarBlockedTitle });
    } catch (error) {
        console.debug('>>> Failed to set the sidebar badge', error);
    }
}

async function clearSidebarBlockedBadge(actionApi, tabId) {
    if (!actionApi || tabId == null) { return; }
    try {
        await actionApi.setBadgeText?.({ tabId, text: '' });
        await actionApi.setTitle?.({ tabId, title: '' });
    } catch (error) {
        console.debug('>>> Failed to clear the sidebar badge', error);
    }
}

function attachSidebarBadgeCleanup(actionApi, tabs = chrome?.tabs) {
    if (!actionApi || !tabs) { return; }

    tabs.onUpdated?.addListener((tabId, changeInfo) => {
        if (changeInfo?.status !== 'loading') { return; }
        void clearSidebarBlockedBadge(actionApi, tabId);
    });
}
