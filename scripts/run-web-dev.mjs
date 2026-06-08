import { spawn } from "node:child_process";
import path from "node:path";
import { getViteDevArgs } from "./web-ui-runtime.mjs";

const viteBin = path.resolve("node_modules", "vite", "bin", "vite.js");
const child = spawn(process.execPath, [viteBin, ...getViteDevArgs(process.env), ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  windowsHide: true
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

