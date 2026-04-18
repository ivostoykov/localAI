import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ribbonCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/ribbon.js'),
    'utf-8'
);

const closeAllDropDownRibbonMenusCode = ribbonCode.match(/async function closeAllDropDownRibbonMenus\([\s\S]*?\n}\n/)[0];
const fillAndShowModelListCode = ribbonCode.match(/async function fillAndShowModelList\([\s\S]*?\n}\n/)[0];

const executeRibbonCode = new Function(
    'document',
    'getShadowRoot',
    'getOptions',
    'showMessage',
    'manifest',
    'getLineNumber',
    'closeAllDropDownRibbonMenus',
    'swapActiveModel',
    'getAndShowModels',
    `
${closeAllDropDownRibbonMenusCode}
${fillAndShowModelListCode}

return { closeAllDropDownRibbonMenus, fillAndShowModelList };
`
);

describe('ribbon.js model list', () => {
    let document;
    let getShadowRoot;
    let getOptions;
    let showMessage;
    let getLineNumber;
    let closeAllDropDownRibbonMenus;
    let swapActiveModel;
    let getAndShowModels;
    let exports;

    beforeEach(() => {
        const dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
                <body>
                    <div id="shadowRoot">
                        <div id="availableModelList" class="available-model-list invisible"></div>
                        <select id="modelList">
                            <option value="">Select Model name</option>
                        </select>
                    </div>
                </body>
            </html>
        `);

        document = dom.window.document;
        getShadowRoot = vi.fn(() => document.getElementById('shadowRoot'));
        getOptions = vi.fn(async () => ({ aiModel: 'llama3.2' }));
        showMessage = vi.fn();
        getLineNumber = vi.fn(() => 'test:1');
        closeAllDropDownRibbonMenus = vi.fn(async () => undefined);
        swapActiveModel = vi.fn(async () => undefined);
        getAndShowModels = vi.fn(async () => undefined);

        exports = executeRibbonCode(
            document,
            getShadowRoot,
            getOptions,
            showMessage,
            { name: 'Local AI helper' },
            getLineNumber,
            closeAllDropDownRibbonMenus,
            swapActiveModel,
            getAndShowModels
        );
    });

    it('keeps the model dropdown open when clicking inside its related panel', async () => {
        const shadowRoot = getShadowRoot();
        const modelNameContainer = document.createElement('div');
        modelNameContainer.id = 'modelNameContainer';
        modelNameContainer.dataset.menuId = 'availableModelList';
        modelNameContainer.classList.add('js-menu-is-open');
        modelNameContainer.click = vi.fn();
        shadowRoot.appendChild(modelNameContainer);

        const availableModelList = shadowRoot.querySelector('#availableModelList');
        const item = document.createElement('button');
        availableModelList.appendChild(item);

        await exports.closeAllDropDownRibbonMenus({
            composedPath: () => [item, availableModelList, shadowRoot]
        });

        expect(modelNameContainer.click).not.toHaveBeenCalled();
    });

    it('closes the open menu when clicking outside the related panel', async () => {
        const shadowRoot = getShadowRoot();
        const modelNameContainer = document.createElement('div');
        modelNameContainer.id = 'modelNameContainer';
        modelNameContainer.dataset.menuId = 'availableModelList';
        modelNameContainer.classList.add('js-menu-is-open');
        modelNameContainer.click = vi.fn();
        shadowRoot.appendChild(modelNameContainer);

        const outsideElement = document.createElement('div');

        await exports.closeAllDropDownRibbonMenus({
            composedPath: () => [outsideElement, shadowRoot]
        });

        expect(modelNameContainer.click).toHaveBeenCalledOnce();
    });

    it('renders local and cloud tabs with a refresh control', async () => {
        await exports.fillAndShowModelList([
            { name: 'llama3.2', source: 'local' },
            { name: 'gpt-oss:120b-cloud', source: 'cloud' }
        ]);

        const shadowRoot = getShadowRoot();
        const modelList = shadowRoot.querySelector('#availableModelList');
        const refreshButton = modelList.querySelector('.model-list-refresh');
        const tabs = Array.from(modelList.querySelectorAll('.model-list-tab'));
        const localItems = Array.from(modelList.querySelectorAll('.model-list-panel[data-panel="local"] .model-list-item'));
        const cloudItems = Array.from(modelList.querySelectorAll('.model-list-panel[data-panel="cloud"] .model-list-item'));

        expect(refreshButton).not.toBeNull();
        expect(tabs.map(tab => tab.textContent)).toEqual(['Local', 'Cloud']);
        expect(tabs.find(tab => tab.classList.contains('active'))?.dataset.tab).toBe('local');
        expect(localItems.map(item => item.dataset.modelName)).toEqual(['llama3.2']);
        expect(cloudItems.map(item => item.dataset.modelName)).toEqual(['gpt-oss:120b-cloud']);
        expect(modelList.classList.contains('invisible')).toBe(false);
    });

    it('refreshes the model catalogue on demand', async () => {
        await exports.fillAndShowModelList([
            { name: 'llama3.2', source: 'local' }
        ]);

        const refreshButton = getShadowRoot().querySelector('.model-list-refresh');

        await refreshButton.dispatchEvent(
            new document.defaultView.MouseEvent('click', { bubbles: true })
        );

        expect(getAndShowModels).toHaveBeenCalledWith(true);
    });

    it('switches to the cloud tab when clicked', async () => {
        await exports.fillAndShowModelList([
            { name: 'llama3.2', source: 'local' },
            { name: 'gpt-oss:120b-cloud', source: 'cloud' }
        ]);

        const shadowRoot = getShadowRoot();
        const cloudTab = shadowRoot.querySelector('.model-list-tab[data-tab="cloud"]');
        const localPanel = shadowRoot.querySelector('.model-list-panel[data-panel="local"]');
        const cloudPanel = shadowRoot.querySelector('.model-list-panel[data-panel="cloud"]');

        await cloudTab.dispatchEvent(
            new document.defaultView.MouseEvent('click', { bubbles: true })
        );

        expect(cloudTab.classList.contains('active')).toBe(true);
        expect(localPanel.classList.contains('invisible')).toBe(true);
        expect(cloudPanel.classList.contains('invisible')).toBe(false);
    });

    it('selects a model item through swapActiveModel', async () => {
        await exports.fillAndShowModelList([
            { name: 'llama3.2', source: 'local' },
            { name: 'gpt-oss:120b-cloud', source: 'cloud' }
        ]);

        const cloudItem = Array.from(getShadowRoot().querySelectorAll('.model-list-item'))
            .find(item => item.dataset.modelName === 'gpt-oss:120b-cloud');

        await cloudItem.dispatchEvent(
            new document.defaultView.MouseEvent('click', { bubbles: true })
        );

        expect(swapActiveModel).toHaveBeenCalled();
    });
});
