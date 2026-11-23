Tor Browser blocks localhost (127.0.0.1) by default to prevent fingerprinting and keep traffic routed through Tor. Depending on whether you want a direct local connection or a Tor onion service, there are two main ways to use localhost with Tor Browser.

## Bypass the Proxy for Localhost (Direct Connection)

Use this to open a local app or server directly without routing through the Tor network.

1. Open Tor Browser and go to about:config.
2. Accept the risk warning if prompted.
3. Search for network.proxy.no_proxies_on.
4. Set its value to localhost, 127.0.0.1.
5. Save the change and load your local URL (such as http://127.0.0.1:8000).

Note: Bypassing the proxy stops traffic for those addresses from going through Tor. For normal local testing, a standard browser is often simpler.

[Custom startpage homepage gives "localhost" error?](https://forum.torproject.org/t/custom-startpage-homepage-gives-localhost-error/20890)
[Direct access to localhost & LAN addresses](https://forum.torproject.org/t/direct-access-to-localhost-lan-addresses/20987)
[Why Tor cant access localhost pages](https://stackoverflow.com/questions/13060096/why-tor-cant-access-localhost-pages)