import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from '@webext-core/fake-browser';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const utilsCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/utils.js'),
    'utf-8'
);

// Setup DOM environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.window = dom.window;
global.chrome = fakeBrowser;
global.manifest = {
    name: 'Local AI helper',
    version: '1.28.29'
};

const executeUtilsCode = new Function('chrome', 'manifest', 'document', 'window', 'getLineNumber', utilsCode + '; return { getLineNumber, getHighestZIndex, checkExtensionState, validateAndGetTabId, isValidContentScriptTab };');

let getLineNumber, getHighestZIndex, checkExtensionState, validateAndGetTabId, isValidContentScriptTab;

describe('utils.js', () => {
    beforeEach(() => {
        const exports = executeUtilsCode(global.chrome, global.manifest, global.document, global.window, () => 'test');
        getLineNumber = exports.getLineNumber;
        getHighestZIndex = exports.getHighestZIndex;
        checkExtensionState = exports.checkExtensionState;
        validateAndGetTabId = exports.validateAndGetTabId;
        isValidContentScriptTab = exports.isValidContentScriptTab;

        // Clear DOM
        document.body.innerHTML = '';
    });

    describe('getLineNumber', () => {
        it('returns line number information', () => {
            const lineNumber = getLineNumber();

            expect(lineNumber).toBeDefined();
            expect(typeof lineNumber).toBe('string');
        });

        it('returns "Unknown" when stack trace unavailable', () => {
            const originalError = Error;
            global.Error = class extends originalError {
                constructor() {
                    super();
                    this.stack = '';
                }
            };

            const lineNumber = getLineNumber();
            expect(lineNumber).toBe('Unknown');

            global.Error = originalError;
        });
    });

    describe('getHighestZIndex', () => {
        it('returns base value when no elements', () => {
            const zIndex = getHighestZIndex();

            expect(zIndex).toBe(1000);
        });

        it('finds highest z-index from inline styles', () => {
            const div1 = document.createElement('div');
            div1.style.zIndex = '100';
            document.body.appendChild(div1);

            const div2 = document.createElement('div');
            div2.style.zIndex = '500';
            document.body.appendChild(div2);

            const zIndex = getHighestZIndex();

            expect(zIndex).toBe(1500);
        });

        it('ignores invalid z-index values', () => {
            const div = document.createElement('div');
            div.style.zIndex = 'auto';
            document.body.appendChild(div);

            const zIndex = getHighestZIndex();

            expect(zIndex).toBe(1000);
        });

        it('adds 1000 to highest z-index', () => {
            const div = document.createElement('div');
            div.style.zIndex = '2000';
            document.body.appendChild(div);

            const zIndex = getHighestZIndex();

            expect(zIndex).toBe(3000);
        });
    });

    describe('checkExtensionState', () => {
        it('returns true when runtime.id exists', () => {
            const result = checkExtensionState();

            expect(result).toBe(true);
        });

        it('returns false when runtime.id missing', () => {
            const originalId = fakeBrowser.runtime.id;
            const reloadMock = vi.fn();
            fakeBrowser.runtime.reload = reloadMock;

            delete fakeBrowser.runtime.id;

            const result = checkExtensionState();

            expect(result).toBe(false);

            fakeBrowser.runtime.id = originalId;
            delete fakeBrowser.runtime.reload;
        });
    });

    describe('validateAndGetTabId', () => {
        beforeEach(() => {
            fakeBrowser.tabs.get = vi.fn();
            fakeBrowser.tabs.query = vi.fn();
        });

        it('returns valid tabId when tab exists', async () => {
            const mockTab = { id: 123, url: 'https://example.com' };
            fakeBrowser.tabs.get.mockResolvedValue(mockTab);

            const result = await validateAndGetTabId(123);

            expect(result).toBe(123);
            expect(fakeBrowser.tabs.get).toHaveBeenCalledWith(123);
        });

        it('falls back to active tab when tabId is invalid', async () => {
            const mockActiveTab = { id: 456, url: 'https://example.com' };
            fakeBrowser.tabs.get.mockRejectedValue(new Error('Tab not found'));
            fakeBrowser.tabs.query.mockResolvedValue([mockActiveTab]);

            const result = await validateAndGetTabId(999);

            expect(result).toBe(456);
            expect(fakeBrowser.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
        });

        it('falls back to active tab when tabId is null', async () => {
            const mockActiveTab = { id: 789, url: 'https://example.com' };
            fakeBrowser.tabs.query.mockResolvedValue([mockActiveTab]);

            const result = await validateAndGetTabId(null);

            expect(result).toBe(789);
            expect(fakeBrowser.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
        });

        it('returns null when no active tab available', async () => {
            fakeBrowser.tabs.query.mockResolvedValue([]);

            const result = await validateAndGetTabId(null);

            expect(result).toBe(null);
        });
    });

    describe('isValidContentScriptTab', () => {
        beforeEach(() => {
            fakeBrowser.tabs.get = vi.fn();
        });

        it('returns true for http URLs', async () => {
            fakeBrowser.tabs.get.mockResolvedValue({ id: 123, url: 'http://example.com' });

            const result = await isValidContentScriptTab(123);

            expect(result).toBe(true);
        });

        it('returns true for https URLs', async () => {
            fakeBrowser.tabs.get.mockResolvedValue({ id: 123, url: 'https://example.com' });

            const result = await isValidContentScriptTab(123);

            expect(result).toBe(true);
        });

        it('returns false for chrome:// URLs', async () => {
            fakeBrowser.tabs.get.mockResolvedValue({ id: 123, url: 'chrome://extensions' });

            const result = await isValidContentScriptTab(123);

            expect(result).toBe(false);
        });

        it('returns false for about: URLs', async () => {
            fakeBrowser.tabs.get.mockResolvedValue({ id: 123, url: 'about:blank' });

            const result = await isValidContentScriptTab(123);

            expect(result).toBe(false);
        });

        it('returns false when tabId is null', async () => {
            const result = await isValidContentScriptTab(null);

            expect(result).toBe(false);
        });

        it('returns false when tab not found', async () => {
            fakeBrowser.tabs.get.mockRejectedValue(new Error('Tab not found'));

            const result = await isValidContentScriptTab(999);

            expect(result).toBe(false);
        });
    });
});
