const manifest = chrome.runtime.getManifest();
const EXT_NAME = manifest?.name ?? 'Unknown';
const storageOptionKey = 'laiOptions';
const storageUserCommandsKey = 'aiUserCommands';
const activeSessionKey = 'activeSession';
const allSessionsStorageKey = 'aiSessions';
const activeSessionIdStorageKey = 'activeSessionId';
const activePageStorageKey = 'activePage';
const commandPlaceholders = {
  "@{{page}}": "Include page into the prompt",
  "@{{dump}}": "Dump LLM response into the console",
  "@{{now}}": "Include current date and time",
  "@{{today}}": "Include current date without the time",
  "@{{time}}": "Include current time without the date"
};

var aiUserCommands = [];
var userCmdItemBtns = { 'edit': null, 'execute': null, 'paste': null, 'delete': null };
var images = [];
var userScrolled = false;
var isElementSelectionActive = false;
var lastRegisteredErrorMessage = [];
lastRegisteredErrorMessage.lastLength = 0;
var availableCommandsPlaceholders = ['@{{page}}', '@{{dump}}', '@{{now}}', '@{{today}}', '@{{time}}', '@{{help}}', '@{{?}}'];
var userPredefinedCmd = [
  { "commandName": "add", "commandDescription": "Create a new predefined prompt" },
  { "commandName": "edit(command_name)", "commandDescription": "Edit the command corresponding to name, provided in the brackets" },
  { "commandName": "error", "commandDescription": "Show last error" },
  { "commandName": "model", "commandDescription": "Show model info" },
  { "commandName": "lastMessage", "commandDescription": "Show last message" },
  { "commandName": "list", "commandDescription": "Show all defined commands" }
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

window.addEventListener('message', async (event) => {
  if (event.source !== window) { return; }
  if (event.data?.type === 'reconnect' && event.data.name === EXT_NAME) {
    Array.from(document.getElementsByTagName('local-ai'))?.forEach(el => el?.remove());

    console.debug(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Message received will try to reconnect...`);

    const ready = await waitForStorageReady();
    if (!ready) { return; }

    allDOMContentLoaded(event);

    showMessage('Extension reloaded', 'success');
    console.debug(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Extension reloaded.`);
  }
});

async function waitForStorageReady(timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await chrome.storage.local.get(null);
      return true;
    } catch {
      await new Promise(res => setTimeout(res, 100));
    }
  }
  return false;
}

//------------------------

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
      laiGetClickedSelectedElement(event);
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

    const options = await getLaiOptions()
    if (options.closeOnClickOut && !isPinned()) { await laiSwapSidebarWithButton(event); }
  }, true);

  document.addEventListener('keydown', async function (e) {
    if (isElementSelectionActive) {
      if (e.key === "Escape") {
        isElementSelectionActive = false;
        document.querySelectorAll(`[data-original-border]`)?.forEach(el => {
          const currentBorder = el.getAttribute('data-original-border');
          el.style.border = currentBorder;
          el.removeAttribute('data-original-border');
        });
        return;
      }
    }

    if (e.key !== "Escape") { return; }
    const laiOptions = await getLaiOptions()
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
    await setActiveSessionPageData({ "url": document.location.href, "pageContent": await getPageTextContent() });
    await getAiUserCommands(); //TODO: remove it as global
  } catch (err) {
    console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${err.message}`, err);
    return;
  }

  init();
  try {
    const cssList = manifest?.web_accessible_resources?.map(el => el?.resources)?.flat()?.filter(el => el?.endsWith('css'))
      ?? ['css/button.css', 'css/sidebar.css', 'css/aioutput.css', 'css/ribbon.css'];
    await Promise.all(laiFetchStyles(cssList));
    // await Promise.all(laiFetchStyles(['css/button.css', 'css/sidebar.css', 'css/aioutput.css', 'css/ribbon.css']));
  } catch (error) {
    console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Error loading one or more styles: ${error.message}`, error);
  }
}

function attachElementSelectionListenersToFrames() {
  const frames = document.querySelectorAll('iframe, frame');
  frames.forEach((frame) => {
    frame.addEventListener('load', () => {
      try {
        const doc = frame.contentWindow.document;

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
            laiGetClickedSelectedElement(event);
          }
        }, true);

      } catch (e) {
        console.warn('Access denied to frame:', e);
      }
    });
  });
}

async function updateTabPageContentStorage() {
  checkActiveTab();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { checkActiveTab(); }
  });

  ['pushState', 'replaceState'].forEach(type => {
    const orig = history[type];
    history[type] = function (...args) {
      const result = orig.apply(this, args);
      window.dispatchEvent(new Event(type.toLowerCase()));
      return result;
    };
  });

  if (!('navigation' in window)) {
    window.addEventListener("popstate", triggerUpdate);
    window.addEventListener("pushstate", triggerUpdate); // only if patched manually
    window.addEventListener("replacestate", triggerUpdate); // only if patched manually
  }
}

function triggerUpdate() {
  console.debug(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - window url before active check: ${location.href}`);

  checkActiveTab();
}

function checkActiveTab() {
  try {
    chrome.runtime.sendMessage({ action: "CHECK_ACTIVE_TAB" }, async (isActive) => {
      if (isActive) {
        await setActiveSessionPageData({ url: location.href, pageContent: await getPageTextContent() });
      } else {
        console.debug(`>>> ${manifest?.name || 'unknown'} - [${getLineNumber()}] - tab is not active, skipping: ${location.href}`);
      }
    });
  } catch (err) {
    console.warn(`>>> ${manifest?.name || 'unknown'} - [${getLineNumber()}] - checkActiveTab failed:`, err);
  }
}

async function init() {
  try {
    if (!chrome.runtime.id) { chrome.runtime.reload(); }
    document.documentElement.querySelector('localAI')?.remove();
    document.querySelector('localAI')?.remove();

    const localAI = document.createElement('local-ai');
    localAI.id = "localAI";
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
    console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Error initiating the extension UI: ${err.message}`, err);
  }
}

// Main orchestrator - coordinates the page content workflow
async function getPageTextContent() {
  const startChildCount = document.body.childNodes.length;
  console.log(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Starting page content extraction - DOM children: ${startChildCount}`);

  const bodyClone = document.body.cloneNode(true);
  const filterConfig = await loadFilteringConfig();
  const cleanedDOM = applyContentFiltering(bodyClone, filterConfig);
  const structure = extractTextStructure(cleanedDOM);
  const result = formatPageContent(structure);

  console.log(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Finished - output: ${result.length} chars`);

  return result;
}

function applyContentFiltering(domClone, filterConfig) {
  // 1. First remove default selectors (script, style, etc.)
  if (filterConfig.enabled && filterConfig.selectors) {
    removeElementsBySelectors(domClone, filterConfig.selectors);
  }

  // 2. Then remove extension-injected elements
  removeAllExtensionInjectedElements(domClone);

  return domClone;
}

function removeAllExtensionInjectedElements(domClone) {
  const extensionUrlElements = domClone.querySelectorAll('[src^="chrome-extension://"], [href^="chrome-extension://"], [src^="moz-extension://"], [href^="moz-extension://"]');
  extensionUrlElements.forEach(el => el.remove());

  // 2. Remove custom elements (likely extension-injected)
  const customElements = Array.from(domClone.querySelectorAll('*'))
    .filter(el => el.tagName.includes('-'));
  customElements.forEach(el => el.remove());

  const localAiElements = domClone.querySelectorAll('local-ai');
  localAiElements.forEach(el => el.remove());
}

function removeElementsBySelectors(domClone, selectors) {
  selectors.forEach(selector => {
    try {
      const elements = domClone.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    } catch (e) {
      console.warn(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Invalid selector: ${selector}`, e);
    }
  });
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

    const parentTag = node.parentElement?.tagName || '';
    let text = node.nodeValue.trim();

    // Strip CDATA markers if present
    text = text.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    if (!text) continue;

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

// Check if node has visible text and is still connected to the DOM
function hasVisibleText(node) {
  if (!node?.nodeValue || !/[^\n\r\t ]/.test(node.nodeValue)) {
    return false;
  }

  // Ensure the node's parent still exists in the tree (not detached)
  if (!node.parentElement) {
    return false;
  }

  return true;
}

// Format the final output
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
    const defaultSelectors = options.defaultSelectors || getDefaultSelectors();
    const siteSpecificRules = options.siteSpecificSelectors || '';

    // Parse default selectors (comma-separated)
    const selectors = defaultSelectors.split(',').map(s => s.trim()).filter(s => s);

    // Parse site-specific selectors
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
    console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Error loading filtering config:`, e);
    return {
      enabled: true,
      selectors: getDefaultSelectors().split(',').map(s => s.trim()).filter(s => s)
    };
  }
}

function getDefaultSelectors() {
  return "nav,header,footer,aside,iframe,[role='navigation'],[role='banner'],[role='contentinfo'],.advertisement,.ad,.cookie-notice,.social-share,.comments,.related-posts";
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

async function laiGetClickedSelectedElement(event) {
  isElementSelectionActive = false;
  clearElementOverDecoration(event);
  let el = event.target;
  let isImg = el.tagName === 'IMG';
  let theAttachment;
  if (isImg) {
    // TODO: add image to the attachments with type image
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getImageBase64', url: el.src });
      if (chrome.runtime.lastError) { throw new Error(`${manifest?.name || 'Unknown'} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
      if (!response.base64) { throw new Error(`Failed to get the image from ${el.src}`); }

      images.push(response?.base64);
      showMessage('Image picked up successfully.', 'info')
      updateStatusBar('Selected image added to the context.');
      showAttachment(el.title || el.alt || el.src.split('/').pop());
    } catch (error) {
      showMessage(error.message);
    }
  } else {
    theAttachment = {
      id: crypto.randomUUID(),
      type: "snippet",
      content: el.innerText ?? '',
      sourceUrl: location.href
    };
    await addAttachment(theAttachment);
    showAttachment(theAttachment);
    showMessage('Element picked up successfully.', 'info')
    updateStatusBar('Selected content added to the context.');
  }
}

async function buildMainButton() {
  var theMainButton = await createMainButtonElement();
  // Guard against createMainButtonElement returning nothing
  if (!theMainButton) {
    console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Failed to create main button element.`);
    return;
  }
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) { return; }
  shadowRoot.appendChild(theMainButton);
  theMainButton.addEventListener('click', async e => await laiMainButtonClicked(e));
  theMainButton.querySelector('div.close-semi-sphere-button')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.stopImmediatePropagation();
    const laiOptions = await getLaiOptions();
    theMainButton.classList.add('lai-fade-out');
    laiOptions.showEmbeddedButton = false;

    setTimeout(() => {
      theMainButton.classList.add('invisible');
      theMainButton.classList.remove('lai-fade-out');
    }, 200);
  });
}

async function createMainButtonElement() {
  const laiOptions = await getLaiOptions();
  reloadRuntime();
  if (!chrome?.runtime?.id) {
    console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Extension context invalidated. Please reload the tab.`);
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
    if (!chrome.runtime.id) { throw new Error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Extension context invalidated. Please reload the tab.`); }

    const shadowRoot = getShadowRoot();
    if (!shadowRoot) { throw new Error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Failed to find the shadow root!`); }

    const response = await fetch(chrome.runtime.getURL('sidebar.html'));
    const data = await response.text();

    var theSideBar = document.createElement('div');
    theSideBar.id = "laiSidebar";
    theSideBar.classList.add("lai-fixed-parent")
    theSideBar.innerHTML = data;
    theSideBar.style.zIndex = getHighestZIndex();

    shadowRoot.appendChild(theSideBar);
  } catch (error) {
    console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Error loading the HTML: ${error.message}`, error);
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
  // Ensure sidebar element exists before using it
  if (!sideBar) {
    console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - showMessage: sidebar element not found.`);
    return;
  }
  if (!sideBar.classList.contains('active')) {
    // Ensure sidebar is opened to show messages; catch errors to avoid silent failures
    setTimeout(() => {
      laiSwapSidebarWithButton()
        .catch(error => {
          console.error(
            `>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - Error opening sidebar for message: ${error.message}`,
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
    msg.replaceChildren(); // clear the space
    msg.classList.remove('feedback-message-active');
  }, timeout ?? type === 'error' ? 7500 : 3000);
  if (timerId) {
    msg.setAttribute('data-timerId', timerId);
  }
}

async function buildMenuDropdowns() {
  const shadowRoot = getShadowRoot();
  const menuDropDowns = shadowRoot.querySelectorAll('#cogMenu select');
  const laiOptions = await getLaiOptions();
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

async function getLaiOptions() {
  const defaults = {
    "openPanelOnLoad": false,
    "aiUrl": "",
    "aiModel": "",
    "closeOnClickOut": true,
    "closeOnCopy": false,
    "closeOnSendTo": true,
    "showEmbeddedButton": false,
    "loadHistoryOnStart": false,
    "systemInstructions": 'You are a helpful assistant.',
    "personalInfo": ''
  };

  try {
    const obj = await getOptions();
    const laiOptions = Object.assign({}, defaults, obj ?? {});
    return laiOptions;
  } catch (e) {
    console.error(`>>> ${manifest?.name || 'Unknown'} - [${getLineNumber()}] - ${e.message}`, e);
    // Inform the user and fall back to defaults
    try {
      showMessage(`Error loading options: ${e.message}. Using default settings.`, 'error');
    } catch (_) {
      // ignore if UI not yet ready
    }
    return defaults;
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