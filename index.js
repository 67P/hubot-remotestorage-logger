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
import { Listener, TextMessage } from 'hubot'

// remoteStorage.js is a browser library and expects the XMLHttpRequest API to
// be available globally when it is loaded.
globalThis.XMLHttpRequest = XHR

const { default: RemoteStorage } = await import('remotestoragejs')
const { default: ChatMessages } = await import('remotestorage-module-chat-messages')

const remoteStorage = new RemoteStorage({
  cache: false, // TODO re-enable default caching (SEEN) when getListing maxAge is fixed
  modules: [ChatMessages]
})

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

export default function (robot) {

  //
  // SETUP
  //

  let rsToken, rsUser
  let messageCache = {}

  rsUser = process.env.RS_LOGGER_USER
  rsToken = process.env.RS_LOGGER_TOKEN

  const log = function (str, logLevel = 'info') {
    robot.logger[logLevel](`[hubot-rs-logger] ${str}`)
  }

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

  var logResponse = (room, strings) => {
    strings.forEach(function (string) {
      string.split('\n').forEach(function (line) {
        let entry = {
          from: robot.name,
          timestamp: (+Date.now()),
          type: 'text',
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
    const info = channelInfo(robot.adapterName, room)
    if (!info) {
      log(`Not archiving messages for unknown adapter "${robot.adapterName}"`, 'warn')
      return Promise.resolve()
    }

    let archive = {
      date: new Date(messages[0].timestamp),
      isPublic: process.env.RS_LOGGER_PUBLIC != null,
      channelName: info.channelName,
      service: info.service
    }

    let rsArchive = new remoteStorage.chatMessages.DailyArchive(archive)

    return rsArchive.addMessages(messages)
  }

  //
  // ROBOT
  //

  // Add a listener that matches all messages and calls logMessage
  // with a Response object
  var listener = new Listener(robot, (function () {
    return true
  }), function (res) {
    return logMessage(res)
  })
  robot.listeners.push(listener)

  // Override send methods in the Response prototype so that we can
  // log Hubot's replies
  var responseOrig = {
    send: robot.Response.prototype.send,
    reply: robot.Response.prototype.reply
  }
  robot.Response.prototype.send = function (...strings) {
    logResponse(this.message.user.room, strings)
    return responseOrig.send.call(this, ...strings)
  }
  robot.Response.prototype.reply = function (...strings) {
    logResponse(this.message.user.room, strings)
    return responseOrig.reply.call(this, ...strings)
  }

}
