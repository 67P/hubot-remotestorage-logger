/* vim: ft=javascript */

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
