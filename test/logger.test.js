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

  class Response {
    constructor(message) { this.message = message }
    async send(...strings) { return ['send', ...strings] }
    async reply(...strings) { return ['reply', ...strings] }
  }

  return {
    name: 'botka',
    adapterName: 'IrcAdapter',
    Response,
    listeners: [],
    logger: {
      debug: (m) => calls.debug.push(m),
      info: (m) => calls.info.push(m),
      warn: (m) => calls.warn.push(m),
      error: (m) => calls.error.push(m)
    },
    calls,
    ...overrides
  }
}

function setup({ env = {}, robotOverrides = {} } = {}) {
  const remoteStorage = makeRemoteStorage()
  const listeners = []

  class FakeListener {
    constructor(robot, matcher, options, callback) {
      this.robot = robot
      this.matcher = matcher
      if (typeof options === 'function') { callback = options }
      this.callback = callback
      listeners.push(this)
    }
  }

  const robot = makeRobot(robotOverrides)
  const use = createLogger({
    remoteStorage,
    Listener: FakeListener,
    TextMessage,
    env: { RS_LOGGER_USER: 'user@example.com', RS_LOGGER_TOKEN: 'token', ...env }
  })
  const internals = use(robot)

  return { remoteStorage, robot, internals, listeners }
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
      Listener: class {},
      TextMessage,
      env: { RS_LOGGER_TOKEN: 'token' }
    })

    assert.throws(() => use(makeRobot()), /RS user and\/or token missing/)
  })

  it('throws when RS_LOGGER_TOKEN is missing', () => {
    const use = createLogger({
      remoteStorage: makeRemoteStorage(),
      Listener: class {},
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

  it('adds a listener and patches the Response prototype', () => {
    const { robot, listeners } = setup()

    assert.equal(listeners.length, 1)
    assert.equal(robot.listeners[0], listeners[0])
    assert.notEqual(robot.Response.prototype.send, undefined)
    assert.ok(robot.Response.prototype.send.toString().includes('logResponse'))
    assert.ok(robot.Response.prototype.reply.toString().includes('logResponse'))
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

describe('listener', () => {
  it('matches every message', () => {
    const { listeners } = setup()

    assert.equal(listeners[0].matcher(), true)
  })

  it('routes matched messages through logMessage', () => {
    const { internals, listeners } = setup()

    listeners[0].callback({ message: textMessage() })

    assert.equal(internals.messageCache['#kosmos-random'].length, 1)
  })
})

describe('Response interception', () => {
  it('logs and forwards send()', async () => {
    const { robot, internals } = setup()
    const response = new robot.Response({ user: { room: '#room' } })

    const result = await response.send('a\nb')

    assert.deepEqual(result, ['send', 'a\nb'])
    assert.deepEqual(internals.messageCache['#room'].map((e) => e.text), ['a', 'b'])
  })

  it('logs and forwards reply()', async () => {
    const { robot, internals } = setup()
    const response = new robot.Response({ user: { room: '#room' } })

    const result = await response.reply('hi')

    assert.deepEqual(result, ['reply', 'hi'])
    assert.deepEqual(internals.messageCache['#room'].map((e) => e.text), ['hi'])
  })
})

describe('integration', () => {
  it('archives a received message and a reply', () => {
    const { remoteStorage, robot, internals, listeners } = setup({ env: { HUBOT_IRC_SERVER: 'irc.libera.chat' } })

    listeners[0].callback({ message: textMessage() })

    const response = new robot.Response({ user: { room: '#kosmos-random' } })
    response.send('pong')

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
