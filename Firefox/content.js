
var laiOptions = {};
var messages = [];
var currentStreamData = '';
var userScrolled = false;
var isElementSelectionActive = false;
var dumpStream = false;
var availableCommands = ['@{{page}}', '@{{dump}}', '@{{help}}'];
const commands = {
  "@{{page}}": "Include page into the prompt",
  "@{{dump}}": "Dump LLM response into the console"
};

document.addEventListener('DOMContentLoaded', async function (e) {

  document.addEventListener('click', function (event) {
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
  const localAI = Object.assign(document.createElement('div'), {
    id: "localAI",
    className: "js-local-ai"
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
  const shadowRoot = document.getElementById('localAI').shadowRoot;
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
  img.src = browser.runtime.getURL('img/icon128.svg');
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
  fetch(browser.runtime.getURL('sidebar.html'))
    .then(response => response.text())
    .then(data => {
      var theSideBar = Object.assign(document.createElement('div'), {
        id: "laiSidebar",
        className: "lai-fixed-parent",
        innerHTML: data
      });
      const shadowRoot = document.getElementById('localAI').shadowRoot;
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
    fetch(browser.runtime.getURL(cssName))
      .then(response => response.text())
      .then(data => {
        const shadowRoot = document.getElementById('localAI').shadowRoot;
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
    el.src = browser.runtime.getURL(`img/${name}.svg`);
  }
}

function laiShowMessage(message, type) {
  const shadowRoot = document.getElementById('localAI').shadowRoot;
  let msg = shadowRoot.getElementById('laiFeedbackMessage');
  if ((type || 'lai-info')?.indexOf('lai-') !== 0) {
    type = `lai-${type}`;
  }

  if (msg.classList.contains('lai-feedback-message-slide')) {
    msg.classList.remove('lai-feedback-message-slide');
    setTimeout(() => { laiShowMessage(message, type); }, 250);
    return;
  }

  msg.innerHTML = message;
  msg.classList.remove('lai-success', 'lai-error', 'lai-info', 'lai-warning');
  msg.classList.add('lai-feedback-message-slide', type || 'lai-info');
  setTimeout(() => {
    msg.classList.remove('lai-feedback-message-slide');
  }, 3000);
}

function getLaiOptions() {
  return new Promise((resolve, reject) => {
    const defaults = {
      "openPanelOnLoad": false,
      "localPort": "1234",
      "chatHistory": 25,
      "closeOnClickOut": true,
      "closeOnCopy": false,
      "closeOnSendTo": true,
      "showEmbeddedButton": false,
      "systemInstructions": '',
      "personalInfo": ''
    };
    browser.storage.sync.get('laiOptions', function (obj) {
      if (browser.runtime.lastError) {
        return reject(browser.runtime.lastError);
      }

      const laiOptions = Object.assign({}, defaults, obj.laiOptions);
      if(laiOptions.systemInstructions) {
        messages.push({ role: "system", content: laiOptions.systemInstructions });
      }
      resolve(laiOptions);
    });
  });
}

browser.storage.onChanged.addListener(function (changes, namespace) {
  for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
    if (key === 'laiOptions') {
      laiOptions = newValue;
      if (oldValue.showEmbeddedButton !== newValue.showEmbeddedButton) {
        laiUpdateMainButtonStyles();
      }
      if (oldValue.systemInstructions !== newValue.systemInstructions) {
        const shadowRoot = document.getElementById('localAI').shadowRoot;
        const sysIntruct = shadowRoot.getElementById('laiSysIntructInput');
        const currentValue = sysIntruct.value.indexOf(oldValue.systemInstructions) < 0
          ? `${newValue.systemInstructions}\n${sysIntruct.value}`
          : sysIntruct.value.replace(oldValue.systemInstructions, newValue.systemInstructions);
        sysIntruct.value = currentValue;
      }
    }
  }
});

