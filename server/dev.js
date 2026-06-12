import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const children = [
  spawn(process.execPath, ["--watch", "server/index.js"], {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "development" }
  }),
  spawn(npmCommand, ["run", "dev:client"], {
    stdio: "inherit",
    env: process.env
  })
];

function stopAll(signal) {
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopAll(signal);
    process.exit(0);
  });
}

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      stopAll("SIGTERM");
      process.exit(code);
    }
  });
}
