import { describe, it, expect, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logSource = fs.readFileSync(path.join(__dirname, '../src/jslib/log.js'), 'utf-8');
const memorySource = fs.readFileSync(path.join(__dirname, '../src/background-memory.js'), 'utf-8');

const extract = name => logSource.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}\\n`))[0];

// The real log.js gate: console.debug is wrapped, and lines handed to debugTrace are held until
// the flag is resolved. `output` records what reached console.debug.
function makeGate({ enabled = false } = {}) {
    const output = [];
    const consoleStub = { debug: (...args) => output.push(args) };
    const load = new Function('console', 'manifest', 'getLineNumber', `
const originalDebug = console.debug.bind(console);
var debugEnabled = ${enabled};
var debugFlagResolved = false;
const pendingDebugTraces = [];
console.debug = function(...args) {
    if (!debugEnabled) return;
    originalDebug(...args);
};
${extract('isDebugEnabled')}
${extract('debugTrace')}
${extract('markDebugFlagResolved')}
${extract('setDebugFlag')}
return { debugTrace, setDebugFlag };
`);
    return { ...load(consoleStub, global.manifest, () => 'test'), output };
}

const loadMemory = (indexedDB, debugTrace) => new Function(
    'indexedDB',
    'manifest',
    'debugTrace',
    `${memorySource}; return BackgroundMemory;`
)(indexedDB, global.manifest, debugTrace);

const makeRequest = (overrides = {}) => ({
    error: null,
    result: null,
    onblocked: null,
    onerror: null,
    onsuccess: null,
    onupgradeneeded: null,
    ...overrides
});

const makeDb = (version = 2) => ({
    version,
    objectStoreNames: { contains: () => true },
    close: vi.fn()
});

const makeStub = () => {
    const requests = [];
    const indexedDBStub = {
        open: vi.fn(() => {
            const request = makeRequest();
            requests.push(request);
            return request;
        })
    };
    return { indexedDBStub, requests };
};

const lines = gate => gate.output.map(args => args[0]);

describe('IndexedDB init diagnostics (#118)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('writes the startup trace once the debug flag is known', async () => {
        const { indexedDBStub, requests } = makeStub();
        const gate = makeGate();
        const memory = new (loadMemory(indexedDBStub, gate.debugTrace))();

        const opening = memory.init('startup');
        expect(gate.output).toEqual([]);

        requests[0].result = makeDb();
        requests[0].onsuccess();
        await opening;
        expect(gate.output).toEqual([]);

        gate.setDebugFlag(true);

        expect(lines(gate)).toEqual([
            'open requested (db LocalAIMemory, version 2, caller startup, attempt 1)',
            'success (version 2, caller startup, attempt 1)'
        ]);
    });

    it('drops the buffered trace when Debug is off', async () => {
        const { indexedDBStub, requests } = makeStub();
        const gate = makeGate();
        const memory = new (loadMemory(indexedDBStub, gate.debugTrace))();

        const opening = memory.init('startup');
        requests[0].result = makeDb();
        requests[0].onsuccess();
        await opening;

        gate.setDebugFlag(false);

        expect(gate.output).toEqual([]);
    });

    it('traces a blocked open', async () => {
        const { indexedDBStub, requests } = makeStub();
        const gate = makeGate();
        gate.setDebugFlag(true);
        const memory = new (loadMemory(indexedDBStub, gate.debugTrace))();

        const opening = memory.init('startup');
        requests[0].onblocked();
        requests[0].result = makeDb();
        requests[0].onsuccess();
        await opening;

        expect(lines(gate)).toContain('blocked (db LocalAIMemory, version 2, caller startup, attempt 1)');
    });

    it('keeps the error name and message with an empty stack and adds the caller and attempt', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { indexedDBStub, requests } = makeStub();
        const gate = makeGate();
        gate.setDebugFlag(true);
        const memory = new (loadMemory(indexedDBStub, gate.debugTrace))();

        const opening = memory.init('startup');
        requests[0].error = { name: 'InvalidStateError', message: 'The database connection is closing' };
        requests[0].onerror();

        await expect(opening).rejects.toMatchObject({ name: 'InvalidStateError', message: 'The database connection is closing' });
        const [message, error] = errorSpy.mock.calls[0];
        expect(message).toContain('db LocalAIMemory, version 2, caller startup, attempt 1');
        expect(message).toContain('InvalidStateError');
        expect(message).toContain('The database connection is closing');
        expect(error).toEqual({ name: 'InvalidStateError', message: 'The database connection is closing' });
        expect(lines(gate)).toContain('error (name InvalidStateError, message The database connection is closing, caller startup, attempt 1)');
    });

    it('numbers every real open so a retry is distinguishable from startup', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { indexedDBStub, requests } = makeStub();
        const gate = makeGate();
        gate.setDebugFlag(true);
        const memory = new (loadMemory(indexedDBStub, gate.debugTrace))();

        const first = memory.init('startup');
        requests[0].error = { name: 'InvalidStateError', message: 'closing' };
        requests[0].onerror();
        await expect(first).rejects.toBeDefined();

        const second = memory.init('startup');
        requests[1].result = makeDb();
        requests[1].onsuccess();
        await second;

        expect(indexedDBStub.open).toHaveBeenCalledTimes(2);
        expect(lines(gate)).toContain('open requested (db LocalAIMemory, version 2, caller startup, attempt 1)');
        expect(lines(gate)).toContain('open requested (db LocalAIMemory, version 2, caller startup, attempt 2)');
        expect(lines(gate)).toContain('success (version 2, caller startup, attempt 2)');
        expect(errorSpy.mock.calls[0][0]).toContain('attempt 1');
    });

    it('logs a call that joins an in-flight attempt with both callers', async () => {
        const { indexedDBStub, requests } = makeStub();
        const gate = makeGate();
        gate.setDebugFlag(true);
        const memory = new (loadMemory(indexedDBStub, gate.debugTrace))();

        const startup = memory.init('startup');
        const context = memory.init('getContext');
        expect(indexedDBStub.open).toHaveBeenCalledOnce();

        requests[0].result = makeDb();
        requests[0].onsuccess();
        await Promise.all([startup, context]);

        expect(lines(gate)).toContain('caller getContext joined in-flight attempt 1 from caller startup');
        expect(lines(gate).filter(line => line.startsWith('open requested'))).toHaveLength(1);
    });

    it.each(['abort', 'error'])('traces an upgrade transaction %s', async kind => {
        const listeners = {};
        const transaction = {
            error: { name: 'AbortError', message: 'upgrade aborted' },
            addEventListener: (type, listener) => {
                (listeners[type] ??= []).push(listener);
            }
        };
        const { indexedDBStub, requests } = makeStub();
        const gate = makeGate();
        gate.setDebugFlag(true);
        const memory = new (loadMemory(indexedDBStub, gate.debugTrace))();

        const opening = memory.init('startup');
        requests[0].onupgradeneeded({ oldVersion: 1, newVersion: 2, target: { result: makeDb(), transaction } });
        listeners[kind].forEach(listener => listener());
        requests[0].result = makeDb();
        requests[0].onsuccess();
        await opening;

        expect(lines(gate)).toContain('upgrade started (oldVersion 1, newVersion 2, caller startup, attempt 1)');
        expect(lines(gate)).toContain(`upgrade transaction ${kind} (name AbortError, message upgrade aborted, caller startup, attempt 1)`);
    });

    it('traces a versionchange request on the open connection', async () => {
        const { indexedDBStub, requests } = makeStub();
        const gate = makeGate();
        gate.setDebugFlag(true);
        const memory = new (loadMemory(indexedDBStub, gate.debugTrace))();

        const opening = memory.init('startup');
        const db = makeDb();
        requests[0].result = db;
        requests[0].onsuccess();
        await opening;

        db.onversionchange({ oldVersion: 2, newVersion: 3 });

        expect(lines(gate)).toContain('versionchange requested (oldVersion 2, newVersion 3, caller startup, attempt 1)');
    });

    it('traces the upgrade window of a real version change', async () => {
        const deleteDatabase = () => new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase('LocalAIMemory');
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
            request.onblocked = () => resolve();
        });
        await deleteDatabase();
        const versionOne = await new Promise((resolve, reject) => {
            const request = indexedDB.open('LocalAIMemory', 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        versionOne.close();

        const gate = makeGate();
        gate.setDebugFlag(true);
        const memory = new (loadMemory(global.indexedDB, gate.debugTrace))();
        await memory.init('startup');
        memory.db.close();

        expect(lines(gate)).toContain('upgrade started (oldVersion 1, newVersion 2, caller startup, attempt 1)');
        expect(lines(gate)).toContain('success (version 2, caller startup, attempt 1)');
    });
});
