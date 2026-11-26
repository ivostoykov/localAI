import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentCode = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf-8');

const handlerCode = contentCode.match(/function handleTabSessionPageShow\([\s\S]*?\n}\n/)[0];
const catchUpCode = contentCode.match(/function handleTabSessionCatchUp\([\s\S]*?\n}\n/)[0];
const visibilityHandlerCode = contentCode.match(/function handleTabSessionVisibilityChange\([\s\S]*?\n}\n/)[0];
const load = deps => new Function('deps', `with (deps) { ${handlerCode}\n${catchUpCode}\n${visibilityHandlerCode}; return { handleTabSessionPageShow, handleTabSessionCatchUp, handleTabSessionVisibilityChange }; }`)(deps);
const createDeps = (overrides = {}) => ({
    notifySidebar: vi.fn(),
    document: { visibilityState: 'visible' },
    ...overrides
});

describe('content.js tab session synchronisation (#40)', () => {
    it('registers the pageshow listener at script scope', () => {
        expect(contentCode).toMatch(/^window\.addEventListener\('pageshow', handleTabSessionPageShow\);$/m);
    });

    it('re-synchronises when the document is restored from the back/forward cache', () => {
        const deps = createDeps();

        load(deps).handleTabSessionPageShow({ persisted: true });

        expect(deps.notifySidebar).toHaveBeenCalledExactlyOnceWith('catchUp', { restore: true });
    });

    it('does nothing for an ordinary page show', () => {
        const deps = createDeps();
        const { handleTabSessionPageShow } = load(deps);

        handleTabSessionPageShow({ persisted: false });
        handleTabSessionPageShow(undefined);

        expect(deps.notifySidebar).not.toHaveBeenCalled();
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

        expect(deps.notifySidebar).toHaveBeenCalledExactlyOnceWith('catchUp');
    });

    it('does nothing when the document becomes hidden', () => {
        const deps = createDeps({ document: { visibilityState: 'hidden' } });

        load(deps).handleTabSessionVisibilityChange();

        expect(deps.notifySidebar).not.toHaveBeenCalled();
    });

    it('catches up on window focus', () => {
        const deps = createDeps();

        load(deps).handleTabSessionCatchUp();

        expect(deps.notifySidebar).toHaveBeenCalledExactlyOnceWith('catchUp');
    });

});
