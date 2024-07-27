# Local AI - Changelog

## [1.13.3] 2024-07-27 - latest

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
