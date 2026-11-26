const commandPlaceholders = {
  "@{{page}}": "Include page into the prompt",
  "@{{dump}}": "Dump LLM response into the console",
  "@{{now}}": "Include current date and time",
  "@{{today}}": "Include current date without the time",
  "@{{time}}": "Include current time without the date",
  "@{{debug}}": "Enable debug logging",
  "@{{nodebug}}": "Disable debug logging",
  "@{{tools}}": "Switch tools on",
  "@{{notools}}": "Switch tools off",
  "@{{help}}": "Show the help and stop"
};
var aiUserCommands = [];
var userCmdItemBtns = { 'edit': null, 'execute': null, 'paste': null, 'delete': null };
var userScrolled = false;
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
  { "commandName": "pagetext", "commandDescription": "Enable page content filtering (show text only)" },
  { "commandName": "rawpage", "commandDescription": "Disable page content filtering (show raw HTML)" },
  { "commandName": "pin", "commandDescription": "Toggle panel pin" },
  { "commandName": "help", "commandDescription": "Show the help and stop" }
];

function getRibbon() { return getShadowRoot()?.querySelector('div.lai-ribbon'); }
function getActiveModel() {
  const ribbon = getRibbon()
  return ribbon.querySelector('#laiModelName')?.textContent;
}

async function attachCroppedContextMenuImage(base64) {
  if (!base64) { throw new Error('Captured image data is empty.'); }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
  const file = new File([bytes], `image-${Date.now()}.png`, { type: 'image/png' });
  const isSidebarActive = getSideBar()?.classList.contains('active');
  if (!isSidebarActive) { await laiSwapSidebarWithButton(); }
  await handleImageFile(file);
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
