# Local AI - Changelog

## [1.28.22] - 2025-07-18 - latest

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
- Resoring Options now displays an error message and falls back to default options if loading stored options fails.
- Extension Main Button now guards against undefined button elements, logs an error, and returns early to avoid appending `undefined`.
- Improved menu close behaviour.
- Fixed session creation logic to correctly identify when no session exists.
- hooks were replaced by tools and functions
- Session now stores the model as well
- Additional menu added to insert selection into the prompt box

## [1.27.45] 2025-04-14

- fixed ordered liks rendering bug
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

- Improved event raised by the markdow parser
- Added built-in function allowing to query the active tab URL and loaded page content
- fixed some bugs related to function calls
- optimised function calls
- optimised messages shown to the user for better understanding
- Added dynamic enabling and disabling of the tools for optimisation of the interaction wtih the AI
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
- Accepts selection of mupliple page snippets

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
- added a finitive (5) attempts to rebuilt the extension in case anything external breaks it.
- several small bugs fixed

## [1.17.33] 2024-08-27

- copy to clipboard looses formatting was fixed
- AI response now stored as a row content and could be reviewed in the console
- added new predefined user command - `dump` - sending the raw content to the console
- minor bugs fixed
- added information specific for the Firefox speach settings in case of problems

## [1.16.36] 2024-08-20

- Added Speech recognition (sount-to-text or STT)
- Updated documentation

## [1.15.86] 2024-08-15

- Fixed file type check when dropped
- Refactored request JSON composition reducing the itterations
- Improved error reporting
- Extgernal resource missing content bug fixed
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
* added menu to switch AI API andpoints and models
* added support for custom commands - predefined prompts labled from the user
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
