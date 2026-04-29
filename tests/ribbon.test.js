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
const closeRibbonMenuElementCode = ribbonCode.match(/function closeRibbonMenuElement\([\s\S]*?\n}\n/)[0];
const closeModelListMenuCode = ribbonCode.match(/function closeModelListMenu\([\s\S]*?\n}\n/)[0];
const closeSessionHistoryMenuCode = ribbonCode.match(/function closeSessionHistoryMenu\([\s\S]*?\n}\n/)[0];
const modelListTabClickedCode = ribbonCode.match(/function modelListTabClicked\([\s\S]*?\n}\n/)[0];
const refreshCloudModelListBtnClickCode = ribbonCode.match(/async function refreshCloudModelListBtnClick\([\s\S]*?\n}\n/)[0];
const fillAndShowModelListCode = ribbonCode.match(/async function fillAndShowModelList\([\s\S]*?\n}\n/)[0];
const deleteHistoryMenuItemClickedCode = ribbonCode.match(/async function deleteHistoryMenuItemClicked\([\s\S]*?\n}\n/)[0];
const deleteAllHistorySessionsClickedCode = ribbonCode.match(/async function deleteAllHistorySessionsClicked\([\s\S]*?\n}\n/)[0];

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
    'deleteSessionById',
    'updateStatusBar',
    'resetStatusbar',
    'recycleAllSessions',
    `
${closeAllDropDownRibbonMenusCode}
${closeRibbonMenuElementCode}
${closeModelListMenuCode}
${closeSessionHistoryMenuCode}
${modelListTabClickedCode}
${refreshCloudModelListBtnClickCode}
${fillAndShowModelListCode}
${deleteHistoryMenuItemClickedCode}
${deleteAllHistorySessionsClickedCode}

return { closeAllDropDownRibbonMenus, modelListTabClicked, refreshCloudModelListBtnClick, fillAndShowModelList, deleteHistoryMenuItemClicked, deleteAllHistorySessionsClicked };
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
    let deleteSessionById;
    let updateStatusBar;
    let resetStatusbar;
    let recycleAllSessions;
    let exports;

    beforeEach(() => {
        const dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
                <body>
                    <div id="shadowRoot">
                        <div id="availableModelList" class="available-model-list invisible" data-active-tab="local">
                            <div class="model-list-toolbar">
                                <div class="model-list-tabs">
                                    <div id="localModelTab" class="model-list-tab active" data-tab="local">Local</div>
                                    <div id="cloudModelTab" class="model-list-tab" data-tab="cloud">
                                        <span>Cloud</span>
                                        <button id="refreshCloudModelListBtn" type="button"
                                            class="model-list-refresh" aria-label="Refresh the available models"
                                            title="Refresh the available models">🗘</button>
                                    </div>
                                </div>
                            </div>
                            <div class="model-list-panel" data-panel="local"></div>
                            <div class="model-list-panel invisible" data-panel="cloud"></div>
                        </div>
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
        deleteSessionById = vi.fn(async () => undefined);
        updateStatusBar = vi.fn();
        resetStatusbar = vi.fn();
        recycleAllSessions = vi.fn(async () => undefined);

        exports = executeRibbonCode(
            document,
            getShadowRoot,
            getOptions,
            showMessage,
            { name: 'Local AI helper' },
            getLineNumber,
            closeAllDropDownRibbonMenus,
            swapActiveModel,
            getAndShowModels,
            deleteSessionById,
            updateStatusBar,
            resetStatusbar,
            recycleAllSessions
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

    it('closes the model menu state when clicking outside the related panel', async () => {
        const shadowRoot = getShadowRoot();
        const modelNameContainer = document.createElement('div');
        modelNameContainer.id = 'modelNameContainer';
        modelNameContainer.dataset.menuId = 'availableModelList';
        modelNameContainer.classList.add('open', 'js-menu-is-open');
        modelNameContainer.click = vi.fn();
        shadowRoot.appendChild(modelNameContainer);

        const availableModelList = shadowRoot.querySelector('#availableModelList');
        availableModelList.classList.remove('invisible');
        const outsideElement = document.createElement('div');

        await exports.closeAllDropDownRibbonMenus({
            composedPath: () => [outsideElement, shadowRoot]
        });

        expect(modelNameContainer.click).not.toHaveBeenCalled();
        expect(modelNameContainer.classList.contains('open')).toBe(false);
        expect(modelNameContainer.classList.contains('js-menu-is-open')).toBe(false);
        expect(availableModelList.classList.contains('invisible')).toBe(true);
    });

    it('clears stale model menu state without reopening the model list', async () => {
        const shadowRoot = getShadowRoot();
        const modelNameContainer = document.createElement('div');
        modelNameContainer.id = 'modelNameContainer';
        modelNameContainer.dataset.menuId = 'availableModelList';
        modelNameContainer.classList.add('js-menu-is-open');
        modelNameContainer.click = vi.fn();
        shadowRoot.appendChild(modelNameContainer);

        const availableModelList = shadowRoot.querySelector('#availableModelList');
        availableModelList.classList.add('invisible');
        const userInput = document.createElement('textarea');

        await exports.closeAllDropDownRibbonMenus({
            composedPath: () => [userInput, shadowRoot]
        });

        expect(modelNameContainer.click).not.toHaveBeenCalled();
        expect(modelNameContainer.classList.contains('js-menu-is-open')).toBe(false);
        expect(availableModelList.classList.contains('invisible')).toBe(true);
    });

    it('renders local and cloud tabs with a refresh control', async () => {
        await exports.fillAndShowModelList({
            groups: {
                local: [
                    { name: 'llama3.2', source: 'local' }
                ],
                cloud: [
                    { name: 'gpt-oss:120b', source: 'cloud', availableLocally: true }
                ]
            }
        });

        const shadowRoot = getShadowRoot();
        const modelList = shadowRoot.querySelector('#availableModelList');
        const refreshButton = modelList.querySelector('.model-list-refresh');
        const tabs = Array.from(modelList.querySelectorAll('.model-list-tab'));
        const localItems = Array.from(modelList.querySelectorAll('.model-list-panel[data-panel="local"] .model-list-item'));
        const cloudItems = Array.from(modelList.querySelectorAll('.model-list-panel[data-panel="cloud"] .model-list-item'));
        const badge = modelList.querySelector('.model-list-panel[data-panel="cloud"] .model-list-item-badge');

        expect(refreshButton).not.toBeNull();
        expect(tabs.map(tab => tab.textContent.replace(/\s+/g, ' ').trim())).toEqual(['Local', 'Cloud 🗘']);
        expect(tabs.find(tab => tab.classList.contains('active'))?.dataset.tab).toBe('local');
        expect(localItems.map(item => item.dataset.modelName)).toEqual(['llama3.2']);
        expect(cloudItems.map(item => item.dataset.modelName)).toEqual(['gpt-oss:120b']);
        expect(badge?.textContent).toBe('Available locally');
        expect(modelList.classList.contains('invisible')).toBe(false);
    });

    it('refreshes the model catalogue on demand', async () => {
        await exports.fillAndShowModelList([
            { name: 'llama3.2', source: 'local' }
        ]);

        await exports.refreshCloudModelListBtnClick({
            preventDefault: vi.fn(),
            stopPropagation: vi.fn()
        });

        expect(getAndShowModels).toHaveBeenCalledWith(true);
    });

    it('switches to the cloud tab when clicked', async () => {
        await exports.fillAndShowModelList({
            groups: {
                local: [
                    { name: 'llama3.2', source: 'local' }
                ],
                cloud: [
                    { name: 'gpt-oss:120b', source: 'cloud', availableLocally: true }
                ]
            }
        });

        const shadowRoot = getShadowRoot();
        const cloudTab = shadowRoot.querySelector('.model-list-tab[data-tab="cloud"]');
        const localPanel = shadowRoot.querySelector('.model-list-panel[data-panel="local"]');
        const cloudPanel = shadowRoot.querySelector('.model-list-panel[data-panel="cloud"]');

        exports.modelListTabClicked({
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
            composedPath: () => [cloudTab]
        });

        expect(cloudTab.classList.contains('active')).toBe(true);
        expect(localPanel.classList.contains('invisible')).toBe(true);
        expect(cloudPanel.classList.contains('invisible')).toBe(false);
    });

    it('selects a model item through swapActiveModel', async () => {
        await exports.fillAndShowModelList({
            groups: {
                local: [
                    { name: 'llama3.2', source: 'local' }
                ],
                cloud: [
                    { name: 'gpt-oss:120b', source: 'cloud', availableLocally: true }
                ]
            }
        });

        const cloudItem = Array.from(getShadowRoot().querySelectorAll('.model-list-item'))
            .find(item => item.dataset.modelName === 'gpt-oss:120b');

        await cloudItem.dispatchEvent(
            new document.defaultView.MouseEvent('click', { bubbles: true })
        );

        expect(swapActiveModel).toHaveBeenCalled();
    });

    it('marks a stripped cloud catalogue entry as active when the stored model uses a cloud alias', async () => {
        getOptions = vi.fn(async () => ({ aiModel: 'gpt-oss:120b-cloud' }));
        exports = executeRibbonCode(
            document,
            getShadowRoot,
            getOptions,
            showMessage,
            { name: 'Local AI helper' },
            getLineNumber,
            closeAllDropDownRibbonMenus,
            swapActiveModel,
            getAndShowModels,
            deleteSessionById,
            updateStatusBar,
            resetStatusbar,
            recycleAllSessions
        );

        await exports.fillAndShowModelList({
            groups: {
                local: [
                    { name: 'llama3.2', source: 'local' }
                ],
                cloud: [
                    {
                        name: 'gpt-oss:120b',
                        source: 'cloud',
                        availableLocally: true,
                        matchNames: ['gpt-oss:120b', 'gpt-oss:120b-cloud']
                    }
                ]
            }
        });

        const shadowRoot = getShadowRoot();
        const activeTab = shadowRoot.querySelector('.model-list-tab.active');
        const activeCloudItem = shadowRoot.querySelector('.model-list-panel[data-panel="cloud"] .model-list-item.active-model-list-item');
        const selectedOption = shadowRoot.querySelector('#modelList').selectedOptions[0];

        expect(activeTab?.dataset.tab).toBe('cloud');
        expect(activeCloudItem?.dataset.modelName).toBe('gpt-oss:120b');
        expect(selectedOption?.value).toBe('gpt-oss:120b');
    });

    it('closes the session history menu when the last session row is deleted', async () => {
        const shadowRoot = getShadowRoot();
        const header = document.createElement('header');
        header.className = 'lai-header';
        const historyButton = document.createElement('img');
        historyButton.id = 'sessionHistory';
        historyButton.classList.add('js-menu-is-open');
        historyButton.dataset.menuId = 'sessionHistMenu';
        const menu = document.createElement('div');
        menu.id = 'sessionHistMenu';
        const scrollable = document.createElement('div');
        scrollable.className = 'scrollable';
        const menuItem = document.createElement('div');
        menuItem.className = 'menu-item';
        const title = document.createElement('span');
        title.className = 'menu-item-title';
        title.textContent = 'Only session';
        const deleteButton = document.createElement('span');
        deleteButton.setAttribute('data-sessionId', 'session-1');
        menuItem.appendChild(title);
        menuItem.appendChild(deleteButton);
        scrollable.appendChild(menuItem);
        menu.appendChild(scrollable);
        header.appendChild(historyButton);
        header.appendChild(menu);
        shadowRoot.appendChild(header);

        await exports.deleteHistoryMenuItemClicked({
            stopPropagation: vi.fn(),
            stopImmediatePropagation: vi.fn(),
            currentTarget: deleteButton
        });

        expect(deleteSessionById).toHaveBeenCalledWith('session-1');
        expect(header.querySelector('#sessionHistMenu')).toBeNull();
        expect(historyButton.classList.contains('js-menu-is-open')).toBe(false);
        expect(historyButton.dataset.menuId).toBeUndefined();
    });

    it('clears session history menu state after deleting all sessions', async () => {
        const shadowRoot = getShadowRoot();
        const header = document.createElement('header');
        header.className = 'lai-header';
        const historyButton = document.createElement('img');
        historyButton.id = 'sessionHistory';
        historyButton.classList.add('js-menu-is-open');
        historyButton.dataset.menuId = 'sessionHistMenu';
        const menu = document.createElement('div');
        menu.id = 'sessionHistMenu';
        const deleteAllItem = document.createElement('div');
        deleteAllItem.className = 'menu-item';
        menu.appendChild(deleteAllItem);
        header.appendChild(historyButton);
        header.appendChild(menu);
        shadowRoot.appendChild(header);

        await exports.deleteAllHistorySessionsClicked({
            composedPath: () => [deleteAllItem, menu, header, shadowRoot],
            stopImmediatePropagation: vi.fn(),
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
            target: deleteAllItem
        });

        expect(recycleAllSessions).toHaveBeenCalled();
        expect(header.querySelector('#sessionHistMenu')).toBeNull();
        expect(historyButton.classList.contains('js-menu-is-open')).toBe(false);
        expect(historyButton.dataset.menuId).toBeUndefined();
    });
});
