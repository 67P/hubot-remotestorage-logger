/* Description:
 *   Logs channel messages to a remoteStorage-enabled account
 *
 * Configuration:
 *   RS_LOGGER_USER: RemoteStorage user address
 *   RS_LOGGER_TOKEN: RemoteStorage OAuth bearer token for "chat-messages:rw" scope
 *   RS_LOGGER_SERVER_NAME: Server ID/shortname to be used with remoteStorage (in URLs and metadata), e.g. "freenode"
 *   RS_LOGGER_PUBLIC: Store log files in public folder (doesn't log direct messages)
 *
 * Commands:
 *
 * Notes:
 *   Some code translated from hubot-logger
 *
 * Author:
 *   Sebastian Kippe <sebastian@kip.pe>
*/

const hubot = require("hubot");

// TODO Remove once re-added in rs.js package
global.XMLHttpRequest = require('xhr2');

const RemoteStorage = require("remotestoragejs");
const ChatMessages  = require("remotestorage-module-chat-messages");

const remoteStorage = new RemoteStorage({
  modules: [ChatMessages.default]
});

module.exports = function (robot) {

  //
  // SETUP
  //

  let rsToken, rsUser, hubotAdapter;
  let messageCache = {};

  rsUser = process.env.RS_LOGGER_USER;
  rsToken = process.env.RS_LOGGER_TOKEN;
  hubotAdapter = robot.adapterName;

  const log = function(str, logLevel='info') {
    robot.logger[logLevel](`[hubot-rs-logger] ${str}`);
  };

  if (typeof rsUser === "undefined" || typeof rsToken === "undefined") {
    throw new Error('ENV variable for RS user and/or token missing');
  }

  log("RemoteStorage credentials set, connecting storage...");

  remoteStorage.access.claim('chat-messages', 'rw');
  // remoteStorage.caching.disable('/');

  remoteStorage.on('ready', function() {
    log("remoteStorage ready");
  });
  remoteStorage.on('connected', function() {
    log("remoteStorage connected");
    setInterval(flushMessageCache, 2000);
  });
  remoteStorage.on('error', function(error) {
    log("remoteStorage.js had a problem: " + error);
  });

  remoteStorage.connect(rsUser, rsToken);

  //
  // LOGS
  //

  var logMessage = function(response) {
    let message = response.message;
    let type;

    if ((typeof message === 'object' && message.constructor.name === 'TextMessage') ||
        message instanceof hubot.TextMessage) {
      type = 'text';
    } else {
      // TODO implement optional join/leave message logging
      return;
    }

    let room = message.user.room || 'general';

    let entry = {
      from: message.user['id'],
      timestamp: (+Date.now()),
      type: type,
      text: message.text
    };

    logEntry(room, entry);
  };

  var logResponse = (room, strings) => {
    strings.forEach(function(string) {
      string.split('\n').forEach(function(line) {
        let entry = {
          from: robot.name,
          timestamp: (+Date.now()),
          type: 'text',
          text: line
        };

        logEntry(room, entry);
      });
    });
  };

  var logEntry = function(room, entry) {
    if (!(messageCache[room] instanceof Array)) { messageCache[room] = []; }
    messageCache[room].push(entry);
  };

  var flushMessageCache = function() {
    Object.keys(messageCache).forEach(function(room) {
      let messages = messageCache[room];

      if (messages && messages.length > 0) {
        log(`Storing ${messages.length} messages for room ${room}`);

        messageCache[room] = [];
        rsAddMessages(room, messages).then(function(){
        }, function(error) {
          messageCache[room] = messages.concat(messageCache[room]);
          log(error, 'error');
        });
      } else {
        // nothing to flush
      }
    });
  };

  var rsAddMessages = function(room, messages) {
    let archive = {
      server: {
        type: hubotAdapter,
        name: process.env.RS_LOGGER_SERVER_NAME
      },
      date: new Date(messages[0].timestamp),
      isPublic: process.env.RS_LOGGER_PUBLIC != null
    };

    switch (hubotAdapter) {
      case 'irc':
        archive.channelName = room;
        archive.server.ircURI = "irc://" + process.env.HUBOT_IRC_SERVER;
        break;
      case 'xmpp':
        let [roomName, mucHost] = room.split("@");
        archive.channelName = roomName;
        archive.server.xmppMUC = mucHost;
        break;
    }

    let rsArchive = new remoteStorage.chatMessages.DailyArchive(archive);

    return rsArchive.addMessages(messages);
  };

  //
  // ROBOT
  //

  // Add a listener that matches all messages and calls logMessage
  // with a Response object
  var listener = new hubot.Listener(robot, (function() {
    return true;
  }), function(res) {
    return logMessage(res);
  });
  robot.listeners.push(listener);

  // Override send methods in the Response prototype so that we can
  // log Hubot's replies
  var responseOrig = {
    send: robot.Response.prototype.send,
    reply: robot.Response.prototype.reply
  };
  robot.Response.prototype.send = function(...strings) {
    logResponse(this.message.user.room, strings);
    responseOrig.send.call(this, ...strings);
  };
  robot.Response.prototype.reply = function(...strings) {
    logResponse(this.message.user.room, strings);
    responseOrig.reply.call(this, ...strings);
  };

};
