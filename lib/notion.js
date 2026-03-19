const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { chromium } = require("playwright");

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const NOTION_FILE_VERSION = "2025-09-03";
const ENABLE_NOTION_SUMMARY_PREVIEW = false;
const execFileAsync = promisify(execFile);
const ACCOUNT_SUMMARY_RELATION_PROPERTY = "Related to 净值汇总 (账户明细)";
const ASSET_SUMMARY_RELATION_PROPERTY = "Related to 净值汇总 (币种明细)";

async function syncSnapshotToNotion(payload, options) {
  const token = String(options.token || "").trim();
  if (!token) {
    throw new Error("缺少 NOTION_TOKEN，无法写入 Notion。");
  }

  const summaryDatabaseId = options.summaryDatabaseId;
  const accountDatabaseId = options.accountDatabaseId;
  const assetDatabaseId = options.assetDatabaseId;
  const summaryTemplateId = String(options.summaryTemplateId || "").trim();

  if (!summaryDatabaseId || !accountDatabaseId || !assetDatabaseId) {
    throw new Error("缺少 Notion Database ID 配置。");
  }

  const collectedAt = payload.collectedAt || new Date().toISOString();
  const notionDate = toNotionDate(collectedAt);
  const title = buildSummaryTitle(collectedAt);
  const dashboard = payload.dashboard || {};
  const marketPrices = normalizeMarketPrices(dashboard.totals?.[0]?.marketPrices || []);
  const referenceCost = toFiniteNumber(options.referenceCost);
  const targetProfit = toFiniteNumber(options.targetProfit);
  const grandTotalUsdt = toFiniteNumber(dashboard.rawSummary?.grandTotalUsdt);
  const grandTotalCny = toFiniteNumber(dashboard.rawSummary?.grandTotalCny);
  const referenceProfit = grandTotalCny - referenceCost;
  const referenceProfitRate = referenceCost > 0 ? referenceProfit / referenceCost : null;
  const targetProgress = targetProfit > 0 ? referenceProfit / targetProfit : null;
  const statusSummary = buildStatusSummary(payload);
  const [summarySchema, accountSchema, assetSchema] = await Promise.all([
    retrieveDatabase({ token, databaseId: summaryDatabaseId }),
    retrieveDatabase({ token, databaseId: accountDatabaseId }),
    retrieveDatabase({ token, databaseId: assetDatabaseId }),
  ]);

  const existingSummary = await findSummaryByDate({ token, databaseId: summaryDatabaseId, notionDate });
  const summaryProperties = orderPropertiesBySchema(summarySchema, {
    标题: titleProperty(title),
    统计日期: { date: { start: notionDate } },
    同步时间: { date: { start: collectedAt } },
    "USDT 净值": { number: grandTotalUsdt },
    "BN 买 1": { number: toFiniteNumber(options.bnBuyOne || options.usdCny || dashboard.rawSummary?.usdCny || options.fxRate || 0) },
    "RMB 净值": { number: grandTotalCny },
    "BTC 价格": { number: toFiniteNumber(marketPrices.BTC) },
    "ETH 价格": { number: toFiniteNumber(marketPrices.ETH) },
    "BNB 价格": { number: toFiniteNumber(marketPrices.BNB) },
    参考成本: { number: referenceCost },
    参考净利润: { number: Number.isFinite(referenceProfit) ? referenceProfit : 0 },
    参考利润率: { number: Number.isFinite(referenceProfitRate) ? referenceProfitRate : null },
    目标利润: { number: targetProfit > 0 ? targetProfit : null },
    利润目标达成率: { number: Number.isFinite(targetProgress) ? targetProgress : null },
    源级错误数: { number: Array.isArray(payload.errors) ? payload.errors.length : 0 },
  });

  const summaryPage = existingSummary
    ? await updatePage({ token, pageId: existingSummary.id, properties: summaryProperties })
    : await createPage({
        token,
        databaseId: summaryDatabaseId,
        properties: summaryProperties,
        templateId: summaryTemplateId || undefined,
      });

  await archivePagesByDate({ token, databaseId: accountDatabaseId, notionDate });
  await archivePagesByDate({ token, databaseId: assetDatabaseId, notionDate });

  const accountRows = Array.isArray(dashboard.accountRows) ? dashboard.accountRows : [];
  const assetRows = Array.isArray(dashboard.assetRows) ? dashboard.assetRows : [];
  const summaryPreviewBlock = ENABLE_NOTION_SUMMARY_PREVIEW
    ? await buildSummaryPreviewBlock({
        token,
        notionDate,
        grandTotalUsdt,
        grandTotalCny,
        usdCny: toFiniteNumber(options.bnBuyOne || options.usdCny || dashboard.rawSummary?.usdCny || options.fxRate || 0),
        marketPrices,
        totalCard: dashboard.totals?.[0] || {},
        assetRows,
        accountRows,
      })
    : null;

  const accountResults = [];
  let accountSort = 1;
  for (const row of accountRows) {
    const previous = await findLatestRowByTitle({
      token,
      databaseId: accountDatabaseId,
      titlePropertyName: "名称",
      title: row.accountLabel,
      datePropertyName: "统计日期",
      beforeDate: notionDate,
    });
    const previousValue = toFiniteNumber(previous?.properties?.["本期"]?.number);
    const currentValue = toFiniteNumber(row.totalUsdt);
    const delta = currentValue - previousValue;
    const note = buildAccountNote(row);
    const category = classifyAccount(row);
    const page = await createPage({
      token,
      databaseId: accountDatabaseId,
      properties: orderPropertiesBySchema(accountSchema, {
        名称: titleProperty(row.accountLabel),
        统计日期: { date: { start: notionDate } },
        [ACCOUNT_SUMMARY_RELATION_PROPERTY]: { relation: [{ id: summaryPage.id }] },
        分类: category ? { select: { name: category } } : undefined,
        上一期: { number: previousValue },
        本期: { number: currentValue },
        Delta: { number: delta },
        备注: richTextProperty(note),
        排序: { number: accountSort++ },
      }),
    });
    accountResults.push(page.id);
  }

  const assetResults = [];
  let assetSort = 1;
  for (const row of assetRows.filter((item) => item.estimatedUsdt !== null && item.estimatedUsdt !== undefined)) {
    const previous = await findLatestRowByTitle({
      token,
      databaseId: assetDatabaseId,
      titlePropertyName: "币种",
      title: row.asset,
      datePropertyName: "统计日期",
      beforeDate: notionDate,
    });
    const previousAmount = toFiniteNumber(previous?.properties?.["本期数量"]?.number);
    const currentAmount = toFiniteNumber(row.totalAmount);
    const amountDelta = currentAmount - previousAmount;
    const currentUsdt = toFiniteNumber(row.estimatedUsdt);
    const sourceText = Array.isArray(row.sourceLabels) ? row.sourceLabels.join("、") : "";
    const page = await createPage({
      token,
      databaseId: assetDatabaseId,
      properties: orderPropertiesBySchema(assetSchema, {
        币种: titleProperty(row.asset),
        统计日期: { date: { start: notionDate } },
        [ASSET_SUMMARY_RELATION_PROPERTY]: { relation: [{ id: summaryPage.id }] },
        上一期数量: { number: previousAmount },
        本期数量: { number: currentAmount },
        数量变化: { number: amountDelta },
        "本期估值 USDT": { number: currentUsdt },
        来源账户: richTextProperty(sourceText),
        备注: richTextProperty(""),
        排序: { number: assetSort++ },
      }),
    });
    assetResults.push(page.id);
  }

  const summaryBlocks = buildSummaryPageBlocks({
    collectedAt,
    grandTotalUsdt,
    grandTotalCny,
    usdCny: toFiniteNumber(options.bnBuyOne || options.usdCny || dashboard.rawSummary?.usdCny || options.fxRate || 0),
    marketPrices,
    statusSummary,
    referenceCost,
    referenceProfit,
    referenceProfitRate,
    targetProfit,
    targetProgress,
    accountRows,
    assetRows,
    summaryPreviewBlock,
  });

  if (summaryTemplateId) {
    await replaceManagedPageBody({
      token,
      pageId: summaryPage.id,
      blocks: summaryBlocks,
    });
  } else {
    await replacePageBody({
      token,
      pageId: summaryPage.id,
      blocks: summaryBlocks,
    });
  }

  return {
    summaryPageId: summaryPage.id,
    summaryPageUrl: summaryPage.url,
    accountRowsWritten: accountResults.length,
    assetRowsWritten: assetResults.length,
    notionDate,
  };
}

async function notionRequest({ token, path, method = "GET", body }) {
  return notionRequestWithVersion({ token, path, method, body, version: NOTION_VERSION });
}

async function notionRequestWithVersion({ token, path, method = "GET", body, version }) {
  const url = `${NOTION_API_BASE}${path}`;
  const args = [
    "-sS",
    "--max-time",
    "30",
    "-X",
    method,
    "-H",
    `Authorization: Bearer ${token}`,
    "-H",
    `Notion-Version: ${version}`,
    "-H",
    "Content-Type: application/json",
    "-w",
    "\n%{http_code}",
  ];

  if (body) {
    args.push("--data", JSON.stringify(body));
  }

  args.push(url);

  const { stdout, stderr } = await execFileAsync("curl", args, {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = String(stdout || "");
  const lastNewline = output.lastIndexOf("\n");
  const rawBody = lastNewline >= 0 ? output.slice(0, lastNewline) : output;
  const statusText = lastNewline >= 0 ? output.slice(lastNewline + 1).trim() : "";
  const status = Number(statusText);
  const data = rawBody ? JSON.parse(rawBody) : null;

  if (!Number.isFinite(status) || status < 200 || status >= 300) {
    throw new Error(data?.message || stderr || `Notion API 请求失败: ${status || "unknown"}`);
  }

  return data;
}

function titleProperty(text) {
  return {
    title: [
      {
        text: {
          content: String(text || ""),
        },
      },
    ],
  };
}

function richTextProperty(text) {
  const content = String(text || "").trim();
  return {
    rich_text: content
      ? [
          {
            text: {
              content,
            },
          },
        ]
      : [],
  };
}

async function createPage({ token, databaseId, properties, templateId }) {
  const body = {
    parent: {
      database_id: databaseId,
    },
    properties: compactProperties(properties),
  };

  if (templateId) {
    body.template = {
      type: "template_id",
      template_id: templateId,
    };
  }

  return notionRequest({
    token,
    path: "/pages",
    method: "POST",
    body,
  });
}

async function updatePage({ token, pageId, properties }) {
  return notionRequest({
    token,
    path: `/pages/${pageId}`,
    method: "PATCH",
    body: {
      properties: compactProperties(properties),
    },
  });
}

async function archivePage({ token, pageId }) {
  return notionRequest({
    token,
    path: `/pages/${pageId}`,
    method: "PATCH",
    body: {
      archived: true,
    },
  });
}

async function listBlockChildren({ token, blockId, startCursor }) {
  const query = new URLSearchParams();
  query.set("page_size", "100");
  if (startCursor) query.set("start_cursor", startCursor);
  return notionRequest({
    token,
    path: `/blocks/${blockId}/children?${query.toString()}`,
  });
}

async function deleteBlock({ token, blockId }) {
  return notionRequest({
    token,
    path: `/blocks/${blockId}`,
    method: "DELETE",
  });
}

async function appendBlockChildren({ token, blockId, children }) {
  return notionRequest({
    token,
    path: `/blocks/${blockId}/children`,
    method: "PATCH",
    body: {
      children,
    },
  });
}

async function queryDatabase({ token, databaseId, filter, sorts, pageSize = 100 }) {
  return notionRequest({
    token,
    path: `/databases/${databaseId}/query`,
    method: "POST",
    body: compactProperties({
      filter,
      sorts,
      page_size: pageSize,
    }),
  });
}

async function retrieveDatabase({ token, databaseId }) {
  return notionRequest({
    token,
    path: `/databases/${databaseId}`,
  });
}

async function findSummaryByDate({ token, databaseId, notionDate }) {
  const result = await queryDatabase({
    token,
    databaseId,
    filter: {
      property: "统计日期",
      date: {
        equals: notionDate,
      },
    },
    pageSize: 10,
  });
  return Array.isArray(result.results) && result.results.length ? result.results[0] : null;
}

async function archivePagesByDate({ token, databaseId, notionDate }) {
  const result = await queryDatabase({
    token,
    databaseId,
    filter: {
      property: "统计日期",
      date: {
        equals: notionDate,
      },
    },
    pageSize: 100,
  });

  for (const page of result.results || []) {
    await archivePage({ token, pageId: page.id });
  }
}

async function replacePageBody({ token, pageId, blocks }) {
  let cursor;
  do {
    const response = await listBlockChildren({ token, blockId: pageId, startCursor: cursor });
    for (const block of response.results || []) {
      await deleteBlock({ token, blockId: block.id });
    }
    cursor = response.has_more ? response.next_cursor : null;
  } while (cursor);

  for (let index = 0; index < blocks.length; index += 100) {
    await appendBlockChildren({
      token,
      blockId: pageId,
      children: blocks.slice(index, index + 100),
    });
  }
}

async function replaceManagedPageBody({ token, pageId, blocks }) {
  let cursor;
  do {
    const response = await listBlockChildren({ token, blockId: pageId, startCursor: cursor });
    for (const block of response.results || []) {
      if (block.type === "child_database") continue;
      await deleteBlock({ token, blockId: block.id });
    }
    cursor = response.has_more ? response.next_cursor : null;
  } while (cursor);

  for (let index = 0; index < blocks.length; index += 100) {
    await appendBlockChildren({
      token,
      blockId: pageId,
      children: blocks.slice(index, index + 100),
    });
  }
}

async function findLatestRowByTitle({ token, databaseId, titlePropertyName, title, datePropertyName, beforeDate }) {
  const result = await queryDatabase({
    token,
    databaseId,
    filter: {
      and: [
        {
          property: titlePropertyName,
          title: {
            equals: title,
          },
        },
        {
          property: datePropertyName,
          date: {
            before: beforeDate,
          },
        },
      ],
    },
    sorts: [
      {
        property: datePropertyName,
        direction: "descending",
      },
    ],
    pageSize: 1,
  });

  return Array.isArray(result.results) && result.results.length ? result.results[0] : null;
}

function buildSummaryTitle(collectedAt) {
  const date = new Date(collectedAt);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `@${year}年${month}月${day}日 净值统计`;
}

function toNotionDate(input) {
  const date = new Date(input);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeMarketPrices(items) {
  return Object.fromEntries(
    (Array.isArray(items) ? items : [])
      .map((item) => [String(item.asset || "").toUpperCase(), toFiniteNumber(String(item.value || "").replace(/[^\d.-]/g, ""))])
      .filter((entry) => entry[0] && Number.isFinite(entry[1])),
  );
}

function toFiniteNumber(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function compactProperties(input) {
  return Object.fromEntries(Object.entries(input || {}).filter(([, value]) => value !== undefined));
}

function orderPropertiesBySchema(schema, properties) {
  const next = compactProperties(properties);
  const schemaKeys = Object.keys((schema && schema.properties) || {});

  if (!schemaKeys.length) {
    return next;
  }

  const ordered = {};

  for (const key of schemaKeys) {
    if (key in next) {
      ordered[key] = next[key];
    }
  }

  return ordered;
}

function buildStatusSummary(payload) {
  const snapshots = Array.isArray(payload.snapshots) ? payload.snapshots : [];
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  const dashboard = payload.dashboard || {};
  const totalCard = dashboard.totals?.[0] || {};
  const exposure = totalCard.exposure || {};
  const topAssets = (dashboard.assetRows || [])
    .filter((item) => item.estimatedUsdt !== null && item.estimatedUsdt !== undefined)
    .slice(0, 3)
    .map((item) => item.asset)
    .join(" / ");
  const topAccounts = (dashboard.accountRows || [])
    .slice(0, 3)
    .map((item) => item.accountLabel)
    .join(" / ");
  const stablecoinRatio = exposure.nonStablecoinRatio || "-";
  const stablecoinUsdt = exposure.stablecoinUsdt || "-";
  const nonStablecoinUsdt = exposure.nonStablecoinUsdt || "-";

  return [
    `本次统计 ${snapshots.length} 个数据源，源级错误 ${errors.length} 个。`,
    `稳定币资产 ${stablecoinUsdt}，非稳币资产 ${nonStablecoinUsdt}，非稳币占比 ${stablecoinRatio}。`,
    `前 3 大资产：${topAssets || "-"}`,
    `前 3 大账户：${topAccounts || "-"}`,
  ].join("\n");
}

function buildSummaryPageBlocks({
  collectedAt,
  grandTotalUsdt,
  grandTotalCny,
  usdCny,
  marketPrices,
  statusSummary,
  referenceCost,
  referenceProfit,
  referenceProfitRate,
  targetProfit,
  targetProgress,
  accountRows,
  assetRows,
}) {
  const topAccounts = (accountRows || []).slice(0, 3);
  const topAssets = (assetRows || [])
    .filter((item) => item.estimatedUsdt !== null && item.estimatedUsdt !== undefined)
    .slice(0, 5);

  const lines = [
    `统计时间：${formatDateTimeForSummary(collectedAt)}`,
    `总资产：${formatUsdt(grandTotalUsdt)} / ${formatCny(grandTotalCny)}`,
    `BN 买 1：${formatPlainNumber(usdCny, 2)}`,
  ];

  if (Number.isFinite(toFiniteNumber(marketPrices.BTC)) || Number.isFinite(toFiniteNumber(marketPrices.ETH)) || Number.isFinite(toFiniteNumber(marketPrices.BNB))) {
    lines.push(
      `参考价格：BTC ${formatUsdtValue(marketPrices.BTC)}，ETH ${formatUsdtValue(marketPrices.ETH)}，BNB ${formatUsdtValue(marketPrices.BNB)}`,
    );
  }

  if (referenceCost > 0) {
    lines.push(
      `参考成本：${formatCny(referenceCost)}；参考净利润：${formatSignedCny(referenceProfit)}；参考利润率：${formatPercent(referenceProfitRate)}`,
    );
  }

  if (targetProfit > 0) {
    lines.push(`目标利润：${formatCny(targetProfit)}；达成率：${formatPercent(targetProgress)}`);
  }

  if (topAssets.length) {
    lines.push(`重点币种：${topAssets.map((item) => `${item.asset} ${formatUsdtValue(item.estimatedUsdt)}`).join("；")}`);
  }

  if (topAccounts.length) {
    lines.push(`重点账户：${topAccounts.map((item) => `${item.accountLabel} ${formatUsdtValue(item.totalUsdt)}`).join("；")}`);
  }

  const statusLines = String(statusSummary || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return [
    headingBlock(2, "摘要"),
    ...lines.map((line) => bulletedListItemBlock(line)),
    ...statusLines.map((line) => bulletedListItemBlock(line)),
    ...(summaryPreviewBlock ? [summaryPreviewBlock] : []),
  ];
}

function headingBlock(level, text) {
  return {
    object: "block",
    type: `heading_${level}`,
    [`heading_${level}`]: {
      rich_text: richText(text),
    },
  };
}

function paragraphBlock(text) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: richText(text),
    },
  };
}

function bulletedListItemBlock(text) {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: richText(text),
    },
  };
}

function richText(text) {
  return [
    {
      type: "text",
      text: {
        content: String(text || ""),
      },
    },
  ];
}

function buildAccountNote(row) {
  const topAssets = Array.isArray(row.rows)
    ? row.rows
        .slice(0, 3)
        .map((item) => `${item.asset} ${formatNoteUsdt(item.estimatedUsdt)}`)
        .join("；")
    : "";
  return topAssets;
}

function classifyAccount(row) {
  const exchange = String(row.exchange || "").toLowerCase();
  if (exchange === "wallet") return "Wallet";
  if (exchange === "defi") return "DeFi";
  return "CEX";
}

function formatNoteUsdt(value) {
  const numeric = toFiniteNumber(value);
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(numeric) >= 1000 ? 0 : 2,
    minimumFractionDigits: Math.abs(numeric) >= 1000 ? 0 : 2,
  }).format(numeric);
}

function formatUsdt(value) {
  const numeric = toFiniteNumber(value);
  return `US$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(numeric)}`;
}

function formatUsdtValue(value) {
  const numeric = toFiniteNumber(value);
  return `US$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(numeric) >= 1000 ? 0 : 2,
    minimumFractionDigits: Math.abs(numeric) >= 1000 ? 0 : 2,
  }).format(numeric)}`;
}

function formatCny(value) {
  const numeric = toFiniteNumber(value);
  return `¥${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(numeric)}`;
}

function formatSignedCny(value) {
  const numeric = toFiniteNumber(value);
  const sign = numeric >= 0 ? "" : "-";
  return `${sign}¥${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Math.abs(numeric))}`;
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

function formatDateTimeForSummary(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function buildSummaryPreviewBlock({
  token,
  notionDate,
  grandTotalUsdt,
  grandTotalCny,
  usdCny,
  marketPrices,
  totalCard,
  assetRows,
  accountRows,
}) {
  let filePath;

  try {
    filePath = await renderSummaryPreviewImage({
      notionDate,
      grandTotalUsdt,
      grandTotalCny,
      usdCny,
      marketPrices,
      totalCard,
      assetRows,
      accountRows,
    });
    const fileUploadId = await uploadImageToNotion({
      token,
      filePath,
      filename: `crypto-summary-${notionDate}.png`,
      contentType: "image/png",
    });

    return imageBlockFromUpload(fileUploadId, "统计概览");
  } catch (error) {
    console.warn(`Notion summary preview skipped: ${error.message}`);
    return null;
  } finally {
    if (filePath) {
      await fs.unlink(filePath).catch(() => {});
    }
  }
}

async function renderSummaryPreviewImage({
  notionDate,
  grandTotalUsdt,
  grandTotalCny,
  usdCny,
  marketPrices,
  totalCard,
  assetRows,
  accountRows,
}) {
  const filePath = path.join(os.tmpdir(), `crypto-summary-${notionDate}-${crypto.randomUUID()}.png`);
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

  return filePath;
}

async function uploadImageToNotion({ token, filePath, filename, contentType }) {
  const created = await notionRequestWithVersion({
    token,
    path: "/file_uploads",
    method: "POST",
    version: NOTION_FILE_VERSION,
    body: {
      mode: "single_part",
      filename,
      content_type: contentType,
    },
  });

  const uploadUrl = created?.upload_url;
  const fileUploadId = created?.id;

  if (!uploadUrl || !fileUploadId) {
    throw new Error("Notion file upload 初始化失败。");
  }

  await uploadFileToUrl({
    token,
    uploadUrl,
    filePath,
    contentType,
  });

  return fileUploadId;
}

async function uploadFileToUrl({ token, uploadUrl, filePath, contentType }) {
  const args = [
    "-sS",
    "--max-time",
    "60",
    "-X",
    "POST",
    "-H",
    `Authorization: Bearer ${token}`,
    "-H",
    `Notion-Version: ${NOTION_FILE_VERSION}`,
    "-H",
    "Expect:",
    "-F",
    `file=@${filePath};type=${contentType}`,
    "-w",
    "\n%{http_code}",
    uploadUrl,
  ];
  const { stdout, stderr } = await execFileAsync("curl", args, {
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  const output = String(stdout || "");
  const lastNewline = output.lastIndexOf("\n");
  const rawBody = lastNewline >= 0 ? output.slice(0, lastNewline) : output;
  const statusText = lastNewline >= 0 ? output.slice(lastNewline + 1).trim() : "";
  const status = Number(statusText);

  if (!Number.isFinite(status) || status < 200 || status >= 300) {
    throw new Error(rawBody || stderr || `Notion 文件上传失败: ${status || "unknown"}`);
  }
}

function imageBlockFromUpload(fileUploadId, caption) {
  return {
    object: "block",
    type: "image",
    image: {
      type: "file_upload",
      file_upload: {
        id: fileUploadId,
      },
      caption: caption ? richText(caption) : [],
    },
  };
}

function buildSummaryPreviewHtml({ grandTotalUsdt, grandTotalCny, usdCny, marketPrices, totalCard, assetRows, accountRows }) {
  const exposure = totalCard.exposure || {};
  const assetItems = buildPreviewChartItems(assetRows, "asset");
  const accountItems = buildPreviewChartItems(accountRows, "account");
  const marketPriceMap = {
    BTC: toFiniteNumber(marketPrices.BTC),
    ETH: toFiniteNumber(marketPrices.ETH),
    BNB: toFiniteNumber(marketPrices.BNB),
  };

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
          --accent: #0c7c74;
          --shadow: 0 18px 44px rgba(134, 99, 55, 0.14);
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          background:
            radial-gradient(circle at top left, rgba(250, 206, 122, 0.20), transparent 34%),
            radial-gradient(circle at top right, rgba(237, 199, 137, 0.16), transparent 28%),
            var(--bg);
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'PingFang SC', 'Hiragino Sans GB', sans-serif;
          color: var(--text);
        }
        .snapshot-canvas {
          width: 1480px;
          padding: 32px;
        }
        .hero {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 34px;
          box-shadow: var(--shadow);
          padding: 28px 32px;
        }
        .hero-grid {
          display: grid;
          grid-template-columns: 1.15fr 1fr;
          gap: 18px;
        }
        .kicker {
          font-size: 13px;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          color: var(--accent);
          font-weight: 700;
          margin-bottom: 8px;
        }
        .headline {
          font-size: 72px;
          line-height: 0.95;
          font-weight: 800;
          margin: 0;
        }
        .subline {
          font-size: 24px;
          color: #145f63;
          font-weight: 700;
          margin-top: 12px;
        }
        .exposure-table {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          margin-top: 22px;
        }
        .exposure-cell {
          padding: 14px 16px;
          border-radius: 18px;
          background: rgba(248, 244, 237, 0.95);
          border: 1px solid rgba(108, 78, 48, 0.10);
        }
        .exposure-cell span {
          display: block;
          font-size: 13px;
          color: var(--muted);
          margin-bottom: 8px;
        }
        .exposure-cell strong {
          font-size: 22px;
        }
        .stablecoins {
          margin-top: 14px;
          font-size: 13px;
          color: var(--muted);
        }
        .price-strip {
          display: flex;
          gap: 12px;
          margin-top: 16px;
          flex-wrap: wrap;
        }
        .price-chip {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          background: rgba(255,255,255,0.9);
          border: 1px solid rgba(108, 78, 48, 0.10);
          border-radius: 999px;
          font-size: 18px;
          font-weight: 700;
        }
        .price-dot {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 12px;
          font-weight: 800;
        }
        .fx-line {
          margin-top: 14px;
          font-size: 13px;
          color: var(--muted);
        }
        .boards {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
        }
        .board {
          background: rgba(255,255,255,0.88);
          border: 1px solid rgba(108, 78, 48, 0.10);
          border-radius: 26px;
          padding: 18px;
        }
        .board h3 {
          font-size: 28px;
          margin: 0 0 14px;
        }
        .board-wrap {
          display: grid;
          grid-template-columns: 340px 1fr;
          gap: 12px;
          align-items: center;
        }
        .donut {
          --donut: conic-gradient(#d6cfc5 0 100%);
          width: 290px;
          height: 290px;
          border-radius: 50%;
          background: var(--donut);
          position: relative;
          margin: 0 auto;
        }
        .donut::after {
          content: "";
          position: absolute;
          inset: 54px;
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
          padding: 0 48px;
        }
        .donut-center span {
          font-size: 16px;
          color: var(--muted);
          margin-bottom: 8px;
        }
        .donut-center strong {
          font-size: 34px;
          line-height: 1;
          font-weight: 800;
        }
        .legend {
          display: grid;
          gap: 12px;
        }
        .legend-row {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 12px;
          align-items: center;
          padding: 10px 12px;
          border-radius: 16px;
          background: rgba(247, 242, 232, 0.68);
        }
        .legend-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
        }
        .legend-name {
          font-size: 18px;
          font-weight: 700;
        }
        .legend-meta {
          text-align: right;
          font-size: 16px;
          color: var(--muted);
        }
        .legend-meta strong {
          display: block;
          color: var(--text);
          font-size: 20px;
          margin-bottom: 2px;
        }
      </style>
    </head>
    <body>
      <div class="snapshot-canvas">
        <section class="hero">
          <div class="hero-grid">
            <div>
              <div class="kicker">Snapshot</div>
              <div class="headline">${escapeHtml(formatUsdt(grandTotalUsdt))}</div>
              <div class="subline">${escapeHtml(formatCny(grandTotalCny))}</div>
              <div class="exposure-table">
                <div class="exposure-cell">
                  <span>非稳币资产</span>
                  <strong>${escapeHtml(exposure.nonStablecoinUsdt || "-")}</strong>
                </div>
                <div class="exposure-cell">
                  <span>非稳币占比</span>
                  <strong>${escapeHtml(exposure.nonStablecoinRatio || "-")}</strong>
                </div>
                <div class="exposure-cell">
                  <span>稳定币资产</span>
                  <strong>${escapeHtml(exposure.stablecoinUsdt || "-")}</strong>
                </div>
              </div>
              ${
                Array.isArray(exposure.stablecoinAssets) && exposure.stablecoinAssets.length
                  ? `<div class="stablecoins">稳定币口径：${escapeHtml(exposure.stablecoinAssets.join("、"))}</div>`
                  : ""
              }
              <div class="price-strip">
                ${["BTC", "ETH", "BNB"]
                  .map(
                    (symbol) => `
                      <div class="price-chip">
                        <span class="price-dot" style="background:${previewColorForSymbol(symbol)}">${escapeHtml(symbol.slice(0, 1))}</span>
                        <span>${escapeHtml(symbol)}</span>
                        <strong>${escapeHtml(formatUsdtValue(marketPriceMap[symbol]))}</strong>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
              <div class="fx-line">BN 买 1：${escapeHtml(formatPlainNumber(usdCny, 2))}</div>
            </div>
            <div class="boards">
              ${buildPreviewBoardHtml("各币种资产", "总资产估值", assetItems, grandTotalUsdt)}
              ${buildPreviewBoardHtml("各账户资产", "账户分布", accountItems, grandTotalUsdt)}
            </div>
          </div>
        </section>
      </div>
    </body>
  </html>`;
}

function buildPreviewBoardHtml(title, centerLabel, rows, totalValue) {
  const segments = rows.length ? rows : [{ label: "暂无数据", value: 1, percent: 100, color: "#d6cfc5" }];
  return `
    <section class="board">
      <h3>${escapeHtml(title)}</h3>
      <div class="board-wrap">
        <div class="donut" style="--donut:${buildConicGradient(segments)}">
          <div class="donut-center">
            <span>${escapeHtml(centerLabel)}</span>
            <strong>${escapeHtml(formatUsdt(totalValue))}</strong>
          </div>
        </div>
        <div class="legend">
          ${segments
            .map(
              (item) => `
                <div class="legend-row">
                  <span class="legend-dot" style="background:${item.color}"></span>
                  <div class="legend-name">${escapeHtml(item.label)}</div>
                  <div class="legend-meta">
                    <strong>${escapeHtml(`${formatPercent(item.percent / 100)}`)}</strong>
                    <span>${escapeHtml(formatUsdtValue(item.value))}</span>
                  </div>
                </div>
              `,
            )
            .join("")}
        </div>
      </div>
    </section>
  `;
}

function buildPreviewChartItems(rows, mode) {
  const total = (rows || []).reduce((sum, row) => sum + toFiniteNumber(mode === "asset" ? row.estimatedUsdt : row.totalUsdt), 0);
  const normalized = (rows || [])
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

  return normalized;
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

function previewColorForSymbol(symbol) {
  const palette = {
    BTC: "#f7931a",
    ETH: "#627eea",
    BNB: "#f3ba2f",
  };
  return palette[symbol] || "#0c7c74";
}

const PREVIEW_CHART_COLORS = ["#177f79", "#d17907", "#b95f0d", "#2e63e8", "#0f99bd", "#c41a4b"];


module.exports = {
  syncSnapshotToNotion,
};
