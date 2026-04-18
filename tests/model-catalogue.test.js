import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelCatalogueCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/model-catalogue.js'),
    'utf-8'
);

const executeModelCatalogueCode = new Function(
    'chrome',
    'fetch',
    'manifest',
    'getLineNumber',
    `${modelCatalogueCode}; return {
        getModelEndpointCacheKey,
        getModelSource,
        normaliseModelSummary,
        groupModelsBySource,
        extractContextWindow,
        sanitiseModelInfo,
        getCachedModelCatalogue,
        fetchModelCatalogueFromApi,
        getModelCatalogue,
        getCachedModelInfo,
        getModelInfoFromApi
    };`
);

describe('model-catalogue.js', () => {
    let storageState;
    let chromeMock;
    let fetchMock;
    let exports;

    beforeEach(() => {
        storageState = {};
        chromeMock = {
            storage: {
                local: {
                    get: vi.fn(async (keys) => {
                        if (Array.isArray(keys)) {
                            return keys.reduce((accumulator, key) => {
                                accumulator[key] = storageState[key];
                                return accumulator;
                            }, {});
                        }

                        if (typeof keys === 'string') {
                            return { [keys]: storageState[keys] };
                        }

                        return { ...storageState };
                    }),
                    set: vi.fn(async (value) => {
                        storageState = {
                            ...storageState,
                            ...value
                        };
                    })
                }
            }
        };
        fetchMock = vi.fn();

        exports = executeModelCatalogueCode(
            chromeMock,
            fetchMock,
            { name: 'Local AI helper' },
            () => 'test:1'
        );
    });

    it('classifies remote models as cloud summaries', () => {
        const model = exports.normaliseModelSummary({
            name: 'gpt-oss:120b-cloud',
            model: 'gpt-oss:120b-cloud',
            remote_host: 'https://ollama.com:443',
            remote_model: 'gpt-oss:120b',
            details: { family: 'gptoss' }
        });

        expect(model.source).toBe('cloud');
        expect(model.remoteHost).toBe('https://ollama.com:443');
        expect(model.remoteModel).toBe('gpt-oss:120b');
    });

    it('groups and sorts models by source', () => {
        const groups = exports.groupModelsBySource([
            { name: 'zeta', model: 'zeta' },
            { name: 'beta-cloud', model: 'beta-cloud', remote_host: 'https://ollama.com:443' },
            { name: 'alpha', model: 'alpha' }
        ]);

        expect(groups.local.map(model => model.name)).toEqual(['alpha', 'zeta']);
        expect(groups.cloud.map(model => model.name)).toEqual(['beta-cloud']);
    });

    it('extracts context window from model info', () => {
        const contextWindow = exports.extractContextWindow({
            model_info: {
                'gptoss.context_length': 131072
            }
        });

        expect(contextWindow).toBe(131072);
    });

    it('sanitises model info and keeps catalogue metadata', () => {
        const cleanData = exports.sanitiseModelInfo(
            {
                capabilities: ['thinking', 'tools'],
                model_info: {
                    'gptoss.context_length': 65536
                },
                details: {
                    family: 'gptoss'
                }
            },
            'gpt-oss:120b-cloud',
            {
                source: 'cloud',
                remoteHost: 'https://ollama.com:443',
                remoteModel: 'gpt-oss:120b'
            }
        );

        expect(cleanData.modelName).toBe('gpt-oss:120b-cloud');
        expect(cleanData.source).toBe('cloud');
        expect(cleanData.contextWindow).toBe(65536);
        expect(cleanData.remoteHost).toBe('https://ollama.com:443');
    });

    it('fetches and caches grouped model catalogue data', async () => {
        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    models: [
                        { name: 'llama3.2:latest', model: 'llama3.2:latest' }
                    ]
                })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    models: [
                        {
                            name: 'gpt-oss:120b-cloud',
                            model: 'gpt-oss:120b-cloud'
                        }
                    ]
                })
            });

        const catalogue = await exports.fetchModelCatalogueFromApi('http://127.0.0.1:11434/api/chat', true);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(catalogue.groups.local).toHaveLength(1);
        expect(catalogue.groups.cloud).toHaveLength(1);
        expect(storageState.modelCatalogueCache['http://127.0.0.1:11434']).toBeDefined();
    });

    it('keeps the local catalogue when the cloud catalogue fetch fails', async () => {
        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    models: [
                        { name: 'llama3.2:latest', model: 'llama3.2:latest' }
                    ]
                })
            })
            .mockResolvedValueOnce({
                ok: false,
                status: 503,
                statusText: 'Service Unavailable'
            });

        const catalogue = await exports.fetchModelCatalogueFromApi('http://127.0.0.1:11434/api/chat', true);

        expect(catalogue.groups.local.map(model => model.name)).toEqual(['llama3.2:latest']);
        expect(catalogue.groups.cloud).toEqual([]);
        expect(catalogue.errors.cloud).toContain('503');
    });

    it('reuses cached catalogue data when refresh is not forced', async () => {
        storageState.modelCatalogueCache = {
            'http://127.0.0.1:11434': {
                endpoint: 'http://127.0.0.1:11434',
                updatedAt: '2026-04-13T00:00:00.000Z',
                groups: {
                    local: [{ name: 'llama3.2:latest', model: 'llama3.2:latest', source: 'local' }],
                    cloud: []
                },
                models: [{ name: 'llama3.2:latest', model: 'llama3.2:latest', source: 'local' }]
            }
        };

        const catalogue = await exports.getModelCatalogue('http://127.0.0.1:11434/api/chat');

        expect(fetchMock).not.toHaveBeenCalled();
        expect(catalogue.models[0].name).toBe('llama3.2:latest');
    });

    it('loads model info, enriches it, and caches it by endpoint and name', async () => {
        storageState.modelCatalogueCache = {
            'http://127.0.0.1:11434': {
                endpoint: 'http://127.0.0.1:11434',
                updatedAt: '2026-04-13T00:00:00.000Z',
                groups: {
                    local: [],
                    cloud: [{
                        name: 'gpt-oss:120b-cloud',
                        model: 'gpt-oss:120b-cloud',
                        source: 'cloud',
                        remoteHost: 'https://ollama.com:443',
                        remoteModel: 'gpt-oss:120b'
                    }]
                },
                models: [{
                    name: 'gpt-oss:120b-cloud',
                    model: 'gpt-oss:120b-cloud',
                    source: 'cloud',
                    remoteHost: 'https://ollama.com:443',
                    remoteModel: 'gpt-oss:120b'
                }]
            }
        };
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({
                capabilities: ['completion', 'tools', 'thinking'],
                model_info: {
                    'gptoss.context_length': 131072
                },
                details: {
                    family: 'gptoss'
                }
            })
        });

        const modelInfo = await exports.getModelInfoFromApi(
            'http://127.0.0.1:11434/api/chat',
            'gpt-oss:120b-cloud'
        );

        expect(modelInfo.modelName).toBe('gpt-oss:120b-cloud');
        expect(modelInfo.source).toBe('cloud');
        expect(modelInfo.contextWindow).toBe(131072);
        expect(storageState.modelInfoCache['http://127.0.0.1:11434']['gpt-oss:120b-cloud']).toBeDefined();
    });
});
