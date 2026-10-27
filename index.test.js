import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import logger, { channelInfo } from './index.js'

describe('channelInfo()', () => {
  it('maps legacy lowercase IRC adapter names', () => {
    assert.deepEqual(
      channelInfo('irc', '#kosmos-random', { HUBOT_IRC_SERVER: 'irc.libera.chat' }),
      {
        channelName: '#kosmos-random',
        service: { protocol: 'IRC', domain: 'irc.libera.chat' }
      }
    )
  })

  it('maps hubot 14 IRC adapter class names', () => {
    assert.deepEqual(
      channelInfo('IrcAdapter', '#kosmos-random', { HUBOT_IRC_SERVER: 'irc.libera.chat' }),
      {
        channelName: '#kosmos-random',
        service: { protocol: 'IRC', domain: 'irc.libera.chat' }
      }
    )
  })

  it('prefers RS_LOGGER_SERVER_NAME over HUBOT_IRC_SERVER', () => {
    const info = channelInfo('IrcAdapter', '#x', {
      RS_LOGGER_SERVER_NAME: 'irc.libera.chat',
      HUBOT_IRC_SERVER: 'znc.kosmos.org'
    })

    assert.equal(info.service.domain, 'irc.libera.chat')
  })

  it('maps XMPP adapter class names and splits room@muc', () => {
    assert.deepEqual(
      channelInfo('XmppAdapter', 'kosmos@kosmos.chat', {}),
      {
        channelName: 'kosmos',
        service: { protocol: 'XMPP', domain: 'kosmos.chat' }
      }
    )
  })

  it('returns null for unknown adapters', () => {
    assert.equal(channelInfo('Shell', '#x', {}), null)
  })
})

describe('logger', () => {
  it('exports a hubot script function', () => {
    assert.equal(typeof logger, 'function')
  })
})
