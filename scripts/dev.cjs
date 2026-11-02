const { dirname, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

// 只消费诊断开关；其余参数仍由原始 electron-vite CLI 解释。
function prepareDevArguments(argv, environment) {
  const separator = argv.indexOf("--");
  const ownArguments = separator < 0 ? argv : argv.slice(0, separator);
  const forwardedArguments = separator < 0 ? [] : argv.slice(separator);
  const enabled = ownArguments.includes("--perf");
  if (enabled) environment.OMPGUI_PERF = "1";
  else delete environment.OMPGUI_PERF;
  return [...ownArguments.filter((argument) => argument !== "--perf"), ...forwardedArguments];
}

async function run() {
  const args = prepareDevArguments(process.argv.slice(2), process.env);
  const root = dirname(require.resolve("electron-vite/package.json"));
  const cli = resolve(root, "bin/electron-vite.js");
  // 同一进程运行官方入口，保留 cwd、stdio、退出码与信号处理，不增加 shell/子进程。
  process.argv = [process.argv[0], cli, "dev", ...args];
  await import(pathToFileURL(cli).href);
}

module.exports = { prepareDevArguments };
if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
