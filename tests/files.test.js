import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from '@webext-core/fake-browser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filesCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/files.js'),
    'utf-8'
);

global.chrome = fakeBrowser;
global.manifest = {
    name: 'Local AI helper',
    version: '1.28.29'
};
global.getLineNumber = () => 'test';

const executeFilesCode = new Function('chrome', 'manifest', 'getLineNumber', 'crypto', filesCode + '; return { readFileContent };');

let readFileContent;

describe('files.js', () => {
    beforeEach(() => {
        const exports = executeFilesCode(global.chrome, global.manifest, global.getLineNumber, global.crypto);
        readFileContent = exports.readFileContent;
    });

    describe('readFileContent', () => {
        it('reads file as ArrayBuffer', async () => {
            const mockFile = new Blob(['test content'], { type: 'text/plain' });
            Object.defineProperty(mockFile, 'name', { value: 'test.txt' });

            const result = await readFileContent(mockFile);

            expect(result).toBeInstanceOf(ArrayBuffer);
            expect(result.byteLength).toBeGreaterThan(0);
        });

        it('rejects on file read error', async () => {
            const mockFile = {
                name: 'test.txt',
                type: 'text/plain'
            };

            // Mock FileReader to simulate error
            const originalFileReader = global.FileReader;
            global.FileReader = class {
                readAsArrayBuffer() {
                    setTimeout(() => {
                        if (this.onerror) {
                            this.onerror(new Error('Read error'));
                        }
                    }, 0);
                }
            };

            await expect(readFileContent(mockFile)).rejects.toBeDefined();

            global.FileReader = originalFileReader;
        });
    });
});
