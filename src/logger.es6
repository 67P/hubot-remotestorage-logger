// vim: ft=javascript

export default function(robot) {
  robot.hear(/ohai/i, (res) => {
    res.send("guten tag!");
  });
}
