import { fakeBrowser } from '@webext-core/fake-browser';
import { afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Several suites replace global.console; the diagnostics gate reads it from the
// global scope, so give every test the native console back afterwards.
const nativeConsole = global.console;
afterEach(() => { global.console = nativeConsole; });

// Code evaluated with `new Function` resolves the diagnostics gate from the real
// jslib/log.js so tests cannot drift from the shipped gate.
const logSource = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/jslib/log.js'), 'utf-8');
(0, eval)([
    'var debugEnabled = false;',
    logSource.match(/function isDebugEnabled\([\s\S]*?\n}\n/)[0],
    logSource.match(/function logDiagnostic\([\s\S]*?\n}\n/)[0]
].join('\n'));

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
