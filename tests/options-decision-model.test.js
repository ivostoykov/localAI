import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from '@webext-core/fake-browser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf-8');
const source = read('src/options.js');
const backgroundSource = read('src/background.js');
const versionCode = backgroundSource.match(/function isOllamaVersionSupported\([\s\S]*?\n}\n/)[0];
const filterCode = backgroundSource.match(/function filterDecisionModels\([\s\S]*?\n}\n/)[0];
const backgroundApi = new Function(`${versionCode}\n${filterCode}\nreturn { isOllamaVersionSupported, filterDecisionModels };`)();

function loadOptions() {
    const dom = new JSDOM(read('src/options.html'), { runScripts: 'outside-only' });
    const { window } = dom;
    const sendMessage = vi.fn(async () => ({ status: 'unreachable' }));
    window.chrome = {
        runtime: {
            getManifest: () => ({ name: 'Local AI helper', version: '1.29.85' }),
            sendMessage
        },
        storage: fakeBrowser.storage
    };
    window.eval(`${source}\n;window.__api = { getOptions, getDecisionModelDefaults, saveSettings, attachDataListListeners };`);
    return { window, document: window.document, api: window.__api, sendMessage };
}

describe('decision-model options', () => {
    beforeEach(async () => {
        await fakeBrowser.storage.sync.clear();
    });

    it.each([
        ['0.40.5', false],
        ['0.40.6', true],
        ['0.41.0', true],
        ['1.0.0', true]
    ])('accepts Ollama %s: %s', (version, expected) => {
        expect(backgroundApi.isOllamaVersionSupported(version)).toBe(expected);
    });

    it('filters models to the decision capability', () => {
        expect(backgroundApi.filterDecisionModels([
            { name: 'chat', capabilities: ['completion'] },
            { name: 'clef:27b', resolvedModelName: 'clef:27b-cloud', capabilities: ['decision', 'vision'] },
            { name: 'duplicate', resolvedModelName: 'clef:27b-cloud', capabilities: ['DECISION'] }
        ]).map(model => model.name)).toEqual(['clef:27b-cloud']);
    });

    it('uses and persists the contracted defaults', async () => {
        const { document, api } = loadOptions();
        expect(await api.getOptions()).toMatchObject({
            decisionModelEnabled: false,
            decisionModelUrl: '',
            decisionModel: 'clef:27b-cloud'
        });

        document.getElementById('decisionModelEnabled').checked = true;
        document.getElementById('decisionModelUrl').value = 'http://localhost:11434/v1/systemone';
        document.getElementById('decisionModel').value = 'clef:27b-cloud';
        const form = document.getElementById('laiOptionsForm');
        await api.saveSettings({ preventDefault() {}, target: form });

        expect((await fakeBrowser.storage.sync.get('laiOptions')).laiOptions).toMatchObject({
            decisionModelEnabled: true,
            decisionModelUrl: 'http://localhost:11434/v1/systemone',
            decisionModel: 'clef:27b-cloud'
        });
    });

    it('attaches decision-model button handlers before availability is known', async () => {
        const { document, api, sendMessage } = loadOptions();
        const reload = document.querySelector('#decisionModelButtons [data-action="reload"]');
        reload.classList.add('disabled');
        await api.attachDataListListeners();
        reload.classList.remove('disabled');
        reload.click();
        await Promise.resolve();
        expect(sendMessage).toHaveBeenCalledWith({ action: 'getModels', forceRefresh: true });
    });
});
