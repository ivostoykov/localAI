# localAI

### Use local AI within the browser

![alt text](media/localAI.png)


Oh! Antohter AI tool!

Why, indeed? Well, even those AI tools that support web browsing can't reach all web contents. If interested in the topic search the web or take a look [here](https://www.technologyreview.com/2024/03/19/1089919/the-ai-act-is-done-heres-what-will-and-wont-change/).

In short, AI are not allow to access all and every content. But you as an user can do it. And here is where this tools comes handy. It uses the content loaded into a tab allowing it to help you with some tasks - summarising for instance.

So, what can it do? It works with your current active tab only. It keeps all data local - no share, no sending or storing your actions for later. You have the full control. You decided whether to keep it ot delete it.

Additionally, you can define, store (locally of caurse) and execute predefined prompts.

Apart from that it works like any other AI UI - ChatGPT, Open WebUI, Llamafile, etc.
It is just an interface to your preferred local AI tool.

Suppored tools are (those providing a local endpoint API):

* [LM Studio](https://lmstudio.ai/)
* [Open WebUI](https://docs.openwebui.com/)
* [Mozilla LlamaFile](https://github.com/Mozilla-Ocho/llamafile)

To use it you need:
1. One or more of those need to be up and running on your local system.
2. Extension for your browser:

| | Browser | Extension |
|-|---------|-----------|
| | Chrome |  [link](http://localhost)|
| | Firefox |  [link](http://localhost)|


Upon installation of this extesion you'll see the icon in the bottom-right corner. It'll respond to the mouse hover/over:

![Main Icon](media/main_icon.gif)

Click it to open the main UI:

<img src="media/UI.gif" height="600" />




## Troubleshoot

#### Ollama 403 Error

1. sudo nano /etc/systemd/system/ollama.service
2. Add this line in the mentioned section

```
[Service]
Environment="OLLAMA_ORIGINS=*"
```
3. Save and exit
4. restart the service

```
sudo systemctl daemon-reload
sudo systemctl restart ollama
```