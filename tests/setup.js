import { fakeBrowser } from '@webext-core/fake-browser';

// Mock Chrome extension APIs globally
global.chrome = fakeBrowser;

// Mock manifest
global.manifest = {
    name: 'Local AI helper',
    version: '1.28.29'
};

// Mock getLineNumber utility
global.getLineNumber = () => 'test';

// Storage keys used in sessions.js
global.allSessionsStorageKey = 'LAI_SESSIONS';
global.activeSessionIdKey = 'LAI_ACTIVE_SESSION_ID';
global.storageUserCommandsKey = 'LAI_USER_COMMANDS';
global.storageOptionKey = 'LAI_OPTIONS';
global.activePageStorageKey = 'LAI_ACTIVE_PAGE';

// Mock crypto.randomUUID if not available
if (typeof crypto === 'undefined') {
    global.crypto = {
        randomUUID: () => {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }
    };
}
