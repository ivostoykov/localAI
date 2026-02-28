async function quickPromptClicked(e) {
    e.stopImmediatePropagation();
    e.stopPropagation();

    const shadowRoot = getShadowRoot();
    if (!shadowRoot) {
        console.error(`${manifest?.name ?? "Extension"} - [${getLineNumber()}]: Shadow root not found!`);
        return;
    }

    shadowRoot.querySelector('.prompt-menu')?.remove();

    const tmpl = shadowRoot.querySelector('#promptMenuTemplate');
    if (!tmpl) {
        console.error(`${manifest?.name ?? "Extension"} - [${getLineNumber()}]: Prompt menu template not found!`);
        return;
    }

    const clone = tmpl.content.cloneNode(true);
    shadowRoot.appendChild(clone);

    const menu = shadowRoot.querySelector('.prompt-menu');
    if (!menu) {
        console.error(`${manifest?.name ?? "Extension"} - [${getLineNumber()}]: Prompt menu not found!`);
        return;
    }

    await buildPromptList(menu.querySelector('.dynamic-prompt-list'));

    const searchInput = menu.querySelector('.search-input')
    if (!searchInput) {
        console.error(`${manifest?.name ?? "Extension"} - [${getLineNumber()}]: Search input not found!`);
        return;
    }

    searchInput.addEventListener('input', quickPromptFilterChanged);
    searchInput.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            e.preventDefault();
            removeQuickPromptMenu(e);
        }
    });
    menu.querySelector('.clear-btn')?.addEventListener('click', clearBtnClicked);
    menu.querySelector('.bottom-cmd')?.addEventListener('click', quickPromptBtnClicked);

    menu.style.left = `${e.clientX + 20}px`;
    menu.style.zIndex = getHighestZIndex();

    menu.classList.remove('invisible');
    searchInput.focus();

}

async function buildPromptList(list) {
    if (!list) {
        console.error(`${manifest?.name ?? "Extension"} - [${getLineNumber()}]: Dynamic prompt list not found!`);
        return;
    }

    const cmd = await getAiUserCommands();
    cmd?.forEach((c, index) => {
        const promptDiv = document.createElement('div')
        promptDiv.textContent = c.commandName ?? 'Unknown';
        promptDiv.dataset.index = index;
        promptDiv.addEventListener('click', async e => await insertClickedPrompt(e, promptDiv));
        list.appendChild(promptDiv);
    });
}

async function insertClickedPrompt(e, promptDiv) {
    const cmd = await getAiUserCommands();
    const index = parseInt(promptDiv?.dataset?.index, 10);
    let prompt = cmd?.[index]?.commandBody ?? 'Unknown';
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) {
        console.error(`${manifest?.name ?? "Extension"} - [${getLineNumber()}]: Shadow root not found!`);
        return;
    }

    const userInput = shadowRoot.querySelector('#laiUserInput')
    if (!userInput) {
        console.error(`${manifest?.name ?? "Extension"} - [${getLineNumber()}]: User input not found!`);
        return;
    }

    userInput.value = prompt;
    userInput.focus();
    removeQuickPromptMenu(e);
}

function quickPromptFilterChanged(e) {
    const input = e.target;
    const promptMenu = input.closest('.prompt-menu');
    const pronptListItems = Array.from(promptMenu.querySelector('.dynamic-prompt-list')?.children);
    const clearBtn = input.parentElement.querySelector('.clear-btn');
    const val = input.value.trim().toLowerCase();
    if (val) {
        clearBtn?.classList.remove('invisible');
        pronptListItems.forEach(el => {
            if (el.textContent.toLowerCase().indexOf(val) < 0) {
                el.classList.add('invisible');
            } else {
                el.classList.remove('invisible');
            }
        });
    } else {
        clearBtn?.classList.add('invisible');
        removeQuickPromptListFilter(e);
    }
}

function libraryBtnClicked(e) {
    e.stopImmediatePropagation();
    e.stopPropagation();
    updateStatusBar("Library is empty.");
    setTimeout(resetStatusbar, 2000);
}

function removeQuickPromptListFilter(e) {
    const promptMenu = e.target.closest('.prompt-menu');
    const pronptListItems = Array.from(promptMenu.querySelector('.dynamic-prompt-list')?.children);
    pronptListItems.forEach(el => el.classList.remove('invisible'));
}

function clearBtnClicked(e) {
    e.target.classList.add('invisible');
    removeQuickPromptListFilter(e);
    const input = e.target.parentElement.querySelector('input');
    input.value = '';
    input.focus();
}

function quickPromptBtnClicked(e) {
    popUserCommandList();
    removeQuickPromptMenu(e);
}

function removeQuickPromptMenu(e) {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) {
        console.error(`${manifest?.name ?? "Extension"} - [${getLineNumber()}]: Shadow root not found!`);
        return;
    }

    const menu = shadowRoot.querySelector('.prompt-menu');
    if (!menu) {
        return;
    }

    menu.remove();
}

function eraseUserInputArea(e) {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) {
        console.error(`${manifest?.name ?? "Extension"} - [${getLineNumber()}]: Shadow root not found!`);
        return;
    }

    const userInput = shadowRoot.querySelector('#laiUserInput')
    if (!userInput) {
        console.error(`${manifest?.name ?? "Extension"} - [${getLineNumber()}]: User input not found!`);
        return;
    }

    userInput.value = '';
    updateStatusBar("User input area updated.");
    setTimeout(resetStatusbar, 2000);
    userInput.focus();
}

function closeQuickPromptListMenu(e) {
    const path = e.composedPath();
    if (path[0].classList?.contains('input-controls-container')) { return; }
    if (path.some(el => el.classList?.contains('dynamic-prompt-list'))) { return; }

    const shadowRoot = getShadowRoot();
    const menu = shadowRoot?.querySelector('.prompt-menu');
    if (!menu) { return; }
    if(e.composedPath()?.some(el => el?.classList?.contains?.('lai-user-area'))) {  return;  }
    if (!path.includes(menu)) { removeQuickPromptMenu(e); }
}

async function debugBtnClicked(e){
    let el = e.composedPath()[0]
    await toggleDebug();
    el = el.tagName === 'IMG' ? el.closest('button') : e.target;
    await debugBtnInit(el);
}

async function pageFilterBtnInit() {
    const shadowRoot = getShadowRoot();
    const el = shadowRoot?.querySelector('#pageFilterBtn');
    if (!el) {
        console.error(`${manifest?.name ?? ""} - [${getLineNumber()}]: Page filter button not found!`);
        return;
    }
    const options = await getOptions();
    el.textContent = (options.contentFilteringEnabled ?? true) ? 'text' : 'html';
}

async function pageFilterBtnClicked(e) {
    let el;
    try {
        if(e){  el = e?.composedPath()?.[0];  }
        else {
            const shadowRoot = getShadowRoot();
            el = shadowRoot?.querySelector('#pageFilterBtn');
        }
        if (!el) {
            console.error(`${manifest?.name ?? ""} - [${getLineNumber()}]: Page filter button not found!`, e?.composedPath());
            return;
        }

        const label = el?.textContent?.trim()?.toLowerCase();
        el.textContent = label === 'html' ? 'text' : 'html';
        const options = await getOptions();
        options["contentFilteringEnabled"] = el?.textContent?.trim()?.toLowerCase() === 'text';
        await setOptions(options);
    } catch (err) {
        console.error(`${manifest?.name ?? ""} - [${getLineNumber()}]: Page filter button error - ${err.message}!`, err);
    }
}

async function handlePageFilterCommand(cmd = ''){
    const options = await getOptions();
    const isContentFilteringEnabled = options.contentFilteringEnabled ?? true;
    if(isContentFilteringEnabled && cmd === "pagetext"){  return;  }
    if(!isContentFilteringEnabled && cmd === "rawpage"){  return;  }
    await pageFilterBtnClicked(null);
}

async function debugBtnInit(btn){
    const options = await getOptions();
    const debug = options?.debug ?? false;
    const debugImg = btn.querySelector('img[data-type="debug"]');
    const noDebugImg = btn.querySelector('img[data-type="nodebug"]');

    if(debug){
        debugImg.classList.remove('invisible');
        noDebugImg.classList.add('invisible');
    } else {
        noDebugImg.classList.remove('invisible');
        debugImg.classList.add('invisible');
    }
}
