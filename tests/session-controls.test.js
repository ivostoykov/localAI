import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ribbonCode = fs.readFileSync(path.join(__dirname, '../src/jslib/ribbon.js'), 'utf-8');
const laiMainCode = fs.readFileSync(path.join(__dirname, '../src/lai-main.js'), 'utf-8');
const sidebarHtml = fs.readFileSync(path.join(__dirname, '../src/sidebar.html'), 'utf-8');

const extractFunction = (source, name) => {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}\\n`));
    if (!match) { throw new Error(`Function ${name} not found`); }
    return match[0];
};

const controlNames = [
    'getSessionDeleteConfirm',
    'openSessionDeleteConfirm',
    'hideSessionDeleteConfirm',
    'cancelSessionDelete',
    'confirmDeleteActiveSession',
    'sessionDeleteConfirmKeydown',
    'closeSessionDeleteConfirmOnOutsideClick'
];
const controlsCode = controlNames.map(name => extractFunction(ribbonCode, name)).join('\n');

const loadControls = (getShadowRoot, recycleActiveSession, showMessage = vi.fn()) => new Function(
    'getShadowRoot', 'recycleActiveSession', 'showMessage', 'manifest', 'getLineNumber',
    `${controlsCode}
return { ${controlNames.join(', ')} };`
)(getShadowRoot, recycleActiveSession, showMessage, { name: 'Local AI helper' }, () => 'test');

const buildDom = () => new JSDOM(`<!DOCTYPE html>
<div id="laiSessionControls">
    <button type="button" id="laiNewSessionBtn">+</button>
    <button type="button" id="laiSessionNameBtn"><span id="laiSessionName"></span></button>
    <button type="button" id="laiDeleteSessionBtn" aria-expanded="false"></button>
    <div id="laiSessionDeleteConfirm" class="invisible">
        <button type="button" id="laiSessionDeleteConfirmBtn">✓</button>
        <button type="button" id="laiSessionDeleteCancelBtn">✗</button>
    </div>
</div>`);

describe('inline session deletion (#135)', () => {
    let doc;
    let showMessage;
    let recycleActiveSession;
    let controls;

    const bin = () => doc.getElementById('laiDeleteSessionBtn');
    const confirm = () => doc.getElementById('laiSessionDeleteConfirm');
    const confirmButton = () => doc.getElementById('laiSessionDeleteConfirmBtn');

    beforeEach(() => {
        doc = buildDom().window.document;
        showMessage = vi.fn();
        recycleActiveSession = vi.fn(async () => undefined);
        controls = loadControls(() => doc, recycleActiveSession, showMessage);
    });

    it('shows the confirmation and focuses it when a stored session exists', () => {
        expect(controls.openSessionDeleteConfirm()).toBe(true);

        expect(confirm().classList.contains('invisible')).toBe(false);
        expect(bin().getAttribute('aria-expanded')).toBe('true');
        expect(doc.activeElement).toBe(confirmButton());
    });

    it('does not open the confirmation while the bin is disabled', () => {
        bin().disabled = true;

        expect(controls.openSessionDeleteConfirm()).toBe(false);

        expect(confirm().classList.contains('invisible')).toBe(true);
        expect(showMessage).toHaveBeenCalledWith('No session to delete.');
    });

    it('cancels through the ✗ button without deleting anything', () => {
        controls.openSessionDeleteConfirm();
        const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };

        controls.cancelSessionDelete(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(confirm().classList.contains('invisible')).toBe(true);
        expect(bin().getAttribute('aria-expanded')).toBe('false');
        expect(doc.activeElement).toBe(bin());
        expect(recycleActiveSession).not.toHaveBeenCalled();
    });

    it('cancels with Escape and leaves other keys alone', () => {
        controls.openSessionDeleteConfirm();
        const escape = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };

        controls.sessionDeleteConfirmKeydown(escape);

        expect(escape.preventDefault).toHaveBeenCalled();
        expect(escape.stopPropagation).toHaveBeenCalled();
        expect(confirm().classList.contains('invisible')).toBe(true);

        controls.openSessionDeleteConfirm();
        const enter = { key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn() };
        controls.sessionDeleteConfirmKeydown(enter);

        expect(enter.preventDefault).not.toHaveBeenCalled();
        expect(confirm().classList.contains('invisible')).toBe(false);
    });

    it('cancels on an outside click but keeps the confirmation for its own controls', () => {
        controls.openSessionDeleteConfirm();

        controls.closeSessionDeleteConfirmOnOutsideClick({ composedPath: () => [doc.body, doc] });
        expect(confirm().classList.contains('invisible')).toBe(true);

        controls.openSessionDeleteConfirm();
        controls.closeSessionDeleteConfirmOnOutsideClick({ composedPath: () => [bin(), doc.getElementById('laiSessionControls'), doc] });
        expect(confirm().classList.contains('invisible')).toBe(false);
    });

    it('deletes and starts a new session only after ✓', async () => {
        controls.openSessionDeleteConfirm();
        const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };

        await controls.confirmDeleteActiveSession(event, doc);

        expect(recycleActiveSession).toHaveBeenCalledOnce();
        expect(recycleActiveSession.mock.calls[0][1]).toBe(doc);
        expect(confirm().classList.contains('invisible')).toBe(true);
    });

    it('ignores a stale confirmation', async () => {
        await controls.confirmDeleteActiveSession(null, doc);

        expect(recycleActiveSession).not.toHaveBeenCalled();
        expect(showMessage).toHaveBeenCalledWith('No session deletion is waiting for confirmation.');
    });
});

describe('session control wiring (#135)', () => {
    it('replaces the three ribbon buttons with the named control group', () => {
        expect(sidebarHtml).toContain('id="laiSessionControls"');
        expect(sidebarHtml).toContain('id="laiNewSessionBtn"');
        expect(sidebarHtml).toContain('id="laiSessionNameBtn"');
        expect(sidebarHtml).toContain('id="laiSessionName"');
        expect(sidebarHtml).toContain('id="laiDeleteSessionBtn"');
        expect(sidebarHtml).toContain('id="laiSessionDeleteConfirm"');
        expect(sidebarHtml).toContain('Delete Current Session');

        expect(sidebarHtml).not.toContain('id="newSession"');
        expect(sidebarHtml).not.toContain('id="sessionHistory"');
        expect(sidebarHtml).not.toContain('id="recycleCurrentSessionBtn"');
        expect(sidebarHtml).not.toContain('Delete Session History');
    });

    it('renders the session buttons as text characters without images', () => {
        const doc = new JSDOM(sidebarHtml).window.document;
        const plus = doc.getElementById('laiNewSessionBtn');
        const bin = doc.getElementById('laiDeleteSessionBtn');

        expect(plus.textContent.trim()).toBe('+');
        expect(bin.textContent.trim()).toBe('♻︎');
        expect([...bin.textContent.trim()].map(character => character.codePointAt(0))).toEqual([0x267B, 0xFE0E]);
        expect(plus.querySelector('img')).toBeNull();
        expect(bin.querySelector('img')).toBeNull();
        expect(plus.getAttribute('aria-label')).toBe('New Session');
        expect(bin.getAttribute('aria-label')).toBe('Delete Current Session');
    });

    it('calls the session functions directly from the cog menu', () => {
        expect(ribbonCode).not.toMatch(/#newSession|#sessionHistory\b|#recycleCurrentSessionBtn/);
        expect(ribbonCode).toMatch(/createSessionCmdMenu[\s\S]{0,200}createNewSessionClicked\(e, shadowRoot\)/);
        expect(ribbonCode).toMatch(/delSessionsCmdMenu[\s\S]{0,200}openSessionDeleteConfirm\(e\)/);
    });

    it('recycles the active session by calling the new-session function directly', async () => {
        const recycleCode = extractFunction(laiMainCode, 'recycleActiveSession');
        const deleteActiveSession = vi.fn(async () => undefined);
        const reportTabBinding = vi.fn(async () => undefined);
        const showMessage = vi.fn();
        const clearChatHistoryUI = vi.fn();
        const createNewSessionClicked = vi.fn(async () => undefined);
        const recycleActiveSession = new Function(
            'deleteActiveSession', 'reportTabBinding', 'showMessage', 'clearChatHistoryUI', 'createNewSessionClicked',
            'getShadowRoot', 'manifest', 'getLineNumber',
            `${recycleCode}
return recycleActiveSession;`
        )(deleteActiveSession, reportTabBinding, showMessage, clearChatHistoryUI, createNewSessionClicked, () => null, { name: 'Local AI helper' }, () => 'test');
        const shadowRoot = {};

        await recycleActiveSession({}, shadowRoot);

        expect(deleteActiveSession).toHaveBeenCalledOnce();
        expect(reportTabBinding).toHaveBeenCalledWith({ sessionId: null });
        expect(clearChatHistoryUI).toHaveBeenCalledOnce();
        expect(createNewSessionClicked).toHaveBeenCalledOnce();
        expect(createNewSessionClicked.mock.calls[0][1]).toBe(shadowRoot);
        expect(clearChatHistoryUI.mock.invocationCallOrder[0]).toBeLessThan(createNewSessionClicked.mock.invocationCallOrder[0]);
    });
});
