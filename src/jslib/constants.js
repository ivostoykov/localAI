var debugEnabled = false;
var manifest = chrome.runtime.getManifest();
var EXT_NAME = manifest?.name ?? 'Unknown';

var storageOptionKey = 'laiOptions';
var storageUserCommandsKey = 'aiUserCommands';
var activeSessionKey = 'activeSession';
var activeSessionIdKey = 'activeSessionId';
var allSessionsStorageKey = 'aiSessions';
var storageToolsKey = 'aiTools';
var activeSessionIdStorageKey = 'activeSessionId';
var activePageStorageKey = 'activePage';
var MAX_SESSION_PAGES = 5; // Maximum pages to keep per session
var mainHelpPageUrl = 'https://github.com/ivostoykov/localAI/blob/main/documentation.md';
var modifiersHelpUrl = 'https://github.com/ivostoykov/localAI/blob/main/documentation.md#modifiers';
