async function getMyTabId() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getTabId' }, (response) => {
            resolve(response?.tabId);
        });
    });
}

let isElementSelectionActive = false;
const highlightedElements = new Map();

let sidebarRoot;
function getRootElement() { return sidebarRoot?.host.isConnected ? sidebarRoot.host : null; }
function getShadowRoot() { return getRootElement() ? sidebarRoot : null; }
function getSideBar() { return getShadowRoot()?.getElementById('laiSidebar'); }
function getMainButton() { return getShadowRoot()?.getElementById('laiMainButton'); }
chrome.runtime.onMessage.addListener(onRuntimeMessage);

let startRetry = null;
let startInProgress = null;
let documentSetupComplete = false;
let contextMenuImageTarget = null;

document.addEventListener('DOMContentLoaded', async (e) => await start());

async function start() {
  if (getShadowRoot()) { return; }
  if (startInProgress) { return startInProgress; }
  if (document.readyState !== 'complete') {
    if (startRetry === null) {
      startRetry = setTimeout(() => {
        startRetry = null;
        start();
      }, 1000);
    }
    return;
  }
  if (startRetry !== null) {
    clearTimeout(startRetry);
    startRetry = null;
  }
  startInProgress = allDOMContentLoaded();
  try {
    await startInProgress;
  } finally {
    startInProgress = null;
  }
}

async function allDOMContentLoaded(e) {
  Array.from(document.getElementsByTagName('local-ai'))?.forEach(el => el?.remove());

  if (!documentSetupComplete) {
    documentSetupComplete = true;
    document.addEventListener('contextmenu', rememberContextMenuImageTarget, true);
    await updateTabPageContentStorage();
    attachElementSelectionListenersToFrames();

    document.addEventListener('click', async function (event) {
      if (event.composedPath().includes(getRootElement())) { return; }
      notifySidebar("dismissMenus");
      if (isElementSelectionActive) {
        await getSelectedClickedElement(event).catch(console.debug);
      }

      const sideBar = getSideBar();
      if (!sideBar?.classList.contains('active')) { return; }

      const options = await getOptions()
      if (!options?.closeOnClickOut || sidebarPinned || !sideBar.classList.contains('active')) { return; }
      await setSidebarOpen(false);
    }, true);

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { void handleSidebarEscape(); }
    }, true);

    document.addEventListener('mouseover', highlightElementOverDecoration, true);

    document.addEventListener('mouseout', clearElementOverDecoration, true);
  }

  await init();
  const visibility = await chrome.runtime.sendMessage({ action: 'getSidebarVisibility' });
  if (visibility?.open || (await getOptions())?.openPanelOnLoad) { await setSidebarOpen(true); }
}

function rememberContextMenuImageTarget(event) {
  const target = event.composedPath?.()[0];
  contextMenuImageTarget = target instanceof HTMLImageElement ? target : null;
}

function getContextMenuImageBounds() {
  if (!contextMenuImageTarget?.isConnected) { return null; }
  const rect = contextMenuImageTarget.getBoundingClientRect();
  return {
    rect: { x: rect.left, y: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
    devicePixelRatio: window.devicePixelRatio,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  };
}

function scrollContextMenuImageIntoView() {
  if (!contextMenuImageTarget?.isConnected) { return false; }
  contextMenuImageTarget.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  return true;
}

function hideLocalAIForImageCapture(rect) {
  const host = getRootElement();
  if (!host) { return { hidden: false }; }
  const hostRect = getSideBar()?.classList.contains("active")
    ? getSideBar().getBoundingClientRect() : (getMainButton() ?? host).getBoundingClientRect();
  const overlaps = hostRect.left < rect.right && hostRect.right > rect.x && hostRect.top < rect.bottom && hostRect.bottom > rect.y;
  if (!overlaps) { return { hidden: false }; }
  return withHostGuardSuspended(() => {
    host.dataset.contextCaptureDisplay = host.style.display;
    host.style.display = 'none';
    return { hidden: true };
  });
}

function restoreLocalAIAfterImageCapture() {
  const host = getRootElement();
  if (!host || !Object.hasOwn(host.dataset, 'contextCaptureDisplay')) { return false; }
  return withHostGuardSuspended(() => {
    host.style.display = host.dataset.contextCaptureDisplay;
    delete host.dataset.contextCaptureDisplay;
    return true;
  });
}

function handleTabSessionPageShow(event) {
  if (event?.persisted) { notifySidebar('catchUp', { restore: true }); }
}

window.addEventListener('pageshow', handleTabSessionPageShow);

function handleTabSessionCatchUp() {
  notifySidebar('catchUp');
}

function handleTabSessionVisibilityChange(event) {
  if (document.visibilityState !== 'visible') { return; }
  handleTabSessionCatchUp();
}

document.addEventListener('visibilitychange', handleTabSessionVisibilityChange);
window.addEventListener('focus', handleTabSessionCatchUp);

if ('navigation' in window) {
    window.addEventListener("popstate", triggerUpdate);
    window.addEventListener("pushstate", triggerUpdate);
    window.addEventListener("replacestate", triggerUpdate);
}

function frameElementSelectionClicked(event) {
  if (isElementSelectionActive) {
    void getSelectedClickedElement(event).catch(console.debug);
  }
}

function attachElementSelectionListenersToFrames() {
  const frames = document.querySelectorAll('iframe, frame');
  frames.forEach((frame) => {
    const attach = (requireReady = false) => {
      try {
        const doc = frame?.contentWindow?.document;
        if (!doc?.addEventListener || (requireReady && doc.readyState === 'loading')) { return; }
        doc.addEventListener('mouseover', highlightElementOverDecoration, true);
        doc.addEventListener('mouseout', clearElementOverDecoration, true);
        doc.addEventListener('click', frameElementSelectionClicked, true);
      } catch (e) {
        console.warn('Access denied to frame!', e);
      }
    };
    frame.addEventListener('load', () => attach());
    attach(true);
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
    document.querySelectorAll('local-ai#localAI').forEach(host => host.remove());

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
    sidebarRoot = localAI.attachShadow({ mode: 'closed' });
    await buildMainButton();
    const hostStyle = document.createElement('style');
    hostStyle.textContent = sidebarHostCss;
    sidebarRoot.appendChild(hostStyle);
    withHostGuardSuspended(() => applyCriticalHostStyles(localAI));
    startHostGuard();
  } catch (err) {
    console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error initiating the extension UI: ${err.message}`, err);
  }
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
        el.tagName === 'LOCAL-AI' ||
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
  removeHiddenContentFromClone(document.body, domClone);

  console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Filter config:`, {
    enabled: filterConfig?.enabled,
    selectorCount: selectors?.length ?? 0,
    selectors: selectors
  });

  if(!domClone || !filterConfig?.enabled || !selectors || selectors.length === 0){
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Filtering skipped: domClone=${!!domClone}, enabled=${filterConfig?.enabled}, selectorsPresent=${!!selectors && selectors.length > 0}`);
    return domClone;
  }

  try {
    Array.from(domClone.attributes).forEach(attr => {
      domClone.removeAttribute(attr.name);
    });

    const selectorString = selectors.join(',');
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Combined selector:`, selectorString);

    const matchedElements = domClone.querySelectorAll(selectorString);
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Matched ${matchedElements.length} elements to remove`);

    matchedElements.forEach(e => e.remove());

  } catch (err) {
    console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error during filtering:`, {err, filterConfig, selectors, domClone});
  }
  console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - after cleaning`, domClone);
  return domClone;
}

const CLONED_ELEMENT_DISPLAY = new WeakMap();
const HIDDEN_ELEMENT_TEXT_ATTRIBUTES = ['alt', 'title', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-description'];

// Must run synchronously straight after cloneNode(): it pairs live and clone nodes by
// position, and computed styles are only meaningful on the connected live DOM.
function removeHiddenContentFromClone(liveRoot, cloneRoot, getStyle = el => window.getComputedStyle(el)) {
  if (!liveRoot || !cloneRoot) {  return;  }

  const hiddenNodes = [];
  const hiddenContentHosts = [];
  const hiddenAttributeHosts = [];
  const visibilityCache = new Map();
  const isVisibilityHidden = el => {
    if (!visibilityCache.has(el)) {
      const visibility = getStyle(el)?.visibility;
      visibilityCache.set(el, visibility === 'hidden' || visibility === 'collapse');
    }
    return visibilityCache.get(el);
  };
  // display:contents and non-atomic inline boxes do not get size containment, so
  // content-visibility:hidden does not skip their children.
  const classify = (live, copy) => {
    const style = getStyle(live);
    if (style?.display === 'none') {  return 'remove';  }
    if (typeof style?.display === 'string' && style.display) {
      CLONED_ELEMENT_DISPLAY.set(copy, style.display);
    }
    if (isVisibilityHidden(live)) {  hiddenAttributeHosts.push(copy);  }
    if (style?.contentVisibility === 'hidden' && style.display !== 'contents' && style.display !== 'inline') {
      return 'empty';
    }
    return 'descend';
  };

  try {
    const rootAction = classify(liveRoot, cloneRoot);
    const pairs = [];
    if (rootAction === 'descend') {
      pairs.push([liveRoot, cloneRoot]);
    } else {
      hiddenContentHosts.push(cloneRoot);
    }

    while (pairs.length > 0) {
      const [liveParent, cloneParent] = pairs.pop();
      let live = liveParent.firstChild;
      let copy = cloneParent.firstChild;

      while (live && copy) {
        if (live.nodeType === Node.ELEMENT_NODE) {
          const action = classify(live, copy);
          if (action === 'remove') {
            hiddenNodes.push(copy);
          } else if (action === 'empty') {
            hiddenContentHosts.push(copy);
          } else if (live.firstChild) {
            pairs.push([live, copy]);
          }
        } else if (live.nodeType === Node.TEXT_NODE && live.parentElement && isVisibilityHidden(live.parentElement)) {
          hiddenNodes.push(copy);
        }
        live = live.nextSibling;
        copy = copy.nextSibling;
      }
    }
  } catch (err) {
    console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error pairing live and cloned nodes for visibility filtering`, err);
  }

  hiddenAttributeHosts.forEach(el => HIDDEN_ELEMENT_TEXT_ATTRIBUTES.forEach(attr => el.removeAttribute(attr)));
  hiddenNodes.forEach(node => node.remove());
  hiddenContentHosts.forEach(host => host.replaceChildren());
  console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Visibility filtering removed ${hiddenNodes.length} node(s), emptied ${hiddenContentHosts.length} element(s) and stripped text attributes from ${hiddenAttributeHosts.length} visibility:hidden element(s)`);
}

function getClonedElementDisplay(element) {
  return CLONED_ELEMENT_DISPLAY.get(element);
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

// COMMENTED OUT - Replaced by enhanced extractor functions
// Extract text with hierarchical structure
// function extractTextStructure(domClone) {
//   const structure = [];
//   const headings = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
//   let currentSection = { title: '', content: [] };

//   const walker = document.createTreeWalker(
//     domClone,
//     NodeFilter.SHOW_TEXT
//   );

//   while (walker.nextNode()) {
//     const node = walker.currentNode;
//     if (!hasVisibleText(node)) continue;

//     const parent = node.parentElement;
//     const parentTag = parent?.tagName || '';
//     let text = node.nodeValue.trim();

//     text = text.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
//     if (!text) continue;

//     const ariaContext = getARIAContext(parent, domClone);
//     if (ariaContext === null) continue; // Skip aria-hidden elements

//     if (ariaContext) {  text = ariaContext + text;  }

//     if (headings.includes(parentTag)) {
//       if (currentSection.content.length) structure.push(currentSection);
//       currentSection = { title: text, content: [] };
//     } else {
//       currentSection.content.push(text);
//     }
//   }

//   if (currentSection.content.length) structure.push(currentSection);
//   return structure;
// }

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

// COMMENTED OUT - Replaced by enhanced extractor
// function formatPageContent(structure) {
//   const formattedSections = structure.map(section => {
//     const title = section.title ? `\n\n## ${section.title}\n` : '';
//     return `${title}${section.content.join('\n')}`;
//   }).join('\n');

//   return `PAGE URL: ${document.location.href}\nPAGE CONTENT START:${formattedSections}\nPAGE CONTENT END`;
// }

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

function highlightElementOverDecoration(e) {
  if (!isElementSelectionActive) { return; }
  const el = e.target;
  if (!el?.style || !el.setAttribute || highlightedElements.has(el)) { return; }
  const original = el.style.border;
  highlightedElements.set(el, original);
  el.setAttribute('data-original-border', original);
  el.style.border = "5px double lime";
}

function restoreElementDecoration(el) {
  if (!el?.style || !el.getAttribute) { return; }
  const original = highlightedElements.has(el)
    ? highlightedElements.get(el)
    : el.getAttribute('data-original-border');
  if (original === null) { return; }
  el.style.border = original;
  if (!original) { el.style.removeProperty('border'); }
  el.removeAttribute('data-original-border');
  highlightedElements.delete(el);
}

function clearElementOverDecoration(e) {
  if (!isElementSelectionActive) { return; }
  restoreElementDecoration(e.target);
}

function clearAllElementDecorations() {
  for (const el of highlightedElements.keys()) { restoreElementDecoration(el); }
  const clearDocument = doc => {
    doc.querySelectorAll('[data-original-border]').forEach(restoreElementDecoration);
    doc.querySelectorAll('iframe, frame').forEach(frame => {
      try {
        if (frame.contentDocument) { clearDocument(frame.contentDocument); }
      } catch (e) { /* Cross-origin frames are inaccessible. */ }
    });
  };
  clearDocument(document);
  highlightedElements.clear();
}

async function getSelectedClickedElement(event) {
  let el = event.target;
  isElementSelectionActive = false;
  clearAllElementDecorations();
  if (el.tagName === 'IMG') {
    notifySidebar('showMessage', { message: 'Copy the image and paste it into the prompt (Ctrl+V).', messageType: 'info' });
    return;
  }
  const content = el.innerText?.trim();
  if (!content) {
    notifySidebar('showMessage', { message: 'Selected element has no visible text.', messageType: 'warn' });
    return;
  }
  await sendToSidebar('attachElement', { content }, true);
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
    title: `Click to open the panel. ${manifest?.version}`,
  });

  theMainButton.style.zIndex = getHighestZIndex();
  const img = new DOMParser().parseFromString(sidebarLauncherIcon, 'image/svg+xml').documentElement;
  img.setAttribute('aria-hidden', 'true');
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

async function laiMainButtonClicked(e) {
  e.preventDefault();
  await setSidebarOpen(!getSideBar()?.classList.contains("active"), true, true, true);
  return false;
}

async function handleContentExtractorCall(response) {
    const { functionName, argument } = response;
    let result;

    switch (functionName) {
        case 'getPageStructureSummary':
            const summaryObj = await getPageStructureSummary();
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - getPageStructureSummary returned:`, summaryObj);
            result = JSON.stringify(summaryObj, null, 2);
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - JSON.stringify result:`, result);
            break;
        case 'getPageTables':
            result = await getPageTables(argument);
            break;
        case 'getPageLists':
            result = await getPageLists(argument);
            break;
        case 'getPageCodeBlocks':
            result = await getPageCodeBlocks(argument);
            break;
        case 'getPageMetadataFormatted':
            result = getPageMetadataFormatted();
            break;
        case 'getEnhancedPageContent':
            result = await getEnhancedPageContent();
            break;
        case 'getMainContentOnly':
            result = await getMainContentOnly();
            break;
        default:
            throw new Error(`Unknown content extractor function: ${functionName}`);
    }

    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Content extractor result ready`, {
        functionName,
        resultType: typeof result,
        resultLength: result?.length
    });

    return result;
}


const sidebarLauncherIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44.779 54.976">
  <path d="m11.11 52.662.024-2.303.351.007c.22.004.338-.027.314-.084-.02-.05-.321-.377-.668-.727-.347-.349-.631-.682-.632-.74 0-.059-.052-.106-.115-.106-.137 0-1.354-1.454-2.021-2.413-.824-1.186-1.744-3.058-2.391-4.864-.396-1.107-.875-2.839-.942-3.406l-.055-.468-.858-.14C2.07 37.084.68 35.9.174 34.063.014 33.48 0 33.195 0 30.47c0-3.309.043-3.66.558-4.539.314-.535.673-.885 1.267-1.233l.393-.23-.05-.431c-.26-2.31-.266-6.07-.01-7.586.526-3.121 1.976-6.341 3.96-8.798.738-.913 2.602-2.756 3.45-3.41C12.793 1.753 16.86.225 20.721.051L21.844 0v9.06l-.247.34c-.727 1.004-3.318 3.423-4.549 4.247-.886.594-3.217 1.737-4.933 2.42-.765.304-1.41.553-1.433.553-.023 0 .355-.272.84-.605 1.978-1.359 3.206-2.41 4.704-4.03.995-1.076 3.163-3.966 3.163-4.217 0-.03-.524.46-1.164 1.087-2.438 2.387-4.614 4.2-8.319 6.933a41.935 41.935 0 0 0-3.149 2.623C5.274 19.787 3.9 21.96 3.465 23.62c-.227.867-.306 2.725-.167 3.924.265 2.28 1.256 5.867 2.502 9.057.173.443.44 1.167.594 1.609 1.778 5.113 2.808 6.991 5.597 10.205 2.12 2.441 3.7 3.778 5.577 4.718 1.166.583 3.177 1.164 4.031 1.164.23 0 .245.021.245.34v.339l-5.38-.005-5.38-.005.025-2.303zM5.603 15.34c.649-1.057 1.873-2.687 2.651-3.526.77-.831 2.26-2.134 3.543-3.097 2.128-1.596 4.586-2.915 6.744-3.618.522-.17.677-.251.565-.295-.242-.094-2.3.021-3.147.176-1.057.193-2.606.726-3.81 1.312-2.525 1.228-4.821 3.585-6.144 6.307-.579 1.19-1.222 3.194-1.385 4.318-.048.33-.043.325.19-.17.133-.279.49-.912.793-1.407zm21.158 39.605c.02-.016.473-.192 1.009-.39a19.796 19.796 0 0 0 1.382-.563 4.38 4.38 0 0 1 .445-.203c.02 0 .035.267.035.593v.593H28.18c-.8 0-1.438-.014-1.418-.03zm3.973-.245c0-.27.03-.29 1.376-.995.756-.396 1.428-.733 1.493-.75.098-.024.11.131.074.901-.024.512-.07.973-.102 1.025-.039.062-.523.094-1.45.094h-1.392zm-8.044-3.324v-2.751l.444-.001c.245 0 .587-.025.76-.053l.316-.052-.053 2.74c-.036 1.843-.084 2.762-.147 2.804-.05.035-.369.063-.707.064h-.613zm2.568 2.45c-.026-.068-.022-.292.009-.498l.056-.374.567-.185c1.304-.426 4.13-1.621 4.354-1.842.51-.502 2.86-3.054 3.514-3.815.652-.76.7-.84.75-1.292l.055-.481.942-.503a115.7 115.7 0 0 1 1.578-.824c.35-.177.683-.36.74-.405.196-.153.108.06-.466 1.123-.759 1.408-1.61 2.528-2.895 3.812-1.228 1.226-3.276 2.807-4.66 3.596-.946.54-2.557 1.217-3.794 1.595-.59.18-.71.195-.75.092zm5.644-.805c.117-.101.593-.452 1.059-.78a183.39 183.39 0 0 0 1.248-.885l.403-.29v.302c0 .296-.019.312-.741.681-.408.208-1.065.553-1.46.767-.396.213-.625.306-.509.205zM25.25 49.96l.023-1.795.337-.173c.565-.291 1.654-1.45 2.022-2.15.297-.568.31-.618.143-.565-.352.112-.947.056-1.874-.177-.899-.226-.963-.231-1.629-.126-.38.06-.91.13-1.178.154l-.485.044-.023 1.742-.022 1.743-.254.015c-.538.032-1.715-.125-2.19-.291-1.143-.403-2.528-1.562-3.208-2.686-.151-.25-.334-.455-.407-.456a.61.61 0 0 1-.284-.114c-.137-.1-.103-.123.312-.216.49-.11 1.696-.693 2.32-1.123.203-.14.626-.375.94-.524.482-.228.666-.27 1.204-.27.564 0 .691.032 1.133.282l.497.282.487-.218c.59-.265 1.105-.28 1.708-.051.243.092.456.152.474.134.053-.053-.703-.471-1.01-.56-.408-.117-.964-.099-1.302.042l-.293.123v-2.552l-.256.05c-.368.074-.976-.157-1.557-.593-.275-.206-.56-.363-.634-.35-.193.038-.217.307-.045.497.16.177.142.186-.302.167-.488-.022-.798-.159-1.118-.492-.388-.406-.523-.838-.47-1.497.065-.81.496-1.479 1.182-1.833.554-.285.585-.234.302.495-.252.649-.391 1.49-.29 1.754.046.12.082.114.302-.048.39-.289.952-.302 1.772-.043.385.121.792.22.906.22h.208V24.917h.979l2.092-2.572c1.758-2.16 2.135-2.58 2.358-2.624.145-.03.723-.053 1.283-.053h1.018l.446-.492c.245-.27.658-.752.918-1.07l.473-.576v-4.363l.493-.75a50.19 50.19 0 0 1 1.38-1.936c1.481-1.983 1.9-2.595 2.263-3.302.416-.813.563-1.01.69-.93.153.094 1.363 1.637 1.992 2.54.555.796 1.649 2.805 1.649 3.03 0 .12-.29.31-1.99 1.302-1.891 1.105-2.95 1.74-3.323 1.993l-.36.244v5.664l-2.35.001c-2.656.002-3.165.069-4.13.544-.89.437-1.448 1.036-1.687 1.809-.055.18.003.163.773-.222.994-.497 1.903-.82 2.653-.941.696-.113 3.913-.114 4.699-.003 1.859.265 3.836 1.496 4.812 2.996.677 1.04.852 1.817.733 3.26a315.23 315.23 0 0 1-.464 5.044c-.07.698-.138 1.44-.15 1.648-.019.343-.058.407-.428.685-.223.169-.96.646-1.636 1.061-.676.415-1.69 1.06-2.253 1.432-1.084.717-1.039.666-1.941 2.159l-.282.466-.027 2.492-.027 2.492-.216.26c-.119.142-.988 1.078-1.931 2.08-1.554 1.648-1.762 1.839-2.212 2.021l-2.021.826c-.838.343-1.572.624-1.632.624-.085 0-.103-.384-.085-1.796zm.912-15.698v-5.217l.438-.562c1.086-1.394 1.988-2.324 2.733-2.816.67-.443 1.277-.616 2.163-.618 1.046-.002 1.702.23 2.752.968 1.162.817 1.713 1.071 2.57 1.186.389.052.722.079.74.06.02-.018-.118-.084-.305-.146-.247-.081-.495-.288-.91-.758-1.026-1.16-2.056-1.93-2.993-2.236a8.04 8.04 0 0 0-1.197-.242c-1.445-.181-3.026.344-4.158 1.38-.629.577-1.772 1.88-2.445 2.788l-.471.635-.021 5.334a604.131 604.131 0 0 0-.01 5.397c.008.035.26.064.563.064h.55zm3.154 2.926c.186-.202.233-.332.233-.658 0-.225-.056-.478-.125-.57-.099-.13-.125-.5-.128-1.815-.002-.908-.036-1.701-.074-1.762-.048-.075-.22-.102-.528-.085l-.458.026-.071 1.733c-.068 1.655-.08 1.744-.275 1.975-.116.137-.204.352-.204.494 0 .881 1.037 1.302 1.63.662zm2.926.172c.26-.159.524-.598.524-.872 0-.065-.095-.259-.212-.43-.204-.3-.211-.362-.211-1.663v-1.35h-1.186v1.4c0 1.16-.024 1.436-.14 1.613-.297.453-.085 1.13.422 1.35.364.158.476.151.803-.048zm3.067.043c.486-.251.639-.879.335-1.376-.154-.253-.169-.428-.169-1.964 0-1.112-.03-1.705-.09-1.742-.05-.031-.296-.031-.545 0l-.453.056-.032 1.667c-.029 1.525-.048 1.696-.218 2.003-.102.184-.186.424-.186.533 0 .322.246.702.535.828.351.152.52.151.823-.005zm-2.413-5.25c1.464-.373 2.634-1.341 3.477-2.876.346-.629.336-.633-.39-.162a4.32 4.32 0 0 1-.677.34c-.21.082-.587.33-.838.553-1.698 1.5-3.774 1.537-5.544.097-.669-.545-.766-.588-1.432-.646l-.574-.05.209.35c.663 1.114 1.905 2.043 3.19 2.389.612.164 1.946.167 2.58.006zm-.445-1.819c1.005-.31 1.598-1.122 1.605-2.198.013-2.105-2.507-3.225-4.079-1.812-.643.579-.808.942-.804 1.767.004.75.084.962.59 1.548.68.79 1.605 1.03 2.688.695zm2.093 12.289v-1.437l.417-.623c.229-.342.486-.683.571-.756.281-.242 1.238-.878 2.526-1.68.698-.434 1.342-.85 1.43-.925.155-.132.159-.121.101.33-.126 1-.611 3.223-.945 4.33-.024.081-.905.578-2.071 1.17l-2.029 1.027zm2.716-1.021c.336-.336.338-.75.004-1.123-.192-.215-.31-.272-.56-.272-.26 0-.372.059-.614.322-.257.281-.289.363-.246.631.108.68.924.934 1.416.442zm3.595-4.504.164-1.218c.274-2.025.609-5.798.695-7.831.04-.91.02-1.256-.091-1.694-.292-1.144-.991-2.173-2.2-3.237-.852-.75-1.56-1.188-2.572-1.588l-.698-.276v-5.276l1.164-.723c1.42-.883 2.474-1.465 2.483-1.372.003.039.002 1.613-.002 3.499-.005 1.947.028 3.648.076 3.937.105.625.643 1.728 1.104 2.26.258.297.562.504 1.212.826 1.017.503 1.641 1.016 2.003 1.65.53.925.538.988.574 4.341.037 3.397.013 3.62-.502 4.681-.54 1.112-1.892 2.125-3.013 2.257l-.435.052.038-.287zm-28.597-5.996c-1.524-.21-2.5-.8-4.194-2.53-.663-.679-1.206-1.259-1.206-1.29 0-.03.276-.08.614-.109.81-.071 1.481-.285 2.537-.81 1.152-.571 1.868-.77 2.781-.77 1.296 0 2.011.213 3.183.949.897.562 2.03 1.932 2.397 2.896l.083.22h-.996l-.252-.445c-.25-.44-1.158-1.383-1.517-1.574-.174-.093-.19-.079-.238.218-.141.871-.595 1.557-1.263 1.91-.49.26-1.473.258-1.967-.004-.638-.337-1.136-1.092-1.257-1.905-.033-.22-.077-.402-.097-.402-.02 0-.32.192-.669.427-.727.49-.726.454-.032 1.214.9.984 2.038 1.261 4.228 1.03.676-.072 1.276-.13 1.334-.13.212 0 .093.133-.402.452-.875.564-1.99.801-3.067.653zm5.436-5.774c-1.192-.853-2.134-1.266-3.851-1.688-1.557-.383-2.756-.475-3.949-.304-1.053.152-2.094.469-2.939.896-.295.15-.558.252-.582.227-.096-.095 1.65-1.714 2.178-2.022 1.15-.668 2.51-.924 3.96-.746 1.245.153 3.688.799 4.422 1.17 1.119.564 1.65 1.276 1.636 2.193-.012.853-.05.865-.875.274zm5.038-1.697c-.024-.062-.033-2.866-.02-6.232l.021-6.12 2.794-.036 2.794-.035.74-.824.742-.823v-8.2l.232.057c.58.143 2.937 1.39 3.747 1.983.906.663 2.286 1.814 2.286 1.906 0 .058-.171.424-.381.813-.21.389-.381.753-.381.808 0 .056-.748 1.126-1.663 2.377a187.131 187.131 0 0 0-2.095 2.911l-.433.635-.025 2.218-.025 2.218-.61.64-.61.64H27.47l-2.117 2.56c-1.718 2.078-2.161 2.567-2.348 2.588-.134.016-.249-.02-.273-.084zm18.76-1.213c-.58-1.277-.546-.971-.579-5.264-.029-3.82-.026-3.912.137-4 .158-.084.184-.018.468 1.159.165.686.34 1.545.388 1.91.174 1.3.071 5.455-.157 6.365l-.064.254zM22.843 7.433 22.82 4.28l-.003-.487.613-.025.614-.025V10.1H22.86zm2.389-.508V3.75h1.185v6.35h-1.185zm2.286 0V3.75h1.185v5.346l-.442.502c-.773.878-.743.983-.743-2.673zM22.86 1.73c0-.505-.025-1.1-.055-1.322L22.75.005l.642.033c.353.018.657.05.675.073.018.023.016.603-.004 1.29l-.037 1.249H22.86zm2.39.856c-.034-.011-.05-.554-.036-1.206.03-1.344-.04-1.248.81-1.132l.392.054v2.249l-.552.028c-.304.016-.58.019-.614.007zm2.267-.947c0-.51.028-.943.063-.962.035-.02.302.022.593.093l.529.128v1.667h-1.185z"/>
</svg>`;

const sidebarHostCss = `
.lai-semi-sphere-button {
  position: fixed;
  bottom: -40px;
  right: -45px;
  z-index: 1000;
  cursor: pointer;
  height: 60px;
  width: 100px;
  border-radius: 30px 0 0 30px;
  color: white;
  border: none;
  text-align: left;
  line-height: 60px;
  padding-left: 15px;
  transition: transform 0.6s ease-in-out, background-color 0.6s ease-in-out, padding-left 0.6s ease-in-out, bottom 0.6s ease-in-out, right 0.6s ease-in-out;
  transform: rotate(-55deg);
  font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
}

.lai-semi-sphere-button:hover {
  transform: rotate(0deg);
  padding-left: 25px;
  bottom: 50px;
  right: 2px;
}

.close-semi-sphere-button{
  position: absolute;
  right: 95px;
  bottom: -35px;
  line-height: 15px;
  vertical-align: bottom;
  justify-items: flex-end;
  margin: auto;
  color: red;
}


#laiSidebar { position: fixed; inset: 0 0 0 auto; width: min(800px, 30vw); height: 100vh;
  box-sizing: border-box; border: 5px double #c3c3c3; background: white; }
/* .lai-semi-sphere-button { background: white; } */
.img-btn { vertical-align: middle; }
.invisible { display: none !important; }
#laiSidebar:not(.active) { visibility: hidden; pointer-events: none; }
#laiSidebar iframe { display: block; border: 0; width: 100%; height: 100%; }
.lai-resize-handle { position: absolute; left: -12px; top: 0; bottom: 0; width: 12px;
  cursor: ew-resize; touch-action: none; }
`;

let sidebarFrame;
let sidebarOpen = false;
let hostGuard;
let hostGuardSuspended = false;
let sidebarPort;
let sidebarPortRetryTimer;
let sidebarChannel;
let sidebarPinned = false;
let sidebarReady = false;
let sidebarMount;
let sidebarFrameTimer;
let sidebarFrameCanRetry = false;

function withHostGuardSuspended(operation) {
  hostGuardSuspended = true;
  try { return operation(); } finally { hostGuardSuspended = false; }
}

function isHostGuardSuspended() { return hostGuardSuspended; }

function isHostTamperedNow() {
  return !hostGuardSuspended && isHostTamperedByDefault(getRootElement());
}

function startHostGuard() {
  if (hostGuard?.isBlocked?.()) {
    hostGuard.stop();
    hostGuard = null;
  }
  if (hostGuard) { hostGuard.start(); return; }

  hostGuard = createHostGuard({
    getHost: () => getRootElement(),
    remount: () => {
      void remountSidebarHost().catch(error => console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to recreate the sidebar host: ${error.message}`, error));
    },
    notifyBlocked: () => {
      void chrome.runtime.sendMessage({ action: 'sidebarBlocked' }).catch(error => console.debug('Failed to report the blocked sidebar.', error));
    },
    isHostTampered: isHostTamperedNow,
    debug: (...args) => console.debug(...args)
  });
  hostGuard.start();
}

async function remountSidebarHost() {
  const shouldOpen = sidebarOpen;
  try {
    await init();
    if (shouldOpen) { await setSidebarOpen(true); }
  } finally {
    hostGuard?.start();
    hostGuard?.onRemounted();
  }
}

async function clearSidebarBlockedBadge() {
  try {
    await chrome.runtime.sendMessage({ action: 'clearSidebarBlocked' });
  } catch (error) {
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to clear the sidebar badge`, error);
  }
}

function getHostState() {
  return {
    open: getSideBar()?.classList.contains('active') ?? false,
    pinned: sidebarPinned,
    url: location.href,
    title: document.title
  };
}

function isSidebarFrameUrl(url) {
  try {
    const candidate = new URL(url);
    const expected = new URL(chrome.runtime.getURL('sidebar.html'));
    const staticHref = `chrome-extension://${chrome.runtime.id}/sidebar.html`;
    return candidate.href === expected.href || candidate.href === staticHref;
  } catch {
    return false;
  }
}

function installResizeHandle(container) {
  const handle = document.createElement('div');
  handle.className = 'lai-resize-handle';
  handle.title = 'Resize sidebar';
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) { return; }
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = container.getBoundingClientRect().width;
    handle.setPointerCapture(event.pointerId);
    const resize = move => {
      const width = Math.max(10, Math.min(window.innerWidth, startWidth + startX - move.clientX));
      container.style.width = `${width}px`;
    };
    handle.addEventListener('pointermove', resize);
    handle.addEventListener('lostpointercapture', () => handle.removeEventListener('pointermove', resize), { once: true });
  });
  container.append(handle);
}

async function mountSidebarFrame(container, retry = true) {
  clearTimeout(sidebarFrameTimer);
  sidebarFrameCanRetry = retry;
  sidebarPort?.disconnect();
  sidebarPort = undefined;
  sidebarChannel = undefined;
  sidebarReady = false;
  sidebarFrame?.remove();
  sidebarFrame = undefined;
  const registration = await chrome.runtime.sendMessage({ action: 'registerSidebarFrame' });
  if (!registration?.ok) {
    throw new Error('Could not register the sidebar frame.');
  }
  const frame = document.createElement('iframe');
  frame.title = 'Local AI';
  frame.allow = 'microphone; clipboard-write';
  frame.src = chrome.runtime.getURL('sidebar.html');
  sidebarFrame = frame;
  container.append(frame);
  if (retry) {
    // A failed registration confirmation cannot open the private port. Retry
    // once if mounting gets no authenticated connection.
    sidebarFrameTimer = setTimeout(() => {
      if (sidebarFrame === frame && container.isConnected && !sidebarPort) {
        void mountSidebarFrame(container, false).catch(console.error);
      }
    }, 11000);
  }
}

async function setSidebarOpen(open, restoreHistory = true, notify = true, userInitiated = false) {
  if (open && !getShadowRoot()) {
    if (hostGuard?.isBlocked?.() && !userInitiated) {
      throw new Error('Local AI stopped recreating the panel after repeated removals.');
    }
    await start();
  }
  const root = getShadowRoot();
  if (!root) {
    sidebarOpen = open;
    if (open) { throw new Error('Local AI host is unavailable.'); }
    return { ...getHostState(), restoreHistory };
  }
  let container = getSideBar();
  if (open) {
    if (!container) {
      container = document.createElement('div');
      container.id = 'laiSidebar';
      container.style.zIndex = getHighestZIndex();
      installResizeHandle(container);
      root.append(container);
    }
    if (!sidebarFrame?.isConnected || !isSidebarFrameUrl(sidebarFrame.src)) {
      sidebarMount ??= mountSidebarFrame(container).finally(() => { sidebarMount = undefined; });
      await sidebarMount;
    }
  }
  container?.classList.toggle('active', open);
  sidebarOpen = open;
  if (open) { void clearSidebarBlockedBadge(); }
  const options = await getOptions();
  getMainButton()?.classList.toggle('invisible', open || !options?.showEmbeddedButton);
  const state = { ...getHostState(), restoreHistory };
  if (notify && sidebarReady) {
    await sendToSidebar('hostState', state).catch(console.debug);
  }
  return state;
}

async function handleSidebarEscape(notify = true) {
  if (isElementSelectionActive) {
    isElementSelectionActive = false;
    clearAllElementDecorations();
  } else if (getHostState().open && (await getOptions())?.closeOnClickOut && !sidebarPinned) {
    return setSidebarOpen(false, true, notify);
  }
  return getHostState();
}

function isSidebarBackgroundSender(sender) {
  if (sender?.id !== chrome.runtime.id || sender.tab != null) { return false; }
  const backgroundPath = manifest.background?.service_worker
    ?? manifest.background?.page
    ?? '_generated_background_page.html';
  return sender.url === chrome.runtime.getURL(backgroundPath);
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'localai-sidebar') { return; }
  if (!isSidebarBackgroundSender(port.sender) ||
      !sidebarFrame?.isConnected || sidebarPort) {
    port.disconnect();
    return;
  }
  sidebarPort = port;
  clearTimeout(sidebarFrameTimer);
  clearTimeout(sidebarPortRetryTimer);
  sidebarChannel = createSidebarChannel(port, async (action, payload) => {
    switch (action) {
      case 'getHostState': return getHostState();
      case 'ready': sidebarReady = true; return getHostState();
      case 'setOpen':
        if (typeof payload.open !== 'boolean') { throw new Error('Invalid panel state.'); }
        return setSidebarOpen(payload.open, payload.restoreHistory, false);
      case 'setPinned':
        if (typeof payload.pinned !== 'boolean') { throw new Error('Invalid pin state.'); }
        sidebarPinned = payload.pinned;
        return getHostState();
      case 'escape': return handleSidebarEscape(false);
      case 'readPage': return handleContentExtractorCall({ functionName: payload.kind, argument: payload.argument });
      default: throw new Error('Unknown page operation.');
    }
  }, () => {
    handleSidebarPortDisconnect(port);
  });
});

function teardownSidebarFrame({ keepOpen = false } = {}) {
  sidebarFrame?.remove();
  sidebarFrame = undefined;
  if (!keepOpen) { void setSidebarOpen(false).catch(console.error); }
}

function handleSidebarPortDisconnect(port) {
  if (sidebarPort !== port) { return; }
  sidebarPort = undefined;
  sidebarChannel = undefined;
  sidebarReady = false;
  isElementSelectionActive = false;
  clearAllElementDecorations();
  clearTimeout(sidebarPortRetryTimer);

  if (!sidebarFrame?.isConnected) {
    // A removed host takes the iframe with it. The guard recreates the host and
    // restores the panel, so keep the desired open state.
    teardownSidebarFrame({ keepOpen: !getRootElement() });
    return;
  }

  // The background broker may have stopped with the service worker. Keep the
  // iframe mounted so it can reconnect; a real teardown still closes the panel.
  sidebarPortRetryTimer = setTimeout(() => {
    if (sidebarPort) { return; }
    teardownSidebarFrame();
  }, 6000);
}

async function sendToSidebar(action, payload, waitForReady = false) {
  if (waitForReady) {
    const deadline = Date.now() + 15000;
    while (!sidebarReady && sidebarFrame?.isConnected && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  if (!sidebarChannel || !sidebarReady) { throw new Error('Local AI sidebar is unavailable.'); }
  return sidebarChannel.request(action, payload);
}

function notifySidebar(action, payload) {
  if (sidebarReady) { void sendToSidebar(action, payload).catch(console.debug); }
}

function onRuntimeMessage(request, sender, respond) {
  if (sender.id !== chrome.runtime.id || !request?.action) { return; }
  processHostMessage(request).then(respond, error => respond({ error: error.message }));
  return true;
}

async function processHostMessage(request) {
  switch (request.action) {
    case 'ping': return { pong: true };
    case 'retrySidebarFrame':
      if (sidebarFrameCanRetry && !sidebarPort && getSideBar()?.isConnected) {
        await mountSidebarFrame(getSideBar(), false);
      }
      return { result: true };
    case 'capturePageData': return { success: await setActiveSessionPageData(await getMyTabId()) };
    case 'callContentExtractor': return { result: await handleContentExtractorCall(request) };
    case 'toggleSidebar': await setSidebarOpen(!getHostState().open, true, true, true); return { result: true };
    case 'toggleSelectElement':
      isElementSelectionActive = request.selection === true;
      if (!isElementSelectionActive) { clearAllElementDecorations(); }
      else { await setSidebarOpen(true, true, true, true); }
      return { result: true };
    case 'getContextMenuImageBounds': return getContextMenuImageBounds();
    case 'scrollContextMenuImageIntoView': return scrollContextMenuImageIntoView();
    case 'hideLocalAIForImageCapture': return hideLocalAIForImageCapture(request.rect);
    case 'restoreLocalAIAfterImageCapture': return restoreLocalAIAfterImageCapture();
    case 'waitForImageCaptureFrame': return new Promise(resolve => requestAnimationFrame(() => resolve(true)));
    case 'activePageSelection':
    case 'inserSelectedInPrompt':
    case 'explainSelection': {
      const selection = window.getSelection()?.toString().trim() || request.selection;
      const state = await setSidebarOpen(true, true, true, true);
      return sendToSidebar(request.action, { selection, url: state.url, title: state.title }, true);
    }
    case 'activePageContent': {
      const content = await cleanPageContent();
      const state = await setSidebarOpen(true, true, true, true);
      return sendToSidebar(request.action, { content, url: state.url }, true);
    }
    case 'attachCroppedContextMenuImage':
      await setSidebarOpen(true, true, true, true);
      return sendToSidebar(request.action, { base64: request.base64 }, true);
    case 'streamData':
    case 'streamEnd':
    case 'streamAbort':
    case 'streamError':
      // Route via the top frame because unscoped Chrome delivery to extension
      // frames is unverified. Only the UI can acknowledge a stream request.
      return sidebarReady && getHostState().open
        ? sendToSidebar(request.action, request)
        : { requestId: null };
    case 'showMessage':
      if (!request.message) { return { result: true }; }
      await setSidebarOpen(true);
      return sendToSidebar(request.action, request, true);
    case 'updateStatusbar':
    case 'dumpInConsole':
      notifySidebar(request.action, request);
      return { result: true };
    default: return undefined;
  }
}
