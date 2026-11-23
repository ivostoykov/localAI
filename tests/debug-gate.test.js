import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backgroundCode = fs.readFileSync(path.join(__dirname, '../src/background.js'), 'utf-8');
const laiMainCode = fs.readFileSync(path.join(__dirname, '../src/lai-main.js'), 'utf-8');

const extractFunction = (source, name) => source.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}\\n`))[0];

const loadDumpInFrontConsole = deps => new Function('deps', `with (deps) { ${extractFunction(backgroundCode, 'dumpInFrontConsole')}; return dumpInFrontConsole; }`)(deps);
const loadConvertFileToText = deps => new Function('deps', `with (deps) { ${extractFunction(backgroundCode, 'convertFileToText')}; return convertFileToText; }`)(deps);
const loadResolveToolCalls = deps => new Function('deps', `with (deps) { ${extractFunction(backgroundCode, 'resolveToolCalls')}; return resolveToolCalls; }`)(deps);
const loadDumpInConsole = () => new Function('manifest', 'getLineNumber', `${extractFunction(laiMainCode, 'dumpInConsole')}; return dumpInConsole;`)(global.manifest, () => 'test');

const SECRET = 'SECRET-PAYLOAD-VALUE';
const baseDeps = extra => ({
    manifest: { name: 'Local AI helper' },
    getLineNumber: () => 'test',
    ...extra
});

const setDebug = enabled => { globalThis.debugEnabled = enabled; };
const consoleCalls = spy => JSON.stringify(spy.mock.calls);

describe('debug payload gate', () => {
    beforeEach(() => {
        setDebug(false);
    });

    afterEach(() => {
        setDebug(false);
        vi.restoreAllMocks();
    });

    it('keeps the summary but drops the payload with Debug off, and honours a live switch', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const payload = { message: SECRET };

        globalThis.logDiagnostic('error', 'request failed', payload);
        expect(errorSpy).toHaveBeenCalledWith('request failed');
        expect(consoleCalls(errorSpy)).not.toContain(SECRET);

        setDebug(true);
        globalThis.logDiagnostic('error', 'request failed', payload);
        expect(errorSpy).toHaveBeenLastCalledWith('request failed', payload);
        expect(consoleCalls(errorSpy)).toContain(SECRET);

        setDebug(false);
        globalThis.logDiagnostic('error', 'request failed', payload);
        expect(errorSpy).toHaveBeenLastCalledWith('request failed');
        expect(errorSpy.mock.calls.filter(args => JSON.stringify(args).includes(SECRET))).toHaveLength(1);
    });

    it.each([
        ['request messages', { messages: [{ role: 'user', content: SECRET }] }, 'log'],
        ['response body', { responseText: SECRET, body: { message: { content: SECRET } } }, 'log'],
        ['tool arguments', { function: { name: 'ext_weather', arguments: { city: SECRET } } }, 'debug'],
        ['tool result', { result: SECRET }, 'debug']
    ])('does not forward %s to the content script with Debug off', async (_label, payload, type) => {
        const sendMessage = vi.fn(async () => undefined);
        const dumpInFrontConsole = loadDumpInFrontConsole(baseDeps({ chrome: { tabs: { sendMessage } } }));

        await dumpInFrontConsole('diagnostic summary', payload, type, 1);
        expect(sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ action: 'dumpInConsole', message: 'diagnostic summary', obj: '', type }));
        expect(JSON.stringify(sendMessage.mock.calls)).not.toContain(SECRET);

        setDebug(true);
        await dumpInFrontConsole('diagnostic summary', payload, type, 1);
        expect(JSON.parse(sendMessage.mock.lastCall[1].obj)).toEqual(payload);

        setDebug(false);
        await dumpInFrontConsole('diagnostic summary', payload, type, 1);
        expect(sendMessage.mock.lastCall[1].obj).toBe('');
    });

    it('never serialises the base64 file into a conversion failure', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const fileAsB64 = Buffer.from(SECRET).toString('base64');
        const convertFileToText = loadConvertFileToText(baseDeps({
            getLaiOptions: vi.fn(async () => ({ tika: 'http://tika.local/' })),
            fetch: vi.fn(async () => { throw new Error('network down'); }),
            showUIMessage: vi.fn()
        }));

        expect(await convertFileToText(fileAsB64)).toBe('');
        expect(consoleCalls(errorSpy)).toContain('network down');
        expect(consoleCalls(errorSpy)).not.toContain(fileAsB64);

        setDebug(true);
        await convertFileToText(fileAsB64);
        expect(consoleCalls(errorSpy)).toContain(fileAsB64);

        setDebug(false);
        errorSpy.mockClear();
        await convertFileToText(fileAsB64);
        expect(consoleCalls(errorSpy)).not.toContain(fileAsB64);
    });

    it('keeps tool call arguments out of the console when a tool call fails with Debug off', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const toolCall = { function: { name: 'ext_weather', type: 'function', arguments: { city: SECRET } } };
        const resolveToolCalls = loadResolveToolCalls(baseDeps({
            tabState: {},
            getInternalToolNames: () => ['browse_url'],
            getToolCallRejection: () => null,
            buildExternalToolUrl: () => 'http://tools.local/ext_weather',
            fetchExtResponse: vi.fn(async () => { throw new TypeError('fetch failed'); }),
            updateUIStatusBar: vi.fn(async () => undefined),
            showUIMessage: vi.fn(async () => undefined),
            dumpInFrontConsole: vi.fn(async () => undefined)
        }));

        await resolveToolCalls(toolCall, 'http://tools.local/', { id: 1 });
        expect(consoleCalls(errorSpy)).toContain('ext_weather');
        expect(consoleCalls(errorSpy)).not.toContain(SECRET);

        setDebug(true);
        await resolveToolCalls(toolCall, 'http://tools.local/', { id: 1 });
        expect(consoleCalls(errorSpy)).toContain(SECRET);
    });

    it('drops a forwarded payload in the content script with Debug off', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const dumpInConsole = loadDumpInConsole();
        const obj = JSON.stringify({ message: { content: SECRET } });

        dumpInConsole('response body message', obj, 'log');
        expect(logSpy).toHaveBeenCalledWith('response body message');
        expect(consoleCalls(logSpy)).not.toContain(SECRET);

        setDebug(true);
        dumpInConsole('response body message', obj, 'log');
        expect(logSpy).toHaveBeenLastCalledWith('response body message', { message: { content: SECRET } });

        setDebug(false);
        dumpInConsole('response body message', obj, 'log');
        expect(logSpy).toHaveBeenLastCalledWith('response body message');
    });
});
