const manifest = chrome.runtime.getManifest();
const DONE = 'DONE';
const storageOptionKey = 'laiOptions';
const storageUserCommandsKey = 'aiUserCommands';
const activeSessionKey = 'activeSession';
const allSessionsStorageKey = 'aiSessions';
const activeSessionIndexStorageKey = 'activeSessionIndex';
const activePageStorageKey = 'activePage';
const commandPlaceholders = {
  "@{{page}}": "Include page into the prompt",
  "@{{dump}}": "Dump LLM response into the console",
  "@{{now}}": "Include current date and time",
  "@{{today}}": "Include current date without the time",
  "@{{time}}": "Include current time without the date"
};

var aiRawResponse = [];
var aiSessions = [];
var aiUserCommands = [];
var userCmdItemBtns = { 'edit': null, 'execute': null, 'paste': null, 'delete': null };
var images = [];
var attachments = [];
var userScrolled = false;
var isElementSelectionActive = false;
var dumpStream = false;
var lastRegisteredErrorMessage = [];
lastRegisteredErrorMessage.lastLength = 0;
var availableCommandsPlaceholders = ['@{{page}}', '@{{dump}}', '@{{now}}', '@{{today}}', '@{{time}}', '@{{help}}', '@{{?}}'];
var userPredefinedCmd = [
  { "commandName": "add", "commandDescription": "Create a new predefined prompt" },
  { "commandName": "edit(command_name)", "commandDescription": "Edit the command corresponding to name, provided in the brackets" },
  { "commandName": "error", "commandDescription": "Show last error" },
  { "commandName": "list", "commandDescription": "Show all defined commands" },
  { "commandName": "hooks", "commandDescription": "Show all defined hooks" },
  { "commandName": "dump", "commandDescription": "Dump AI raw content into the console" },
  { "commandName": "udump", "commandDescription": "Dump generated prompt including all data" }
];

document.addEventListener('DOMContentLoaded', async function (e) {
  // await allDOMContentLoaded(e);
  await start();
  chrome.storage.sync.get(null, items => {
    console.log(`>>> ${manifest.name} - [${getLineNumber()}] - Keys:`, Object.keys(items));
    console.log(`>>> ${manifest.name} - [${getLineNumber()}] - Raw:`, items);
  });
});

async function start() {
  if (document.readyState !== 'complete') {
    setTimeout(start, 1000);
  } else {
    await allDOMContentLoaded();
  }
}

async function allDOMContentLoaded(e) {
  await updateTabPageContentStorage();

  document.addEventListener('click', async function (event) {
    if (isElementSelectionActive) { laiGetClickedSelectedElement(event); }

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

    await laiSwapSidebarWithButton();
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
    await removeLocalStorageObject(activeSessionIndexStorageKey);
    await setActiveSessionPageData({"url": document.location.href, "pageContent": getPageTextContent()});
    await getAiUserCommands(); //TODO: remove it as global
  } catch (err) {
    console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${err.message}`, err);
    return;
  }

  init();
  try {
    await Promise.all(laiFetchStyles(['css/button.css', 'css/sidebar.css', 'css/aioutput.css', 'css/ribbon.css' ]));
  } catch (error) {
      console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Error loading one or more styles: ${error.message}`, error);
  }
}

async function updateTabPageContentStorage() {
  checkActiveTab();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {  checkActiveTab(); }
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
  console.debug(`>>> ${manifest.name} - [${getLineNumber()}] - window url before active check: ${location.href}`);

  checkActiveTab();
}

function checkActiveTab() {
  chrome.runtime.sendMessage({ action: "CHECK_ACTIVE_TAB" }, async (isActive) => {
    if (isActive) {
      console.debug(`>>> ${manifest.name} - [${getLineNumber()}] - window url after active check: ${location.href}`);
      await setActiveSessionPageData({ url: location.href, pageContent: getPageTextContent() });
    } else {
      console.debug(`>>> ${manifest.name} - [${getLineNumber()}] - tab is not active, skipping: ${location.href}`);
    }
  });
}

async function init() {
  try {
    if (!chrome.runtime.id) { chrome.runtime.reload(); }
    document.documentElement.querySelector('localAI')?.remove();
    document.querySelector('localAI')?.remove();

    const localAI = document.createElement('local-ai');
    localAI.id = "localAI";

    document.documentElement.appendChild(localAI);
    localAI.attachShadow({ "mode": 'open' });
    await buildMainButton();
    await laiFetchAndBuildSidebarContent();
    await initSidebar();
    await laiUpdateMainButtonStyles();
  } catch (err) {
    console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Error initiating the extension UI: ${err.message}`, err);
  }
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
  if (isImg) {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getImageBase64', url: el.src });
      if (chrome.runtime.lastError) { throw new Error(`${manifest.name} - [${getLineNumber()}] - chrome.runtime.lastError: ${chrome.runtime.lastError.message}`); }
      if (!response.base64) { throw new Error(`Failed to get the image from ${el.src}`); }

      images.push(response?.base64);
    showMessage('Image picked up successfully.', 'info')
    updateStatusBar('Selected image added to the context.');
      showAttachment(el.title || el.alt || el.src.split('/').pop());
    } catch (error) {
      showMessage(error.message);
    }
  } else {
    attachments.push(el.innerText ?? ''); // get the visible text only
    showAttachment(`${el?.innerText?.split(/\s+/)?.slice(0, 5).join(' ')}...` || 'Selected element');
    showMessage('Element picked up successfully.', 'info')
    updateStatusBar('Selected content added to the context.');
  }
}

async function buildMainButton() {
  var theMainButton = await createMainButtonElement();
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) { return; }
  shadowRoot.appendChild(theMainButton);
  theMainButton.addEventListener('click', async e => await laiMainButtonClicked(e));
  theMainButton.querySelector('div.close-semi-sphere-button')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.stopImmediatePropagation();
    const laiOptions = await getLaiOptions();
    theMainButton.classList.add('lai-faid-out');
    laiOptions.showEmbeddedButton = false;

    setTimeout(() => {
      theMainButton.classList.add('invisible');
      theMainButton.classList.remove('lai-faid-out');
    }, 200);
  });
}

async function createMainButtonElement() {
  const laiOptions = await getLaiOptions();
  if (!chrome.runtime.id && chrome.runtime.reload) { chrome.runtime.reload(); }
  if (!chrome.runtime.id) {
    console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Extension context invalidated. Please reload the tab.`);
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
  if (!chrome.runtime.id && chrome.runtime.reload) {
    chrome.runtime.reload();
  }
  if (!chrome.runtime.id) {
    console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Extension context invalidated. Please reload the tab.`);
    return;
  }

  try {
      const shadowRoot = getShadowRoot();
    if (!shadowRoot) {
        console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Failed to find the shadow root!`, shadowRoot);
        return;
      }

    const response = await fetch(chrome.runtime.getURL('sidebar.html'));
    const data = await response.text();

      var theSideBar = document.createElement('div');
      theSideBar.id = "laiSidebar";
      theSideBar.classList.add("lai-fixed-parent")
      theSideBar.innerHTML = data;
    theSideBar.style.zIndex = getHighestZIndex();

      shadowRoot.appendChild(theSideBar);
  } catch (error) {
    console.error(`>>> ${manifest.name} - [${getLineNumber()}] - Error loading the HTML: ${error.message}`, error);
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

function showMessage(messagesToShow, type) {
  if (!messagesToShow) { return; }
  if (!Array.isArray(messagesToShow)) { messagesToShow = [messagesToShow]; }
  messagesToShow = [...new Set(messagesToShow)];
  if (messagesToShow.length < 1) { return; }
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) { return; }
  const sideBar = getSideBar();
  if (!sideBar.classList.contains('active')) {
    setTimeout(async () => {  await laiSwapSidebarWithButton(); }, 0);
  }
  let msg = shadowRoot.querySelector('#feedbackMessage');
  let oldTimerId = msg.getAttribute('data-timerId');
  if (oldTimerId) {
    clearTimeout(parseInt(oldTimerId, 10));
  }

  const types = ['success', 'error', 'info', 'warning'];
  type = types.find(el => el === type) || 'info';

  for (let i = 0; i < messagesToShow.length; i++) {
    const msgText = document.createElement('p');
    msgText.textContent = messagesToShow[i];
    msg.appendChild(msgText);
  }

  msg.classList.remove('success', 'error', 'info', 'warning');
  msg.classList.add('feedback-message-active', type || 'info');
  const timerId = setTimeout(() => {
    if (type === 'error') {
      lastRegisteredErrorMessage = Array.from(msg.children).map(el => el.textContent);
    }
    handleErrorButton();
    msg.replaceChildren(); // clear the space
    msg.classList.remove('feedback-message-active');
  }, type === 'error' ? 7500 : 3000);
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
    console.error(`>>> ${manifest.name} - [${getLineNumber()}] - ${e.message}`, e);
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

function getLineNumber() {
  const e = new Error();
  return e.stack.split("\n")[2].trim().replace(/\s{0,}at (.+)/, "[$1]");
}