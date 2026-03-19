#!/usr/bin/env node

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const SKILL_DIR = path.resolve(__dirname, "..");
const PROJECT_HINTS = ["scripts/run-report.js", "scripts/manage-config.js", "package.json"];

function main() {
  const argv = process.argv.slice(2);
  const mode = argv[0];
  const forwardedArgs = argv.slice(1);

  if (!mode || mode === "--help" || mode === "-h") {
    printHelp();
    return;
  }

  if (!["report", "config"].includes(mode)) {
    process.stderr.write(`不支持的模式：${mode}\n`);
    process.exitCode = 1;
    return;
  }

  const explicitRoot = getOptionValue(forwardedArgs, "--repo-root") || process.env.CRYPTO_ASSET_REPORT_ROOT;
  const projectRoot = resolveProjectRoot(explicitRoot);
  if (!projectRoot) {
    process.stderr.write(
      "找不到项目根目录。请在仓库根目录中调用 Skill，或通过 --repo-root / CRYPTO_ASSET_REPORT_ROOT 指定项目路径。\n",
    );
    process.exitCode = 1;
    return;
  }

  const scriptPath =
    mode === "report"
      ? path.join(projectRoot, "scripts", "run-report.js")
      : path.join(projectRoot, "scripts", "manage-config.js");

  const cleanArgs = stripOptionWithValue(forwardedArgs, "--repo-root");
  const child = spawn(process.execPath, [scriptPath, ...cleanArgs], {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code) => {
    process.exitCode = code ?? 0;
  });
}

function resolveProjectRoot(explicitRoot) {
  if (explicitRoot) {
    const resolved = path.resolve(explicitRoot);
    if (looksLikeProjectRoot(resolved)) return resolved;
    return null;
  }

  const candidates = [
    process.cwd(),
    path.resolve(SKILL_DIR, "..", ".."),
    path.resolve(SKILL_DIR, "..", "..", ".."),
  ];

  for (const candidate of candidates) {
    const found = searchUp(candidate);
    if (found) return found;
  }

  return null;
}

function searchUp(startDir) {
  let current = path.resolve(startDir);
  for (;;) {
    if (looksLikeProjectRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function looksLikeProjectRoot(dirPath) {
  return PROJECT_HINTS.every((relativePath) => fs.existsSync(path.join(dirPath, relativePath)));
}

function getOptionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return "";
  return args[index + 1] || "";
}

function stripOptionWithValue(args, name) {
  const copy = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) {
      index += 1;
      continue;
    }
    copy.push(args[index]);
  }
  return copy;
}

function printHelp() {
  process.stdout.write(`Crypto Asset Report skill wrapper

用法：
  node skills/crypto-asset-report/scripts/invoke-project-cli.js report --config ./config.local.json
  node skills/crypto-asset-report/scripts/invoke-project-cli.js config show

可选：
  --repo-root <path>      显式指定项目根目录

也可以设置环境变量：
  CRYPTO_ASSET_REPORT_ROOT=/path/to/project
`);
}

main();
