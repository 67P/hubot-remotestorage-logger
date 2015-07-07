/* vim: ft=javascript */
/* global setInterval */

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
 *
 * Author:
 *   Sebastian Kippe
*/

var hubot = require("hubot");

export default function(robot) {

  //
  // SETUP
  //

  var RemoteStorage, remoteStorage, rsToken, rsUser;
  var messageCache = {};

  rsUser = process.env.RS_LOGGER_USER;
  rsToken = process.env.RS_LOGGER_TOKEN;

  var log = function(str) {
    robot.logger.info(`[hubot-rs-logger] ${str}`);
  };

  if (typeof rsUser === "undefined" || typeof rsToken === "undefined") {
    throw new Error('ENV variable for RS user and/or token missing');
  }

  RemoteStorage = require("remotestoragejs");
  require("../lib/chat-messages.es6");
  log("RemoteStorage credentials set, connecting storage...");
  remoteStorage = new RemoteStorage();
  global.remoteStorage = remoteStorage;

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
    let type;

    if (response.message instanceof hubot.TextMessage) {
      type = 'text';
    } else {
      // TODO implement optional join/leave message logging
      return;
    }

    let room = response.message.user.room || 'general';

    let entry = {
      from: response.message.user['id'],
      timestamp: (+Date.now()),
      type: type,
      text: response.message.text
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
        }, function() {
          messageCache[room] = messages.concat(messageCache[room]);
        });
      } else {
        // nothing to flush
      }
    });
  };

  var rsAddMessages = function(room, messages) {
    let rsArchive = new remoteStorage.chatMessages.DailyArchive({
      // TODO support format for other adapters/protocols
      server: {
        type: "irc",
        name: process.env.RS_LOGGER_SERVER_NAME,
        ircURI: "irc://" + process.env.HUBOT_IRC_SERVER
      },
      channelName: room,
      date: new Date(messages[0].timestamp),
      isPublic: process.env.RS_LOGGER_PUBLIC != null
    });

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

}
