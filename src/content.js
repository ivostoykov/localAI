const commandPlaceholders = {
  "@{{page}}": "Include page into the prompt",
  "@{{dump}}": "Dump LLM response into the console",
  "@{{now}}": "Include current date and time",
  "@{{today}}": "Include current date without the time",
  "@{{time}}": "Include current time without the date",
  "@{{debug}}": "Enable debug logging",
  "@{{nodebug}}": "Disable debug logging",
  "@{{tools}}": "Switch tools on",
  "@{{notools}}": "Switch tools off"
};
var aiUserCommands = [];
var userCmdItemBtns = { 'edit': null, 'execute': null, 'paste': null, 'delete': null };
var userScrolled = false;
var isElementSelectionActive = false;
var lastRegisteredErrorMessage = [];
lastRegisteredErrorMessage.lastLength = 0;
var availableCommandsPlaceholders = ['@{{page}}', '@{{dump}}', '@{{now}}', '@{{today}}', '@{{time}}', '@{{debug}}', '@{{nodebug}}', '@{{help}}', '@{{?}}'];
var userPredefinedCmd = [
  { "commandName": "add", "commandDescription": "Create a new predefined prompt" },
  { "commandName": "edit(command_name)", "commandDescription": "Edit the command corresponding to name, provided in the brackets" },
  { "commandName": "error", "commandDescription": "Show last error" },
  { "commandName": "model", "commandDescription": "Show model info" },
  { "commandName": "lastMessage", "commandDescription": "Show last message" },
  { "commandName": "list", "commandDescription": "Show all defined commands" },
  { "commandName": "tools", "commandDescription": "Switch tools on (temporary)" },
  { "commandName": "notools", "commandDescription": "Switch tools off (temporary)" },
  { "commandName": "debug", "commandDescription": "Enable debug logging (temporary)" },
  { "commandName": "nodebug", "commandDescription": "Disable debug logging (temporary)" },
  { "commandName": "pin", "commandDescription": "Toggle panel pin" }
];

function getRootElement() { return document.documentElement.querySelector('localAI') || document.getElementById('localAI'); }
function getShadowRoot() { return getRootElement()?.shadowRoot; }
function getSideBar() { return getShadowRoot()?.getElementById('laiSidebar'); }
function getMainButton() { return getShadowRoot()?.getElementById('laiMainButton'); }
function getRibbon() { return getShadowRoot()?.querySelector('div.lai-ribbon'); }
function getActiveModel() {
  const ribbon = getRibbon()
  return ribbon.querySelector('#laiModelName')?.textContent;
}

chrome.runtime.onMessage.addListener(onRuntimeMessage);

document.addEventListener('DOMContentLoaded', async (e) => await start());

async function start() {
  if (document.readyState !== 'complete') {
    setTimeout(start, 1000);
  } else {
    await allDOMContentLoaded();
  }
}

async function allDOMContentLoaded(e) {
  Array.from(document.getElementsByTagName('local-ai'))?.forEach(el => el?.remove());

  await updateTabPageContentStorage();
  attachElementSelectionListenersToFrames();

  document.addEventListener('click', async function (event) {
    closeQuickPromptListMenu(event);
    if (isElementSelectionActive) {
      getSelectedClickedElement(event);
    }

    await closeAllDropDownRibbonMenus(event);
    const localAI = document.getElementById('localAI');
    if (localAI === event.target) { return; }
    const laiShadowRoot = localAI?.shadowRoot
    if (!laiShadowRoot) { return; }
    const pluginContainer = laiShadowRoot.getElementById('laiSidebar');

    if (!pluginContainer) { return; }
    if (pluginContainer.contains(event.target)) { return; }
    if (window.innerWidth - pluginContainer.getBoundingClientRect().right < 0) {
      return;
    }

    const options = await getOptions()
    if (options.closeOnClickOut && !isPinned()) { await laiSwapSidebarWithButton(event); }
  }, true);

  document.addEventListener('keydown', async function (e) {
    if (isElementSelectionActive) {
      if (e.key === "Escape") {
        isElementSelectionActive = false;
        clearAllElementDecorations();
        return;
      }
    }

    if (e.key !== "Escape") { return; }
    const laiOptions = await getOptions()
    if (!laiOptions.closeOnClickOut) { return; }

    const pluginContainer = document.getElementById('localAI')?.shadowRoot?.getElementById('laiSidebar');

    if (window.innerWidth - pluginContainer.getBoundingClientRect().right < 0) {
      return;
    }

    await laiSwapSidebarWithButton();
  }, true);

  document.addEventListener('mouseover', function (event) {
    if (!isElementSelectionActive) { return; }
    const el = event.target
    const currentBorder = el.style.border;
    el.setAttribute('data-original-border', currentBorder);
    el.style.border = "5px double lime";
  }, true);

  document.addEventListener('mouseout', clearElementOverDecoration, true);

  try {
    await removeLocalStorageObject('activeSessionIndex'); // TODO: for sync - to be removed
    await removeLocalStorageObject(activeSessionIdStorageKey);
    await setActiveSessionPageData();
    await getAiUserCommands(); //TODO: remove it as global
  } catch (err) {
    console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${err.message}`, err);
    return;
  }

  init();
  try {
    const cssList = manifest?.web_accessible_resources?.map(el => el?.resources)?.flat()?.filter(el => el?.endsWith('css'))
      ?? ['css/button.css', 'css/sidebar.css', 'css/aioutput.css', 'css/ribbon.css'];
    await Promise.all(laiFetchStyles(cssList));
  } catch (error) {
    console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error loading one or more styles: ${error.message}`, error);
  }
}

if ('navigation' in window) {
    window.addEventListener("popstate", triggerUpdate);
    window.addEventListener("pushstate", triggerUpdate);
    window.addEventListener("replacestate", triggerUpdate);
    navigation.addEventListener('navigate', async () => {
        await setActiveSessionPageData();
    });
}

function attachElementSelectionListenersToFrames() {
  const frames = document.querySelectorAll('iframe, frame');
  frames.forEach((frame) => {
    frame.addEventListener('load', () => {
      try {
        const doc = frame?.contentWindow?.document;
        if(!doc || !doc.addEventListener){  return;  }

        doc.addEventListener('mouseover', function (event) {
          if (!isElementSelectionActive) return;
          const el = event.target;
          const currentBorder = el.style.border;
          el.setAttribute('data-original-border', currentBorder);
          el.style.border = "5px double lime";
        }, true);

        doc.addEventListener('mouseout', function (event) {
          if (!isElementSelectionActive) return;
          const el = event.target;
          const original = el.getAttribute('data-original-border') || '';
          el.style.border = original;
        }, true);

        doc.addEventListener('click', function (event) {
          if (isElementSelectionActive) {
            getSelectedClickedElement(event);
          }
        }, true);

      } catch (e) {
        console.log('Access denied to frame!', e);
      }
    });
  });
}

async function updateTabPageContentStorage() {
  ['pushState', 'replaceState'].forEach(type => {
    const orig = history[type];
    history[type] = function (...args) {
      const result = orig.apply(this, args);
      window.dispatchEvent(new Event(type.toLowerCase()));
      return result;
    };
  });
}

function triggerUpdate() {
  console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - window url before active check: ${location.href}`);
}

async function init() {
  try {
    if (!chrome.runtime.id) { chrome.runtime.reload(); }
    document.documentElement.querySelector('localAI')?.remove();
    document.querySelector('localAI')?.remove();

    const localAI = document.createElement('local-ai');
    localAI.id = "localAI";
    localAI.dataset.intance = Date.now();
    const style = document.createElement('style');
    style.textContent = `
        #localAI {
            all: initial;
            box-sizing: border-box;
            font-family: system-ui, sans-serif;
            font-size: 16px;
            color: black;
            text-size-adjust: none;
            -webkit-text-size-adjust: none;
            -moz-text-size-adjust: none;
            -ms-text-size-adjust: none;
            position: fixed; /* or relative, your choice */
            z-index: 2147483647; /* high enough for UI */
        }
    `;
    localAI.appendChild(style);

    document.documentElement.appendChild(localAI);
    localAI.attachShadow({ "mode": 'open' });
    await buildMainButton();
    await laiFetchAndBuildSidebarContent();
    await initSidebar();
    await laiUpdateMainButtonStyles();
  } catch (err) {
    console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error initiating the extension UI: ${err.message}`, err);
  }
}

// Main orchestrator - coordinates the page content workflow
async function getPageTextContent() {
  const cleanedDOM = await getDocumentContentFiltered();
  return await getExtractedFilteredContent(cleanedDOM);
}

async function getExtractedFilteredContent(cleanedDOM) {
  const structure = extractTextStructure(cleanedDOM);
  const result = formatPageContent(structure);
  // console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - page:\n ${result}`);
  return result;
}

async function getDocumentContentFiltered() {
  const domClone = await removeElementsBySelectors();
  removeAllExtensionInjectedElements(domClone);
  return domClone;
}

function removeAllExtensionInjectedElements(domClone) {
  try {
    Array.from(domClone.querySelectorAll('*')).forEach(el => {
      if (
        el.tagName.includes('-') ||
        Array.from(el.attributes).some(attr =>
          attr.value.includes('chrome-extension://') ||
          attr.value.includes('moz-extension://')
        )
      ) {
        el.remove();
      }
    });
  } catch (err) {
    console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}]`, err);
  }
}

async function removeElementsBySelectors() {
  const filterConfig = await loadFilteringConfig();
  const selectors = filterConfig?.selectors ?? null;
  const domClone = document.body.cloneNode(true);
  if(!filterConfig?.enabled || !selectors){ return domClone;  }


  try {
    Array.from(domClone.attributes).forEach(attr => {
      domClone.removeAttribute(attr.name);
    });

    domClone
      .querySelectorAll(selectors.join(','))
      .forEach(e => e.remove());

  } catch (err) {
    console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}]`, err);
  }
  console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - after cleaning`, domClone);
  return domClone;
}

function getARIAContext(element, rootElement) {
  if (!element || !element.attributes) return '';

  if (element.getAttribute('aria-hidden') === 'true') {
    return null;
  }

  const textAriaAttrs = ['aria-label', 'aria-labelledby', 'aria-describedby', 'aria-description'];

  const relevantAttrs = Array.from(element.attributes)
    .filter(attr => textAriaAttrs.includes(attr.name));

  if (relevantAttrs.length < 1) return '';

  const parts = [];

  for (const attr of relevantAttrs) {
    const name = attr.name;
    if (!name) { continue; }
    const value = attr.value.trim();
    if (!value) { continue; }

    try {
      switch (name) {
        case 'aria-label':
        case 'aria-description':
          parts.push(`${name}: ${value}`);
          break;

        case 'aria-labelledby':
        case 'aria-describedby':
          if (!rootElement) { continue; }
          const refElement = rootElement.querySelector(`#${CSS.escape(value)}`);
          const refText = refElement?.textContent.trim();
          if (refText) {
            parts.push(`${name}: ${refText}`);
          }
          break;
      }
    } catch (err) {
      console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - ${err.message}`, { element, rootElement, err });
    }
  }

  return parts.length > 0 ? `[${parts.join('; ')}] ` : '';
}

// Extract text with hierarchical structure
function extractTextStructure(domClone) {
  const structure = [];
  const headings = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
  let currentSection = { title: '', content: [] };

  const walker = document.createTreeWalker(
    domClone,
    NodeFilter.SHOW_TEXT
  );

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!hasVisibleText(node)) continue;

    const parent = node.parentElement;
    const parentTag = parent?.tagName || '';
    let text = node.nodeValue.trim();

    text = text.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    if (!text) continue;

    const ariaContext = getARIAContext(parent, domClone);
    if (ariaContext === null) continue; // Skip aria-hidden elements

    if (ariaContext) {  text = ariaContext + text;  }

    if (headings.includes(parentTag)) {
      if (currentSection.content.length) structure.push(currentSection);
      currentSection = { title: text, content: [] };
    } else {
      currentSection.content.push(text);
    }
  }

  if (currentSection.content.length) structure.push(currentSection);
  return structure;
}

function hasVisibleText(node) {
  if (!node?.nodeValue || !/[^\n\r\t ]/.test(node.nodeValue)) {
    return false;
  }

  const parent = node.parentElement;
  if (!parent) {  return false;  }

  const parentTag = parent.tagName?.toLowerCase();
  if (parentTag === 'script' || parentTag === 'style' || parentTag === 'noscript') {
    return false;
  }

  let element = parent;
  while (element && element !== document.body) {
    if (element.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    element = element.parentElement;
  }

  const computedStyle = window.getComputedStyle(parent);
  if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') {
    return false;
  }

  return true;
}

function formatPageContent(structure) {
  const formattedSections = structure.map(section => {
    const title = section.title ? `\n\n## ${section.title}\n` : '';
    return `${title}${section.content.join('\n')}`;
  }).join('\n');

  return `PAGE URL: ${document.location.href}\nPAGE CONTENT START:${formattedSections}\nPAGE CONTENT END`;
}

async function loadFilteringConfig() {
  try {
    const stored = await chrome.storage.sync.get('laiOptions');
    const options = stored.laiOptions || {};

    const enabled = options.contentFilteringEnabled ?? true;
    const defaultSelectors = options.defaultSelectors || '';
    const siteSpecificRules = options.siteSpecificSelectors || '';

    if (!defaultSelectors) {
      console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - defaultSelectors is empty! No default filtering will be applied.`);
    }

    const selectors = defaultSelectors.split(',').map(s => s.trim()).filter(s => s);

    const hostname = window.location.hostname;
    const siteRules = parseSiteSpecificSelectors(siteSpecificRules, hostname);
    if (siteRules.length > 0) {
      selectors.push(...siteRules);
    }

    return {
      enabled,
      selectors
    };
  } catch (e) {
    console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error loading filtering config:`, e);
    return {
      enabled: true,
      selectors: []
    };
  }
}

function parseSiteSpecificSelectors(siteSpecificRules, hostname) {
  if (!siteSpecificRules || !hostname) { return []; }

  const lines = siteSpecificRules.split('\n');
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) { continue; }

    const colonIndex = trimmedLine.indexOf(':');
    if (colonIndex < 0) { continue; }

    const domain = trimmedLine.substring(0, colonIndex).trim();
    const selectorsStr = trimmedLine.substring(colonIndex + 1).trim();

    if (hostname.includes(domain)) {
      return selectorsStr.split(',').map(s => s.trim()).filter(s => s);
    }
  }

  return [];
}

function clearElementOverDecoration(e) {
  let el = e.target;
  const currentBorder = el.getAttribute('data-original-border') || '';
  el.style.border = currentBorder;
  el.removeAttribute('data-original-border');
}

function clearAllElementDecorations() {
  document.querySelectorAll('[data-original-border]').forEach(el => {
    const original = el.getAttribute('data-original-border') || '';
    el.style.border = original;
    el.removeAttribute('data-original-border');
  });
}

async function getSelectedClickedElement(event) {
  let el = event.target;
  isElementSelectionActive = false;
  clearAllElementDecorations();
  let isImg = el.tagName === 'IMG';
  let theAttachment;
  if (isImg) {
    showMessage('Right-click the image and select "Copy image", then paste it into the input field (Ctrl+V).', 'info');
  } else {
    const filters = await loadFilteringConfig();
    // const content = el.innerText?.trim() || '';
    const content = await getExtractedFilteredContent(el, filters);
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Selected element content:\n${content}`);
    if (!content) {
      showMessage('Selected element has no visible text.', 'warn');
      return;
    }
    theAttachment = {
      id: crypto.randomUUID(),
      type: "snippet",
      content: `SNIPPET START:\n${content}\nSNIPPET END`,
      filename: 'Selected Element'
    };
    await addAttachment(theAttachment);
    showAttachment(theAttachment);
    showMessage('Element picked up successfully.', 'info')
    updateStatusBar('Selected content added to the context.');
  }
}

async function buildMainButton() {
  var theMainButton = await createMainButtonElement();
  if (!theMainButton) {
    console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to create main button element.`);
    return;
  }
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) { return; }
  shadowRoot.appendChild(theMainButton);
  theMainButton.addEventListener('click', async e => await laiMainButtonClicked(e));
  theMainButton.querySelector('div.close-semi-sphere-button')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.stopImmediatePropagation();
    const laiOptions = await getOptions();
    theMainButton.classList.add('lai-fade-out');
    laiOptions.showEmbeddedButton = false;

    setTimeout(() => {
      theMainButton.classList.add('invisible');
      theMainButton.classList.remove('lai-fade-out');
    }, 200);
  });
}

async function createMainButtonElement() {
  const laiOptions = await getOptions();
  reloadRuntime();
  if (!chrome?.runtime?.id) {
    console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Extension context invalidated. Please reload the tab.`);
    return;
  }
  var theMainButton = Object.assign(document.createElement('div'), {
    id: "laiMainButton",
    className: `lai-semi-sphere-button ${laiOptions.showEmbeddedButton ? '' : 'invisible'}`,
    title: "Click to open the panel.",
  });

  theMainButton.style.zIndex = getHighestZIndex();
  const img = document.createElement('img');
  img.src = chrome.runtime.getURL('img/icon128.svg');
  img.style.display = 'none';
  img.classList.add('img-btn');
  theMainButton.appendChild(img);

  setTimeout(() => {
    img.style.display = '';
  }, 1000);

  var btnClose = Object.assign(document.createElement('div'), {
    id: "laiCloseMainButton",
    className: 'close-semi-sphere-button',
    title: "Remove the button for this session.",
    textContent: '✖'
  });
  theMainButton.appendChild(btnClose);

  return theMainButton;
}

async function laiMainButtonClicked(e) {
  e.preventDefault();
  await laiSwapSidebarWithButton();
  return false;
}

async function laiFetchAndBuildSidebarContent() {
  reloadRuntime();

  try {
    if (!chrome.runtime.id) { throw new Error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Extension context invalidated. Please reload the tab.`); }

    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { throw new Error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to find the shadow root!`); }

    const response = await fetch(chrome.runtime.getURL('sidebar.html'));
    const data = await response.text();

    var theSideBar = document.createElement('div');
    theSideBar.id = "laiSidebar";
    theSideBar.classList.add("lai-fixed-parent")
    theSideBar.innerHTML = data;
    theSideBar.style.zIndex = getHighestZIndex();

    shadowRoot.appendChild(theSideBar);
  } catch (error) {
    console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error loading the HTML: ${error.message}`, error);
  }
}

function laiFetchStyles(cssNames) {
  if (!checkExtensionState()) { return; }
  if (!cssNames) { return; }
  if (!Array.isArray(cssNames)) { cssNames = [cssNames]; }

  return cssNames.map(cssName =>
    fetch(chrome.runtime.getURL(cssName))
      .then(response => response.text())
      .then(data => {
        const shadowRoot = getShadowRoot();
        if (!shadowRoot) { return; }
        const styleElement = document.createElement('style');
        styleElement.innerHTML = data;
        styleElement.id = cssName.split('.')[0];
        shadowRoot.appendChild(styleElement);
        return true;
      })
  );
}

function laiSetImg(el) {
  if (!checkExtensionState()) { return; }
  const name = el?.getAttribute('data-type')?.toLowerCase();
  if (name) {
    el.src = chrome.runtime.getURL(`img/${name}.svg`);
  }
}

function showMessage(messagesToShow, type, timeout) {
  if (!messagesToShow) { return; }
  if (!Array.isArray(messagesToShow)) { messagesToShow = [messagesToShow]; }
  messagesToShow = [...new Set(messagesToShow)];
  if (messagesToShow.length < 1) { return; }
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) { return; }
  const sideBar = getSideBar();
  if (!sideBar) {
    console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - showMessage: sidebar element not found.`);
    return;
  }
  if (!sideBar.classList.contains('active')) {
    setTimeout(() => {
      laiSwapSidebarWithButton()
        .catch(error => {
          console.error(
            `>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error opening sidebar for message: ${error.message}`,
            error
          );
        });
    }, 0);
  }
  let msg = shadowRoot.querySelector('#feedbackMessage');
  let msgHistory = JSON.parse(msg?.dataset?.history ?? "[]");
  if (msgHistory && !Array.isArray(msgHistory)) { msgHistory = [msgHistory]; }
  let oldTimerId = msg.getAttribute('data-timerId');
  if (oldTimerId) {
    clearTimeout(parseInt(oldTimerId, 10));
  }

  const types = ['success', 'error', 'info', 'warning'];
  type = types.find(el => el === type) || 'info';
  if(!timeout){  timeout = type === 'error' ? 7500 : 3000;  }

  for (let i = 0; i < messagesToShow.length; i++) {
    const msgText = document.createElement('p');
    msgText.textContent = messagesToShow[i];
    msgHistory.push(`${type}: ${messagesToShow[i]}`);
    msg.appendChild(msgText);
  }

  msgHistory = [...new Set(msgHistory)];
  msg.dataset.history = JSON.stringify(msgHistory);

  msg.classList.remove('success', 'error', 'info', 'warning');
  msg.classList.add('feedback-message-active', type || 'info');
  const timerId = setTimeout(() => {
    if (type === 'error') {
      lastRegisteredErrorMessage = Array.from(msg.children).map(el => el.textContent);
    }
    handleErrorButton();
    msg.replaceChildren();
    msg.classList.remove('feedback-message-active');
  }, timeout);
  if (timerId) {
    msg.setAttribute('data-timerId', timerId);
  }
}

async function buildMenuDropdowns() {
  const shadowRoot = getShadowRoot();
  const menuDropDowns = shadowRoot.querySelectorAll('#cogMenu select');
  const laiOptions = await getOptions();
  for (let i = 0; i < menuDropDowns.length; i++) {
    const list = menuDropDowns[i];
    const selectOption = list.querySelectorAll('option')[0];
    list.replaceChildren();
    list.appendChild(selectOption);
    list.selectedIndex = 0;
    let data = list.getAttribute('data-source');
    if (!data) { continue; }
    try { data = JSON.parse(data); }
    catch (e) { continue; }
    if (!laiOptions?.[data?.list]) { return; }
    laiOptions[data?.list]?.forEach(m => {
      const option = document.createElement('option');
      option.value = option.text = m;
      if (m === laiOptions[data?.selected]) { option.selected = true; }
      list.appendChild(option);
    });
  }
}

function handleErrorButton() {
  if (lastRegisteredErrorMessage.length === lastRegisteredErrorMessage.lastLength) { return; }
  const shadowRoot = getShadowRoot();
  const errorBtn = shadowRoot.querySelector('#errorMsgBtn');
  if (!errorBtn) { return; }
  if (lastRegisteredErrorMessage.length > 0) {
    errorBtn.classList.remove('invisible');
  } else {
    errorBtn.classList.add('invisible');
  }

  lastRegisteredErrorMessage.lastLength = lastRegisteredErrorMessage.length;
}