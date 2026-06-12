// PM2 配置。本仓库 package.json 为 "type": "module"，因此 PM2 配置使用 .cjs 后缀，
// 以保证 PM2 能以 CommonJS 方式正确加载。
const path = require("path");

// 部署后该文件位于 /opt/stake-worldcup-odds-monitor/ecosystem.config.cjs，
// 后端代码位于其下的 app/ 子目录。
const home = __dirname;
const appDir = path.join(home, "app");
const logsDir = path.join(home, "logs");

module.exports = {
  apps: [
    {
      name: "stake-worldcup-odds-backend",
      cwd: appDir,
      script: "server/index.js",
      node_args: [],
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production"
      },
      env_production: {
        NODE_ENV: "production"
      },
      error_file: path.join(logsDir, "backend.err.log"),
      out_file: path.join(logsDir, "backend.out.log"),
      merge_logs: true,
      time: true
    }
  ]
};
