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



# AI response parser

A new Markdown parser is included for an improved experience. It is available as an independent open-source project on GitHub: [solomd2html](https://github.com/ivostoykov/solomd2html). Please use the parser's [Issues section](https://github.com/ivostoykov/solomd2html/issues) for bug reports and suggestions related to the AI output format.

<img src="media/ai_reply.png" height="600" />


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
* Create a new prompt and save it for future use.
* Show a list of predefiend and save prompts.
* Show a list of the availabel system commands.
* The last menu will open extension's options in a new tab.

#### Changing [Ollama](https://ollama.com/) model

You can switch models in two ways: through the [Menu](#menu) or by hover the mouse over the current model name at the top of the [Ribbon](#ribbon). The model you're using will have a checkmark beside it.

![Model list](media/modelslist.png)

When you hover over the [Ribbon](#ribbon), you'll see the extension's version number pop up.

![version](media/version.png)

### Session
<img src="Chrome/img/plus.svg" height="30" alt="New Session"/> - new session

<img src="Chrome/img/history-icon.svg" height="30" alt="Load Session"/> - Show session list. Click to reload any.

<img src="Chrome/img/recycle.svg" height="30" alt="Delete Session"/> - Delete sessions

<img src="Chrome/img/think.svg" height="30" alt="Think"/> - Toggle thinking. When the model [is changed](#changing-ollama-model) the thinking status is adjusted with the model capability.

<img src="media/temperature.svg" height="30" alt="Modifiers"/> - Show some of the model's [modifiers](#modifiers).

Sessions can be managed also from the [Options](#options) page.

### Modifiers

These options control how the AI gives answers. For example, the temperature changes how creative or random the answers are. A low number means more serious and focused replies; a higher one makes them more varied. The seed makes the answers repeatable—using the same seed gives the same result. Other settings help guide how long or detailed the reply should be, or how much it avoids repeating itself.

A helping table with short description is available [here](https://github.com/ollama/ollama/blob/main/docs/modelfile.md#valid-parameters-and-values).

![modifiers](media/modifiers.png)

### Tools

<img src="Chrome/img/tools.svg" height="30" alt="Tools"/> - Enable or disable the tools. Also avaliable in the [Options](#options) page - see [Tools](#functions-tools).


# Context menu

![Context menu](media/context_menu.png)

On each web page (where the tab has a valid `http` location), there is a `Local AI` context menu available by right-clicking.

- **Local AI**: Contains context-dependent menu options.

- **Select and Send Element**: Allows you to select an element on the page to send to the AI for processing. The selected element will be highlighted with a temporary lime-coloured double border. Click inside the element to confirm selection, or press the `Esc` key to cancel.

![Context menu](media/select_and_send.png)

- **Ask AI to Explain Selected**: Sends the selected text to the AI and requests an explanation.

- **Send Selected**: Sends the selected text on the page to the AI. You can include multiple selected elements as context for the prompt.

- **Entire Page**: Sends the entire visible content of the page to the AI as context for the prompt.

- **Options**: Opens the options page to configure the [AI settings](#options).

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

Simply drag and drop a file. If it's an image and the active LLM can process images (vision model), it can be included in the prompts.

#### Images
> [!Note]
> If the LLM can process images (known as vision models), a converter is unnecessary. The image can be attached directly to the prompt, and the model will handle it.
>

Images can be provided as a selected element on the page or pass as an attachment from the local files.

> [!Note]
> Only plain text files and images can be used currently.

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

<img src="media/default_temp.png" width="250" alt="Temperature" title="Temperature"/> Use temperature slider to set default temperature, adjustable anytime from the [Ribbon](#ribbon). The short description is: the lower the value, the stricter the response; conversely, a higher value allows for a more relaxed and creative outcome. If you're interested in learning more about temperature, here is a [helpful article](https://www.hopsworks.ai/dictionary/llm-temperature), or you can simply Google it.

### End Points

Add the end point used to query the LLM. Use the buttons to `add` ( <img src="Chrome/img/add.svg" height="25" alt="Add" title="Add"/> ), `delete` ( <img src="Chrome/img/remove.svg" height="25" alt="Remove" title="Remove"/> ), `delete all` ( <img src="Chrome/img/remove-all.svg" height="25" alt="Remove All" title="Remove All"/> ) `sort ascending` ( <img src="Chrome/img/a-z.svg" height="25" alt="Sort Asc" title="Sort Asc"/> ) or `descending` ( <img src="Chrome/img/z-a.svg" height="25" alt="Sort Desc" title="Sort Desc"/> ), and `copy` ( <img src="Chrome/img/copy.svg" height="25" alt="Copy" title="Copy"/> ).

Check if the provided url is accessible using the `test connection` button ( <img src="Chrome/img/testnet.svg" height="25" alt="test connection" title="test connection"/> )

The model list, determined by the endpoint, includes an additional reload button ( <img src="Chrome/img/reload.svg" height="25" alt="Reload" title="Reload"/> ). Deleting or adding models is not possible within this interface and depends on the associated tool.

#### Models

If [Ollama](https://ollama.com/) is defined as [End Point](#end-points), Model list will be automatically populated. Open the list and click the preferable model. You can temporary change it from the [Menu](#menu) in the [Ribbon](#ribbon).

#### Generative Model

Optional (default: undefined). If set, it will be used internally, for example to generate a session title. As models vary, experiments may help measure its effectiveness.

### Document Converter

If a valid URL is provided, documents dropped into the panel will be converted based on the API used. One particularly capable option available for local use is [tika](https://hub.docker.com/r/apache/tika), which supports multiple languages and can be easily installed as a Docker or Podman image. Users can choose any other tool that returns plain text, based on their preference.

### Functions (Tools)

![User Commands](media/functions.png)

> ![Note]
> This is experimental

Similar to [User Commands](#user-commands) container for [tool & functions](https://platform.openai.com/docs/guides/agents#tools). Here are all the tools your system has ready to serve.

As defined in OpenAI's specification, tools are defined functionalities the model can access to perform specific tasks beyond its typical capabilities. They act as interfaces to external systems or functions, enabling the model to execute commands, retrieve data, or perform calculations directly.

When a tool is included, during interaction, if the model determines a tool's usage is needed, it can call the tool with the specified parameters, facilitating tasks like accessing a database or invoking a web service.

Tools enhance the model's utility, allowing it to handle complex scenarios by integrating real-time data or operations that require exact execution, thus expanding its practical applications beyond generating text to include dynamic data manipulation.

There is one built-in fool function related wtih the active tab, allowing to get the URL and loaded page content. It require to be devined by the user into the Options -> Functions section.

```
{
    "function": {
        "description": "Returns the active browser tab URL and content without need for further web search.",
        "name": "get_tab_info",
        "parameters": {
            "properties": {},
            "required": [],
            "type": "object"
        }
    },
    "strict": true,
    "type": "tool",
    "usage_cost": 1
}
```

> [!Note]
> get_tab_info **must** be declared as `type: "tool"`

> [!Note]
> As per [Llama3 documentation](https://www.llama.com/docs/model-cards-and-prompt-formats/llama3_1/#-tool-calling-(8b/70b/405b)-): *We recommend using Llama 70B-instruct or Llama 405B-instruct for applications that combine conversation and tool calling. **Llama 8B-Instruct can not reliably maintain a conversation alongside tool calling definitions**.*

#### Definition

[OpenAI Documentation](https://platform.openai.com/docs/guides/function-calling?api-mode=responses) provide description of definition structure. Whenever a prompt is sent to LLM those definitions will be included.

#### External Helper Project

For those seeking ideas on implementing the functions, I've created a small project available [here](https://github.com/ivostoykov/llmTools). It can be used "as is" or modified to suit specific needs. For any suggestions, issues, or assistance related to this project, please use the project's own [issue tracking system](https://github.com/ivostoykov/llmTools/issues).

## User Commands

![User Commands](media/user_cmd.png)

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
