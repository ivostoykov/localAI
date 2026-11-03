import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from '@webext-core/fake-browser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf-8');

const MANIFEST = { name: 'Local AI helper', version: '1.29.80' };
const OPTIONS_SOURCE = read('src/options.js');
const EXPORTED_API = [
    'buildFullExport', 'validateFullImport', 'describeCollections', 'downloadJson',
    'exportAllAsFile', 'exportAsFile', 'importAllFromFile', 'importFromFile', 'importUserCommand'
];

function loadOptionsPage() {
    const dom = new JSDOM(read('src/options.html'), { runScripts: 'outside-only' });
    const { window } = dom;
    window.chrome = {
        runtime: { getManifest: () => MANIFEST },
        storage: fakeBrowser.storage
    };
    window.confirm = vi.fn(() => true);
    window.URL.createObjectURL = vi.fn(() => 'blob:local-ai-test');
    window.URL.revokeObjectURL = vi.fn();
    window.eval(`${OPTIONS_SOURCE}\n;window.__api = { ${EXPORTED_API.join(', ')} };`);
    return { window, document: window.document, api: window.__api };
}

function captureDownloads(window) {
    const blobs = [];
    const names = [];
    window.Blob = class {
        constructor(parts, options) {
            this.parts = parts;
            this.options = options;
            blobs.push(this);
        }
    };
    window.HTMLAnchorElement.prototype.click = function () { names.push(this.download); };
    return { blobs, names };
}

const readDownload = download => JSON.parse(download.parts.join(''));

const messageBox = document => document.querySelector('.message-box');

const makeFile = (window, content, name = 'localAI_full_export_20261103.json') =>
    new window.File([typeof content === 'string' ? content : JSON.stringify(content)], name, { type: 'application/json' });

const fullEnvelope = overrides => ({
    app: 'localAI',
    type: 'full-export',
    formatVersion: 1,
    extensionVersion: '1.29.80',
    exportedAt: '2026-11-03T09:00:00.000Z',
    data: {
        laiOptions: { aiModel: 'llama3', tempRange: '0.5' },
        aiUserCommands: [{ commandName: 'summarise', commandBody: 'Summarise this' }],
        aiTools: [{ type: 'tool', function: { name: 'get_tab_info' } }]
    },
    ...overrides
});

async function storageState() {
    const sync = await fakeBrowser.storage.sync.get(['laiOptions']);
    const local = await fakeBrowser.storage.local.get(['aiUserCommands', 'aiTools']);
    return { sync, local };
}

describe('options global export/import', () => {
    let window;
    let document;
    let api;

    beforeEach(async () => {
        await fakeBrowser.storage.local.clear();
        await fakeBrowser.storage.sync.clear();
        ({ window, document, api } = loadOptionsPage());
    });

    describe('buildFullExport', () => {
        it('builds the documented envelope', () => {
            const now = new Date('2026-11-03T09:00:00.000Z');
            const envelope = api.buildFullExport(
                { laiOptions: { a: 1 }, aiUserCommands: [], aiTools: [{ b: 2 }] },
                '1.29.80',
                now
            );

            expect(envelope).toEqual({
                app: 'localAI',
                type: 'full-export',
                formatVersion: 1,
                extensionVersion: '1.29.80',
                exportedAt: '2026-11-03T09:00:00.000Z',
                data: { laiOptions: { a: 1 }, aiUserCommands: [], aiTools: [{ b: 2 }] }
            });
        });

        it('omits collections absent from storage', () => {
            const envelope = api.buildFullExport({ aiUserCommands: [{ commandName: 'x' }] }, '1.29.80', new Date(0));

            expect(Object.keys(envelope.data)).toEqual(['aiUserCommands']);
            expect(envelope.data.aiUserCommands).toEqual([{ commandName: 'x' }]);
        });

        it('leaves data empty when nothing is stored', () => {
            expect(api.buildFullExport({}, '1.29.80', new Date(0)).data).toEqual({});
        });
    });

    describe('validateFullImport', () => {
        it('accepts a full export and reports all collections', () => {
            expect(api.validateFullImport(fullEnvelope())).toEqual({ ok: true, keys: ['laiOptions', 'aiUserCommands', 'aiTools'] });
        });

        it('accepts a partial export listing only the present collections', () => {
            const result = api.validateFullImport(fullEnvelope({ data: { aiTools: [] } }));

            expect(result).toEqual({ ok: true, keys: ['aiTools'] });
        });

        it('ignores unknown keys inside data', () => {
            const result = api.validateFullImport(fullEnvelope({ data: { laiOptions: {}, aiSessions: [{ id: 1 }] } }));

            expect(result).toEqual({ ok: true, keys: ['laiOptions'] });
        });

        it.each([
            ['null', null],
            ['a list', []],
            ['a string', 'localAI']
        ])('rejects %s', (label, value) => {
            expect(api.validateFullImport(value).ok, label).toBe(false);
        });

        it.each([
            ['app', { app: 'other' }],
            ['type', { type: 'import' }],
            ['formatVersion number', { formatVersion: 2 }],
            ['formatVersion string', { formatVersion: '1' }],
            ['data missing', { data: undefined }],
            ['data as list', { data: [] }],
            ['data empty', { data: {} }],
            ['laiOptions as list', { data: { laiOptions: [] } }],
            ['aiUserCommands as object', { data: { aiUserCommands: {} } }],
            ['aiTools as string', { data: { aiTools: 'tools' } }]
        ])('rejects a wrong %s', (label, overrides) => {
            const result = api.validateFullImport(fullEnvelope(overrides));

            expect(result.ok, label).toBe(false);
            expect(result.error, label).toBeTruthy();
            expect(result.keys, label).toBeUndefined();
        });
    });

    describe('describeCollections', () => {
        it('names one, two or three collections in readable form', () => {
            expect(api.describeCollections(['laiOptions'])).toBe('settings');
            expect(api.describeCollections(['aiUserCommands', 'aiTools'])).toBe('user prompts and functions');
            expect(api.describeCollections(['laiOptions', 'aiUserCommands', 'aiTools'])).toBe('settings, user prompts and functions');
            expect(api.describeCollections([])).toBe('');
        });
    });

    describe('exportAllAsFile', () => {
        it('downloads one full-export file containing the three stored collections', async () => {
            const downloads = captureDownloads(window);
            await fakeBrowser.storage.sync.set({ laiOptions: { aiModel: 'llama3' } });
            await fakeBrowser.storage.local.set({ aiUserCommands: [{ commandName: 'one' }], aiTools: [] });

            await api.exportAllAsFile();

            expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1);
            expect(downloads.blobs).toHaveLength(1);
            expect(downloads.blobs[0].options).toEqual({ type: 'application/json' });

            const envelope = readDownload(downloads.blobs[0]);
            expect(envelope.app).toBe('localAI');
            expect(envelope.type).toBe('full-export');
            expect(envelope.formatVersion).toBe(1);
            expect(envelope.extensionVersion).toBe('1.29.80');
            expect(envelope.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(envelope.data).toEqual({
                laiOptions: { aiModel: 'llama3' },
                aiUserCommands: [{ commandName: 'one' }],
                aiTools: []
            });
        });

        it('omits collections that are not in storage', async () => {
            const downloads = captureDownloads(window);
            await fakeBrowser.storage.local.set({ aiTools: [{ type: 'tool' }] });

            await api.exportAllAsFile();

            expect(Object.keys(readDownload(downloads.blobs[0]).data)).toEqual(['aiTools']);
        });

        it('names the file with the shared date pattern', async () => {
            const downloads = captureDownloads(window);
            await fakeBrowser.storage.sync.set({ laiOptions: {} });

            await api.exportAllAsFile();

            const suffix = (new Date).toISOString().split('T')[0].replace(/\D/g, '');
            expect(downloads.names).toEqual([`localAI_full_export_${suffix}.json`]);
            expect(suffix).toMatch(/^\d{8}$/);
        });

        it('reports a storage failure without downloading', async () => {
            const downloads = captureDownloads(window);
            const get = fakeBrowser.storage.sync.get;
            fakeBrowser.storage.sync.get = vi.fn().mockRejectedValue(new Error('storage unavailable'));
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            await api.exportAllAsFile();

            expect(downloads.blobs).toHaveLength(0);
            expect(messageBox(document).textContent).toContain('Export failed');
            expect(messageBox(document).classList.contains('error')).toBe(true);
            expect(errorSpy).toHaveBeenCalled();

            fakeBrowser.storage.sync.get = get;
            errorSpy.mockRestore();
        });
    });

    describe('importAllFromFile', () => {
        const refreshers = () => ({ loadSettings: vi.fn(), getAiUserCommands: vi.fn(), getTools: vi.fn() });

        it('replaces the collections in their own storage areas and refreshes them', async () => {
            const calls = refreshers();
            const file = makeFile(window, fullEnvelope());

            await api.importAllFromFile(file, calls);

            expect(await fakeBrowser.storage.sync.get(['laiOptions'])).toEqual({ laiOptions: fullEnvelope().data.laiOptions });
            expect(await fakeBrowser.storage.local.get(['aiUserCommands', 'aiTools'])).toEqual({
                aiUserCommands: fullEnvelope().data.aiUserCommands,
                aiTools: fullEnvelope().data.aiTools
            });
            expect(calls.loadSettings).toHaveBeenCalledTimes(1);
            expect(calls.getAiUserCommands).toHaveBeenCalledTimes(1);
            expect(calls.getTools).toHaveBeenCalledTimes(1);
            expect(messageBox(document).textContent).toBe(`${file.name} imported successfully.`);
            expect(messageBox(document).classList.contains('success')).toBe(true);
            expect(document.getElementById('spinner').classList.contains('invisible')).toBe(true);
        });

        it('leaves collections absent from the file untouched', async () => {
            await fakeBrowser.storage.sync.set({ laiOptions: { aiModel: 'keep-me' } });
            await fakeBrowser.storage.local.set({ aiUserCommands: [{ commandName: 'keep' }] });
            const calls = refreshers();

            await api.importAllFromFile(makeFile(window, fullEnvelope({ data: { aiTools: [{ type: 'tool' }] } })), calls);

            expect(await fakeBrowser.storage.sync.get(['laiOptions'])).toEqual({ laiOptions: { aiModel: 'keep-me' } });
            expect(await fakeBrowser.storage.local.get(['aiUserCommands'])).toEqual({ aiUserCommands: [{ commandName: 'keep' }] });
            expect(await fakeBrowser.storage.local.get(['aiTools'])).toEqual({ aiTools: [{ type: 'tool' }] });
            expect(calls.loadSettings).not.toHaveBeenCalled();
            expect(calls.getAiUserCommands).not.toHaveBeenCalled();
            expect(calls.getTools).toHaveBeenCalledTimes(1);
        });

        it('writes nothing when the file fails validation', async () => {
            await fakeBrowser.storage.sync.set({ laiOptions: { aiModel: 'keep-me' } });
            const before = await storageState();
            const calls = refreshers();
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
            const file = makeFile(window, fullEnvelope({ type: 'section-export' }));

            await api.importAllFromFile(file, calls);

            expect(await storageState()).toEqual(before);
            expect(window.confirm).not.toHaveBeenCalled();
            expect(calls.loadSettings).not.toHaveBeenCalled();
            expect(messageBox(document).textContent).toContain('was rejected');
            expect(messageBox(document).classList.contains('error')).toBe(true);
            expect(document.getElementById('spinner').classList.contains('invisible')).toBe(true);
            errorSpy.mockRestore();
        });

        it.each([
            ['a per-section prompts export', [{ commandName: 'one' }]],
            ['a per-section functions export', [{ type: 'tool' }]],
            ['an unrelated object', { hello: 'world' }]
        ])('rejects %s as a full export', async (label, content) => {
            const before = await storageState();

            await api.importAllFromFile(makeFile(window, content, 'partial.json'), refreshers());

            expect(await storageState(), label).toEqual(before);
            expect(messageBox(document).classList.contains('error'), label).toBe(true);
        });

        it('writes nothing when the file is not valid JSON', async () => {
            const before = await storageState();
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            await api.importAllFromFile(makeFile(window, '{ not json'), refreshers());

            expect(await storageState()).toEqual(before);
            expect(messageBox(document).textContent).toContain('could not be read');
            expect(messageBox(document).classList.contains('error')).toBe(true);
            errorSpy.mockRestore();
        });

        it('writes nothing when the confirmation is cancelled', async () => {
            await fakeBrowser.storage.sync.set({ laiOptions: { aiModel: 'keep-me' } });
            const before = await storageState();
            const calls = refreshers();
            window.confirm.mockReturnValue(false);

            await api.importAllFromFile(makeFile(window, fullEnvelope()), calls);

            expect(window.confirm).toHaveBeenCalledTimes(1);
            expect(await storageState()).toEqual(before);
            expect(calls.loadSettings).not.toHaveBeenCalled();
            expect(calls.getAiUserCommands).not.toHaveBeenCalled();
            expect(calls.getTools).not.toHaveBeenCalled();
            expect(messageBox(document).textContent).toBe('Import cancelled. Nothing was changed.');
            expect(messageBox(document).classList.contains('info')).toBe(true);
        });

        it('names the collections in the confirmation prompt', async () => {
            await api.importAllFromFile(makeFile(window, fullEnvelope({ data: { laiOptions: {}, aiTools: [] } })), refreshers());

            expect(window.confirm.mock.calls[0][0]).toContain('settings and functions');
        });

        it('reports a write failure, still hides the spinner and does not refresh', async () => {
            const calls = refreshers();
            const set = fakeBrowser.storage.sync.set;
            fakeBrowser.storage.sync.set = vi.fn().mockRejectedValue(new Error('quota exceeded'));
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            await api.importAllFromFile(makeFile(window, fullEnvelope({ data: { laiOptions: {} } })), calls);

            expect(messageBox(document).textContent).toContain('Import failed');
            expect(messageBox(document).classList.contains('error')).toBe(true);
            expect(calls.loadSettings).not.toHaveBeenCalled();
            expect(document.getElementById('spinner').classList.contains('invisible')).toBe(true);
            expect(errorSpy).toHaveBeenCalled();

            fakeBrowser.storage.sync.set = set;
            errorSpy.mockRestore();
        });
    });

    describe('importFromFile routing', () => {
        it('delegates the importAllBtn key to the full import', async () => {
            const event = { target: { dataset: { key: 'importAllBtn' }, files: [makeFile(window, fullEnvelope())] } };

            await api.importFromFile(event);

            expect(await fakeBrowser.storage.sync.get(['laiOptions'])).toEqual({ laiOptions: fullEnvelope().data.laiOptions });
        });

        it('keeps the per-section prompts import unchanged', async () => {
            const commands = [{ commandName: 'one', commandBody: 'Body' }];
            const event = { target: { dataset: { key: 'importPromptBtn' }, files: [makeFile(window, commands, 'prompts.json')] } };

            await api.importFromFile(event);
            await vi.waitFor(() => expect(messageBox(document).textContent).toBe('prompts.json imported successfully.'));

            expect(await fakeBrowser.storage.local.get(['aiUserCommands'])).toEqual({ aiUserCommands: commands });
        });

        it('keeps the per-section functions import unchanged', async () => {
            const tools = [{ type: 'tool', function: { name: 'get_tab_info' } }];
            const event = { target: { dataset: { key: 'importFuncBtn' }, files: [makeFile(window, tools, 'tools.json')] } };

            await api.importFromFile(event);
            await vi.waitFor(() => expect(messageBox(document).textContent).toBe('tools.json imported successfully.'));

            expect(await fakeBrowser.storage.local.get(['aiTools'])).toEqual({ aiTools: tools });
        });
    });

    describe('exportAsFile per-section behaviour', () => {
        it('keeps the prompts export format and filename unchanged', async () => {
            const downloads = captureDownloads(window);
            await fakeBrowser.storage.local.set({ aiUserCommands: [{ commandName: 'one' }] });

            await api.exportAsFile({ target: { id: 'exportPromptBtn' } });

            expect(downloads.blobs).toHaveLength(1);
            const suffix = (new Date).toISOString().split('T')[0].replace(/\D/g, '');
            expect(readDownload(downloads.blobs[0])).toEqual([{ commandName: 'one' }]);
            expect(downloads.names).toEqual([`localAI_user_commands_export_${suffix}.json`]);
            expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1);
        });

        it('exports an empty list when the collection is missing', async () => {
            const downloads = captureDownloads(window);

            await api.exportAsFile({ target: { id: 'exportFuncBtn' } });

            expect(readDownload(downloads.blobs[0])).toEqual([]);
            expect(downloads.names[0]).toMatch(/^localAI_tool_functions_\d{8}\.json$/);
        });
    });

    describe('options.html', () => {
        const ribbon = () => document.getElementById('generalRibbon');

        it('places Export All and Import All after Close, before the help link', () => {
            const children = Array.from(ribbon().children);
            const closeIndex = children.indexOf(document.getElementById('cancelButton'));
            const exportIndex = children.indexOf(document.getElementById('exportAllBtn'));
            const importIndex = children.indexOf(document.getElementById('importAllBtn'));
            const helpIndex = children.findIndex(el => el.tagName === 'A');

            expect(exportIndex).toBe(closeIndex + 1);
            expect(importIndex).toBe(closeIndex + 2);
            expect(helpIndex).toBe(importIndex + 1);
        });

        it('declares both new buttons as type="button" inside the form', () => {
            [document.getElementById('exportAllBtn'), document.getElementById('importAllBtn')].forEach(button => {
                expect(button.getAttribute('type')).toBe('button');
                expect(button.closest('form').id).toBe('laiOptionsForm');
            });
        });

        it('labels them Export All and Import All', () => {
            expect(document.getElementById('exportAllBtn').textContent.trim()).toBe('Export All');
            expect(document.getElementById('importAllBtn').textContent.trim()).toBe('Import All');
        });

        it('relabels the per-section buttons without changing their IDs', () => {
            expect(document.getElementById('exportPromptBtn').textContent.trim()).toBe('Export Prompts');
            expect(document.getElementById('importPromptBtn').textContent.trim()).toBe('Import Prompts');
            expect(document.getElementById('exportFuncBtn').textContent.trim()).toBe('Export Functions');
            expect(document.getElementById('importFuncBtn').textContent.trim()).toBe('Import Functions');
        });

        it('renames the prompts menu item', () => {
            expect(document.querySelector('.menu-item[data-section="prompts"]').textContent.trim()).toBe('User Prompts');
        });

        it('points the prompts help link at the renamed documentation section', () => {
            const link = document.querySelector('#promptRibbon a[href*="documentation.md"]');

            expect(link.getAttribute('href')).toMatch(/#user-prompts$/);
        });
    });

    describe('documentation.md', () => {
        const docs = read('documentation.md');

        it('uses the new User Prompts heading and anchor', () => {
            expect(docs).toMatch(/^## User Prompts$/m);
            expect(docs).not.toContain('## User Commands');
            expect(docs).not.toContain('#user-commands');
        });

        it('documents Export All and Import All under General Settings', () => {
            const general = docs.slice(docs.indexOf('## General Settings'), docs.indexOf('### End Points'));

            expect(general).toContain('Export All');
            expect(general).toContain('Import All');
            expect(general).toContain('not included');
            expect(general).toContain('Export Prompts');
            expect(general).toContain('Import Functions');
        });
    });
});
