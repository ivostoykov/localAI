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
var availableCommandsPlaceholders = ['@{{page}}', '@{{dump}}', '@{{now}}', '@{{today}}', '@{{time}}', '@{{help}}', '@{{?}}'];
const commandPlacehoders = {
  "@{{page}}": "Include page into the prompt",
  "@{{dump}}": "Dump LLM response into the console",
  "@{{now}}": "Include current date and time",
  "@{{today}}": "Include cuddent date without the time",
  "@{{time}}": "Include current time without the date"
};

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
      console.error('Error loading one or more styles:', error);
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
      theMainButton.classList.add('lai-invisible');
      theMainButton.classList.remove('lai-faid-out');
    }, 750);
  });
}

function laiBuildMainButton(){
  var theMainButton = Object.assign(document.createElement('div'), {
    id: "laiMainButton",
    className: `lai-semi-sphere-button ${laiOptions.showEmbeddedButton ? '' : 'lai-invisible'}`,
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
  const name = el?.getAttribute('data-type')?.toLowerCase();
  if (name) {
    el.src = chrome.runtime.getURL(`img/${name}.svg`);
  }
}

function laiShowMessage(message, type) {
  const shadowRoot = getShadowRoot();
  if(!shadowRoot) {  return;  }
  let msg = shadowRoot.querySelector('#feedbackMessage');

  const types = ['success', 'error', 'info', 'warning'];
  type = types.find(el => el===type) || 'info';

  if (msg.classList.contains('feedback-message-active')) {
    msg.classList.remove('feedback-message-active');
    setTimeout(() => { laiShowMessage(message, type); }, 250);
    return;
  }

  msg.innerHTML = message;
  msg.classList.remove('success', 'error', 'info', 'warning');
  msg.classList.add('feedback-message-active', type || 'info');
  setTimeout(() => {
    msg.classList.remove('feedback-message-active');
  }, 3000);
}

function getLaiOptions() {
  return new Promise((resolve, reject) => {
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
    chrome.storage.sync.get('laiOptions', function (obj) {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }

      const laiOptions = Object.assign({}, defaults, obj.laiOptions);
      if(laiOptions.systemInstructions) {
        messages.push({ role: "system", content: laiOptions.systemInstructions });
      }
      resolve(laiOptions);
    });
  });
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
