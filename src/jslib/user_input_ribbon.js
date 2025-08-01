async function quickPromptClicked(e) {
    e.stopImmediatePropagation();
    e.stopPropagation();

    const shadowRoot = getShadowRoot();
    shadowRoot.querySelector('.prompt-menu')?.remove();

    const tmpl = shadowRoot.querySelector('#promptMenuTemplate');
    const clone = tmpl.content.cloneNode(true);
    shadowRoot.appendChild(clone);

    const menu = shadowRoot.querySelector('.prompt-menu');
    await buildPromptList(menu?.querySelector('.dynamic-prompt-list'));

    const searchInput = menu.querySelector('.search-input')
    searchInput?.addEventListener('input', quickPromptFilterChanged);
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
    searchInput?.focus();

}

async function buildPromptList(list) {
    if (!list) {
        console.error(`${manifest?.name ?? "Extension"} - [${getLineNumber()}]: Dynamic prompt list not found!`);
        return;
    }

    const cmd = await getAiUserCommands();
    cmd?.forEach(c => {
        const promptDiv = document.createElement('div')
        promptDiv.textContent = c.commandName ?? 'Unknown';
        promptDiv.addEventListener('click', async e => await insertClickedPrompt(e, promptDiv));
        list.appendChild(promptDiv);
    });
}

async function insertClickedPrompt(e, promptDiv) {
    const cmd = await getAiUserCommands();
    let prompt = cmd.find(el => el.commandName === promptDiv?.textContent?.trim());
    prompt = prompt?.commandBody ?? 'Unknown';
    const shadowRoot = getShadowRoot();
    const userInput = shadowRoot.querySelector('#laiUserInput')
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
    setTimeout(resetStatusbar(), 2000);
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
    const menu = shadowRoot.querySelector('.prompt-menu');
    menu.remove();
}

function eraseUserInputArea(e) {
    const shadowRoot = getShadowRoot();
    const userInput = shadowRoot.querySelector('#laiUserInput')
    userInput.value = '';
    updateStatusBar("User input area updated.");
    setTimeout(resetStatusbar(), 2000);
    userInput.focus();
}

function closeQuickPromptListMenu(e) {
    const path = e.composedPath();
    if (path[0].classList?.contains('input-controls-container')) { return; }
    if (path.some(el => el.classList?.contains('dynamic-prompt-list'))) { return; }

    const shadowRoot = getShadowRoot();
    const menu = shadowRoot.querySelector('.prompt-menu');
    if (!menu) { return; }
    if(e.composedPath()?.some(el => el?.classList?.contains?.('lai-user-area'))) {  return;  }
    if (!path.includes(menu)) { removeQuickPromptMenu(e); }
}