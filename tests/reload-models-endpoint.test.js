import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backgroundCode = fs.readFileSync(path.join(__dirname, '../src/background.js'), 'utf-8');

const extract = pattern => {
    const match = backgroundCode.match(pattern);
    if (!match) { throw new Error(`Could not extract ${pattern} from background.js`); }
    return match[0];
};

const validateCode = extract(/function validateModelEndpoint\([\s\S]*?\n}\n/);
const getModelsCode = extract(/async function getModels\([\s\S]*?\n}\n/);
const getDecisionModelsCode = extract(/async function getDecisionModels\([\s\S]*?\n}\n/);
const getModelInfoCode = extract(/async function getModelInfo\([\s\S]*?\n}\n/);
const isOptionsPageSenderCode = extract(/function isOptionsPageSender\([\s\S]*?\n}\n/);
const handleRuntimeMessageCode = extract(/async function handleRuntimeMessage\([\s\S]*?\n}\n/);
const isOllamaVersionSupportedCode = extract(/function isOllamaVersionSupported\([\s\S]*?\n}\n/);
const filterDecisionModelsCode = extract(/function filterDecisionModels\([\s\S]*?\n}\n/);

const manifest = { name: 'Local AI helper' };
const getLineNumber = () => 'test:1';
const okResponse = body => ({ ok: true, status: 200, statusText: 'OK', json: async () => body });

function loadBackground(stubs = {}) {
    const deps = {
        getLaiOptions: vi.fn(async () => ({ aiUrl: 'http://saved:11434/api/chat', decisionModelUrl: '' })),
        showUIMessage: vi.fn(async () => { }),
        getModelCatalogue: vi.fn(async () => ({
            models: [{ name: 'clef:27b' }],
            groups: { local: [{ name: 'clef:27b' }], cloud: [] },
            errors: {}
        })),
        fetch: vi.fn(async () => okResponse({ version: '0.41.0' })),
        getAiModel: vi.fn(async () => 'clef:27b'),
        getAiUrl: vi.fn(async () => 'http://saved:11434/api/chat'),
        getModelInfoFromApi: vi.fn(async () => ({ model: 'clef:27b', resolvedModelName: 'clef:27b-cloud', capabilities: ['decision'] })),
        ...stubs
    };
    const module = new Function(
        'manifest', 'getLineNumber', 'getLaiOptions', 'showUIMessage', 'getModelCatalogue', 'fetch',
        'getAiModel', 'getAiUrl', 'getModelInfoFromApi',
        `${isOllamaVersionSupportedCode}
        ${filterDecisionModelsCode}
        ${validateCode}
        ${getModelsCode}
        ${getModelInfoCode}
        ${getDecisionModelsCode}
        return { isOllamaVersionSupported, filterDecisionModels, validateModelEndpoint, getModels, getModelInfo, getDecisionModels };`
    )(manifest, getLineNumber, deps.getLaiOptions, deps.showUIMessage, deps.getModelCatalogue, deps.fetch,
        deps.getAiModel, deps.getAiUrl, deps.getModelInfoFromApi);
    return { module, deps };
}

function loadRouter(stubs = {}) {
    const deps = {
        getModels: vi.fn(async () => ({ status: 'success', models: [] })),
        getDecisionModels: vi.fn(async () => ({ status: 'success', models: [] })),
        ...stubs
    };
    const chrome = {
        runtime: { getURL: suffix => `chrome-extension://testid/${suffix}` }
    };
    const module = new Function(
        'chrome', 'manifest', 'getLineNumber', 'controllers', 'getModels', 'getDecisionModels',
        `${isOptionsPageSenderCode}
        ${handleRuntimeMessageCode}
        return { handleRuntimeMessage };`
    )(chrome, manifest, getLineNumber, new Map(), deps.getModels, deps.getDecisionModels);
    return { module, deps, chrome };
}

const SAVED = 'http://saved:11434/api/chat';
const OVERRIDE = 'http://override:11434/api/chat';

describe('getModels endpoint override', () => {
    it('queries the override endpoint instead of the saved URL', async () => {
        const { module, deps } = loadBackground();
        const response = await module.getModels(true, false, OVERRIDE);

        expect(deps.getModelCatalogue).toHaveBeenCalledWith(OVERRIDE, true, true, false);
        expect(deps.getLaiOptions).not.toHaveBeenCalled();
        expect(response.status).toBe('success');
        expect(response.models).toEqual([{ name: 'clef:27b' }]);
    });

    it('falls back to the saved URL when no override is supplied', async () => {
        const { module, deps } = loadBackground();
        await module.getModels(false, false, '');

        expect(deps.getModelCatalogue).toHaveBeenCalledWith(SAVED, false, true, false);
    });

    it('returns a missing-endpoint error with a UI message when the saved URL is absent', async () => {
        const { module, deps } = loadBackground({ getLaiOptions: vi.fn(async () => ({ aiUrl: '' })) });
        const response = await module.getModels(false, false, '');

        expect(response).toMatchObject({ status: 'error', code: 'missing-endpoint' });
        expect(deps.showUIMessage).toHaveBeenCalledTimes(1);
        expect(deps.getModelCatalogue).not.toHaveBeenCalled();
    });

    it.each([
        'ftp://override:11434/api/tags',
        'not a url',
        'http://override:11434/chat'
    ])('returns a structured error for the override "%s" without a UI message', async (endpoint) => {
        const { module, deps } = loadBackground();
        const response = await module.getModels(true, false, endpoint);

        expect(response.status).toBe('error');
        expect(response.code).toBe('invalid-endpoint');
        expect(response.message).toContain(endpoint);
        expect(deps.showUIMessage).not.toHaveBeenCalled();
        expect(deps.getModelCatalogue).not.toHaveBeenCalled();
    });

    it('names the missing /api/ path in the message', async () => {
        const { module } = loadBackground();
        const response = await module.getModels(true, false, 'http://override:11434/chat');

        expect(response.message).toContain('/api/');
    });

    it('still shows a UI message for a bad saved URL so the ribbon path is unchanged', async () => {
        const { module, deps } = loadBackground({ getLaiOptions: vi.fn(async () => ({ aiUrl: 'ftp://saved:11434/api/chat' })) });
        const response = await module.getModels(false, false, '');

        expect(response).toMatchObject({ status: 'error', code: 'invalid-endpoint' });
        expect(deps.showUIMessage).toHaveBeenCalledTimes(1);
    });

    it('reports an unreachable endpoint instead of a silent failure', async () => {
        const { module, deps } = loadBackground({
            getModelCatalogue: vi.fn(async () => { throw new Error('Failed to load models (500: Internal Server Error)'); })
        });
        const response = await module.getModels(true, false, OVERRIDE);

        expect(response).toMatchObject({ status: 'error', code: 'unreachable' });
        expect(response.message).toContain(OVERRIDE);
        expect(response.message).toContain('500');
    });
});

describe('message router endpoint gating', () => {
    it('passes the endpoint override from the Options page sender', async () => {
        const { module, deps, chrome } = loadRouter();
        const sender = { url: `${chrome.runtime.getURL('options.html')}` };
        await module.handleRuntimeMessage({ action: 'getModels', forceRefresh: true, endpoint: OVERRIDE }, sender);

        expect(deps.getModels).toHaveBeenCalledWith(true, false, OVERRIDE);
    });

    it('ignores the endpoint override from a content-script sender', async () => {
        const { module, deps } = loadRouter();
        const sender = { url: 'https://example.com/page', tab: { id: 7 } };
        await module.handleRuntimeMessage({ action: 'getModels', forceRefresh: true, refreshCloud: true, endpoint: OVERRIDE }, sender);

        expect(deps.getModels).toHaveBeenCalledWith(true, true, '');
    });

    it('passes endpoint and decision-model URL overrides from the Options page sender', async () => {
        const { module, deps, chrome } = loadRouter();
        const sender = { url: `${chrome.runtime.getURL('options.html')}?tab=models` };
        await module.handleRuntimeMessage({
            action: 'getDecisionModels',
            forceRefresh: true,
            endpoint: OVERRIDE,
            decisionModelUrl: 'http://decision:11434/v1/systemone'
        }, sender);

        expect(deps.getDecisionModels).toHaveBeenCalledWith(true, OVERRIDE, 'http://decision:11434/v1/systemone');
    });

    it('ignores decision-model overrides from a content-script sender', async () => {
        const { module, deps } = loadRouter();
        const sender = { url: 'https://example.com/page', tab: { id: 7 } };
        await module.handleRuntimeMessage({
            action: 'getDecisionModels',
            forceRefresh: false,
            endpoint: OVERRIDE,
            decisionModelUrl: 'http://decision:11434/v1/systemone'
        }, sender);

        expect(deps.getDecisionModels).toHaveBeenCalledWith(false, '', '');
    });
});

describe('getDecisionModels endpoint overrides', () => {
    it('uses the override origin for the version check, the catalogue and model info', async () => {
        const { module, deps } = loadBackground();
        const response = await module.getDecisionModels(true, OVERRIDE, '');

        expect(deps.fetch.mock.calls[0][0].href).toBe('http://override:11434/api/version');
        expect(deps.getModelCatalogue).toHaveBeenCalledWith(OVERRIDE, true, true, true);
        expect(deps.getModelInfoFromApi).toHaveBeenCalledWith(OVERRIDE, 'clef:27b', false);
        expect(response.status).toBe('success');
        expect(response.models.map(model => model.name)).toEqual(['clef:27b-cloud']);
    });

    it('lets the decision-model URL override win for the version origin', async () => {
        const { module, deps } = loadBackground();
        await module.getDecisionModels(true, OVERRIDE, 'http://decision:11434/v1/systemone');

        expect(deps.fetch.mock.calls[0][0].href).toBe('http://decision:11434/api/version');
        expect(deps.getModelCatalogue).toHaveBeenCalledWith(OVERRIDE, true, true, true);
    });

    it('falls back to the saved settings when no overrides are supplied', async () => {
        const { module, deps } = loadBackground({
            getLaiOptions: vi.fn(async () => ({ aiUrl: SAVED, decisionModelUrl: 'http://saveddecision:11434/v1/systemone' }))
        });
        await module.getDecisionModels(false, '', '');

        expect(deps.fetch.mock.calls[0][0].href).toBe('http://saveddecision:11434/api/version');
        expect(deps.getModelCatalogue).toHaveBeenCalledWith(SAVED, false, true, false);
        expect(deps.getModelInfoFromApi).toHaveBeenCalledWith(SAVED, 'clef:27b', false);
    });
});

describe('getModelInfo endpoint override', () => {
    it('routes to the per-endpoint API when an endpoint is supplied', async () => {
        const { module, deps } = loadBackground();
        await module.getModelInfo('clef:27b', false, OVERRIDE);

        expect(deps.getModelInfoFromApi).toHaveBeenCalledWith(OVERRIDE, 'clef:27b', false);
        expect(deps.getAiUrl).not.toHaveBeenCalled();
    });

    it('keeps using the saved URL for existing callers', async () => {
        const { module, deps } = loadBackground();
        await module.getModelInfo('clef:27b');

        expect(deps.getModelInfoFromApi).toHaveBeenCalledWith(SAVED, 'clef:27b', false);
    });
});
