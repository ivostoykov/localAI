var debugEnabled = false;
var manifest = chrome.runtime.getManifest();

var storageOptionKey = 'laiOptions';
var storageUserCommandsKey = 'aiUserCommands';
var activeSessionKey = 'activeSession';
var activeSessionIdKey = 'activeSessionId';
var allSessionsStorageKey = 'aiSessions';
var archivedSessionsStorageKey = 'archivedSessions';
var storageToolsKey = 'aiTools';
var activePageStorageKey = 'activePage';
var MAX_SESSION_PAGES = 5; // Maximum pages to keep per session
var ARCHIVE_RETENTION_DAYS = 2; // Keep archived sessions for 2 days
var mainHelpPageUrl = 'https://github.com/ivostoykov/localAI/blob/main/documentation.md';
var modifiersHelpUrl = 'https://github.com/ivostoykov/localAI/blob/main/documentation.md#modifiers';
