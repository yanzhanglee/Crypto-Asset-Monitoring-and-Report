const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");

async function writeSnapshotToObsidian(payload, options) {
  const vaultPath = String(options.vaultPath || "").trim();
  if (!vaultPath) {
    throw new Error("缺少 Obsidian Vault 路径。");
  }

  const rootDir = String(options.rootDir || "NetWorth").trim() || "NetWorth";
  const weeklyDir = path.join(vaultPath, rootDir, "Weekly");
  const assetDir = path.join(vaultPath, rootDir, "Assets");
  const indexPath = path.join(vaultPath, rootDir, "index.md");

  await fs.mkdir(weeklyDir, { recursive: true });
  await fs.mkdir(assetDir, { recursive: true });

  const dashboard = payload.dashboard || {};
  const totalCard = dashboard.totals?.[0] || {};
  const exposure = totalCard.exposure || {};
  const marketPrices = normalizeMarketPrices(totalCard.marketPrices || []);
  const accountRows = Array.isArray(dashboard.accountRows) ? dashboard.accountRows : [];
  const assetRows = Array.isArray(dashboard.assetRows) ? dashboard.assetRows : [];
  const rawSummary = dashboard.rawSummary || {};

  const collectedAt = payload.collectedAt || new Date().toISOString();
  const dayKey = formatDayKey(collectedAt);
  const title = `@${formatChineseDate(collectedAt)} 净值统计`;
  const weeklyPath = path.join(weeklyDir, `${dayKey}.md`);
  const imageFilename = `${dayKey}-summary.png`;
  const imagePath = path.join(assetDir, imageFilename);

  const referenceCost = toFiniteNumber(options.referenceCost);
  const targetProfit = toFiniteNumber(options.targetProfit);
  const grandTotalUsdt = toFiniteNumber(rawSummary.grandTotalUsdt);
  const grandTotalCny = toFiniteNumber(rawSummary.grandTotalCny);
  const referenceProfit = referenceCost > 0 ? grandTotalCny - referenceCost : null;
  const referenceProfitRate = referenceCost > 0 ? referenceProfit / referenceCost : null;
  const targetProgress = targetProfit > 0 && Number.isFinite(referenceProfit) ? referenceProfit / targetProfit : null;

  await renderSummaryPreviewImage({
    filePath: imagePath,
    grandTotalUsdt,
    grandTotalCny,
    usdCny: toFiniteNumber(rawSummary.usdCny || options.usdCny),
    marketPrices,
    totalCard,
    assetRows,
    accountRows,
  });

  const content = buildWeeklyMarkdown({
    title,
    collectedAt,
    rootDir,
    imageFilename,
    grandTotalUsdt,
    grandTotalCny,
    bnBuyOne: toFiniteNumber(rawSummary.usdCny || options.usdCny),
    marketPrices,
    exposure,
    referenceCost,
    referenceProfit,
    referenceProfitRate,
    targetProfit,
    targetProgress,
    accountRows,
    assetRows,
  });

  await fs.writeFile(weeklyPath, content, "utf8");
  await upsertIndexFile({
    indexPath,
    rootDir,
    dayKey,
    title,
    grandTotalUsdt,
    grandTotalCny,
  });

  return {
    filePath: weeklyPath,
    imagePath,
    indexPath,
    noteTitle: title,
  };
}

function buildWeeklyMarkdown({
  title,
  collectedAt,
  rootDir,
  imageFilename,
  grandTotalUsdt,
  grandTotalCny,
  bnBuyOne,
  marketPrices,
  exposure,
  referenceCost,
  referenceProfit,
  referenceProfitRate,
  targetProfit,
  targetProgress,
  accountRows,
  assetRows,
}) {
  const topAssets = assetRows
    .filter((item) => item.estimatedUsdt !== null && item.estimatedUsdt !== undefined)
    .slice(0, 5);
  const topAccounts = accountRows.slice(0, 5);
  const stablecoinUsdt = parseUsdtFromDisplay(exposure.stablecoinUsdt);
  const nonStablecoinUsdt = parseUsdtFromDisplay(exposure.nonStablecoinUsdt);
  const nonStablecoinRatio = parsePercent(exposure.nonStablecoinRatio);

  const frontmatter = [
    "---",
    `标题: "${escapeYaml(title)}"`,
    `统计日期: ${formatDayKey(collectedAt)}`,
    `USDT净值: ${formatYamlNumber(grandTotalUsdt, 0)}`,
    `RMB净值: ${formatYamlNumber(grandTotalCny, 0)}`,
    `非稳币占比: ${formatYamlNumber(nonStablecoinRatio, 3)}`,
    `参考成本: ${formatYamlNumber(referenceCost, 0)}`,
    `参考净利润: ${formatYamlNumber(referenceProfit, 0)}`,
    "---",
    "",
  ];

  const summaryLines = [
    `# ${title}`,
    "",
    `![[${rootDir}/Assets/${imageFilename}]]`,
    "",
    "## 摘要",
    `- 统计时间：${formatDateTime(collectedAt)}`,
    `- USDT 净值：${formatUsdt(grandTotalUsdt)}`,
    `- RMB 净值：${formatCny(grandTotalCny)}`,
    `- 稳定币资产：${formatUsdtValue(stablecoinUsdt)}`,
    `- 非稳币资产：${formatUsdtValue(nonStablecoinUsdt)}`,
    `- 非稳币占比：${formatPercent(nonStablecoinRatio)}`,
  ];

  const marketLines = [
    "## 市场参考",
    `- BN 买 1：${formatPlainNumber(bnBuyOne, 2)}`,
    `- BTC 价格：${formatUsdtValue(marketPrices.BTC)}`,
    `- ETH 价格：${formatUsdtValue(marketPrices.ETH)}`,
    `- BNB 价格：${formatUsdtValue(marketPrices.BNB)}`,
  ];

  const profitLines = ["## 收益参考"];
  if (referenceCost > 0) {
    profitLines.push(`- 参考成本：${formatCny(referenceCost)}`);
    profitLines.push(`- 参考净利润：${formatSignedCny(referenceProfit)}`);
    profitLines.push(`- 参考利润率：${formatPercent(referenceProfitRate)}`);
  }

  if (targetProfit > 0) {
    profitLines.push(`- 目标利润：${formatCny(targetProfit)}`);
    profitLines.push(`- 利润目标达成率：${formatPercent(targetProgress)}`);
  }

  return [
    ...frontmatter,
    ...summaryLines,
    "",
    ...marketLines,
    "",
    ...(profitLines.length > 1 ? [...profitLines, ""] : []),
    "## 重点币种",
    ...topAssets.map((item) => `- ${item.asset}：${formatAssetAmount(item.asset, item.totalAmount)} / ${formatUsdtValue(item.estimatedUsdt)}`),
    "",
    "## 重点账户",
    ...topAccounts.map((item) => `- ${item.accountLabel}：${formatUsdtValue(item.totalUsdt)}`),
    "",
  ].join("\n");
}

async function renderSummaryPreviewImage({
  filePath,
  grandTotalUsdt,
  grandTotalCny,
  usdCny,
  marketPrices,
  totalCard,
  assetRows,
  accountRows,
}) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1560, height: 1180 },
      deviceScaleFactor: 2,
    });

    await page.setContent(
      buildSummaryPreviewHtml({
        grandTotalUsdt,
        grandTotalCny,
        usdCny,
        marketPrices,
        totalCard,
        assetRows,
        accountRows,
      }),
      { waitUntil: "load" },
    );

    await page.locator(".snapshot-canvas").screenshot({
      path: filePath,
      type: "png",
    });
  } finally {
    await browser.close();
  }
}

function buildSummaryPreviewHtml({ grandTotalUsdt, grandTotalCny, usdCny, marketPrices, totalCard, assetRows, accountRows }) {
  void grandTotalCny;
  void usdCny;
  void marketPrices;
  void totalCard;
  const assetItems = buildPreviewChartItems(assetRows, "asset");
  const accountItems = buildPreviewChartItems(accountRows, "account");

  return `<!DOCTYPE html>
  <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <title>Crypto Summary</title>
      <style>
        :root {
          --bg: #f7f2e8;
          --panel: rgba(255,255,255,0.92);
          --border: rgba(108, 78, 48, 0.12);
          --text: #2b1708;
          --muted: #7d6146;
          --shadow: 0 18px 44px rgba(134, 99, 55, 0.14);
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          background:
            radial-gradient(circle at top left, rgba(250, 206, 122, 0.20), transparent 34%),
            radial-gradient(circle at top right, rgba(237, 199, 137, 0.16), transparent 28%),
            var(--bg);
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", sans-serif;
          color: var(--text);
        }
        .snapshot-canvas { width: 2048px; padding: 24px; }
        .boards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; }
        .board {
          background: rgba(255,255,255,0.88);
          border: 1px solid rgba(108, 78, 48, 0.10);
          border-radius: 26px;
          padding: 18px;
        }
        .board-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
        .board h3 { font-size: 28px; margin: 0; }
        .board-subtitle { font-size: 16px; color: #8a6748; font-weight: 700; }
        .board-wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: stretch; }
        .board-chart-shell,
        .board-legend-shell {
          min-height: 540px;
          border-radius: 22px;
          background: rgba(255,255,255,0.88);
          border: 1px solid rgba(108, 78, 48, 0.10);
          padding: 18px;
        }
        .board-chart-shell {
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .donut {
          --donut: conic-gradient(#d6cfc5 0 100%);
          width: 430px;
          height: 430px;
          border-radius: 50%;
          background: var(--donut);
          position: relative;
          margin: 0 auto;
        }
        .donut::after {
          content: "";
          position: absolute;
          inset: 82px;
          border-radius: 50%;
          background: rgba(255,255,255,0.96);
          box-shadow: inset 0 0 0 1px rgba(108, 78, 48, 0.08);
        }
        .donut-center {
          position: absolute;
          inset: 0;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 0 64px;
        }
        .donut-center span { font-size: 18px; color: var(--muted); margin-bottom: 10px; }
        .donut-center strong { font-size: 36px; line-height: 1; font-weight: 800; }
        .donut-center em { font-style: normal; font-size: 18px; font-weight: 800; margin-top: 10px; letter-spacing: 0.04em; }
        .legend { display: grid; gap: 18px; }
        .legend-row {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 12px;
          align-items: center;
          padding: 8px 6px;
          border-radius: 16px;
        }
        .legend-dot { width: 14px; height: 14px; border-radius: 50%; }
        .legend-name { font-size: 22px; font-weight: 700; }
        .legend-meta { text-align: right; font-size: 16px; color: var(--muted); }
        .legend-meta strong { display: block; color: var(--text); font-size: 24px; margin-bottom: 4px; }
      </style>
    </head>
    <body>
      <div class="snapshot-canvas">
        <div class="boards">
          ${buildPreviewBoardHtml("各币种资产", "多账户汇总", "总资产估值", assetItems, grandTotalUsdt)}
          ${buildPreviewBoardHtml("各账户资产", "按账户归并展示", "账户分布", accountItems, grandTotalUsdt)}
        </div>
      </div>
    </body>
  </html>`;
}

function buildPreviewBoardHtml(title, subtitle, centerLabel, rows, totalValue) {
  const segments = rows.length ? rows : [{ label: "暂无数据", value: 1, percent: 100, color: "#d6cfc5" }];
  return `
    <section class="board">
      <div class="board-head">
        <h3>${escapeHtml(title)}</h3>
        <span class="board-subtitle">${escapeHtml(subtitle)}</span>
      </div>
      <div class="board-wrap">
        <div class="board-chart-shell">
          <div class="donut" style="--donut:${buildConicGradient(segments)}">
            <div class="donut-center">
              <span>${escapeHtml(centerLabel)}</span>
              <strong>${escapeHtml(formatUsdtNumber(totalValue))}</strong>
              <em>USDT</em>
            </div>
          </div>
        </div>
        <div class="board-legend-shell">
          <div class="legend">
            ${segments
              .map(
                (item) => `
                  <div class="legend-row">
                    <span class="legend-dot" style="background:${item.color}"></span>
                    <div class="legend-name">${escapeHtml(item.label)}</div>
                    <div class="legend-meta">
                      <strong>${escapeHtml(formatPercent(item.percent / 100))}</strong>
                      <span>${escapeHtml(formatUsdtValue(item.value))}</span>
                    </div>
                  </div>
                `,
              )
              .join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function buildPreviewChartItems(rows, mode) {
  const total = (rows || []).reduce((sum, row) => sum + toFiniteNumber(mode === "asset" ? row.estimatedUsdt : row.totalUsdt), 0);
  return (rows || [])
    .map((row, index) => ({
      label: mode === "asset" ? row.asset : row.accountLabel,
      value: toFiniteNumber(mode === "asset" ? row.estimatedUsdt : row.totalUsdt),
      color: PREVIEW_CHART_COLORS[index % PREVIEW_CHART_COLORS.length],
    }))
    .filter((row) => row.value > 0)
    .sort((left, right) => right.value - left.value)
    .slice(0, 6)
    .map((row) => ({
      ...row,
      percent: total > 0 ? (row.value / total) * 100 : 0,
    }));
}

function buildConicGradient(rows) {
  let offset = 0;
  return `conic-gradient(${rows
    .map((row) => {
      const start = offset;
      const end = offset + row.percent;
      offset = end;
      return `${row.color} ${start}% ${end}%`;
    })
    .join(", ")})`;
}

function upsertIndexFile({ indexPath, rootDir, dayKey, title, grandTotalUsdt, grandTotalCny }) {
  return fs
    .readFile(indexPath, "utf8")
    .catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return "# 净值索引\n\n## 周报\n";
    })
    .then((existing) => {
      const noteLink = `[[${rootDir}/Weekly/${dayKey}|${title}]]`;
      const line = `- ${dayKey} · ${noteLink} · ${formatUsdt(grandTotalUsdt)} · ${formatCny(grandTotalCny)}`;
      const lines = existing.split("\n").filter((entry) => entry.trim());
      const prefix = lines.filter((entry) => !entry.startsWith("- "));
      const entries = lines.filter((entry) => entry.startsWith("- ") && !entry.includes(`Weekly/${dayKey}|`));
      return fs.writeFile(indexPath, `${[...prefix, line, ...entries].join("\n")}\n`, "utf8");
    });
}

function normalizeMarketPrices(items) {
  return Object.fromEntries(
    (Array.isArray(items) ? items : [])
      .map((item) => [String(item.asset || "").toUpperCase(), parseUsdtFromDisplay(item.value)])
      .filter(([key, value]) => key && Number.isFinite(value)),
  );
}

function previewColorForSymbol(symbol) {
  const palette = {
    BTC: "#f7931a",
    ETH: "#627eea",
    BNB: "#f3ba2f",
  };
  return palette[symbol] || "#0c7c74";
}

function formatDayKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatChineseDate(value) {
  const date = new Date(value);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatDateTime(value) {
  const date = new Date(value);
  return `${formatDayKey(value)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

function formatUsdt(value) {
  return `US$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(toFiniteNumber(value))}`;
}

function formatUsdtNumber(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(toFiniteNumber(value));
}

function formatUsdtValue(value) {
  const numeric = toFiniteNumber(value);
  return `US$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(numeric) >= 1000 ? 0 : 2,
    minimumFractionDigits: Math.abs(numeric) >= 1000 ? 0 : 2,
  }).format(numeric)}`;
}

function formatCny(value) {
  return `¥${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(toFiniteNumber(value))}`;
}

function formatSignedCny(value) {
  const numeric = toFiniteNumber(value);
  const sign = numeric >= 0 ? "" : "-";
  return `${sign}${formatCny(Math.abs(numeric))}`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function formatPlainNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function formatAssetAmount(asset, value) {
  const numeric = toFiniteNumber(value);
  const maximumFractionDigits = String(asset || "").toUpperCase() === "USDT" ? 1 : 3;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(numeric);
}

function parseUsdtFromDisplay(value) {
  const numeric = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function parsePercent(value) {
  const numeric = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? numeric / 100 : 0;
}

function toFiniteNumber(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundNumber(value) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function formatYamlNumber(value, digits = 0) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function escapeYaml(value) {
  return String(value || "").replaceAll('"', '\\"');
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const PREVIEW_CHART_COLORS = ["#177f79", "#d17907", "#b95f0d", "#2e63e8", "#0f99bd", "#c41a4b"];

module.exports = {
  writeSnapshotToObsidian,
};
