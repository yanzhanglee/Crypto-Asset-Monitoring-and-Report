#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const { collectPortfolioPayload } = require("../server");
const { syncSnapshotToNotion } = require("../lib/notion");
const { writeSnapshotToObsidian } = require("../lib/obsidian");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const configPath = args.config || "config.local.json";
  const resolvedConfigPath = path.resolve(process.cwd(), configPath);
  const config = await loadConfig(resolvedConfigPath);

  if (args.referenceCost !== undefined) {
    config.validation = { ...(config.validation || {}), referenceCost: String(args.referenceCost) };
  }
  if (args.targetProfit !== undefined) {
    config.validation = { ...(config.validation || {}), targetProfit: String(args.targetProfit) };
  }

  const payload = await collectPortfolioPayload(config);
  let notion = null;
  let obsidian = null;

  if (args.syncNotion) {
    notion = await syncSnapshotToNotion(payload, {
      token: config.meta?.notionToken || process.env.NOTION_TOKEN,
      summaryDatabaseId: config.meta?.notionSummaryDatabaseId || process.env.NOTION_SUMMARY_DATABASE_ID,
      accountDatabaseId: config.meta?.notionAccountDatabaseId || process.env.NOTION_ACCOUNT_DATABASE_ID,
      assetDatabaseId: config.meta?.notionAssetDatabaseId || process.env.NOTION_ASSET_DATABASE_ID,
      summaryTemplateId: config.meta?.notionSummaryTemplateId || "",
      referenceCost: config.validation?.referenceCost,
      targetProfit: config.validation?.targetProfit,
      usdCny: payload.dashboard?.rawSummary?.usdCny,
    });
  }

  if (args.writeObsidian) {
    obsidian = await writeSnapshotToObsidian(payload, {
      vaultPath: config.meta?.obsidianVaultPath,
      rootDir: config.meta?.obsidianRootDir,
      referenceCost: config.validation?.referenceCost,
      targetProfit: config.validation?.targetProfit,
      usdCny: payload.dashboard?.rawSummary?.usdCny,
    });
  }

  const result = {
    ...payload,
    ...(notion ? { notion } : {}),
    ...(obsidian ? { obsidian } : {}),
  };

  if (args.output === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${buildSummaryText(result)}\n`);
}

function parseArgs(argv) {
  const args = {
    output: "summary",
    syncNotion: false,
    writeObsidian: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--config") {
      args.config = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--output") {
      args.output = argv[index + 1] || "summary";
      index += 1;
      continue;
    }
    if (token === "--sync-notion") {
      args.syncNotion = true;
      continue;
    }
    if (token === "--write-obsidian") {
      args.writeObsidian = true;
      continue;
    }
    if (token === "--reference-cost") {
      args.referenceCost = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--target-profit") {
      args.targetProfit = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

async function loadConfig(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`找不到配置文件：${filePath}。你可以先复制 config.example.json 为 config.local.json。`);
    }
    throw new Error(`配置文件读取失败：${error.message}`);
  }
}

function buildSummaryText(result) {
  const totalCard = result.dashboard?.totals?.[0] || {};
  const exposure = totalCard.exposure || {};
  const topAssets = Array.isArray(result.dashboard?.assetRows) ? result.dashboard.assetRows.slice(0, 5) : [];
  const topAccounts = Array.isArray(result.dashboard?.accountRows) ? result.dashboard.accountRows.slice(0, 5) : [];
  const lines = [
    `统计时间：${result.collectedAt || "-"}`,
    `总资产：${totalCard.value || "-"}`,
    `RMB 估值：${totalCard.secondaryValue || "-"}`,
  ];

  if (exposure.nonStablecoinRatio || exposure.nonStablecoinUsdt || exposure.stablecoinUsdt) {
    lines.push(
      `非稳币占比：${exposure.nonStablecoinRatio || "-"}，非稳币资产：${exposure.nonStablecoinUsdt || "-"}，稳定币资产：${exposure.stablecoinUsdt || "-"}`,
    );
  }

  if (topAssets.length) {
    lines.push(`重点币种：${topAssets.map((item) => `${item.asset} ${item.estimatedUsdt !== null ? formatUsdt(item.estimatedUsdt) : "-"}`).join("；")}`);
  }

  if (topAccounts.length) {
    lines.push(`重点账户：${topAccounts.map((item) => `${item.accountLabel} ${formatUsdt(item.totalUsdt || 0)}`).join("；")}`);
  }

  if (result.notion?.summaryPageUrl) {
    lines.push(`Notion：已同步 ${result.notion.summaryPageUrl}`);
  }

  if (result.obsidian?.filePath) {
    lines.push(`Obsidian：已写入 ${result.obsidian.filePath}`);
  }

  if (result.errorSummary) {
    lines.push(
      `错误概况：核心 ${Number(result.errorSummary.core?.count || 0)} 个，补充 ${Number(result.errorSummary.supplemental?.count || 0)} 个`,
    );
  }

  return lines.join("\n");
}

function formatUsdt(value) {
  const numeric = Number(value || 0);
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(numeric) >= 1000 ? 0 : 2,
    minimumFractionDigits: Math.abs(numeric) >= 1000 ? 0 : 2,
  }).format(numeric);
  return `${formatted} USDT`;
}

function printHelp() {
  process.stdout.write(`Crypto Asset Report CLI

用法：
  node scripts/run-report.js --config ./config.local.json
  node scripts/run-report.js --config ./config.local.json --output json
  node scripts/run-report.js --config ./config.local.json --sync-notion
  node scripts/run-report.js --config ./config.local.json --write-obsidian

可选参数：
  --config <path>           配置文件路径，默认 config.local.json
  --output <summary|json>   输出格式，默认 summary
  --sync-notion             同步到 Notion
  --write-obsidian          写入 Obsidian
  --reference-cost <value>  覆盖配置里的参考成本
  --target-profit <value>   覆盖配置里的目标利润
  --help                    显示帮助
`);
}

main().catch((error) => {
  process.stderr.write(`执行失败：${error.message}\n`);
  process.exitCode = 1;
});
