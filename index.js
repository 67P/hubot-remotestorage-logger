/* Description:
 *   Logs chat channel messages to a remoteStorage-enabled account
 *
 * Configuration:
 *   RS_LOGGER_USER: RemoteStorage user address
 *   RS_LOGGER_TOKEN: RemoteStorage OAuth bearer token for "chat-messages:rw" scope
 *   RS_LOGGER_PUBLIC: Store log files in public folder (doesn't log direct messages)
 *
 * Notes:
 *   Some code translated from hubot-logger
 *
 * Author:
 *   Sebastian Kippe <sebastian@kip.pe>
*/

import XHR from 'xhr2'
import { TextMessage } from 'hubot'

// remoteStorage.js is a browser library and expects the XMLHttpRequest API to
// be available globally when it is loaded.
globalThis.XMLHttpRequest = XHR

const { default: RemoteStorage } = await import('remotestoragejs')
const { default: ChatMessages } = await import('remotestorage-module-chat-messages')

const remoteStorage = new RemoteStorage({
  cache: false, // TODO re-enable default caching (SEEN) when getListing maxAge is fixed
  modules: [ChatMessages]
})

// Response methods whose output is archived.
const LOGGED_METHODS = ['send', 'reply', 'emote']

// Map a hubot room to its remoteStorage archive channel info.
//
// In hubot >= 14 the adapter name is the adapter class name (e.g.
// "IrcAdapter" or "XmppAdapter"), so match on a substring rather than an exact
// value. Returns null for adapters we don't know how to archive.
export function channelInfo(adapterName, room, env = process.env) {
  const adapter = String(adapterName ?? '').toLowerCase()

  if (adapter.includes('irc')) {
    return {
      channelName: room,
      service: {
        protocol: 'IRC',
        domain: env.RS_LOGGER_SERVER_NAME || env.HUBOT_IRC_SERVER
      }
    }
  }

  if (adapter.includes('xmpp')) {
    const [roomName, mucHost] = String(room).split('@')
    return {
      channelName: roomName,
      service: {
        protocol: 'XMPP',
        domain: mucHost
      }
    }
  }

  return null
}

// Build the hubot script function. Dependencies are injected so the whole
// logger can be unit tested; the default export below wires in the real ones.
//
// Logging semantics (deliberately hiding bot commands and their replies):
// - inbound: log every message, except those the CommandBus consumes. The
//   CommandBus registers its receive middleware before this one (in
//   Robot#run) and, for a command, sets `message.done` and returns false,
//   which stops the middleware chain before our handler runs.
// - outbound: log `send`/`reply`/`emote` only for messages we actually logged
//   inbound. CommandBus replies originate from a message we never saw, so
//   they are skipped. This does not depend on the adapter's Response subclass.
export function createLogger({ remoteStorage, TextMessage, env = process.env }) {
  return function use(robot) {

    //
    // SETUP
    //

    const messageCache = {}

    // Messages that were logged inbound; used to decide whether a response
    // belongs to a command (which we hide) or not.
    const loggedMessages = new WeakSet()

    const log = function (str, logLevel = 'info') {
      robot.logger[logLevel](`[hubot-rs-logger] ${str}`)
    }

    const rsUser = env.RS_LOGGER_USER
    const rsToken = env.RS_LOGGER_TOKEN

    if (typeof rsUser === 'undefined' || typeof rsToken === 'undefined') {
      throw new Error('ENV variable for RS user and/or token missing')
    }

    log('RemoteStorage credentials set, connecting storage...')

    remoteStorage.access.claim('chat-messages', 'rw')

    remoteStorage.on('ready', function () {
      log('remoteStorage ready')
    })
    remoteStorage.on('connected', function () {
      log('remoteStorage connected')
      setInterval(flushMessageCache, 2000)
    })
    remoteStorage.on('error', function (error) {
      log('remoteStorage.js had a problem: ' + error)
    })

    remoteStorage.connect(rsUser, rsToken)

    //
    // LOGS
    //

    var logMessage = function (response) {
      let message = response.message
      let type

      if ((typeof message === 'object' && message.constructor.name === 'TextMessage') ||
          message instanceof TextMessage) {
        type = 'text'
      } else {
        // TODO implement optional join/leave message logging
        return
      }

      let room = message.user.room || 'general'

      let entry = {
        from: message.user['id'],
        timestamp: (+Date.now()),
        type: type,
        text: message.text
      }

      logEntry(room, entry)
    }

    var logResponse = function (room, strings, method = 'send') {
      const type = method === 'emote' ? 'action' : 'text'

      strings.forEach(function (string) {
        string.split('\n').forEach(function (line) {
          let entry = {
            from: robot.name,
            timestamp: (+Date.now()),
            type: type,
            text: line
          }

          logEntry(room, entry)
        })
      })
    }

    var logEntry = function (room, entry) {
      if (!(messageCache[room] instanceof Array)) { messageCache[room] = [] }
      messageCache[room].push(entry)
    }

    var flushMessageCache = function () {
      Object.keys(messageCache).forEach(function (room) {
        let messages = messageCache[room]

        if (messages && messages.length > 0) {
          log(`Storing ${messages.length} new messages for room ${room}`)

          messageCache[room] = []
          rsAddMessages(room, messages).then(function () {
          }, function (error) {
            messageCache[room] = messages.concat(messageCache[room])
            log(error, 'error')
          })
        } else {
          // nothing to flush
        }
      })
    }

    var rsAddMessages = function (room, messages) {
      const info = channelInfo(robot.adapterName, room, env)
      if (!info) {
        log(`Not archiving messages for unknown adapter "${robot.adapterName}"`, 'warn')
        return Promise.resolve()
      }

      let archive = {
        date: new Date(messages[0].timestamp),
        isPublic: env.RS_LOGGER_PUBLIC != null,
        channelName: info.channelName,
        service: info.service
      }

      let rsArchive = new remoteStorage.chatMessages.DailyArchive(archive)

      return rsArchive.addMessages(messages)
    }

    //
    // ROBOT
    //

    // Inbound: log every message the CommandBus didn't consume (see above).
    robot.receiveMiddleware(function (context) {
      const message = context.response.message
      logMessage({ message })
      loggedMessages.add(message)
      return true
    })

    // Outbound: log the bot's own send/reply/emote for messages we logged.
    robot.responseMiddleware(function (context) {
      if (!LOGGED_METHODS.includes(context.method)) { return true }

      const message = context.response.message
      if (!loggedMessages.has(message)) { return true }

      const room = context.response.envelope?.room ?? message?.user?.room ?? 'general'
      logResponse(room, context.strings, context.method)

      return true
    })

    return { logMessage, logResponse, logEntry, flushMessageCache, rsAddMessages, messageCache }
  }
}

export default createLogger({ remoteStorage, TextMessage })
