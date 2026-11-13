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
const modelListTabClickedCode = ribbonCode.match(/function modelListTabClicked\([\s\S]*?\n}\n/)[0];
const refreshCloudModelListBtnClickCode = ribbonCode.match(/async function refreshCloudModelListBtnClick\([\s\S]*?\n}\n/)[0];
const fillAndShowModelListCode = ribbonCode.match(/async function fillAndShowModelList\([\s\S]*?\n}\n/)[0];
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
    'getActiveSessionId',
    'reportTabBinding',
    `
${closeAllDropDownRibbonMenusCode}
${closeRibbonMenuElementCode}
${closeModelListMenuCode}
${modelListTabClickedCode}
${refreshCloudModelListBtnClickCode}
${fillAndShowModelListCode}
${deleteAllHistorySessionsClickedCode}

return { closeAllDropDownRibbonMenus, modelListTabClicked, refreshCloudModelListBtnClick, fillAndShowModelList, deleteAllHistorySessionsClicked };
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
    let getActiveSessionId;
    let reportTabBinding;
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
        getActiveSessionId = vi.fn(async () => null);
        reportTabBinding = vi.fn(async () => undefined);

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
            recycleAllSessions,
            getActiveSessionId,
            reportTabBinding
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

});

describe('ribbon.js sessions dialog (#64)', () => {
    const sessionHistoryClickedCode = ribbonCode.match(/async function sessionHistoryClicked\([\s\S]*?\n}\n/)[0];
    const popSessionListCode = ribbonCode.match(/async function popSessionList\([\s\S]*?\n}\n/)[0];
    const buildSessionListRowsCode = ribbonCode.match(/function buildSessionListRows\([\s\S]*?\n}\n/)[0];
    const showSessionListEmptyStateCode = ribbonCode.match(/function showSessionListEmptyState\([\s\S]*?\n}\n/)[0];
    const buildSessionListRowCode = ribbonCode.match(/function buildSessionListRow\([\s\S]*?\n}\n/)[0];
    const buildSessionListTitleButtonCode = ribbonCode.match(/function buildSessionListTitleButton\([\s\S]*?\n}\n/)[0];
    const buildSessionListActionButtonCode = ribbonCode.match(/function buildSessionListActionButton\([\s\S]*?\n}\n/)[0];
    const sessionListBlockClickedCode = ribbonCode.match(/async function sessionListBlockClicked\([\s\S]*?\n}\n/)[0];
    const loadSessionFromSessionListCode = ribbonCode.match(/async function loadSessionFromSessionList\([\s\S]*?\n}\n/)[0];
    const deleteSessionFromSessionListCode = ribbonCode.match(/async function deleteSessionFromSessionList\([\s\S]*?\n}\n/)[0];
    const sessionListDeleteAllClickedCode = ribbonCode.match(/function sessionListDeleteAllClicked\([\s\S]*?\n}\n/)[0];
    const sessionListDeleteAllCancelClickedCode = ribbonCode.match(/function sessionListDeleteAllCancelClicked\([\s\S]*?\n}\n/)[0];
    const hideSessionListDeleteAllConfirmCode = ribbonCode.match(/function hideSessionListDeleteAllConfirm\([\s\S]*?\n}\n/)[0];
    const sessionListKeydownCode = ribbonCode.match(/function sessionListKeydown\([\s\S]*?\n}\n/)[0];
    const closeSessionListOnOutsideClickCode = ribbonCode.match(/function closeSessionListOnOutsideClick\([\s\S]*?\n}\n/)[0];
    const closeSessionListDialogCode = ribbonCode.match(/function closeSessionListDialog\([\s\S]*?\n}\n/)[0];
    const startSessionRenameCode = ribbonCode.match(/async function startSessionRename\([\s\S]*?\n}\n/)[0];
    const setSessionRowAccessibleNamesCode = ribbonCode.match(/function setSessionRowAccessibleNames\([\s\S]*?\n}\n/)[0];
    const deleteAllHistorySessionsClickedCode = ribbonCode.match(/async function deleteAllHistorySessionsClicked\([\s\S]*?\n}\n/)[0];

    const sidebarHtmlCode = fs.readFileSync(path.join(__dirname, '../src/sidebar.html'), 'utf-8');

    const loadDialog = deps => new Function('deps', `with (deps) {
${sessionHistoryClickedCode}
${popSessionListCode}
${buildSessionListRowsCode}
${showSessionListEmptyStateCode}
${buildSessionListRowCode}
${buildSessionListTitleButtonCode}
${buildSessionListActionButtonCode}
${sessionListBlockClickedCode}
${loadSessionFromSessionListCode}
${deleteSessionFromSessionListCode}
${sessionListDeleteAllClickedCode}
${sessionListDeleteAllCancelClickedCode}
${hideSessionListDeleteAllConfirmCode}
${sessionListKeydownCode}
${closeSessionListOnOutsideClickCode}
${closeSessionListDialogCode}
${startSessionRenameCode}
${setSessionRowAccessibleNamesCode}
${deleteAllHistorySessionsClickedCode}
${closeAllDropDownRibbonMenusCode}
return { sessionHistoryClicked, popSessionList, sessionListBlockClicked, loadSessionFromSessionList, deleteSessionFromSessionList, sessionListDeleteAllClicked, sessionListDeleteAllCancelClicked, sessionListKeydown, closeSessionListOnOutsideClick, closeSessionListDialog, startSessionRename, deleteAllHistorySessionsClicked };
 }`)(deps);

    const buildDom = () => new JSDOM(`<!DOCTYPE html>
<div id="sidebar">
    <div id="sessionListContainer" class="invisible session-list">
        <div class="session-list-ribbon">
            <button id="sessionListDeleteAll" type="button">delete all</button>
            <button id="sessionListClose" type="button">close</button>
        </div>
        <div class="session-list-ribbon session-list-confirm invisible">
            <button id="sessionListDeleteAllConfirm" type="button">Delete</button>
            <button id="sessionListDeleteAllCancel" type="button">Cancel</button>
        </div>
        <div class="session-list-block"></div>
    </div>
</div>`);

    let exports;
    let doc;
    let deps;
    let sessions;
    let openSessionIds;
    let ownSessionId;
    let fetchOpenSessions;
    let restoreHistorySessionClicked;
    let deleteSessionById;
    let recycleAllSessions;
    let getActiveSessionId;
    let reportTabBinding;
    let renameSession;
    let showMessage;

    beforeEach(() => {
        doc = buildDom().window.document;
        sessions = [];
        openSessionIds = [];
        ownSessionId = null;
        fetchOpenSessions = vi.fn(async () => ({ openSessionIds, ownSessionId }));
        restoreHistorySessionClicked = vi.fn(async () => undefined);
        deleteSessionById = vi.fn(async () => undefined);
        recycleAllSessions = vi.fn(async () => undefined);
        getActiveSessionId = vi.fn(async () => 'session-current');
        reportTabBinding = vi.fn(async () => undefined);
        renameSession = vi.fn(async () => true);
        showMessage = vi.fn();
        deps = {
            document: doc,
            getShadowRoot: () => doc,
            fetchOpenSessions,
            getAllSessions: vi.fn(async () => sessions),
            restoreHistorySessionClicked,
            deleteSessionById,
            recycleAllSessions,
            getActiveSessionId,
            reportTabBinding,
            renameSession,
            updateStatusBar: vi.fn(),
            resetStatusbar: vi.fn(),
            showMessage,
            closeAllDropDownRibbonMenus: vi.fn(async () => undefined),
            manifest: { name: 'Local AI helper' },
            getLineNumber: () => 'test',
            chrome: { runtime: { getURL: path => `chrome-extension://test/${path}` } }
        };
        exports = loadDialog(deps);
    });

    const dialog = () => doc.getElementById('sessionListContainer');
    const rows = () => Array.from(doc.querySelectorAll('.session-list-item'));
    const rowAction = (row, action) => Array.from(row.querySelectorAll('button')).find(b => b.dataset.action === action);

    const openDialog = async () => {
        await exports.popSessionList();
    };

    const clickEvent = (button, row) => ({
        composedPath: () => [button, row, dialog().querySelector('.session-list-block'), dialog(), doc],
        stopPropagation: vi.fn()
    });

    it('orders sessions by last use, newest first, falling back to createdAt', async () => {
        sessions = [
            { id: 'old', title: 'Old', createdAt: 10 },
            { id: 'newest', title: 'Newest', lastAccessedAt: 300, createdAt: 1 },
            { id: 'mid', title: 'Mid', lastAccessedAt: 200, createdAt: 500 }
        ];
        await openDialog();

        expect(rows().map(row => row.dataset.sessionId)).toEqual(['newest', 'mid', 'old']);
    });

    it('tags rows current, open and closed and dims only closed rows', async () => {
        sessions = [
            { id: 'session-current', title: 'Mine' },
            { id: 'session-other-tab', title: 'Elsewhere' },
            { id: 'session-none', title: 'Shut' }
        ];
        openSessionIds = ['session-current', 'session-other-tab'];
        ownSessionId = 'session-current';
        await openDialog();

        const tags = rows().map(row => row.querySelector('.session-list-item-state').textContent);
        expect(tags).toEqual(['current', 'open', 'closed']);
        expect(rows()[2].classList.contains('session-list-item-closed')).toBe(true);
        expect(rows()[0].classList.contains('session-list-item-closed')).toBe(false);
        expect(rows()[1].classList.contains('session-list-item-closed')).toBe(false);
    });

    it('treats every session as closed when the open-session report fails', async () => {
        sessions = [{ id: 'session-current', title: 'Mine' }];
        deps.fetchOpenSessions = vi.fn(async () => { throw new Error('worker gone'); });
        exports = loadDialog(deps);

        await openDialog();

        const tags = rows().map(row => row.querySelector('.session-list-item-state').textContent);
        expect(tags).toEqual(['closed']);
        expect(rows()[0].classList.contains('session-list-item-closed')).toBe(true);
        expect(showMessage).not.toHaveBeenCalled();
    });

    it('shows the last page on the second line and keeps it empty for older sessions', async () => {
        sessions = [
            { id: 'with-page', title: 'Known', lastPage: { domain: 'example.com', title: 'A page' } },
            { id: 'without-page', title: 'Unknown' }
        ];
        await openDialog();

        const lines = rows().map(row => row.querySelector('.session-list-item-last-page'));
        expect(lines[0].textContent).toBe('example.com — A page');
        expect(lines[1].textContent).toBe('');
    });

    it('loads a session from the title or the load button and dismisses the dialog', async () => {
        sessions = [{ id: 'session-1', title: 'Target', messages: [{ role: 'user', content: 'hi' }] }];
        await openDialog();

        await exports.sessionListBlockClicked(clickEvent(rows()[0].querySelector('.session-list-item-title'), rows()[0]));

        expect(restoreHistorySessionClicked).toHaveBeenCalledWith(null, 'session-1');
        expect(dialog().classList.contains('invisible')).toBe(true);

        await openDialog();
        await exports.sessionListBlockClicked(clickEvent(rowAction(rows()[0], 'load'), rows()[0]));

        expect(restoreHistorySessionClicked).toHaveBeenCalledTimes(2);
        expect(dialog().classList.contains('invisible')).toBe(true);
    });

    it('keeps the dialog and shows a message when the session cannot be loaded', async () => {
        sessions = [{ id: 'session-1', title: 'Empty' }];
        await openDialog();

        await exports.sessionListBlockClicked(clickEvent(rows()[0].querySelector('.session-list-item-title'), rows()[0]));

        expect(restoreHistorySessionClicked).not.toHaveBeenCalled();
        expect(showMessage).toHaveBeenCalledWith('Session "Empty" could not be loaded.', 'error');
        expect(dialog().classList.contains('invisible')).toBe(false);
    });

    it('saves a rename with Enter and cancels it with Escape', async () => {
        sessions = [{ id: 'session-1', title: 'Before' }];
        await openDialog();
        const row = rows()[0];

        await exports.startSessionRename(row, 'session-1');
        const input = row.querySelector('.session-list-rename-input');
        expect(input).not.toBeNull();

        input.value = 'After';
        input.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await vi.waitFor(() => expect(row.querySelector('.session-list-rename-input')).toBeNull());

        expect(renameSession).toHaveBeenCalledWith('session-1', 'After');
        const title = row.querySelector('.session-list-item-title');
        expect(title.textContent).toBe('After');
        expect(title.getAttribute('aria-label')).toBe('Load session After');
        expect(rowAction(row, 'delete').getAttribute('aria-label')).toBe('Delete session After');
        expect(dialog().classList.contains('invisible')).toBe(false);
    });

    it('cancels only the rename with Escape, not the dialog', async () => {
        sessions = [{ id: 'session-1', title: 'Keep' }];
        await openDialog();
        const row = rows()[0];

        await exports.startSessionRename(row, 'session-1');
        const input = row.querySelector('.session-list-rename-input');
        input.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(renameSession).not.toHaveBeenCalled();
        expect(row.querySelector('.session-list-rename-input')).toBeNull();
        expect(row.querySelector('.session-list-item-title').textContent).toBe('Keep');
        expect(dialog().classList.contains('invisible')).toBe(false);
    });

    it('deletes a row and unbinds the tab when its own session is deleted', async () => {
        sessions = [
            { id: 'session-current', title: 'Mine' },
            { id: 'session-2', title: 'Other' }
        ];
        await openDialog();

        await exports.sessionListBlockClicked(clickEvent(rowAction(rows()[0], 'delete'), rows()[0]));

        expect(deleteSessionById).toHaveBeenCalledWith('session-current');
        expect(reportTabBinding).toHaveBeenCalledWith({ sessionId: null });
        expect(rows().map(row => row.dataset.sessionId)).toEqual(['session-2']);
        expect(dialog().classList.contains('invisible')).toBe(false);
    });

    it('shows the empty state when the last row is deleted', async () => {
        sessions = [{ id: 'session-1', title: 'Only' }];
        await openDialog();

        await exports.sessionListBlockClicked(clickEvent(rowAction(rows()[0], 'delete'), rows()[0]));

        expect(rows()).toHaveLength(0);
        expect(doc.querySelector('.session-list-empty').textContent).toBe('There are no saved sessions.');
    });

    it('asks for confirmation before deleting all sessions and cancels without deleting', async () => {
        sessions = [{ id: 'session-1', title: 'One' }];
        await openDialog();

        exports.sessionListDeleteAllClicked({ stopPropagation: vi.fn() });
        expect(dialog().querySelector('.session-list-confirm').classList.contains('invisible')).toBe(false);

        exports.sessionListDeleteAllCancelClicked({ stopPropagation: vi.fn() });
        expect(dialog().querySelector('.session-list-confirm').classList.contains('invisible')).toBe(true);
        expect(recycleAllSessions).not.toHaveBeenCalled();
        expect(rows()).toHaveLength(1);
    });

    it('deletes all sessions on confirmation and shows the empty state with the dialog open', async () => {
        sessions = [{ id: 'session-1', title: 'One' }];
        await openDialog();
        exports.sessionListDeleteAllClicked({ stopPropagation: vi.fn() });

        await exports.deleteAllHistorySessionsClicked({
            stopPropagation: vi.fn(),
            stopImmediatePropagation: vi.fn(),
            target: dialog().querySelector('#sessionListDeleteAllConfirm')
        });

        expect(recycleAllSessions).toHaveBeenCalled();
        expect(rows()).toHaveLength(0);
        expect(doc.querySelector('.session-list-empty')).not.toBeNull();
        expect(dialog().querySelector('.session-list-confirm').classList.contains('invisible')).toBe(true);
        expect(dialog().classList.contains('invisible')).toBe(false);
    });

    it('dismisses through the close button path, Escape and a click outside', async () => {
        sessions = [{ id: 'session-1', title: 'One' }];
        await openDialog();

        exports.sessionListKeydown({ key: 'Escape', stopPropagation: vi.fn() });
        expect(dialog().classList.contains('invisible')).toBe(true);

        await openDialog();
        exports.closeSessionListOnOutsideClick({
            composedPath: () => [doc.getElementById('sidebar'), doc]
        });
        expect(dialog().classList.contains('invisible')).toBe(true);

        await openDialog();
        exports.closeSessionListDialog();
        expect(dialog().classList.contains('invisible')).toBe(true);
    });

    it('ignores an outside click that originates from the dialog or the header button', async () => {
        sessions = [{ id: 'session-1', title: 'One' }];
        await openDialog();

        exports.closeSessionListOnOutsideClick({
            composedPath: () => [dialog().querySelector('.session-list-block'), dialog(), doc]
        });
        expect(dialog().classList.contains('invisible')).toBe(false);
    });

    it('opens the dialog from the header history button', async () => {
        sessions = [{ id: 'session-1', title: 'One' }];
        await exports.sessionHistoryClicked({ preventDefault: vi.fn(), stopPropagation: vi.fn(), target: {} });

        expect(dialog().classList.contains('invisible')).toBe(false);
        expect(rows()).toHaveLength(1);
    });

    it('shows the empty state when there are no saved sessions', async () => {
        sessions = [];
        await openDialog();

        expect(doc.querySelector('.session-list-empty').textContent).toBe('There are no saved sessions.');
        expect(dialog().classList.contains('invisible')).toBe(false);
    });

    it('builds every control as a button with an accessible name', async () => {
        sessions = [{ id: 'session-1', title: 'Named session' }];
        await openDialog();

        const row = rows()[0];
        const buttons = Array.from(row.querySelectorAll('button'));
        expect(buttons).toHaveLength(4);
        buttons.forEach(button => {
            expect(button.tagName).toBe('BUTTON');
            expect((button.getAttribute('aria-label') || '').trim()).not.toBe('');
        });
        expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([
            'Load session Named session',
            'Rename session Named session',
            'Load session Named session',
            'Delete session Named session'
        ]);

        ['sessionListDeleteAll', 'sessionListClose', 'sessionListDeleteAllConfirm', 'sessionListDeleteAllCancel'].forEach(id => {
            expect(sidebarHtmlCode).toMatch(new RegExp(`<button id="${id}"[^>]*>`));
        });
    });
});
describe('ribbon.js session restore', () => {
    const isRenderableSessionMessageCode = ribbonCode.match(/function isRenderableSessionMessage\([\s\S]*?\n}\n/)[0];
    const renderSessionHistoryMessageCode = ribbonCode.match(/async function renderSessionHistoryMessage\([\s\S]*?\n}\n/)[0];
    const renderSessionHistoryMessagesCode = ribbonCode.match(/async function renderSessionHistoryMessages\([\s\S]*?\n}\n/)[0];
    const restoreCode = ribbonCode.match(/async function restoreHistorySessionClicked\([\s\S]*?\n}\n/)[0];
    const laiMainCode = fs.readFileSync(path.join(__dirname, '../src/lai-main.js'), 'utf-8');
    const markdownSourceCode = laiMainCode.match(/function setMarkdownSource\([\s\S]*?\n}\n/)[0]
        + laiMainCode.match(/function getMarkdownSource\([\s\S]*?\n}\n/)[0];
    const renderUserPromptCardCode = laiMainCode.match(/async function renderUserPromptCard\([\s\S]*?\n}\n/)[0];

    it('keeps the stored Markdown of restored messages for Copy as Markdown', async () => {
        const dom = new JSDOM('<!DOCTYPE html><div id="laiChatMessageList"></div>');
        const doc = dom.window.document;
        const cards = [];
        const markdown = '## Heading\n\n- **item**\n\n```js\nconst a = 1;\n```';
        const deps = {
            getActiveSessionId: vi.fn(async () => 's1'),
            getActiveSessionById: vi.fn(async () => ({
                title: 'Restored',
                messages: [
                    { role: 'user', content: 'question' },
                    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'browse_url' } }] },
                    { role: 'tool', content: 'tool output' },
                    { role: 'assistant', content: markdown }
                ]
            })),
            setActiveSessionId: vi.fn(async () => undefined),
            reportTabBinding: vi.fn(async () => undefined),
            clearChatHistoryUI: vi.fn(),
            addInputCardToUIChatHistory: vi.fn(async () => {
                const el = doc.createElement('span');
                cards.push(el);
                return el;
            }),
            parseAndRender: vi.fn(async (text, el) => { el.innerHTML = '<h2>Heading</h2>'; }),
            getShadowRoot: () => doc,
            showMessage: vi.fn(),
            manifest: { name: 'Local AI helper' },
            getLineNumber: () => 'test'
        };

        const { restoreHistorySessionClicked, getMarkdownSource } = new Function('deps',
            `with (deps) { ${markdownSourceCode}\n${renderUserPromptCardCode}\n${isRenderableSessionMessageCode}\n${renderSessionHistoryMessageCode}\n${renderSessionHistoryMessagesCode}\n${restoreCode}\n return { restoreHistorySessionClicked, getMarkdownSource }; }`
        )(deps);

        await restoreHistorySessionClicked(null, 's1');

        expect(deps.reportTabBinding).toHaveBeenCalledWith({ sessionId: 's1' });

        expect(cards).toHaveLength(2);
        expect(getMarkdownSource(cards[0])).toBe('question');
        expect(getMarkdownSource(cards[1])).toBe(markdown);
    });

    it('restores silently for the automatic tab-session path', async () => {
        const dom = new JSDOM('<!DOCTYPE html><div id="laiChatMessageList"></div>');
        const doc = dom.window.document;
        const deps = {
            getActiveSessionId: vi.fn(async () => 's1'),
            getActiveSessionById: vi.fn(async () => ({ title: 'Restored', messages: [{ role: 'user', content: 'question' }] })),
            setActiveSessionId: vi.fn(async () => undefined),
            reportTabBinding: vi.fn(async () => undefined),
            setMarkdownSource: vi.fn(),
            clearChatHistoryUI: vi.fn(),
            addInputCardToUIChatHistory: vi.fn(async () => doc.createElement('span')),
            parseAndRender: vi.fn(async () => undefined),
            getShadowRoot: () => doc,
            showMessage: vi.fn(),
            manifest: { name: 'Local AI helper' },
            getLineNumber: () => 'test'
        };

        const { restoreHistorySessionClicked } = new Function('deps',
            `with (deps) { ${renderUserPromptCardCode}\n${isRenderableSessionMessageCode}\n${renderSessionHistoryMessageCode}\n${renderSessionHistoryMessagesCode}\n${restoreCode}\n return { restoreHistorySessionClicked }; }`
        )(deps);

        await restoreHistorySessionClicked(null, 's1', { silent: true });

        expect(deps.showMessage).not.toHaveBeenCalled();
    });
});

describe('ribbon.js model capability refresh', () => {
    const onModelOptionsChangedCode = ribbonCode.match(/function onModelOptionsChanged\([\s\S]*?\n}\n/)[0];
    const adjustThinkingStatusCode = ribbonCode.match(/async function adjustThinkingStatus\([\s\S]*?\n}\n/)[0];
    const adjustToolsStatusCode = ribbonCode.match(/async function adjustToolsStatus\([\s\S]*?\n}\n/)[0];

    const buildExports = (deps) => new Function('deps',
        `with (deps) { ${onModelOptionsChangedCode}\n${adjustThinkingStatusCode}\n${adjustToolsStatusCode}\n return { onModelOptionsChanged, adjustThinkingStatus, adjustToolsStatus }; }`
    )(deps);

    const baseDeps = () => ({
        storageOptionKey: 'laiOptions',
        setModelNameLabel: vi.fn(),
        scheduleModelCapabilityRefresh: vi.fn(),
        getAiModel: vi.fn(async () => 'llama3.2'),
        modelCanUseToolsHelper: vi.fn(async () => true),
        modelCanThinkHelper: vi.fn(async () => true),
        getShadowRoot: vi.fn(() => null),
        updateStatusBar: vi.fn(),
        resetStatusbar: vi.fn()
    });

    const makeElement = () => new JSDOM('<!DOCTYPE html><body></body>').window.document.createElement('img');

    it('ignores option changes in a non-sync storage area', () => {
        const deps = baseDeps();
        const { onModelOptionsChanged } = buildExports(deps);

        const result = onModelOptionsChanged({ laiOptions: { oldValue: { aiModel: 'a' }, newValue: { aiModel: 'b' } } }, 'local');

        expect(result).toBe(false);
        expect(deps.setModelNameLabel).not.toHaveBeenCalled();
        expect(deps.scheduleModelCapabilityRefresh).not.toHaveBeenCalled();
    });

    it('ignores storage changes that do not touch the options key', () => {
        const deps = baseDeps();
        const { onModelOptionsChanged } = buildExports(deps);

        const result = onModelOptionsChanged({ someOtherKey: { newValue: { aiModel: 'b' } } }, 'sync');

        expect(result).toBe(false);
        expect(deps.setModelNameLabel).not.toHaveBeenCalled();
        expect(deps.scheduleModelCapabilityRefresh).not.toHaveBeenCalled();
    });

    it('ignores unrelated option writes', () => {
        const deps = baseDeps();
        const { onModelOptionsChanged } = buildExports(deps);

        const result = onModelOptionsChanged({
            laiOptions: { oldValue: { aiModel: 'a', aiUrl: 'u', debug: false }, newValue: { aiModel: 'a', aiUrl: 'u', debug: true } }
        }, 'sync');

        expect(result).toBe(false);
        expect(deps.setModelNameLabel).not.toHaveBeenCalled();
        expect(deps.scheduleModelCapabilityRefresh).not.toHaveBeenCalled();
    });

    it('refreshes the label and the switches when the model changes', () => {
        const deps = baseDeps();
        const { onModelOptionsChanged } = buildExports(deps);

        const result = onModelOptionsChanged({
            laiOptions: { oldValue: { aiModel: 'a', aiUrl: 'u' }, newValue: { aiModel: 'b', aiUrl: 'u' } }
        }, 'sync');

        expect(result).toBe(true);
        expect(deps.setModelNameLabel).toHaveBeenCalledWith({ model: 'b' });
        expect(deps.scheduleModelCapabilityRefresh).toHaveBeenCalledTimes(1);
    });

    it('refreshes when the options are written for the first time', () => {
        const deps = baseDeps();
        const { onModelOptionsChanged } = buildExports(deps);

        const result = onModelOptionsChanged({
            laiOptions: { newValue: { aiModel: 'b', aiUrl: 'u' } }
        }, 'sync');

        expect(result).toBe(true);
        expect(deps.setModelNameLabel).toHaveBeenCalledWith({ model: 'b' });
        expect(deps.scheduleModelCapabilityRefresh).toHaveBeenCalledTimes(1);
    });

    it('refreshes when only the endpoint changes', () => {
        const deps = baseDeps();
        const { onModelOptionsChanged } = buildExports(deps);

        const result = onModelOptionsChanged({
            laiOptions: { oldValue: { aiModel: 'a', aiUrl: 'http://one' }, newValue: { aiModel: 'a', aiUrl: 'http://two' } }
        }, 'sync');

        expect(result).toBe(true);
        expect(deps.scheduleModelCapabilityRefresh).toHaveBeenCalledTimes(1);
    });

    it('enables the tools switch for a capable model', async () => {
        const deps = baseDeps();
        const { adjustToolsStatus } = buildExports(deps);
        const el = makeElement();
        el.classList.add('disabled');

        await adjustToolsStatus(el, { suppressStatusBar: true });

        expect(el.classList.contains('disabled')).toBe(false);
        expect(el.title).toBe('Disable System Tool Functions');
        expect(el.alt).toBe('Disable System Tool Functions');
        expect(deps.updateStatusBar).not.toHaveBeenCalled();
    });

    it('disables the tools switch for a non-capable model', async () => {
        const deps = baseDeps();
        deps.modelCanUseToolsHelper = vi.fn(async () => false);
        const { adjustToolsStatus } = buildExports(deps);
        const el = makeElement();

        await adjustToolsStatus(el, { suppressStatusBar: true });

        expect(el.classList.contains('disabled')).toBe(true);
        expect(el.title).toBe('Enable System Tool Functions');
        expect(el.alt).toBe('Enable System Tool Functions');
    });

    it('keeps the tools switch untouched when the model changed while probing', async () => {
        const deps = baseDeps();
        deps.getAiModel = vi.fn()
            .mockResolvedValueOnce('a')
            .mockResolvedValueOnce('b');
        const { adjustToolsStatus } = buildExports(deps);
        const el = makeElement();
        el.classList.add('disabled');

        await adjustToolsStatus(el, { suppressStatusBar: true });

        expect(el.classList.contains('disabled')).toBe(true);
        expect(el.title).toBe('');
    });

    it('enables the thinking switch for a capable model', async () => {
        const deps = baseDeps();
        const { adjustThinkingStatus } = buildExports(deps);
        const el = makeElement();
        el.classList.add('disabled');

        await adjustThinkingStatus(el, { suppressStatusBar: true });

        expect(el.classList.contains('disabled')).toBe(false);
    });

    it('disables the thinking switch for a non-capable model', async () => {
        const deps = baseDeps();
        deps.modelCanThinkHelper = vi.fn(async () => false);
        const { adjustThinkingStatus } = buildExports(deps);
        const el = makeElement();

        await adjustThinkingStatus(el, { suppressStatusBar: true });

        expect(el.classList.contains('disabled')).toBe(true);
    });

    it('keeps the thinking switch untouched when the model changed while probing', async () => {
        const deps = baseDeps();
        deps.getAiModel = vi.fn()
            .mockResolvedValueOnce('a')
            .mockResolvedValueOnce('b');
        const { adjustThinkingStatus } = buildExports(deps);
        const el = makeElement();
        el.classList.add('disabled');

        await adjustThinkingStatus(el, { suppressStatusBar: true });

        expect(el.classList.contains('disabled')).toBe(true);
    });
});

describe('ribbon.js restored user prompts (#41)', () => {
    const laiMainCode = fs.readFileSync(path.join(__dirname, '../src/lai-main.js'), 'utf-8');
    const tabStateCode = fs.readFileSync(path.join(__dirname, '../src/jslib/tab-state.js'), 'utf-8');
    const utilsCode = fs.readFileSync(path.join(__dirname, '../src/jslib/utils.js'), 'utf-8');
    const isMessagePersistableCode = utilsCode.match(/function isMessagePersistable\([\s\S]*?\n}\n/)[0];
    const solomdCode = fs.readFileSync(path.join(__dirname, '../src/jslib/solomd2html.js'), 'utf-8');
    const isRenderableSessionMessageCode = ribbonCode.match(/function isRenderableSessionMessage\([\s\S]*?\n}\n/)[0];
    const renderSessionHistoryMessageCode = ribbonCode.match(/async function renderSessionHistoryMessage\([\s\S]*?\n}\n/)[0];
    const renderSessionHistoryMessagesCode = ribbonCode.match(/async function renderSessionHistoryMessages\([\s\S]*?\n}\n/)[0];

    const loadParser = () => new Function(
        'document',
        'DocumentFragment',
        'CustomEvent',
        'Node',
        'navigator',
        solomdCode + '; return parseAndRender;'
    )(global.document, global.window.DocumentFragment, global.window.CustomEvent, global.window.Node, global.navigator);
    const executeRestore = new Function('document', 'window', 'manifest', 'chrome', 'getLineNumber', 'isMessagePersistable',
        tabStateCode + '\n' + isMessagePersistableCode + '\nconst checkExtensionState = () => true;\nlet aiUserCommands = [];\n' +
        isRenderableSessionMessageCode + '\n' + renderSessionHistoryMessageCode + '\n' + renderSessionHistoryMessagesCode + '\n' +
        laiMainCode +
        '; return { renderUserPromptCard, editUserInput, renderSessionHistoryMessages };'
    );

    let renderUserPromptCard, editUserInput, renderSessionHistoryMessages;

    beforeEach(() => {
        global.getLineNumber = () => 'test:1';
        global.showMessage = vi.fn();
        global.getShadowRoot = vi.fn(() => document);
        global.getSideBar = vi.fn(() => document.body);
        global.getOptions = vi.fn(async () => ({}));
        global.getActiveSession = vi.fn(async () => null);
        global.setActiveSession = vi.fn(async () => {});
        global.deleteActiveSession = vi.fn(async () => {});
        global.reportTabBinding = vi.fn(async () => {});
        global.parseAndRender = loadParser();
        global.chrome = { runtime: { sendMessage: vi.fn(), onMessage: { addListener: vi.fn() }, getURL: path => `chrome-extension://test/${path}` } };

        document.body.innerHTML = `
            <div id="panel">
                <div id="laiChatMessageList"></div>
                <textarea id="laiUserInput"></textarea>
            </div>
            <div id="laiCopyHint" class="invisible"></div>
        `;

        ({ renderUserPromptCard, editUserInput, renderSessionHistoryMessages } =
            executeRestore(global.document, global.window, global.manifest, global.chrome, global.getLineNumber, global.isMessagePersistable));
    });

    it('renders a restored user prompt identically to a fresh submission', async () => {
        const md = '## Heading\n\n- item\n\n**bold** and `code`\n\n```\nfenced\n```';
        const fresh = await renderUserPromptCard(md);

        await renderSessionHistoryMessages({ messages: [{ role: 'user', content: md }] });

        const restored = document.querySelector('.lai-user-input .lai-input-text');
        expect(restored.innerHTML).toBe(fresh.innerHTML);
        expect(restored.querySelector('h2').textContent).toBe('Heading');
    });

    it('keeps the assistant path and returns the original Markdown through Edit after restore', async () => {
        const original = 'Explain\n\nthis  \n- **item**  \n\nend `code`';
        await renderSessionHistoryMessages({
            messages: [
                { role: 'user', content: original },
                { role: 'assistant', content: 'Answer **here**' }
            ]
        });

        const assistantText = document.querySelector('.lai-ai-input .lai-input-text');
        expect(assistantText.querySelector('p strong').textContent).toBe('here');

        const userCard = document.querySelector('.lai-user-input');
        await editUserInput({ target: userCard.querySelector('[data-type="edit"]') }, 'user');

        expect(document.getElementById('laiUserInput').value).toBe(original);
    });
});
