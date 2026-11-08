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
        inferModelSourceFromName,
        normaliseModelSummary,
        groupModelsBySource,
        extractContextWindow,
        sanitiseModelInfo,
        getModelNameVariants,
        modelSummaryMatchesName,
        findMatchingModelSummary,
        buildModelNameCandidates,
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
                        { name: 'llama3.2:latest', model: 'llama3.2:latest' },
                        {
                            name: 'gpt-oss:120b-cloud',
                            model: 'gpt-oss:120b-cloud',
                            remote_host: 'https://ollama.com:443',
                            remote_model: 'gpt-oss:120b'
                        }
                    ]
                })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    models: [
                        { name: 'gpt-oss:120b', model: 'gpt-oss:120b' },
                        { name: 'deepseek-v3.1:671b', model: 'deepseek-v3.1:671b' }
                    ]
                })
            });

        const catalogue = await exports.fetchModelCatalogueFromApi('http://127.0.0.1:11434/api/chat', true);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(catalogue.groups.local).toHaveLength(1);
        expect(catalogue.groups.cloud).toHaveLength(2);
        expect(catalogue.groups.cloud.map(model => model.name)).toEqual(['deepseek-v3.1:671b', 'gpt-oss:120b']);
        expect(catalogue.groups.cloud.find(model => model.name === 'gpt-oss:120b')?.availableLocally).toBe(true);
        expect(catalogue.groups.cloud.find(model => model.name === 'deepseek-v3.1:671b')?.availableLocally).toBe(false);
        expect(storageState.modelCatalogueCache['http://127.0.0.1:11434']).toBeDefined();
    });

    it('falls back to cached cloud models when the live cloud fetch fails', async () => {
        storageState.modelCatalogueCache = {
            'http://127.0.0.1:11434': {
                endpoint: 'http://127.0.0.1:11434',
                updatedAt: '2026-04-19T00:00:00.000Z',
                groups: {
                    local: [{ name: 'llama3.2:latest', model: 'llama3.2:latest', source: 'local' }],
                    cloud: [
                        { name: 'deepseek-v3.1:671b', model: 'deepseek-v3.1:671b', source: 'cloud' },
                        { name: 'gpt-oss:120b', model: 'gpt-oss:120b', source: 'cloud' }
                    ]
                },
                models: [
                    { name: 'llama3.2:latest', model: 'llama3.2:latest', source: 'local' },
                    { name: 'deepseek-v3.1:671b', model: 'deepseek-v3.1:671b', source: 'cloud' },
                    { name: 'gpt-oss:120b', model: 'gpt-oss:120b', source: 'cloud' }
                ],
                scope: 'all',
                cloudCatalogueLoaded: true
            }
        };
        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    models: [
                        { name: 'llama3.2:latest', model: 'llama3.2:latest' },
                        {
                            name: 'deepseek-v3.1:671b-cloud',
                            model: 'deepseek-v3.1:671b-cloud',
                            remote_host: 'https://ollama.com:443',
                            remote_model: 'deepseek-v3.1:671b'
                        }
                    ]
                })
            })
            .mockResolvedValueOnce({
                ok: false,
                status: 503,
                statusText: 'Service Unavailable'
            });

        const catalogue = await exports.getModelCatalogue('http://127.0.0.1:11434/api/chat', false, true, true);

        expect(catalogue.groups.local.map(model => model.name)).toEqual(['llama3.2:latest']);
        expect(catalogue.groups.cloud.map(model => model.name)).toEqual(['deepseek-v3.1:671b', 'gpt-oss:120b']);
        expect(catalogue.groups.cloud[0].availableLocally).toBe(true);
        expect(catalogue.errors.cloud).toBe('Failed to load models (503: Service Unavailable)');
        expect(catalogue.cloudCatalogueLoaded).toBe(false);
        expect(catalogue.cloudCatalogueFallback).toBe(true);
        expect(catalogue.cloudCatalogueFallbackSource).toBe('cache');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('falls back to locally known cloud models when no cached cloud catalogue exists', async () => {
        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    models: [
                        { name: 'llama3.2:latest', model: 'llama3.2:latest' },
                        {
                            name: 'deepseek-v3.1:671b-cloud',
                            model: 'deepseek-v3.1:671b-cloud',
                            remote_host: 'https://ollama.com:443',
                            remote_model: 'deepseek-v3.1:671b'
                        }
                    ]
                })
            })
            .mockResolvedValueOnce({
                ok: false,
                status: 503,
                statusText: 'Service Unavailable'
            });

        const catalogue = await exports.getModelCatalogue('http://127.0.0.1:11434/api/chat', false, true, true);

        expect(catalogue.groups.local.map(model => model.name)).toEqual(['llama3.2:latest']);
        expect(catalogue.groups.cloud.map(model => model.name)).toEqual(['deepseek-v3.1:671b-cloud']);
        expect(catalogue.groups.cloud[0].availableLocally).toBe(true);
        expect(catalogue.errors.cloud).toBe('Failed to load models (503: Service Unavailable)');
        expect(catalogue.cloudCatalogueLoaded).toBe(false);
        expect(catalogue.cloudCatalogueFallback).toBe(true);
        expect(catalogue.cloudCatalogueFallbackSource).toBe('local');
        expect(fetchMock).toHaveBeenCalledTimes(2);
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
                models: [{ name: 'llama3.2:latest', model: 'llama3.2:latest', source: 'local' }],
                scope: 'daemon'
            }
        };

        const catalogue = await exports.getModelCatalogue('http://127.0.0.1:11434/api/chat');

        expect(fetchMock).not.toHaveBeenCalled();
        expect(catalogue.models[0].name).toBe('llama3.2:latest');
    });

    it('refreshes the cloud catalogue on demand even when a current cache exists', async () => {
        storageState.modelCatalogueCache = {
            'http://127.0.0.1:11434': {
                endpoint: 'http://127.0.0.1:11434',
                updatedAt: '2026-04-19T00:00:00.000Z',
                groups: {
                    local: [{ name: 'llama3.2:latest', model: 'llama3.2:latest', source: 'local' }],
                    cloud: [{ name: 'gpt-oss:120b', model: 'gpt-oss:120b', source: 'cloud' }]
                },
                models: [
                    { name: 'llama3.2:latest', model: 'llama3.2:latest', source: 'local' },
                    { name: 'gpt-oss:120b', model: 'gpt-oss:120b', source: 'cloud' }
                ],
                scope: 'all',
                cloudCatalogueLoaded: true
            }
        };
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
                        { name: 'deepseek-v3.1:671b', model: 'deepseek-v3.1:671b' }
                    ]
                })
            });

        const catalogue = await exports.getModelCatalogue('http://127.0.0.1:11434/api/chat', false, true, true);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(catalogue.groups.cloud.map(model => model.name)).toEqual(['deepseek-v3.1:671b']);
        expect(catalogue.cloudCatalogueLoaded).toBe(true);
    });

    it('does not treat a daemon-only cached catalogue as a full cloud catalogue', async () => {
        storageState.modelCatalogueCache = {
            'http://127.0.0.1:11434': {
                endpoint: 'http://127.0.0.1:11434',
                updatedAt: '2026-04-13T00:00:00.000Z',
                groups: {
                    local: [{ name: 'llama3.2:latest', model: 'llama3.2:latest', source: 'local' }],
                    cloud: [{ name: 'gpt-oss:120b-cloud', model: 'gpt-oss:120b-cloud', source: 'cloud', availableLocally: true }]
                },
                models: [
                    { name: 'llama3.2:latest', model: 'llama3.2:latest', source: 'local' },
                    { name: 'gpt-oss:120b-cloud', model: 'gpt-oss:120b-cloud', source: 'cloud', availableLocally: true }
                ],
                scope: 'daemon'
            }
        };
        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    models: [
                        { name: 'llama3.2:latest', model: 'llama3.2:latest' },
                        {
                            name: 'gpt-oss:120b-cloud',
                            model: 'gpt-oss:120b-cloud',
                            remote_host: 'https://ollama.com:443',
                            remote_model: 'gpt-oss:120b'
                        }
                    ]
                })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    models: [
                        { name: 'gpt-oss:120b', model: 'gpt-oss:120b' }
                    ]
                })
            });

        const catalogue = await exports.getModelCatalogue('http://127.0.0.1:11434/api/chat', false, true);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(catalogue.groups.cloud.map(model => model.name)).toEqual(['gpt-oss:120b']);
        expect(catalogue.groups.cloud[0].availableLocally).toBe(true);
    });

    it('re-fetches stale pre-metadata cloud catalogues cached with scope all', async () => {
        storageState.modelCatalogueCache = {
            'http://127.0.0.1:11434': {
                endpoint: 'http://127.0.0.1:11434',
                updatedAt: '2026-04-18T00:00:00.000Z',
                groups: {
                    local: [{ name: 'llama3.2:latest', model: 'llama3.2:latest', source: 'local' }],
                    cloud: [{ name: 'gpt-oss:120b-cloud', model: 'gpt-oss:120b-cloud', source: 'cloud' }]
                },
                models: [
                    { name: 'llama3.2:latest', model: 'llama3.2:latest', source: 'local' },
                    { name: 'gpt-oss:120b-cloud', model: 'gpt-oss:120b-cloud', source: 'cloud' }
                ],
                scope: 'all'
            }
        };
        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    models: [
                        { name: 'llama3.2:latest', model: 'llama3.2:latest' },
                        {
                            name: 'gpt-oss:120b-cloud',
                            model: 'gpt-oss:120b-cloud',
                            remote_host: 'https://ollama.com:443',
                            remote_model: 'gpt-oss:120b'
                        }
                    ]
                })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    models: [
                        { name: 'gpt-oss:120b', model: 'gpt-oss:120b' },
                        { name: 'deepseek-v3.1:671b', model: 'deepseek-v3.1:671b' }
                    ]
                })
            });

        const catalogue = await exports.getModelCatalogue('http://127.0.0.1:11434/api/chat', false, true);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(catalogue.cloudCatalogueLoaded).toBe(true);
        expect(catalogue.groups.cloud.map(model => model.name)).toEqual(['deepseek-v3.1:671b', 'gpt-oss:120b']);
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

    it('resolves stripped cloud aliases through daemon catalogue matches', async () => {
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
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                capabilities: ['completion', 'tools'],
                model_info: {
                    'gptoss.context_length': 131072
                }
            })
        });

        const modelInfo = await exports.getModelInfoFromApi(
            'http://127.0.0.1:11434/api/chat',
            'gpt-oss:120b'
        );

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('gpt-oss:120b-cloud');
        expect(modelInfo.modelName).toBe('gpt-oss:120b');
        expect(modelInfo.resolvedModelName).toBe('gpt-oss:120b-cloud');
        expect(modelInfo.source).toBe('cloud');
    });

    it('falls back to the -cloud routing suffix when the daemon catalogue does not expose the model yet', async () => {
        storageState.modelCatalogueCache = {
            'http://127.0.0.1:11434': {
                endpoint: 'http://127.0.0.1:11434',
                updatedAt: '2026-04-13T00:00:00.000Z',
                groups: { local: [], cloud: [] },
                models: []
            }
        };
        fetchMock
            .mockResolvedValueOnce({
                ok: false,
                status: 404,
                statusText: 'Not Found'
            })
            .mockResolvedValueOnce({
                ok: false,
                status: 404,
                statusText: 'Not Found'
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    capabilities: ['completion'],
                    model_info: {
                        'deepseek2.context_length': 163840
                    }
                })
            });

        const modelInfo = await exports.getModelInfoFromApi(
            'http://127.0.0.1:11434/api/chat',
            'deepseek-v3.1:671b'
        );

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/tags');
        expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe('deepseek-v3.1:671b');
        expect(JSON.parse(fetchMock.mock.calls[2][1].body).model).toBe('deepseek-v3.1:671b-cloud');
        expect(modelInfo.resolvedModelName).toBe('deepseek-v3.1:671b-cloud');
        expect(modelInfo.source).toBe('cloud');
    });

    it('re-resolves stale cached model info entries that predate resolvedModelName', async () => {
        storageState.modelCatalogueCache = {
            'http://127.0.0.1:11434': {
                endpoint: 'http://127.0.0.1:11434',
                updatedAt: '2026-04-13T00:00:00.000Z',
                groups: { local: [], cloud: [] },
                models: []
            }
        };
        storageState.modelInfoCache = {
            'http://127.0.0.1:11434': {
                'deepseek-v3.1:671b': {
                    modelName: 'deepseek-v3.1:671b',
                    source: 'local',
                    capabilities: ['completion']
                }
            }
        };
        fetchMock
            .mockResolvedValueOnce({
                ok: false,
                status: 404,
                statusText: 'Not Found'
            })
            .mockResolvedValueOnce({
                ok: false,
                status: 404,
                statusText: 'Not Found'
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    capabilities: ['completion'],
                    model_info: {
                        'deepseek2.context_length': 163840
                    }
                })
            });

        const modelInfo = await exports.getModelInfoFromApi(
            'http://127.0.0.1:11434/api/chat',
            'deepseek-v3.1:671b'
        );

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(modelInfo.resolvedModelName).toBe('deepseek-v3.1:671b-cloud');
    });

    describe('model name candidates', () => {
        it('builds the full fallback chain for an untagged name', () => {
            expect(exports.buildModelNameCandidates('llama3.2')).toEqual([
                'llama3.2',
                'llama3.2:cloud',
                'llama3.2-cloud',
                'llama3.2:latest'
            ]);
        });

        it('adds only the -cloud routing suffix to a tagged name', () => {
            expect(exports.buildModelNameCandidates('deepseek-v4-flash:0731')).toEqual([
                'deepseek-v4-flash:0731',
                'deepseek-v4-flash:0731-cloud'
            ]);
        });

        it('never rebuilds variants for a tagged cloud name', () => {
            expect(exports.buildModelNameCandidates('deepseek-v4-flash:0731-cloud')).toEqual([
                'deepseek-v4-flash:0731-cloud'
            ]);
            expect(exports.buildModelNameCandidates('glm-5.3-flash:cloud')).toEqual([
                'glm-5.3-flash:cloud'
            ]);
        });

        it('does not fall back to a cloud name with its routing suffix removed', () => {
            const catalogue = {
                models: [
                    { name: 'deepseek-v4.1-flash:1017-cloud', model: 'deepseek-v4.1-flash:1017-cloud' },
                    { name: 'deepseek-v4.1-flash:1017', model: 'deepseek-v4.1-flash:1017' }
                ]
            };

            expect(exports.buildModelNameCandidates('deepseek-v4.1-flash:1017-cloud', catalogue))
                .toEqual(['deepseek-v4.1-flash:1017-cloud']);
        });

        it('treats a colon in the registry path as part of the name, not a tag', () => {
            expect(exports.buildModelNameCandidates('hf.co/user/model')).toEqual([
                'hf.co/user/model',
                'hf.co/user/model:cloud',
                'hf.co/user/model-cloud',
                'hf.co/user/model:latest'
            ]);
        });
    });

    describe('model info failures', () => {
        const seedCatalogue = () => {
            storageState.modelCatalogueCache = {
                'http://127.0.0.1:11434': {
                    endpoint: 'http://127.0.0.1:11434',
                    updatedAt: '2026-11-08T00:00:00.000Z',
                    groups: {
                        local: [{ name: 'llama3.2:latest', model: 'llama3.2:latest', source: 'local' }],
                        cloud: []
                    },
                    models: [{ name: 'llama3.2:latest', model: 'llama3.2:latest', source: 'local' }],
                    scope: 'daemon'
                }
            };
        };

        const retiredFailure = () => ({
            ok: false,
            status: 410,
            statusText: 'Gone',
            text: async () => JSON.stringify({
                error: 'deepseek-v4-flash:0731 was retired on September 25, 2026. Try glm-5.3-flash:cloud.'
            })
        });

        it('stops after the first non-404 response and reports status and Ollama text', async () => {
            seedCatalogue();
            fetchMock.mockResolvedValueOnce(retiredFailure());

            const error = await exports
                .getModelInfoFromApi('http://127.0.0.1:11434/api/chat', 'deepseek-v4-flash:0731-cloud')
                .catch(caught => caught);

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('deepseek-v4-flash:0731-cloud');
            expect(error.message).toBe(
                'deepseek-v4-flash:0731-cloud: 410 Gone – deepseek-v4-flash:0731 was retired on September 25, 2026. Try glm-5.3-flash:cloud.'
            );
        });

        it('keeps a non-JSON error body as the failure text', async () => {
            seedCatalogue();
            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                text: async () => 'upstream exploded'
            });

            await expect(exports.getModelInfoFromApi('http://127.0.0.1:11434/api/chat', 'llama3.2'))
                .rejects.toThrow('llama3.2: 500 Internal Server Error – upstream exploded');
        });

        it('reports the exact-name failure when every candidate is missing', async () => {
            storageState.modelCatalogueCache = {
                'http://127.0.0.1:11434': {
                    endpoint: 'http://127.0.0.1:11434',
                    updatedAt: '2026-11-08T00:00:00.000Z',
                    groups: {
                        local: [{ name: 'other-model', model: 'other-model', source: 'local' }],
                        cloud: []
                    },
                    models: [{ name: 'other-model', model: 'other-model', source: 'local' }],
                    scope: 'daemon'
                }
            };
            fetchMock.mockResolvedValue({
                ok: false,
                status: 404,
                statusText: 'Not Found',
                text: async () => JSON.stringify({ error: 'model not found' })
            });

            await expect(exports.getModelInfoFromApi('http://127.0.0.1:11434/api/chat', 'llama3.2'))
                .rejects.toThrow('llama3.2: 404 Not Found – model not found');

            expect(fetchMock).toHaveBeenCalledTimes(4);
            expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('llama3.2');
            expect(storageState.modelInfoFailureCache).toBeUndefined();
        });

        it('remembers a terminal failure so repeat callers do not probe again', async () => {
            seedCatalogue();
            fetchMock.mockResolvedValueOnce(retiredFailure());

            await expect(exports.getModelInfoFromApi('http://127.0.0.1:11434/api/chat', 'deepseek-v4-flash:0731-cloud'))
                .rejects.toThrow('410 Gone');

            await expect(exports.getModelInfoFromApi('http://127.0.0.1:11434/api/chat', 'deepseek-v4-flash:0731-cloud'))
                .rejects.toThrow('410 Gone');

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(
                storageState.modelInfoFailureCache['http://127.0.0.1:11434']['deepseek-v4-flash:0731-cloud'].status
            ).toBe(410);
        });

        it('does not memorise a transient 503', async () => {
            seedCatalogue();
            fetchMock.mockResolvedValue({
                ok: false,
                status: 503,
                statusText: 'Service Unavailable',
                text: async () => JSON.stringify({ error: 'service overloaded' })
            });

            await expect(exports.getModelInfoFromApi('http://127.0.0.1:11434/api/chat', 'deepseek-v4-flash:0731-cloud'))
                .rejects.toThrow('deepseek-v4-flash:0731-cloud: 503 Service Unavailable – service overloaded');
            expect(fetchMock).toHaveBeenCalledTimes(1);

            await expect(exports.getModelInfoFromApi('http://127.0.0.1:11434/api/chat', 'deepseek-v4-flash:0731-cloud'))
                .rejects.toThrow('503 Service Unavailable');

            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(storageState.modelInfoFailureCache).toBeUndefined();
        });

        it('does not memorise a 401 so signing in retries on the next prompt', async () => {
            seedCatalogue();
            fetchMock.mockResolvedValue({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                text: async () => JSON.stringify({ error: 'sign in to ollama.com' })
            });

            await expect(exports.getModelInfoFromApi('http://127.0.0.1:11434/api/chat', 'deepseek-v4-flash:0731-cloud'))
                .rejects.toThrow('401 Unauthorized – sign in to ollama.com');
            await expect(exports.getModelInfoFromApi('http://127.0.0.1:11434/api/chat', 'deepseek-v4-flash:0731-cloud'))
                .rejects.toThrow('401 Unauthorized');

            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(storageState.modelInfoFailureCache).toBeUndefined();
        });

        it('clears the remembered failure for a forced refresh', async () => {
            seedCatalogue();
            fetchMock.mockResolvedValue(retiredFailure());

            await expect(exports.getModelInfoFromApi('http://127.0.0.1:11434/api/chat', 'deepseek-v4-flash:0731-cloud'))
                .rejects.toThrow('410 Gone');
            await expect(exports.getModelInfoFromApi('http://127.0.0.1:11434/api/chat', 'deepseek-v4-flash:0731-cloud', true))
                .rejects.toThrow('410 Gone');

            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it('keys the remembered failure by model and endpoint', async () => {
            seedCatalogue();
            fetchMock.mockResolvedValue(retiredFailure());

            await expect(exports.getModelInfoFromApi('http://127.0.0.1:11434/api/chat', 'deepseek-v4-flash:0731-cloud'))
                .rejects.toThrow('410 Gone');

            await expect(exports.getModelInfoFromApi('http://127.0.0.1:11434/api/chat', 'llama3.2'))
                .rejects.toThrow('410 Gone');
            expect(fetchMock).toHaveBeenCalledTimes(2);

            await expect(exports.getModelInfoFromApi('http://127.0.0.1:11435/api/chat', 'deepseek-v4-flash:0731-cloud'))
                .rejects.toThrow('410 Gone');
            expect(fetchMock.mock.calls.length).toBeGreaterThan(2);
            expect(storageState.modelInfoFailureCache['http://127.0.0.1:11435']).toBeDefined();
        });

        it('clears remembered failures when the catalogue is reloaded explicitly', async () => {
            seedCatalogue();
            fetchMock.mockResolvedValueOnce(retiredFailure());

            await expect(exports.getModelInfoFromApi('http://127.0.0.1:11434/api/chat', 'deepseek-v4-flash:0731-cloud'))
                .rejects.toThrow('410 Gone');
            expect(storageState.modelInfoFailureCache['http://127.0.0.1:11434']).toBeDefined();

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    models: [{ name: 'llama3.2:latest', model: 'llama3.2:latest' }]
                })
            });
            await exports.getModelCatalogue('http://127.0.0.1:11434/api/chat', true, false);

            expect(storageState.modelInfoFailureCache['http://127.0.0.1:11434']).toBeUndefined();
        });
    });
});
