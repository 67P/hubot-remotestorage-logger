import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import logger, { createLogger } from '../index.js'

class TextMessage {}
class SubTextMessage extends TextMessage {}

function makeRemoteStorage() {
  const rs = {
    claimed: [],
    handlers: {},
    connectedWith: null,
    archives: [],
    addResult: undefined
  }

  rs.access = { claim: (name, mode) => rs.claimed.push([name, mode]) }
  rs.on = (event, cb) => { rs.handlers[event] = cb }
  rs.connect = (user, token) => { rs.connectedWith = [user, token] }
  rs.chatMessages = {
    DailyArchive: class {
      constructor(archive) {
        this.archive = archive
        this.messages = null
        rs.archives.push(this)
      }

      addMessages(messages) {
        this.messages = messages
        return rs.addResult ?? Promise.resolve()
      }
    }
  }

  return rs
}

function makeRobot(overrides = {}) {
  const calls = { debug: [], info: [], warn: [], error: [] }

  const robot = {
    name: 'botka',
    adapterName: 'IrcAdapter',
    logger: {
      debug: (m) => calls.debug.push(m),
      info: (m) => calls.info.push(m),
      warn: (m) => calls.warn.push(m),
      error: (m) => calls.error.push(m)
    },
    calls,
    receiveMiddleware(fn) { robot._receiveMiddleware = fn },
    responseMiddleware(fn) { robot._responseMiddleware = fn },
    ...overrides
  }

  return robot
}

function setup({ env = {}, robotOverrides = {} } = {}) {
  const remoteStorage = makeRemoteStorage()
  const robot = makeRobot(robotOverrides)
  const use = createLogger({
    remoteStorage,
    TextMessage,
    env: { RS_LOGGER_USER: 'user@example.com', RS_LOGGER_TOKEN: 'token', ...env }
  })
  const internals = use(robot)

  return { remoteStorage, robot, internals }
}

function textMessage(overrides = {}) {
  const message = new TextMessage()
  message.user = { id: 'mark', room: '#kosmos-random' }
  message.text = 'hello'
  return Object.assign(message, overrides)
}

describe('logger setup', () => {
  it('throws when RS_LOGGER_USER is missing', () => {
    const use = createLogger({
      remoteStorage: makeRemoteStorage(),
      TextMessage,
      env: { RS_LOGGER_TOKEN: 'token' }
    })

    assert.throws(() => use(makeRobot()), /RS user and\/or token missing/)
  })

  it('throws when RS_LOGGER_TOKEN is missing', () => {
    const use = createLogger({
      remoteStorage: makeRemoteStorage(),
      TextMessage,
      env: { RS_LOGGER_USER: 'user@example.com' }
    })

    assert.throws(() => use(makeRobot()), /RS user and\/or token missing/)
  })

  it('claims the chat-messages scope and connects', () => {
    const { remoteStorage, robot } = setup()

    assert.deepEqual(remoteStorage.claimed, [['chat-messages', 'rw']])
    assert.deepEqual(remoteStorage.connectedWith, ['user@example.com', 'token'])
    assert.ok(robot.calls.info.some((m) => m.includes('connecting storage')))
  })

  it('registers ready/connected/error handlers', () => {
    const { remoteStorage } = setup()

    assert.equal(typeof remoteStorage.handlers.ready, 'function')
    assert.equal(typeof remoteStorage.handlers.connected, 'function')
    assert.equal(typeof remoteStorage.handlers.error, 'function')
  })

  it('registers receive and response middleware', () => {
    const { robot } = setup()

    assert.equal(typeof robot._receiveMiddleware, 'function')
    assert.equal(typeof robot._responseMiddleware, 'function')
  })
})

describe('remoteStorage event handlers', () => {
  it('logs when ready', () => {
    const { remoteStorage, robot } = setup()

    remoteStorage.handlers.ready()

    assert.ok(robot.calls.info.some((m) => m.includes('remoteStorage ready')))
  })

  it('logs and starts a flush interval when connected', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] })
    const { remoteStorage, robot, internals } = setup()

    internals.logEntry('#room', { from: 'x', timestamp: 1, type: 'text', text: 'hi' })
    remoteStorage.handlers.connected()

    assert.ok(robot.calls.info.some((m) => m.includes('remoteStorage connected')))

    t.mock.timers.tick(2000)

    assert.equal(remoteStorage.archives.length, 1)
    assert.equal(remoteStorage.archives[0].messages.length, 1)
  })

  it('logs errors', () => {
    const { remoteStorage, robot } = setup()

    remoteStorage.handlers.error('boom')

    assert.ok(robot.calls.info.some((m) => m.includes('remoteStorage.js had a problem: boom')))
  })
})

describe('logMessage()', () => {
  it('logs a TextMessage identified by constructor name', () => {
    const { internals } = setup()

    internals.logMessage({ message: textMessage() })

    const entries = internals.messageCache['#kosmos-random']
    assert.equal(entries.length, 1)
    assert.equal(entries[0].from, 'mark')
    assert.equal(entries[0].text, 'hello')
    assert.equal(entries[0].type, 'text')
    assert.equal(typeof entries[0].timestamp, 'number')
  })

  it('logs a TextMessage identified by instanceof', () => {
    const { internals } = setup()
    const message = Object.assign(new SubTextMessage(), { user: { id: 'mark', room: '#r' }, text: 'sub' })

    internals.logMessage({ message })

    assert.equal(internals.messageCache['#r'][0].text, 'sub')
  })

  it('falls back to the general room', () => {
    const { internals } = setup()

    internals.logMessage({ message: textMessage({ user: { id: 'mark' } }) })

    assert.equal(internals.messageCache.general.length, 1)
  })

  it('ignores non-text messages', () => {
    const { internals } = setup()

    internals.logMessage({ message: { user: { id: 'mark', room: '#r' }, text: 'x' } })

    assert.deepEqual(internals.messageCache, {})
  })
})

describe('logResponse()', () => {
  it('logs a single string', () => {
    const { internals } = setup()

    internals.logResponse('#room', ['hello'])

    assert.deepEqual(internals.messageCache['#room'].map((e) => e.text), ['hello'])
  })

  it('splits multi-line strings', () => {
    const { internals } = setup()

    internals.logResponse('#room', ['a\nb'])

    assert.deepEqual(internals.messageCache['#room'].map((e) => e.text), ['a', 'b'])
  })

  it('logs multiple strings with the robot name as sender', () => {
    const { internals } = setup()

    internals.logResponse('#room', ['one', 'two'])

    const entries = internals.messageCache['#room']
    assert.equal(entries.length, 2)
    assert.ok(entries.every((e) => e.from === 'botka'))
  })

  it('logs emotes as action type', () => {
    const { internals } = setup()

    internals.logResponse('#room', ['waves'], 'emote')

    assert.equal(internals.messageCache['#room'][0].type, 'action')
  })
})

describe('logEntry()', () => {
  it('creates the room array on first use and appends', () => {
    const { internals } = setup()

    internals.logEntry('#room', { text: 'a' })
    internals.logEntry('#room', { text: 'b' })

    assert.equal(internals.messageCache['#room'].length, 2)
  })
})

describe('flushMessageCache()', () => {
  it('stores and clears non-empty rooms', () => {
    const { remoteStorage, internals } = setup()

    internals.logEntry('#room', { from: 'x', timestamp: 1, type: 'text', text: 'hi' })
    internals.flushMessageCache()

    assert.equal(remoteStorage.archives.length, 1)
    assert.deepEqual(internals.messageCache['#room'], [])
  })

  it('ignores empty rooms', () => {
    const { remoteStorage, internals } = setup()

    internals.messageCache['#empty'] = []
    internals.flushMessageCache()

    assert.equal(remoteStorage.archives.length, 0)
  })

  it('flushes multiple rooms', () => {
    const { remoteStorage, internals } = setup()

    internals.logEntry('#one', { from: 'x', timestamp: 1, type: 'text', text: 'a' })
    internals.logEntry('#two', { from: 'x', timestamp: 1, type: 'text', text: 'b' })
    internals.flushMessageCache()

    assert.equal(remoteStorage.archives.length, 2)
  })

  it('restores messages and logs when storing fails', async () => {
    const { remoteStorage, robot, internals } = setup()
    remoteStorage.addResult = Promise.reject(new Error('nope'))

    internals.logEntry('#room', { from: 'x', timestamp: 1, type: 'text', text: 'hi' })
    internals.flushMessageCache()
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(internals.messageCache['#room'].length, 1)
    assert.ok(robot.calls.error.some((m) => String(m).includes('nope')))
  })
})

describe('rsAddMessages()', () => {
  it('warns and skips unknown adapters', async () => {
    const { remoteStorage, robot, internals } = setup({ robotOverrides: { adapterName: 'Shell' } })

    await internals.rsAddMessages('#room', [{ timestamp: 1 }])

    assert.equal(remoteStorage.archives.length, 0)
    assert.ok(robot.calls.warn.some((m) => m.includes('unknown adapter "Shell"')))
  })

  it('builds an IRC archive', async () => {
    const { remoteStorage, internals } = setup({ env: { HUBOT_IRC_SERVER: 'irc.libera.chat' } })

    await internals.rsAddMessages('#kosmos-random', [{ timestamp: 1700000000000 }])

    const archive = remoteStorage.archives[0].archive
    assert.equal(archive.channelName, '#kosmos-random')
    assert.deepEqual(archive.service, { protocol: 'IRC', domain: 'irc.libera.chat' })
    assert.equal(archive.date.getTime(), 1700000000000)
    assert.equal(archive.isPublic, false)
  })

  it('builds an XMPP archive', async () => {
    const { remoteStorage, internals } = setup({ robotOverrides: { adapterName: 'XmppAdapter' } })

    await internals.rsAddMessages('kosmos@kosmos.chat', [{ timestamp: 1 }])

    const archive = remoteStorage.archives[0].archive
    assert.equal(archive.channelName, 'kosmos')
    assert.deepEqual(archive.service, { protocol: 'XMPP', domain: 'kosmos.chat' })
  })

  it('marks archives public when RS_LOGGER_PUBLIC is set', async () => {
    const { remoteStorage, internals } = setup({ env: { RS_LOGGER_PUBLIC: 'true' } })

    await internals.rsAddMessages('#room', [{ timestamp: 1 }])

    assert.equal(remoteStorage.archives[0].archive.isPublic, true)
  })

  it('passes the messages to addMessages and returns its result', async () => {
    const { remoteStorage, internals } = setup()
    const messages = [{ timestamp: 1, text: 'hi' }]

    const result = await internals.rsAddMessages('#room', messages)

    assert.equal(remoteStorage.archives[0].messages, messages)
    assert.equal(result, undefined)
  })
})

describe('inbound middleware', () => {
  it('logs a message and returns true', () => {
    const { robot, internals } = setup()

    const result = robot._receiveMiddleware({ response: { message: textMessage() } })

    assert.equal(result, true)
    assert.equal(internals.messageCache['#kosmos-random'].length, 1)
  })
})

describe('outbound middleware', () => {
  it('logs send/reply for a message that was logged inbound', () => {
    const { robot, internals } = setup()
    const message = textMessage()

    robot._receiveMiddleware({ response: { message } })
    robot._responseMiddleware({
      response: { message, envelope: { room: '#kosmos-random' } },
      strings: ['pong'],
      method: 'send'
    })

    assert.deepEqual(internals.messageCache['#kosmos-random'].map((e) => e.text), ['hello', 'pong'])
  })

  it('logs emote as an action', () => {
    const { robot, internals } = setup()
    const message = textMessage()

    robot._receiveMiddleware({ response: { message } })
    robot._responseMiddleware({
      response: { message, envelope: { room: '#kosmos-random' } },
      strings: ['waves'],
      method: 'emote'
    })

    const entry = internals.messageCache['#kosmos-random'].find((e) => e.text === 'waves')
    assert.equal(entry.type, 'action')
  })

  it('skips replies for messages that were not logged inbound (e.g. commands)', () => {
    const { robot, internals } = setup()
    const commandMessage = textMessage({ text: 'help' })

    const result = robot._responseMiddleware({
      response: { message: commandMessage, envelope: { room: '#kosmos-random' } },
      strings: ['commands: ...'],
      method: 'reply'
    })

    assert.equal(result, true)
    assert.equal(internals.messageCache['#kosmos-random'], undefined)
  })

  it('skips methods that are not logged', () => {
    const { robot, internals } = setup()
    const message = textMessage()

    robot._receiveMiddleware({ response: { message } })
    for (const method of ['topic', 'play', 'locked']) {
      robot._responseMiddleware({
        response: { message, envelope: { room: '#kosmos-random' } },
        strings: ['x'],
        method
      })
    }

    // only the inbound message
    assert.equal(internals.messageCache['#kosmos-random'].length, 1)
  })

  it('falls back to the message room, then to general', () => {
    const { robot, internals } = setup()

    const message = textMessage({ user: { id: 'mark', room: '#from-user' } })
    robot._receiveMiddleware({ response: { message } })
    robot._responseMiddleware({ response: { message }, strings: ['a'], method: 'send' })
    assert.deepEqual(internals.messageCache['#from-user'].map((e) => e.text), ['hello', 'a'])

    const roomless = textMessage({ user: { id: 'mark' } })
    robot._receiveMiddleware({ response: { message: roomless } })
    robot._responseMiddleware({ response: { message: roomless }, strings: ['b'], method: 'send' })
    assert.deepEqual(internals.messageCache.general.map((e) => e.text), ['hello', 'b'])
  })
})

describe('integration', () => {
  it('archives a received message and the bot reply', () => {
    const { remoteStorage, robot, internals } = setup({ env: { HUBOT_IRC_SERVER: 'irc.libera.chat' } })
    const message = textMessage()

    robot._receiveMiddleware({ response: { message } })
    robot._responseMiddleware({
      response: { message, envelope: { room: '#kosmos-random' } },
      strings: ['pong'],
      method: 'reply'
    })
    internals.flushMessageCache()

    const stored = remoteStorage.archives[0].messages
    assert.deepEqual(stored.map((e) => e.text), ['hello', 'pong'])
  })
})

describe('default export', () => {
  it('is a hubot script function', () => {
    assert.equal(typeof logger, 'function')
  })
})
