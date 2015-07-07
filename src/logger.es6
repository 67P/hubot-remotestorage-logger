/* vim: ft=javascript
 *
 * Description:
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

export default function(robot) {

  var RemoteStorage, remoteStorage, rsToken, rsUser;

  rsUser = process.env.RS_LOGGER_USER;
  rsToken = process.env.RS_LOGGER_TOKEN;

  var log = function(str) {
    robot.logger.info(`[hubot-rs-logger] ${str}`);
  };

  if (typeof rsUser === "undefined" || typeof rsToken === "undefined") {
    throw new Error('ENV variable for RS user and/or token missing');
  } else {
    RemoteStorage = require("remotestoragejs");
    require("../lib/chat-messages.es6");
    log("RemoteStorage credentials set, connecting storage...");
    // remoteStorage = new RemoteStorage({logging: true});
    remoteStorage = new RemoteStorage({logging: true});
    global.remoteStorage = remoteStorage;

    remoteStorage.access.claim("chat-messages", "rw");

    remoteStorage.on('ready', function() {
      log("remoteStorage ready");
    });
    remoteStorage.on('connected', function() {
      log("remoteStorage connected");
    });
    remoteStorage.on('error', function(error) {
      log("remoteStorage.js had a problem: " + error);
    });

    remoteStorage.connect(rsUser, rsToken);
  }

  // ROBOT

  robot.hear(/ohai/i, (res) => {
    log('messages: ' + remoteStorage.chatMessages);
    res.send("guten tag!");
  });

}
