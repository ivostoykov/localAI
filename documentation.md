# localAI

### Use local AI within the browser

![alt text](media/localAI.png)

- [Usage](#usage)
- [The Panel](#the-panel)
    - [Ribbon](#ribbon)
        - [Menu](#menu)
        - [Session](#session)
- [System Instructions](#system-instructions)
    - [Other](#other)
    - [User Input (Prompt Area)](#user-input-prompt-area)
        - [Speech Recognition](#speech-recognition)
        - [Attach file](#attach-file)
        - [Commands](#commands)
            - [System commands](#system-commands)
            - [Custom Commends](#custom-commands)
- [Options](#options)
    - [End Points](#end-points)
        - [Models](#models)
    - [Web Hooks](#web-hooks)
        - [Format](#format)
- [Troubleshoot](#troubleshoot)
    - [Ollama](#ollama)
        - [403 Error](#403-error)

---

# Usage

Upon installation of this extension, you'll see the icon in the bottom-right corner. It will respond to mouse hover/over.

![Main Icon](media/main_icon.gif)

Hover the top of the head on the bottom right corner with the mouse and the head will come out:

![Hidden head](media/hidden_head.png)

The red cross near the ear allows temporarily hiding the head—only for the current tab and until it is reloaded.

![Temporary close](media/red_cross.png)

# The panel

Click the icon to open the main UI.

<img src="media/UI.gif" height="600" />

## Ribbon
![alt text](media/ribbon.png)

The ribbon at the top gives some quick access options:
From left to right there are:

### Menu
Click to toggle the menu

<img src="Chrome/img/cog.svg" height="48" alt="Menu"/>

The changes made here are temporary for the session, (until reload) and for the current tab only.

![Submenus](media/menu.png)

* On the top is the API endpoint where AI prompts are sent to.
* If [Ollama](https://ollama.com/) is used as an endpont, next dropdown will be populated with the available model names. **It is mandatory** to select one, otherwise an error will be trown.
* See [Web Hook](#web-hooks) for more information
* Create a new prompt and save it for future use.
* Show a list of predefiend and save prompts.
* Show a list of the availabel system commands.
* The last menu will open extension's options in a new tab.

#### Chanking [Ollama](https://ollama.com/) model

You can switch models in two ways: through the [Menu](#menu) or by hover the mouse over the current model name at the top of the [Ribbon](#ribbon). The model you're using will have a checkmark beside it.

![Model list](media/modelslist.png)

When you hover over the [Ribbon](#ribbon), you'll see the extension's version number pop up.

![version](media/version.png)

### Session
<img src="Chrome/img/plus.svg" height="30" alt="New Session"/> - new session

<img src="Chrome/img/history-icon.svg" height="30" alt="Load Session"/> - Show session list. Click to reload any.

<img src="Chrome/img/recycle.svg" height="30" alt="New Session"/> - Delete sessions

Sessions can be managed also from the [Options](#options) page.

# System instructions

<img src="Chrome/img/wrench.svg" height="30" alt="New Session"/> - Edit system instructions. **Only for the session**. Use the [Options](#options) page to set permanent system instructions.

<img src="media/instruct.png" height="400" alt="New Session"/>

## Other

Click <img src="Chrome/img/pushpin.svg" height="30" alt="New Session"/> to pin panel.

Click <img src="Chrome/img/black_pushpin.svg" height="30" alt="New Session"/> to unpin panel.

If the pannel is not pinned (default) then clicking outside the panel will hide it. This behaviour can be changed from the [Options](#options) page.

<img src="Chrome/img/close.svg" height="30" alt="New Session"/> - Hide the panel.

> [!Note]
> Clicking the hide button will unpin the panel first, then close it. This means it won’t be pinned the next time you open it.

## User Input (Prompt Area)

When empty, the field provides a brief overview of the available options.

### Speech Recognition

A speech-to-text feature is available to dictate prompts in English. This can be activated by clicking the button located at the bottom right corner of the statusbar. Each click toggles the feature on and off. Once activated, the system will attempt to recognize spoken English words until it is deactivated. Transcriptions will appear in the prompt field.

![Speech Recognition](media/speech_icon.png)

> [!IMPORTANT]
> For speach recognition with Firefox browser look [here](ff.md#speech-recognition-doesnt-work-in-firefox)

Additional information about which browser and how support it is available <a href="https://caniuse.com/speech-recognition">here</a> (`Ctrl + click` (Windows/Linux) or `Cmd + click` (macOS) to open the link in a new tab manually).

### Attach file

Just drag and drop a file.

> [!Note]
> Only plain text files can be used currently.

<img src="media/attach.gif" height="600" alt="attach"/>

Click on the file icon to delete it.

### Commands

#### System Commands

There are two types of commands: system and custom. System commands start with `@` and are enclosed within double brackets `{{}}`. Those are predefined commands and cannot be modified. To view the list of the available system commands type `/help`.

![System commands](media/help.png)

#### Custom Commands

Custom commands are user defined prompts. Usually, those are prompts often used and this will help avoiding repetitive typing the same prompt again and again.

To list all available commands type `/list` and press `Enter`.

![alt text](media/list.png)

On the top of the list there are two buttons: `Close` (<img src="Chrome/img/remove-all.svg" height="26" alt="Close"/>) on the right and `New` (<img src="Chrome/img/new.svg" height="26" alt="New"/>) on the left. Custom commands could be imported (<img src="Chrome/img/import.svg" height="26" alt="Close"/>) and exported (<img src="Chrome/img/export.svg" height="26" alt="Close"/>) from here.

Following are a few predefined commands which connot be changed, with their descriptions: `/add`, `/list` and `/error`.

The rest in the list are the commands created by the User. Above each command there are a few buttons:

![Custom commands](media/cmd_list.png)


To use a predefined custom command type its name after a slash `/` and press `Enter`, or use any of the buttons available:

![Cuntom command buttons](media/cmd_buttons.png)

Pressing `Enter` will execute it as if it has been typed as a prompt text followed by `Enter` key. Buttons above each command give alternative actions related with the command:

<img src="Chrome/img/edit.svg" height="26" alt="Edit"/> - edit command prompt.

<img src="Chrome/img/execute.svg" height="26" alt="Edit"/> - executed the command.

<img src="Chrome/img/paste.svg" height="26" alt="Edit"/> - copy and paste command's content into the prompt area.

<img src="Chrome/img/delete.svg" height="26" alt="Edit"/> - delete this command.

> [!Warning]
> No `Undo` is available,

To view available custom commands, type `/list` in the prompt.

Custom command can include system commands. Example:

```
summarise @{{page}}
```

This will send the content of the page from current active tab to the AI with a requiest to generate a summary.

`New` (<img src="Chrome/img/new.svg" height="26" alt="New"/>) and `edit` (<img src="Chrome/img/edit.svg" height="26" alt="Edit"/>) will open a simple editor:

<img src="media/editor.png" height="500" alt="Editor" title="Editor"/>


# Options

## General Settings

![Options](media/options.png)

### End Points

Add the end point used to query the LLM. Use the buttons to `add` ( <img src="Chrome/img/add.svg" height="25" alt="Add" title="Add"/> ), `delete` ( <img src="Chrome/img/remove.svg" height="25" alt="Remove" title="Remove"/> ), `delete all` ( <img src="Chrome/img/remove-all.svg" height="25" alt="Remove All" title="Remove All"/> ) `sort ascending` ( <img src="Chrome/img/a-z.svg" height="25" alt="Sort Asc" title="Sort Asc"/> ) or `descending` ( <img src="Chrome/img/z-a.svg" height="25" alt="Sort Desc" title="Sort Desc"/> ), and `copy` ( <img src="Chrome/img/copy.svg" height="25" alt="Copy" title="Copy"/> ).

Check if the provided url is accessible using the `test connection` button ( <img src="Chrome/img/testnet.svg" height="25" alt="test connection" title="test connection"/> )

The model list, determined by the endpoint, includes an additional reload button ( <img src="Chrome/img/reload.svg" height="25" alt="Reload" title="Reload"/> ). Deleting or adding models is not possible within this interface and depends on the associated tool.

#### Models

If [Ollama](https://ollama.com/) is defined as [End Point](#end-points), Model list will be automatically populated. Open the list and click the preferable model. You can temporary change it from the [Menu](#menu) in the [Ribbon](#ribbon).

### Document Converter

If a valid URL is provided, documents dropped into the panel will be converted based on the API used. One particularly capable option available for local use is [tika](https://hub.docker.com/r/apache/tika), which supports multiple languages and can be easily installed as a Docker or Podman image. Users can choose any other tool that returns plain text, based on their preference.

-----
> [!IMPORTANT]
> **Web Hooks** will be removed in favor of the document converter.

### Web Hooks

Allows adding a list of predefined API end points to be called before sending the prompt to the model. The resource used must return plain text. Any other type will either be treated as text or throw an error, potentially misleading the model.

The purpose is to enrich the context by providing relevant information when needed, which will improve the quality of the generated response.

The user has complete freedom to choose the type of service they want to use, but the intention is to run the service locally. If needed, this hook can be easily extended to call external services.

**Example Project**: An example project is available on GitHub [here](https://github.com/ivostoykov/localAI_webhook). It provides a simple HTTP server and an option to extend it.

#### Format

To embed a Web Hook, follow this structure:

* `!#` indicates the start of an external call construction.
* `/path/to/the/resource`: This is the endpoint API defined in [Web Hooks](#web-hooks).
* `?`: A separator used if any parameters will be passed.
* `key=value`: A sequence used to pass parameters as a `POST` body.
* `#!`: Indicates the end of the external call construction.

To add web resources as prompt contexts, consider this example project. A script that queries and returns text content is available on [this GitHub repository](https://github.com/ivostoykov/localAI). Once set up, you can pass it in the prompt like so:

```
!#/readweb?resource=https://github.com/ivostoykov/localAI#!
```

The result will be the text content added to the rest of the prompt. The purpose is for this retrieved content to be used as context by the model.

> [!Note]
>  If another API is used, it must abide by two rules:

* Understand the content enclosed between `!#...#!`.
* Return plain text.

> [!IMPORTANT]
> **Web Hooks** will be removed in favor of the document converter.

-----

## User Commands

![User Commands](media/options.png)

Each command is listed as a card.

In the top right corrner there are edit and delete buttons

![User Commands](media/cmd_actions.png)

Each user command nas a `Name`, `Description` and `Body`. The command itselt is the name in lowercase with underscore for the spaces (see [Commands](#Commands) for more information)

# Troubleshoot

After installing or updating [Ollama](https://ollama.com/) it is likely to hit [403 Forbidden error](https://en.wikipedia.org/wiki/HTTP_403). In this case follow the instruction below.

## Ollama

### 403 Error

1. Edit Ollama service
```
sudo nano /etc/systemd/system/ollama.service
```
or with the preferable editor, i.e.:
```
sudo vim /etc/systemd/system/ollama.service
```

2. Add this line in the mentioned section

```
[Service]
Environment="OLLAMA_ORIGINS=*"
```
3. Save and exit
4. restart the service

```
sudo systemctl daemon-reload && sudo systemctl restart ollama
```
