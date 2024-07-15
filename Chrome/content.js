var DONE = 'DONE';
var laiOptions = {};
var aiSessions = [];
var aiUserCommands = [];
var userCmdItemBtns = {'edit':null, 'execute': null, 'paste': null, 'delete': null};
var activeSessionIndex = 0;
var messages = [];
var attachments = [];
var userScrolled = false;
var isElementSelectionActive = false;
var dumpStream = false;
var lastRegisteredErrorMessage = [];
lastRegisteredErrorMessage.lastLength = 0;
var availableCommandsPlaceholders = ['@{{page}}', '@{{dump}}', '@{{now}}', '@{{today}}', '@{{time}}', '@{{help}}', '@{{?}}'];
const commandPlacehoders = {
  "@{{page}}": "Include page into the prompt",
  "@{{dump}}": "Dump LLM response into the console",
  "@{{now}}": "Include current date and time",
  "@{{today}}": "Include cuddent date without the time",
  "@{{time}}": "Include current time without the date"
};
var userPredefinedCmd = [
  {"commandName": "add", "commandDescription":"Create a new predefined prompt"},
  {"commandName": "edit(command_name)", "commandDescription":"Edit the command corresponding to name, provided in the brackets"},
  {"commandName": "error", "commandDescription":"Show last error"},
  {"commandName":"list", "commandDescription":"Show all defined commands"}
];

document.addEventListener('DOMContentLoaded', async function (e) {

  document.addEventListener('click', function (event) {
    hideSessionHistoryMenu();
    if(isElementSelectionActive) {  laiGetClickedSelectedElement(event);  }

    const localAI = document.getElementById('localAI');
    if(localAI === event.target){  return;  }
    const laiShadowRoot = localAI?.shadowRoot
    if(!laiShadowRoot){  return;  }
    const pluginContainer = laiShadowRoot.getElementById('laiSidebar');

    if (!pluginContainer) { return; }
    if (pluginContainer.contains(event.target)) { return; }
    if (window.innerWidth - pluginContainer.getBoundingClientRect().right < 0) {
      return;
    }

    laiSwapSidebarWithButton();
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key !== "Escape") { return; }
    if (!laiOptions.closeOnClickOut) { return; }

    const pluginContainer = document.getElementById('localAI')?.shadowRoot?.getElementById('laiSidebar');

    if (window.innerWidth - pluginContainer.getBoundingClientRect().right < 0) {
      return;
    }

    laiSwapSidebarWithButton();
  }, true);

  document.addEventListener('mouseover', function(event) {
    if(!isElementSelectionActive) {  return;  }
    const el = event.target
    const currentBorder = el.style.border;
    el.setAttribute('data-original-border', currentBorder);
    el.style.border = "5px double lime";
  }, true);

  document.addEventListener('mouseout', laiClearElementOver, true);

  try {
    laiOptions = await getLaiOptions();
    await getAiSessions();
    await getAiUserCommands();
  } catch (err) {
    console.error(err);
    return;
  }

  init();
  Promise.all(laiFetchStyles(['button.css', 'sidebar.css']))
    .then(res => {
      laiFetchAndBuildSidebarContent(laiInitSidebar);
      laiBuiltMainButton();
    })
    .catch(error => {
      console.error(`>>> ${manifest.name} - Error loading one or more styles`, error);
    });
});

function init() {
  const localAI = Object.assign(document.createElement('local-ai'), {
    id: "localAI"
  });

  document?.body?.appendChild(localAI);
  localAI.attachShadow({"mode": 'open'});
}

function laiClearElementOver(e){
  const el = e.target
  const currentBorder = el.getAttribute('data-original-border') || '';
  el.style.border = currentBorder;
}

function laiGetClickedSelectedElement(event){
  isElementSelectionActive = false;
  laiClearElementOver(event);
  laiAppendSelectionToUserInput(event.target.textContent.trim().replace(/\s{1,}/g, ' ') || 'No content found');
}

function laiBuiltMainButton() {
  var theMainButton = laiBuildMainButton();
  const shadowRoot = getShadowRoot();
if(!shadowRoot) {  return;  }
  shadowRoot.appendChild(theMainButton);
  theMainButton.addEventListener('click', laiMainButtonClicked);
  theMainButton.querySelector('div.close-semi-sphere-button')?.addEventListener('click', (e) => {
    e.stopPropagation();
    e.stopImmediatePropagation();
    theMainButton.classList.add('lai-faid-out');
    laiOptions.showEmbeddedButton = false;

    setTimeout(() => {
      theMainButton.classList.add('invisible');
      theMainButton.classList.remove('lai-faid-out');
    }, 750);
  });
}

function laiBuildMainButton(){
  if(!chrome.runtime.id){
    console.error(`${manifest.name} - Extension context invalidated. Please reload the tab.`);
    return;
  }
  var theMainButton = Object.assign(document.createElement('div'), {
    id: "laiMainButton",
    className: `lai-semi-sphere-button ${laiOptions.showEmbeddedButton ? '' : 'invisible'}`,
    title: "Click to open the panel.",
  });

  const img = document.createElement('img');
  img.src = chrome.runtime.getURL('img/icon128.svg');
  img.classList.add('img-btn');
  theMainButton.appendChild(img);

  var btnClose = Object.assign(document.createElement('div'), {
    id: "laiCloseMainButton",
    className: 'close-semi-sphere-button',
    title: "Remove the button for this session.",
    textContent: '✖'
  });
  theMainButton.appendChild(btnClose);

  return theMainButton;
}

function laiMainButtonClicked(e){
  e.preventDefault();
  // e.stopPropagation();
  laiSwapSidebarWithButton();
  return false;
}

function laiFetchAndBuildSidebarContent(sidebarLoadedCallback) {
  if(!chrome.runtime.id){
    console.error(`${manifest.name} - Extension context invalidated. Please reload the tab.`);
    return;
  }
  fetch(chrome.runtime.getURL('sidebar.html'))
    .then(response => response.text())
    .then(data => {
      var theSideBar = Object.assign(document.createElement('div'), {
        id: "laiSidebar",
        className: "lai-fixed-parent",
        innerHTML: data
      });
      const shadowRoot = getShadowRoot();
      if(!shadowRoot) {  return;  }

      shadowRoot.appendChild(theSideBar);

      if (typeof (sidebarLoadedCallback) === 'function') {
        return sidebarLoadedCallback();
      }
    })
    .catch(error => console.error('Error loading the HTML:', error));
}

function laiFetchStyles(cssNames) {
  if(!checkExtensionState()){  return;  }
  if (!cssNames) { return; }
  if (!Array.isArray(cssNames)) { cssNames = [cssNames]; }

  return cssNames.map(cssName =>
    fetch(chrome.runtime.getURL(cssName))
      .then(response => response.text())
      .then(data => {
        const shadowRoot = getShadowRoot();
        if(!shadowRoot) {  return;  }
        const styleElement = document.createElement('style');
        styleElement.innerHTML = data;
        styleElement.id = cssName.split('.')[0];
        shadowRoot.appendChild(styleElement);
        return true;
      })
  );
}

function laiSetImg(el) {
  if(!checkExtensionState()){  return;  }
  const name = el?.getAttribute('data-type')?.toLowerCase();
  if (name) {
    el.src = chrome.runtime.getURL(`img/${name}.svg`);
  }
}

function showMessage(messages, type) {
  if(!messages){  return;  }
  if(!Array.isArray(messages)){  messages = [messages];  }
  if(messages.length < 1) {  return;  }
  const shadowRoot = getShadowRoot();
  if(!shadowRoot) {  return;  }
  let msg = shadowRoot.querySelector('#feedbackMessage');
  let oldTimerId = msg.getAttribute('data-timerId');
  if(oldTimerId){
    clearTimeout(parseInt(oldTimerId, 10));
  }

  const types = ['success', 'error', 'info', 'warning'];
  type = types.find(el => el===type) || 'info';

  for (let i = 0; i < messages.length; i++) {
    const msgText = document.createElement('p');
    msgText.textContent = messages[i];
    msg.appendChild(msgText);
  }

  msg.classList.remove('success', 'error', 'info', 'warning');
  msg.classList.add('feedback-message-active', type || 'info');
  const timerId = setTimeout(() => {
    lastRegisteredErrorMessage = Array.from(msg.children).map(el => el.textContent);
    handleErrorButton();
    msg.replaceChildren(); // clear the space
    msg.classList.remove('feedback-message-active');
  }, type === 'error' ? 7500 : 3000);
  if(timerId) {
    msg.setAttribute('data-timerId', timerId);
  }
}

function buildMenuDropdowns(){
  const shadowRoot = getShadowRoot();
  const menuDropDowns = shadowRoot.querySelectorAll('#cogMenu select');
  for (let i = 0; i < menuDropDowns.length; i++) {
    const list = menuDropDowns[i];
    const selectOption = list.querySelectorAll('option')[0];
    list.replaceChildren();
    list.appendChild(selectOption);
    list.selectedIndex = 0;
    let data = list.getAttribute('data-source');
    if(!data){  continue;  }
    try { data = JSON.parse(data);  }
    catch(e){  continue;  }
    if(!laiOptions?.[data?.list]){  return;  }
    laiOptions[data?.list]?.forEach(m => {
      const option = document.createElement('option');
      option.value = option.text = m;
      if(m === laiOptions[data?.selected]){  option.selected = true;  }
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
      const obj = await chrome.storage.sync.get('laiOptions');
      const laiOptions = Object.assign({}, defaults, obj?.laiOptions ?? {});
      if(laiOptions.systemInstructions) {
        messages.push({ role: "system", content: laiOptions.systemInstructions });
      }
      return laiOptions;
  } catch (e) {
    console.error(`>>> ${manifest.name}`, e);
  }
}

async function getAiSessions(){
  const sessions = await chrome.storage.local.get(['aiSessions']);
  aiSessions = sessions.aiSessions || [];
  if(aiSessions.length < 1){  aiSessions[0] = [];  }
  activeSessionIndex = aiSessions.length - 1;
}

async function setAiSessions(){
  await chrome.storage.local.set({['aiSessions']: aiSessions});
}

async function getAiUserCommands(){
  const commands = await chrome.storage.local.get(['aiUserCommands']);
  aiUserCommands = commands.aiUserCommands || [];
}

async function setAiUserCommands(){
  await chrome.storage.local.set({['aiUserCommands']: aiUserCommands});
}

chrome.storage.onChanged.addListener(function (changes, namespace) {
  for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
    if (key === 'laiOptions') {
      laiOptions = newValue;
      if (oldValue.showEmbeddedButton !== newValue.showEmbeddedButton) {
        laiUpdateMainButtonStyles();
      }
      if (oldValue.systemInstructions !== newValue.systemInstructions) {
        const shadowRoot = getShadowRoot();
        if(!shadowRoot) {  return;  }
        const sysIntruct = shadowRoot.getElementById('laiSysIntructInput');
        const currentValue = sysIntruct.value.indexOf(oldValue.systemInstructions) < 0
          ? `${newValue.systemInstructions}\n${sysIntruct.value}`
          : sysIntruct.value.replace(oldValue.systemInstructions, newValue.systemInstructions);
        sysIntruct.value = currentValue;
      }
    }
  }
});

function handleErrorButton(){
  if(lastRegisteredErrorMessage.length === lastRegisteredErrorMessage.lastLength) {  return;  }
  const shadowRoot = getShadowRoot();
  const errorBtn = shadowRoot.querySelector('#errorMsgBtn');
  if(!errorBtn)  {  return;  }
  if(lastRegisteredErrorMessage.length > 0){
    errorBtn.classList.remove('invisible');
  } else {
    errorBtn.classList.add('invisible');
  }

  lastRegisteredErrorMessage.lastLength = lastRegisteredErrorMessage.length;
}