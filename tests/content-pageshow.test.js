import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentCode = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf-8');

const handlerCode = contentCode.match(/function handleTabSessionPageShow\([\s\S]*?\n}\n/)[0];
const catchUpCode = contentCode.match(/function handleTabSessionCatchUp\([\s\S]*?\n}\n/)[0];
const visibilityHandlerCode = contentCode.match(/function handleTabSessionVisibilityChange\([\s\S]*?\n}\n/)[0];
const startupCode = contentCode.match(/async function restoreTabSessionOnStartup\([\s\S]*?\n}\n/)[0];

const load = deps => new Function('deps', `with (deps) { ${handlerCode}\n${catchUpCode}\n${visibilityHandlerCode}\n${startupCode}; return { handleTabSessionPageShow, handleTabSessionCatchUp, handleTabSessionVisibilityChange, restoreTabSessionOnStartup }; }`)(deps);

const createDeps = (overrides = {}) => ({
    manifest: { name: 'Local AI helper' },
    getLineNumber: () => 'test',
    init: vi.fn(async () => undefined),
    restoreTabSessionFromBackground: vi.fn(async () => undefined),
    catchUpActiveSessionFromStorage: vi.fn(async () => undefined),
    document: { visibilityState: 'visible' },
    console: { error: vi.fn() },
    ...overrides
});


describe('content.js tab session synchronisation (#40)', () => {
    it('registers the pageshow listener at script scope', () => {
        expect(contentCode).toMatch(/^window\.addEventListener\('pageshow', handleTabSessionPageShow\);$/m);
    });

    it('re-synchronises when the document is restored from the back/forward cache', () => {
        const deps = createDeps();

        load(deps).handleTabSessionPageShow({ persisted: true });

        expect(deps.restoreTabSessionFromBackground).toHaveBeenCalledTimes(1);
    });

    it('does nothing for an ordinary page show', () => {
        const deps = createDeps();
        const { handleTabSessionPageShow } = load(deps);

        handleTabSessionPageShow({ persisted: false });
        handleTabSessionPageShow(undefined);

        expect(deps.restoreTabSessionFromBackground).not.toHaveBeenCalled();
    });

    it('logs a failed re-synchronisation instead of throwing', async () => {
        const deps = createDeps({ restoreTabSessionFromBackground: vi.fn(async () => { throw new Error('gone'); }) });

        expect(() => load(deps).handleTabSessionPageShow({ persisted: true })).not.toThrow();
        await vi.waitFor(() => expect(deps.console.error).toHaveBeenCalled());
    });

    it('restores the tab session only after the sidebar UI is built', async () => {
        const order = [];
        const deps = createDeps({
            init: vi.fn(async () => { order.push('init'); }),
            restoreTabSessionFromBackground: vi.fn(async () => { order.push('restore'); })
        });

        await load(deps).restoreTabSessionOnStartup();

        expect(order).toEqual(['init', 'restore']);
    });
});

describe('content.js focus catch-up trigger (#61)', () => {
    it('registers the visibilitychange and focus listeners at script scope', () => {
        expect(contentCode).toMatch(/^document\.addEventListener\('visibilitychange', handleTabSessionVisibilityChange\);$/m);
        expect(contentCode).toMatch(/^window\.addEventListener\('focus', handleTabSessionCatchUp\);$/m);
    });

    it('catches up when the document becomes visible', () => {
        const deps = createDeps();

        load(deps).handleTabSessionVisibilityChange();

        expect(deps.catchUpActiveSessionFromStorage).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the document becomes hidden', () => {
        const deps = createDeps({ document: { visibilityState: 'hidden' } });

        load(deps).handleTabSessionVisibilityChange();

        expect(deps.catchUpActiveSessionFromStorage).not.toHaveBeenCalled();
    });

    it('catches up on window focus', () => {
        const deps = createDeps();

        load(deps).handleTabSessionCatchUp();

        expect(deps.catchUpActiveSessionFromStorage).toHaveBeenCalledTimes(1);
    });

    it('logs a failed catch-up instead of throwing', async () => {
        const deps = createDeps({ catchUpActiveSessionFromStorage: vi.fn(async () => { throw new Error('gone'); }) });

        expect(() => load(deps).handleTabSessionCatchUp()).not.toThrow();
        await vi.waitFor(() => expect(deps.console.error).toHaveBeenCalled());
    });
});
