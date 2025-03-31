# Local AI - Changelog

## [1.24.52] 2025-03-31 - latest

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
