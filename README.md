[![npm](https://img.shields.io/npm/v/hubot-remotestorage-logger.svg)](https://www.npmjs.com/package/hubot-remotestorage-logger)
[![CI](https://github.com/67P/hubot-remotestorage-logger/actions/workflows/test.yml/badge.svg)](https://github.com/67P/hubot-remotestorage-logger/actions/workflows/test.yml)

# hubot-remotestorage-logger

This [Hubot](https://hubot.github.com/) script logs chat messages to
remoteStorage-enabled accounts. It targets **Hubot >= 14** and **Node >= 18**
(ESM).

## Configuration

* `RS_LOGGER_USER`: RemoteStorage user address
* `RS_LOGGER_TOKEN`: RemoteStorage OAuth bearer token for "chat-messages:rw" scope
* `RS_LOGGER_PUBLIC`: Store log files in public folder (doesn't log direct messages)
* `RS_LOGGER_SERVER_NAME`: Optional IRC server name override (defaults to
  `HUBOT_IRC_SERVER`)

## Development

```sh
npm install
npm test
```

## Help

If you have a question about this program, please open an issue for this repo
or [chat with us](https://wiki.kosmos.org/Main_Page#Chat).
