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

const executeUtilsCode = new Function('chrome', 'manifest', 'document', 'window', 'getLineNumber', utilsCode + '; return { getLineNumber, getHighestZIndex, checkExtensionState };');

let getLineNumber, getHighestZIndex, checkExtensionState;

describe('utils.js', () => {
    beforeEach(() => {
        const exports = executeUtilsCode(global.chrome, global.manifest, global.document, global.window, () => 'test');
        getLineNumber = exports.getLineNumber;
        getHighestZIndex = exports.getHighestZIndex;
        checkExtensionState = exports.checkExtensionState;

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
            delete fakeBrowser.runtime.id;

            const result = checkExtensionState();

            expect(result).toBe(false);

            fakeBrowser.runtime.id = originalId;
        });
    });
});
