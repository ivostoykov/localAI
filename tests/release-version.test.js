import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf-8'));

describe('release version', () => {
    it('is identical across package, lock file and every distribution manifest', () => {
        const expected = readJson('package.json').version;
        const lock = readJson('package-lock.json');
        const versions = {
            'package-lock.json': lock.version,
            'package-lock.json packages[""]': lock.packages[''].version,
            'src/manifest.json': readJson('src/manifest.json').version,
            'Chrome/manifest.json': readJson('Chrome/manifest.json').version,
            'Firefox/manifest.json': readJson('Firefox/manifest.json').version
        };
        expect(expected).toMatch(/^\d+\.\d+\.\d+$/);
        for (const [file, version] of Object.entries(versions)) {
            expect(version, file).toBe(expected);
        }
    });
});
