import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainCode = fs.readFileSync(path.join(__dirname, '../src/lai-main.js'), 'utf8');
const ribbonCode = fs.readFileSync(path.join(__dirname, '../src/jslib/ribbon.js'), 'utf8');

const load = (source, exports, deps) => new Function('deps', `with (deps) { ${source}; return { ${exports.join(', ')} }; }`)(deps);

const promptKeyDownCode = mainCode.match(/async function onPromptTextAreaKeyDown\([\s\S]*?\n}\n/)[0];
const deleteAllCode = ribbonCode.match(/async function deleteAllHistorySessionsClicked\([\s\S]*?\n}\n/)[0];

function promptEvent() {
    return {
        target: { value: 'hello', classList: { add: vi.fn(), remove: vi.fn() }, blur: vi.fn() },
        key: 'Enter',
        code: 'Enter',
        shiftKey: false,
        preventDefault: vi.fn(),
        stopImmediatePropagation: vi.fn(),
        stopPropagation: vi.fn()
    };
}

describe('sidebar visibility gate wiring', () => {
    it('blocks Enter submission while the sidebar is not fully visible', async () => {
        const renderUserPromptCard = vi.fn();
        const sidebarActionAllowed = vi.fn(() => false);
        const deps = {
            onSuggestionBoxKeyDown: () => false,
            laiHideSuggestions: vi.fn(),
            getShadowRoot: () => ({ getElementById: () => null }),
            isAskingForHelp: () => false,
            checkCommandHandler: async () => false,
            sidebarActionAllowed,
            renderUserPromptCard,
            showMessage: vi.fn()
        };
        const { onPromptTextAreaKeyDown } = load(promptKeyDownCode, ['onPromptTextAreaKeyDown'], deps);
        const event = promptEvent();

        await onPromptTextAreaKeyDown(event);

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(sidebarActionAllowed).toHaveBeenCalledTimes(1);
        expect(renderUserPromptCard).not.toHaveBeenCalled();
    });

    it('blocks Delete All while the sidebar is not fully visible', async () => {
        const getShadowRoot = vi.fn(() => ({}));
        const recycleAllSessions = vi.fn();
        const deps = {
            sidebarActionAllowed: () => false,
            getShadowRoot,
            recycleAllSessions,
            showMessage: vi.fn(),
            closeSessionListDialog: vi.fn(),
            hideSessionListDeleteAllConfirm: vi.fn()
        };
        const { deleteAllHistorySessionsClicked } = load(deleteAllCode, ['deleteAllHistorySessionsClicked'], deps);
        const event = { stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() };

        await deleteAllHistorySessionsClicked(event);

        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(getShadowRoot).not.toHaveBeenCalled();
        expect(recycleAllSessions).not.toHaveBeenCalled();
    });
});
