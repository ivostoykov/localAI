import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentCode = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf-8');

const handlerCode = contentCode.match(/function handleTabSessionPageShow\([\s\S]*?\n}\n/)[0];
const startupCode = contentCode.match(/async function restoreTabSessionOnStartup\([\s\S]*?\n}\n/)[0];

const load = deps => new Function('deps', `with (deps) { ${handlerCode}\n${startupCode}; return { handleTabSessionPageShow, restoreTabSessionOnStartup }; }`)(deps);

const createDeps = (overrides = {}) => ({
    manifest: { name: 'Local AI helper' },
    getLineNumber: () => 'test',
    init: vi.fn(async () => undefined),
    restoreTabSessionFromBackground: vi.fn(async () => undefined),
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
