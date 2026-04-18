# Local AI - Changelog

## [1.29.59] - 2026-04-18 - latest

### Cloud Model List

- Cloud tab now shows the full Ollama cloud catalogue, not only previously used models
- Last cloud model list update timestamp stored in local storage
- Cloud tab title attribute shows staleness: "Cloud models updated today", "last updated N days ago", or "never loaded — click to refresh"
- Timestamp is written and title updated automatically after every successful cloud fetch

### Model Switch Fix

- Fixed false "Failed to load model" error on every model switch
- Replaced status checks so any 2xx response is treated as success

## [1.29.56] - 2026-04-16 - latest

### Session Rename

- Added inline rename button to each session history menu item
- Separated session title to handle properly the click, confirmed on Enter or blur
- Added `renameSession` — saves the new title and prevent later auto-title overwriting
- Session element structure refactored to accommodate the rename button
- Added separate styles for the buttons to distinguish it from each other

### Session Title Generation

- Title generation is now fire-and-forget so it no longer blocks the UI after the first turn
- No longer appends a stale session fragment — the generated title replaces it wholesale
- Added clean raw model output: strips leading `title:` labels, removes punctuation and quotes, limits to 5 words
- Title generation prompt rewritten for plain-word, no-punctuation output
- Title generation temperature lowered to `0.1` and `top_p` to `0.2` for more deterministic title output
- `-cloud` suffix is no longer stripped before the title API call — Ollama uses the full name (e.g. `gpt-oss:120b-cloud`) to route cloud models
- Auto-title is now skipped when `titleManual` is set

### Model Catalogue

- `getModelCatalogue` now accepts an `includeCloud` flag; cloud fetch is isolated so a cloud failure does not block local models
- Catalogue response now carries an `errors` map so callers can distinguish partial failures
- `scope` field added to the cached catalogue (`'local'` or `'all'`) to avoid cache misses when cloud was not originally requested
- `fetchModelCataloguePayload` now accepts a direct `https://.../api/tags` URL in addition to a base API URL
- Cloud model list can be independently refreshed via the new button
- `getModelSummary` and `getModelInfoFromApi` propagate `includeCloud` based on the `-cloud` suffix

### Stream Handling

- Stream Response now accepts an `AbortSignal` and checks `signal.aborted` on each iteration, throwing `AbortError` immediately
- `streamFinished` flag added so the block only cancels the reader on premature exit, not on normal completion
- Early-return guard removed — abort message now always reaches the background

### Debug Helpers

- Added `globalThis.localAIHelpers.getLastRawResponse` and `dumpLastRawResponse` for in-browser debugging
- Now raw response is kept in sync after each chunk and reset
- Noisy stream-chunk debug log replaced with a commented-out block

## [1.29.53] - 2026-04-16

### Abort Handling Fixes

- Fixed abort button having no effect during streaming — early-return guard which is set from the first chunk, blocking the abort message from ever reaching the background
- Fixed `streamAbort` switch case falling due to incorrect case ordering
- Fixed returning early with no content on abort — added fallback when response body carries no content (as abort messages do)
- Fixed Stream Response continuing to process buffered chunks after abort
- Fixed cancelling the reader on normal completion instead of premature exit
- Fixed `streamEnd` being delayed until after title generation — title generation is now fire-and-forget so it no longer blocks the UI notification
- Fixed "no such model" error in session title generation for cloud models — `-cloud` suffix is now stripped before the title-generator API call

## [1.29.50] - 2026-04-14

### Model List Refactor

- The static model-list structure is no longer recreated on every open
- Extracted tab-click and refresh-button handlers into standalone functions and registered them properly
- Model List now receives the full response payload and splits models into local/cloud group once; both panels are targeted and repopulated in place instead of being recreated
- Active tab is now always derived from where the active model lives
- Active Tab is now synced on every list open, not only on tab click
- Bug fixed with refresh button location - now it is resolved from the shadow DOM
- The model list tab resolves now properly on click
- Active model indicator refactored to be consistent
- Guard for missing model name moved before filling the name
- Refresh button spin animation fixed

## [1.29.45] - 2026-04-13

### Models And Ollama Cloud

- Added a provider-aware model catalogue backed by Ollama with cached per-model metadata
- Added grouped local and cloud model browsing in the sidebar and options page
- Added remembered local/cloud model-tab state in the sidebar model picker
- Added a safe cloud fallback state instead of failing when no cloud models are available
- Documented the signed-in local Ollama path for Ollama Cloud usage without storing API keys in the extension

### Context Window

- Added automatic context selection for local models when the active model exposes a context length and the user has not set it manually
- Left cloud models on provider defaults for the first pass

### Streaming

- Added streamed Ollama chat response handling in the background worker
- Added live plain-text progress in the sidebar while a reply is being generated
- Kept the final rich markdown render as a single completion-step render
- Kept raw streamed payloads available for debugging when debug mode is enabled

### Validation

- Added unit coverage for the new model catalogue, automatic context window, and streamed response helpers
- Verified the local/cloud model browser live in Chrome
- Verified the new streamed response behaviour live in Chrome

## [1.29.37] - 2026-03-30

### Message Passing Fixes

- Fixed content-extractor message passing so extracted page content is returned reliably to the worker instead of occasionally resolving to a bare `true`
- Refactored the content-script runtime message handler to use a single response path
- Removed redundant `sendResponse` handling, which now returns extracted content directly

### Context Handling

- Removed duplicated page-context injection for `@{{page}}` so non-tool models no longer receive the same page content twice

## [1.29.34] - 2026-03-29

### Browser-Session Web Search

- Added `search_web` internal tool allowing the LLM to search the web using the user's configured search engine
- Search opens a reusable background tab (visible, non-active) and reuses it across requests — tab ID persisted in `chrome.storage.session`
- Added search engine registry with URL builders, SERP CSS selectors, and URL filters/decoders for DuckDuckGo, Google, and Bing
- Added web search orchestrator handling tab lifecycle, SERP scraping, result page content extraction, captcha/consent detection, and result assembly
- Added search engine setting (default: DuckDuckGo) and search result count setting (default: 3, max: 5) to General Settings
- Fixed save settings in options page not persisting plain values

## [1.29.28] - 2026-03-27

### Bug Fixes

- Fixed internal tools silently returning empty results
- Fixed grouped LinkedIn experience entries mislabelling bare tenure strings
- Fixed emitting multi-paragraph promotional blurbs

## [1.29.27] - 2026-03-27

### LinkedIn Experience Section Normalisation
- Added self-contained LinkedIn profile extractor
- Detects LinkedIn profile pages and replaces the raw section with normalised output
- Handles grouped layout (company header + role list) and standalone layout (role-first entries)
- Uses stable selectors
- Filters "Show all" / "Show less" LinkedIn UI noise
- Updated LinkedIn related content output format

### Page Content — On-Demand Extraction
- Removed eager page-content pre-load on navigation and tab activation
- `@{{page}}` parameter now extracts content fresh from the live DOM at request time
- Page content is persisted to session history only after it is actually sent to the model
- Removed `redundant message handlers
- Simplified page read from session DB only
- Purge stale page storage keys left by earlier installations — called once at service-worker startup; planned for removal after v1.31.x

## [1.29.20] - 2026-03-23
- Fixed content filtering missing some pre-defined elements
- Fixed prompt placeholder bug causing casual empty content
- Other minor fixes

## [1.29.18] - 2026-03-22

### New Features
- Added thinking/reasoning display support for models with thinking capabilities
- Thinking content now rendered as collapsible "🤔 Thought" sections in UI
- Thinking is not stored in database or session history

### Bug Fixes
- Fixed rendering in thinking blocks
- Fixed critical message passing bug preventing proper returning results
- Fixed await async responses bug
- Enhanced tool error messages
- Tool error messages now list available tools to guide model selection
- Fixed on-demand page capture failure during startup
- Fixed thinking-only replies persistence mismatch
- Thinking-only responses now skipped during display to match history persistence behaviour
- Messages without content or tool_calls are not saved to history
- Eliminated unnecessary latency on first page-tool request for uncached tabs
- Removed duplicate functions
- Unified functions with automatic context detection in utils.js
- Detects service worker context
- Automatically uses proper message depending on the execution context

### Code Refactoring
- Fixed functions naming conflicts
- Fixed race condition in model capability detection during model swap
- Centralised some helper functions

### Tests
- Added comprehensive tests (14 test cases)
- Added test for thinking-only response skipping behaviour
- Added test for thinking display when tool_calls present but no content
- Updated existing test to verify thinking-only responses are skipped
- Added test coverage for page-capture functions in sessions.test.js (3 test cases)

## [1.29.15] - 2026-03-18

### Page Data Retrieval Fix
- Fixed "no page available" error when model requests page content with `@{{page}}` placeholder
- Added utility to handle missing or invalid tab IDs with fallback to active tab
- Added utility to validate tabs support content scripts (http/https only)
- Transformed Page Data getter from passive retriever to active data provider
- Added a trigger to capture the page data when data missing
- Added return success/failure status for data capture
- Added tab ID validation at all entry points
- Added capture Page Data message handler in content script
- Imported required script into background service worker
- Added comprehensive test coverage for new validation functions (12 new test cases)
- Fixed storage key mismatch issue caused by undefined tab IDs
- Improved error handling for non-http(s) tabs (chrome://, about:, extension pages)

## [1.29.10] - 2026-03-04

### Thinking Response Handling Fix
- Fixed thinking-only responses causing empty content display in UI
- Thinking-only responses no longer sent to frontend, only logged in worker console
- Added status bar feedback "Thinking completed, awaiting response..." for thinking-only replies
- Simplified frontend extraction logic

## [1.29.08] - 2026-03-03

### Thinking Response Handling
- Fixed `thinking` only responses (without `content`) to be handled properly
- Thinking-only replies are not stored in the history
- Updated the UI response handler rendering `Empty content!` when thinking reply occurs
- Output thinking in worker debug console

## [1.28.98] - 2026-03-01

### Session Title Generation
- Refactored session title generation to execute in background worker after first turn
- Removed redundant message passing between worker and content script for title generation
- Removed obsolete userPrompt message flow and related functions (storeLastGeneratedPrompt, dumpRawContent)
- Added titleGenerated flag to sessions to prevent repeated title generation
- Cleaned up legacy pre-session-handling code
- Added navigation facilitation shortcuts in the options page

### Options Page Enhancements
- Added Title Generator model selector to allow using a different model for generating session titles
- Added Archived Session Retention Period field (days) with 0=forever option
- Added keyboard navigation shortcuts:
  - Ctrl+Home: Jump to first section (General)
  - Ctrl+End: Jump to last section (Functions)
  - Ctrl+Shift+PgUp: Previous section (with wrap-around)
  - Ctrl+Shift+PgDn: Next section (with wrap-around)
  - Ctrl+S: Save settings (existing)
- Added keyboard shortcuts hint panel in sidebar with styled kbd elements

### Session Management
- Session archiving now respects user-defined retention period
- If retention is set to 0, archived sessions are kept forever (no purging)
- If retention is not set, defaults to 2 days (ARCHIVE_RETENTION_DAYS)

## [1.28.97] - 2026-02-28
- Sanitising and bug fixing.

## [1.28.90] - 2026-02-24

### Page Content Filtering Commands
- Added page content filtering command
- Added Page filter toggle button to status bar with text

### Bug Fixes
- Fixed page content extraction message passing
- Added automatic page data refresh on tab activation

## [1.28.87] - 2026-02-22

### Enhanced Content Extraction System
- **Intelligent selective content extraction tools** allowing AI to query specific page elements instead of extracting everything
- **Six new internal tools** for structured page analysis
- **Metadata extraction** from Open Graph tags, JSON-LD, and meta tags including author, publish date, description, and keywords
- **Smart main content detection** using semantic HTML5 elements and heuristics to isolate article content from navigation
- **Structured data preservation** maintaining hierarchy for lists, markdown formatting for tables, and language detection for code blocks
- **Token efficiency gains** of 70-90% for specific queries through selective extraction vs full page dumps
- **Service worker to content script communication** architecture ensuring DOM access whilst maintaining extension security model

### Files Added
- Content extractor module with selective and full-page extraction capabilities
- Console test helpers for validating extraction quality on any webpage
- Comprehensive documentation of extraction tools and usage patterns

## [1.28.82] - 2026-02-22

- **Implemented model metadata caching** to reduce redundant API calls
- **Added dedicated embedding endpoint and model configuration**
- **Reorganised options page into two-column grid layout**
- **Fixed cross-tab contamination**: Page content is now scoped by tab ID to prevent Tab A's content from appearing in Tab B's session
- **IndexedDB schema upgraded** from version 1 to 2 with new EMBEDDINGS store
- **`search_conversation_history`**: Semantic search across conversation history with scope
- **`get_conversation_turn`**: Retrieve specific conversation turn by number from current session
- **`list_recent_sessions`**: List recent chat sessions sorted by last access time with titles and timestamps

### Bug Fixes
- Fixed `Cannot read properties of null (reading 'pageContent')` error in internal tools
- Modified internal tools to accept `tabId` parameter
- Added null-safety checks using optional chaining in url and page content tools

### Session Archiving and Cleanup
- **Session timestamps**: Added timestamps to all sessions
- **Archive system**: Implemented session archiving with 2-day retention policy

## [1.28.73] - 2026-02-18

- Added command hint box above the input area, triggered by `/` (slash commands) or `@` (context placeholders)
- Hint box filters the matching list as the user types and hides on non-matching input
- Arrow keys navigate the list; Tab appends the completion suffix; Escape dismisses
- Fixed `rootElement.getElementById` error in `getARIAContext` — replaced with `querySelector`
- Fixed missing closing bracket and misplaced `return` in `getARIAContext`
- Fixed typo `$err.message` → `err.message` in `getARIAContext` error handler

## [1.28.58] - 2026-02-15

- Refactored the session management.
- Refactored context management.
- Split UI and context history for clarity
- Added additional commands to user input
- Added internal tool call handling for page browsing
- Separated internal from user tools (external resources)
- Added global page filtering to reduce context noise
- Added per domain filtering for fine-tuning what page content will be included in the context
- Added image format validation using magic byte detection to prevent misidentified file formats
- Added support for GIF images alongside PNG and JPEG formats
- Enhanced image handling to detect actual format regardless of file extension or MIME type
- Fixed issue where WebP images disguised as PNG files would crash Ollama's llava:7b model
- Improved error messages for unsupported image formats

## [1.28.28] - 2025-08-04

- bug preventing communication with the server fixed

## [1.28.25] - 2025-08-01

- Action ribbon is now globally available and supports injecting predefined prompts even when the input area is inactive.
- Fixed an issue where menus could unexpectedly close.
- The "Thinking Mode" button now checks whether the active model supports thinking mode.
- The "Tools Mode" button now verifies if the active model can handle external tools.

## [1.28.22] - 2025-07-18

- Added new prompt area button ribbon for quick access to features
- Added quick prompt menu for direct prompt injection
    - Included prompt filter for easy prompt search by name
    - Enabled quick access to stored prompts with enhanced manipulation options
- Added library button (reserved for future use)
- Added erase button to clear the user input area

## [1.28.15] 2025-07-12

- Added hot reload after extension update.
- Removed redundant snippets

## [1.28.10] 2025-07-11

- Added more information in the background messages logged in the front space
- Simplified the log entry by shortening the location.
- Refactored messaging communication to mitigate "The message port closed before a response was received." messages.
- Removed redundant snippets.

## [1.28.05] 2025-07-10

- Added a new command to pull active model information
- Added a new command to show last message
- Added links to documentation for some of the elements
- Added a help menu

## [1.28.0] 2025-07-01
- New extension settings page
- Changes in the General Settings section are detected and the window won't be closed if there are changes not saved yet.
- Added links to the help documentation
- Bug fixes
- Improved model capability detection (if server provides information)
- Documentation updated

## [1.27.93] 2025-06-29
- Model tool usage detection is now available.
- Detection of model thinking capabilities was added.
- Bug fixes

## [1.27.90] 2025-06-28
- Added the ability to switch thinking on or off (available in Ollama).
- Added session name generating calls
- Tool availability is now tied to the session.
- Extension options updated
- Instead of storing status, the model is checked on the fly for tool support. If it supports tools, they’re included; if not, they’re left out.

## [1.27.85] 2025-06-26
- Message exchange bug fixed
- Dynamic setting Model options bug fixed
- Added Help in the main menu
- Added help in the model settings menu

## [1.27.80] 2025-06-25

- Fixed a bug that was duplicating attachment icons
- Refactored model calls to simplify the code base
- Fixed Firefox select element bug when document has iframes
- Added some useful Model modifiers menu

## [1.27.72] 2025-06-12

- Attachments are now visible when the input field is focused.
- AI session title generation has been added.
- The session menu can now be scrolled.
- If a session menu item's title is too long to fit, it will be displayed as a tooltip.

## [1.27.70] 2025-05-20

- Main menu not closing - fixed
- Page content scrapping improved
- Fix problem with changing the model when the active one has been deleted
- Adjusted the list of models.


## [1.27.68] 2025-04-27

- replace session index with unique id
- fixed bug in deleting session by index
- attachment are now kept in the session history
- user input support some markdown formating
- fixed layout to be independent from the layout of the page rendered in the active tab
- fixed `rendering` event to avoid gaps on longer text chunks

## [1.27.60] 2025-04-26

- hooks removed
- undefined context fixed
- overlapping the sidebar fixed

## [1.27.58] 2025-04-25
- Optimised menu button click handlers.
- Added delete individual history record from the history menu
- Separated AbortControllers per‑tab replacing a single global controller/abort flag.
- AbortController now cancels only the current tab’s request.
- Removed obsolete objects and logic.
- Enhanced session management with lazy creation with fallbacks to avoid undefined errors.
- Refactored session storage helpers to handle return of undefined on error.
- Fixed Options storage call.
- Corrected error handling and return values from storage get/set.
- User Import listens for change, and cleans up the element after use.
- Added imports guard against missing file, parses JSON safely, uses proper error variables, and always removes the input.
- Export As File revokes object URL after download, and removes the temporary link element.
- Refactored element positioning calculation.
- Simplified get Line Number used in console messages.
- fixed Recycle Current Session Btn event listener to avoid errors when element is missing.
- Spinner ensure side bar exists before operations, and improved error logging.
- Show Message now catches errors from asynchronously opening the sidebar when displaying messages and logs them to avoid silent failures.
- Restoring Options now displays an error message and falls back to default options if loading stored options fails.
- Extension Main Button now guards against undefined button elements, logs an error, and returns early to avoid appending `undefined`.
- Improved menu close behaviour.
- Fixed session creation logic to correctly identify when no session exists.
- hooks were replaced by tools and functions
- Session now stores the model as well
- Additional menu added to insert selection into the prompt box

## [1.27.45] 2025-04-14

- fixed ordered links rendering bug
- transformed the version label
- fixed rendering event bug
- fixed normalization of markdown source

## [1.27.41] 2025-04-12

- fixed autoscroll
- fixed bug in fonts and colours in some pages
- fixed rendering event bubbling
 - fixed scrolling behaviour separating extension and page scrolling behaviour.
- enhanced rendering of output from reasoning models.

## [1.27.30] 2025-04-06

- Improved event raised by the markdown parser
- Added built-in function allowing to query the active tab URL and loaded page content
- fixed some bugs related to function calls
- optimised function calls
- optimised messages shown to the user for better understanding
- Added dynamic enabling and disabling of the tools for optimisation of the interaction with the AI
- fixed some bugs with chat parts buttons

## [1.27.22] 2025-04-06

- Completely rewrote the session management.
- Added the ability to name session history for easier restoration.
- Synced chat history changes with the active session.
- Redesigned dynamic chat menus.
- Implemented the newest Markdown parser features.
- Introduced internal tool functions for rendering the active page in the current tab.
- Enhanced the options page.
- Improved the import, export, and deletion functions for user commands.
- Improved the import, export, and deletion functions for user tool functions.
- Moved related button from the "General" section to the associated script.
- Designated Ollama as the primary API endpoint, deprecating others.

## [1.24.52] 2025-03-31

- Replaced the Markdown processor to improve output handling.
- Bug fixed

## [1.24.33] 2025-03-29
- Added tool functions to extend LLMs that support them as part of the prompt, such as Llama 3.2.
- Enhanced image functionality: users can now select an image on the page and/or attach an image as context for the prompt.
- Extended user input edit allowing to exeute the prompt again after adjusting contents
- Sync session with the edit
- Added global option to set default prompt temperature.
- Added per-prompt temperature control, temporary until tab reload or user adjustment.
- Documentation page was updated withe the latest changes.
- fixed missing system instructions
- fixed some false error messages
- fixed missing attaching icon for pages and sections
- improved prompt context
- fixed adding images to the prompt

## [1.22.58] 2025-01-30
- Attachments bug fixes
- Custom commands bug fixes
- Accepts selection of multiple page snippets

## [1.22.47] 2024-12-16
- `Select and Send Element` now separate image from text elements and prompt them accordingly. Processing images required LLM that supports it, like llama3.2-vision
- Some bugs were fixed.

## [1.22.37] 2024-12-09 - latest
### Options page
- Added `test connection` button
- Added converting binary to text service and point
- Added list of user prompt
- Added ability to add, edit and delete prompts
- Added user prompts import and export
- Added connection check

### Side panel
- Improved injecting active tab's page into the context
- Removed binary content handler and replaced it with converting it to text
- Fixed issues with `Ask AI To Explain Selected` action
- Fixed issues with `Select and Send Element`
- Selected element is not added in the context rather in the user input field
- More than one selection may be added to the context.
- The response is possible to be inserted in element allowing input by point-and-click
- Response formatting parser has some improvements
- Added endpoint for document processing
- A number of bugs fixed
- Improved showing background messages to the user

## [1.17.68] 2024-09-01

- added a new predefined user command - `udump` - sending the raw content to the console with the generated prompt combining all included resources
- added check if any broken extension prevents loading
- added a finite (5) attempts to rebuilt the extension in case anything external breaks it.
- several small bugs fixed

## [1.17.33] 2024-08-27

- copy to clipboard looses formatting was fixed
- AI response now stored as a row content and could be reviewed in the console
- added new predefined user command - `dump` - sending the raw content to the console
- minor bugs fixed
- added information specific for the Firefox speech settings in case of problems

## [1.16.36] 2024-08-20

- Added Speech recognition (sound-to-text or STT)
- Updated documentation

## [1.15.86] 2024-08-15

- Fixed file type check when dropped
- Refactored request JSON composition reducing the iterations
- Improved error reporting
- External resource missing content bug fixed
- Facilitated model change for Ollama API
- Added more menus in the cog button.
- Added `/hook` command to list the available functions available on the given webHook server
- Command `/hook` added to the predefined commands
- Added a status bar providing information about various statuses
- Added separate documentation

## [1.13.3] 2024-07-27

- fixed issue with context menu
- fixed permission issue for external resources call
- resolved issue with calling external resources
- improved error handling and notification for background issues

## [1.12.90] 2024-07-25

* Fixed bug in getting the selection used by "Ask AI to Explain Selected" context menu.
* Fixed bug related to text structure when Select and Send Element is used.
* Simplified communication between frontend and backend.
* Added external resources endpoint calls

## [1.12.3] 2024-07-16
* lost contact with the background when executing some prompts has been fixed.
* Added user commands `import` and `export` to the main menu.
* Added user commands `import` and `export` to the cog menu.

## [1.11.51] 2024-07-15
* some bugs fixed
* added buttons to increase or decrease font-size for individual chat block
* added `new` button to create a custom command from executed prompt.
* chat related buttons positioned better to avoid overlapping the content.

### Custom commands
* fixed a bug preventing change of the command name
* added `edit` to directly load custom command in the editor

## [1.10.13]

### Options
* added multiple API endpoints
* added model list - automatically populated with all available models related with `Ollama`

### UI
* added menu to switch AI API endpoints and models
* added support for custom commands - predefined prompts labelled from the user
* added dynamic help options
* added attachments
* added custom commands related actions - edit, delete, paste, execute


## [1.8.10]

* added contex menu "Explain" with current page context
* changed @{{page}} to represent content
* added @{{source}} to represent html

## [1.7.30]

* added user command import and export
* added session export
* added removing sessions
* added removing user commands
* more buttons in the ribbon


## [1.6.50]

* added user commands
* added user command editor
* added user command list
* added buttons to user command list

## [1.5.90]

* added attachements
