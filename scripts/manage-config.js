#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_STABLECOIN_SYMBOLS =
  "USDT,USDC,BUSD,FDUSD,USDP,TUSD,USDS,USDG,DAI,PYUSD,USDE,USD1,RLUSD,GHO,FRAX,FRXUSD,LUSD,CRVUSD,USD0,USDT0,SUSDS";

const DEFAULT_CONFIG = {
  version: "v1",
  meta: {
    alchemyApiKey: "",
    zerionApiKey: "",
    notionToken: "",
    obsidianVaultPath: "",
    obsidianRootDir: "NetWorth",
    notionSummaryDatabaseId: "",
    notionAccountDatabaseId: "",
    notionAssetDatabaseId: "",
    notionSummaryTemplateId: "",
  },
  cexAccounts: [],
  wallets: [],
  defiPositions: [],
  validation: {
    minBalanceThreshold: "0",
    ignoredTokens: "NFT,DUST",
    focusAssets: "BTC,ETH,SOL,USDT,BNB",
    stablecoinSymbols: DEFAULT_STABLECOIN_SYMBOLS,
    referenceCost: "",
    targetProfit: "",
  },
  updatedAt: null,
};

const EXCHANGE_SCOPE_DEFAULTS = {
  binance:
    "spot,funding,simple_earn_flexible,simple_earn_locked,cross_margin,isolated_margin,um_futures,cm_futures,subaccount_spot,subaccount_margin,subaccount_um_futures,subaccount_cm_futures",
  bitget: "spot,futures,cross_margin,savings_flexible,savings_fixed,overview",
  okx: "trading,funding,savings,overview",
};

const META_KEYS = new Set(Object.keys(DEFAULT_CONFIG.meta));
const VALIDATION_KEYS = new Set(Object.keys(DEFAULT_CONFIG.validation));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.command) {
    printHelp();
    return;
  }

  const configPath = path.resolve(process.cwd(), args.config || "config.local.json");

  if (args.command === "init") {
    await initConfig(configPath, Boolean(args.force));
    process.stdout.write(`已初始化配置文件：${configPath}\n`);
    return;
  }

  const config = await loadConfig(configPath);

  if (args.command === "show") {
    process.stdout.write(`${JSON.stringify(maskSecrets(config), null, 2)}\n`);
    return;
  }

  if (args.command === "set-meta") {
    requireKeyValue(args);
    if (!META_KEYS.has(args.key)) {
      throw new Error(`不支持的 meta 字段：${args.key}`);
    }
    config.meta[args.key] = String(args.value ?? "");
    await saveConfig(configPath, config);
    process.stdout.write(`已更新 meta.${args.key}\n`);
    return;
  }

  if (args.command === "set-validation") {
    requireKeyValue(args);
    if (!VALIDATION_KEYS.has(args.key)) {
      throw new Error(`不支持的 validation 字段：${args.key}`);
    }
    config.validation[args.key] = String(args.value ?? "");
    await saveConfig(configPath, config);
    process.stdout.write(`已更新 validation.${args.key}\n`);
    return;
  }

  if (args.command === "add-wallet") {
    const label = String(args.label || "").trim();
    const address = String(args.address || "").trim();
    if (!label || !address) {
      throw new Error("add-wallet 需要 --label 和 --address");
    }
    const existingIndex = config.wallets.findIndex((item) => String(item.label || "").trim() === label);
    const wallet = {
      label,
      chain: String(args.chain || "all_evm").trim() || "all_evm",
      address,
      assetScope: "auto",
      rpcUrl: String(args.rpcUrl || "").trim(),
      tokenContracts: String(args.tokenContracts || "").trim(),
    };

    if (existingIndex >= 0) {
      config.wallets[existingIndex] = wallet;
      await saveConfig(configPath, config);
      process.stdout.write(`已更新钱包：${label}\n`);
      return;
    }

    config.wallets.push(wallet);
    await saveConfig(configPath, config);
    process.stdout.write(`已新增钱包：${label}\n`);
    return;
  }

  if (args.command === "remove-wallet") {
    const label = String(args.label || "").trim();
    if (!label) {
      throw new Error("remove-wallet 需要 --label");
    }
    const nextWallets = config.wallets.filter((item) => String(item.label || "").trim() !== label);
    if (nextWallets.length === config.wallets.length) {
      throw new Error(`未找到钱包：${label}`);
    }
    config.wallets = nextWallets;
    await saveConfig(configPath, config);
    process.stdout.write(`已删除钱包：${label}\n`);
    return;
  }

  if (args.command === "add-cex") {
    const exchange = String(args.exchange || "").trim().toLowerCase();
    const label = String(args.label || "").trim();
    if (!label || !exchange) {
      throw new Error("add-cex 需要 --exchange 和 --label");
    }
    if (!EXCHANGE_SCOPE_DEFAULTS[exchange]) {
      throw new Error(`暂不支持的交易所：${exchange}`);
    }

    const account = {
      label,
      exchange,
      apiKey: String(args.apiKey || "").trim(),
      apiSecret: String(args.apiSecret || "").trim(),
      passphrase: exchange === "binance" ? "" : String(args.passphrase || "").trim(),
      accountScope: String(args.accountScope || EXCHANGE_SCOPE_DEFAULTS[exchange]).trim(),
      recvWindow: String(args.recvWindow || "10000").trim(),
      environment: String(args.environment || "production").trim(),
    };

    const existingIndex = config.cexAccounts.findIndex((item) => String(item.label || "").trim() === label);
    if (existingIndex >= 0) {
      config.cexAccounts[existingIndex] = account;
      await saveConfig(configPath, config);
      process.stdout.write(`已更新交易所账户：${label}\n`);
      return;
    }

    config.cexAccounts.push(account);
    await saveConfig(configPath, config);
    process.stdout.write(`已新增交易所账户：${label}\n`);
    return;
  }

  if (args.command === "remove-cex") {
    const label = String(args.label || "").trim();
    if (!label) {
      throw new Error("remove-cex 需要 --label");
    }
    const nextAccounts = config.cexAccounts.filter((item) => String(item.label || "").trim() !== label);
    if (nextAccounts.length === config.cexAccounts.length) {
      throw new Error(`未找到交易所账户：${label}`);
    }
    config.cexAccounts = nextAccounts;
    await saveConfig(configPath, config);
    process.stdout.write(`已删除交易所账户：${label}\n`);
    return;
  }

  throw new Error(`不支持的命令：${args.command}`);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (!token.startsWith("--") && !args.command) {
      args.command = token;
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
        continue;
      }
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

async function initConfig(filePath, force) {
  if (!force) {
    try {
      await fs.access(filePath);
      throw new Error(`配置文件已存在：${filePath}。如需覆盖请加 --force`);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  await saveConfig(filePath, structuredClone(DEFAULT_CONFIG));
}

async function loadConfig(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return mergeConfig(JSON.parse(raw));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`找不到配置文件：${filePath}。你可以先执行 npm run config -- init`);
    }
    throw new Error(`配置文件读取失败：${error.message}`);
  }
}

function mergeConfig(input) {
  return {
    ...structuredClone(DEFAULT_CONFIG),
    ...input,
    meta: { ...DEFAULT_CONFIG.meta, ...(input.meta || {}) },
    validation: { ...DEFAULT_CONFIG.validation, ...(input.validation || {}) },
    cexAccounts: Array.isArray(input.cexAccounts) ? input.cexAccounts : [],
    wallets: Array.isArray(input.wallets) ? input.wallets : [],
    defiPositions: Array.isArray(input.defiPositions) ? input.defiPositions : [],
  };
}

async function saveConfig(filePath, config) {
  config.updatedAt = new Date().toISOString();
  await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function requireKeyValue(args) {
  if (!args.key) throw new Error("缺少 --key");
  if (args.value === undefined) throw new Error("缺少 --value");
}

function maskSecrets(config) {
  const clone = structuredClone(config);
  clone.meta.notionToken = maskValue(clone.meta.notionToken);
  clone.meta.alchemyApiKey = maskValue(clone.meta.alchemyApiKey);
  clone.meta.zerionApiKey = maskValue(clone.meta.zerionApiKey);
  clone.cexAccounts = clone.cexAccounts.map((account) => ({
    ...account,
    apiKey: maskValue(account.apiKey),
    apiSecret: maskValue(account.apiSecret),
    passphrase: maskValue(account.passphrase),
  }));
  return clone;
}

function maskValue(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 8) return "*".repeat(text.length);
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

function printHelp() {
  process.stdout.write(`Crypto Asset Config CLI

用法：
  npm run config -- init
  npm run config -- show
  npm run config -- set-meta --key notionToken --value <token>
  npm run config -- set-validation --key referenceCost --value 758000
  npm run config -- add-wallet --label "Main Wallet" --address 0x123...
  npm run config -- remove-wallet --label "Main Wallet"
  npm run config -- add-cex --exchange binance --label "Binance Main" --api-key xxx --api-secret xxx
  npm run config -- remove-cex --label "Binance Main"

常用参数：
  --config <path>          配置文件路径，默认 config.local.json
  --force                  init 时覆盖已有配置
  --label <value>          账户或钱包名称
  --exchange <value>       binance / bitget / okx
  --address <value>        钱包地址
  --chain <value>          默认 all_evm
  --api-key <value>        交易所 API Key
  --api-secret <value>     交易所 API Secret
  --passphrase <value>     OKX / Bitget Passphrase
  --account-scope <value>  账户范围，留空则使用默认值
  --key <value>            set-meta / set-validation 的字段名
  --value <value>          对应字段值
`);
}

main().catch((error) => {
  process.stderr.write(`执行失败：${error.message}\n`);
  process.exitCode = 1;
});
