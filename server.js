const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const { collectBinanceSnapshot } = require("./lib/binance");
const { collectBitgetSnapshot } = require("./lib/bitget");
const { collectOkxSnapshot } = require("./lib/okx");
const { collectWalletSnapshot } = require("./lib/onchain");
const { collectZerionDefiSnapshot } = require("./lib/zerion");
const { collectVenusSnapshot } = require("./lib/venus");
const { collectMorphoSnapshot } = require("./lib/morpho");
const { collectWlfiUnlockSnapshot } = require("./lib/wlfi");
const { syncSnapshotToNotion } = require("./lib/notion");
const { writeSnapshotToObsidian } = require("./lib/obsidian");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const execFileAsync = promisify(execFile);
const NOTION_SUMMARY_DATABASE_ID = process.env.NOTION_SUMMARY_DATABASE_ID || "";
const NOTION_ACCOUNT_DATABASE_ID = process.env.NOTION_ACCOUNT_DATABASE_ID || "";
const NOTION_ASSET_DATABASE_ID = process.env.NOTION_ASSET_DATABASE_ID || "";
const STABLECOIN_PRICES = {
  USDT: 1,
  USDC: 1,
  BUSD: 1,
  FDUSD: 1,
  USDP: 1,
  TUSD: 1,
  USDS: 1,
  USDG: 1,
  DAI: 1,
  PYUSD: 1,
  USDE: 1,
  USD1: 1,
  RLUSD: 1,
  GHO: 1,
  FRAX: 1,
  FRXUSD: 1,
  LUSD: 1,
  CRVUSD: 1,
  USD0: 1,
  USDT0: 1,
  SUSDS: 1,
};
const ASSET_PRICE_ALIASES = {
  BTCB: "BTC",
  WBTC: "BTC",
  WETH: "ETH",
  WBNB: "BNB",
  WBETH: "ETH",
};
const EXCHANGE_SCOPE_DEFAULTS = {
  binance:
    "spot,funding,simple_earn_flexible,simple_earn_locked,cross_margin,isolated_margin,um_futures,cm_futures,subaccount_spot,subaccount_margin,subaccount_um_futures,subaccount_cm_futures",
  bitget: "spot,futures,cross_margin,savings_flexible,savings_fixed,overview",
  okx: "trading,funding,savings,overview",
};
let tickerCache = {
  updatedAt: 0,
  prices: {
    binance: new Map(),
    okx: new Map(),
    bitget: new Map(),
  },
};
let fxCache = {
  updatedAt: 0,
  rates: {
    usdCny: 7.2,
    asOf: null,
    source: "fallback",
  },
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (req.method === "GET" && url.pathname === "/api/health") {
        return sendJson(res, 200, { ok: true, now: new Date().toISOString() });
      }

      if (req.method === "GET" && url.pathname === "/api/binance/ping") {
        return sendJson(res, 200, await pingBinance());
      }

      if (req.method === "GET" && url.pathname === "/api/fx") {
        return sendJson(res, 200, await getFxRates());
      }

      if (req.method === "POST" && url.pathname === "/api/binance/snapshot") {
        const body = await readJsonBody(req);
        const config = body && body.config ? body.config : {};
        const payload = await collectPortfolioPayload(config);

        return sendJson(res, 200, {
          ...payload,
        });
      }

      if (req.method === "POST" && url.pathname === "/api/notion/sync") {
        const body = await readJsonBody(req);
        const config = body && body.config ? body.config : {};
        const snapshotPayload = body && body.payload ? body.payload : null;
        const notionMeta = config.meta || {};
        const payload = snapshotPayload || (await collectPortfolioPayload(config));
        const notionResult = await syncSnapshotToNotion(payload, {
          token: notionMeta.notionToken || process.env.NOTION_TOKEN,
          summaryDatabaseId: notionMeta.notionSummaryDatabaseId || NOTION_SUMMARY_DATABASE_ID,
          accountDatabaseId: notionMeta.notionAccountDatabaseId || NOTION_ACCOUNT_DATABASE_ID,
          assetDatabaseId: notionMeta.notionAssetDatabaseId || NOTION_ASSET_DATABASE_ID,
          summaryTemplateId: notionMeta.notionSummaryTemplateId,
          referenceCost: config.validation?.referenceCost,
          targetProfit: config.validation?.targetProfit,
          usdCny: payload.dashboard?.rawSummary?.usdCny,
        });

        return sendJson(res, 200, {
          ...payload,
          notion: notionResult,
        });
      }

      if (req.method === "POST" && url.pathname === "/api/obsidian/sync") {
        const body = await readJsonBody(req);
        const config = body && body.config ? body.config : {};
        const snapshotPayload = body && body.payload ? body.payload : null;
        const obsidianMeta = config.meta || {};
        const payload = snapshotPayload || (await collectPortfolioPayload(config));
        const obsidianResult = await writeSnapshotToObsidian(payload, {
          vaultPath: obsidianMeta.obsidianVaultPath,
          rootDir: obsidianMeta.obsidianRootDir,
          referenceCost: config.validation?.referenceCost,
          targetProfit: config.validation?.targetProfit,
          usdCny: payload.dashboard?.rawSummary?.usdCny,
        });

        return sendJson(res, 200, {
          ...payload,
          obsidian: obsidianResult,
        });
      }

      return serveStatic(url.pathname, res);
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Unexpected server error" });
    }
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

async function serveStatic(pathname, res) {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(ROOT, normalizedPath);

  if (!filePath.startsWith(ROOT)) {
    sendPlain(res, 403, "Forbidden");
    return;
  }

  try {
    const contents = await fs.readFile(filePath);
    const extension = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[extension] || "application/octet-stream" });
    res.end(contents);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendPlain(res, 404, "Not Found");
      return;
    }

    throw error;
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendPlain(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

async function pingBinance() {
  const targets = [
    "https://api.binance.com/api/v3/time",
    "https://fapi.binance.com/fapi/v1/time",
    "https://dapi.binance.com/dapi/v1/time",
  ];

  const results = [];

  for (const target of targets) {
    try {
      const response = await fetch(target);
      const text = await response.text();
      results.push({
        url: target,
        ok: response.ok,
        status: response.status,
        bodyPreview: text.slice(0, 120),
      });
    } catch (error) {
      results.push({
        url: target,
        ok: false,
        error: error.message,
        cause: error.cause && error.cause.code ? error.cause.code : null,
      });
    }
  }

  return {
    ok: results.every((item) => item.ok),
    checkedAt: new Date().toISOString(),
    results,
  };
}

async function collectPortfolioPayload(config) {
  const providers = {
    alchemyApiKey: String(config.meta?.alchemyApiKey || "").trim(),
    zerionApiKey: String(config.meta?.zerionApiKey || "").trim(),
  };
  const accounts = Array.isArray(config.cexAccounts) ? config.cexAccounts.map(normalizeExchangeAccount) : [];
  const wallets = Array.isArray(config.wallets) ? config.wallets.map((wallet) => normalizeWallet(wallet, providers)) : [];
  const defiPositions = Array.isArray(config.defiPositions)
    ? config.defiPositions.map((position) => normalizeDefiPosition(position, providers))
    : [];
  const autoDefiPositions = buildAutoDefiPositions(wallets, providers);
  const sources = [
    ...accounts.map((account) => ({ kind: "cex", source: account })),
    ...wallets.map((wallet) => ({ kind: "wallet", source: wallet })),
    ...autoDefiPositions.map((position) => ({ kind: "defi", source: position })),
    ...defiPositions.map((position) => ({ kind: "defi", source: position })),
  ];

  if (sources.length === 0) {
    throw new Error("没有找到可用的交易所账户或链上钱包配置。");
  }

  const settled = await Promise.all(
    sources.map(async (entry) => {
      try {
        const snapshot =
          entry.kind === "wallet"
            ? await collectWalletSnapshot(entry.source)
            : entry.kind === "defi"
              ? await collectDefiSnapshot(entry.source)
              : await collectExchangeSnapshot(entry.source);
        const shouldSkip =
          entry.kind === "defi" &&
          entry.source.autoDetected &&
          Array.isArray(snapshot.holdings) &&
          snapshot.holdings.length === 0 &&
          Array.isArray(snapshot.errors) &&
          snapshot.errors.length === 0;
        return { ok: true, skipped: shouldSkip, snapshot, source: entry.source, kind: entry.kind };
      } catch (error) {
        return { ok: false, error, source: entry.source, kind: entry.kind };
      }
    }),
  );

  const snapshots = settled.filter((item) => item.ok && !item.skipped).map((item) => item.snapshot);
  const errors = settled
    .filter((item) => !item.ok)
    .map((item) => ({
      accountLabel:
        item.source.label || item.source.protocol || (item.kind === "wallet" ? "Wallet" : "Exchange Account"),
      message: item.error.message,
      kind: item.kind,
      severity: classifyErrorSeverity(item),
      sourceType: classifyErrorSourceType(item),
    }));
  const errorSummary = summarizeErrors(errors);

  const collectedAt = new Date().toISOString();
  const [prices, fxRates] = await Promise.all([getUsdtPrices(), getFxRates()]);
  const dashboard = buildDashboard(snapshots, prices, fxRates, config.validation || {});

  return {
    ok: errorSummary.core.count === 0,
    collectedAt,
    snapshots,
    dashboard,
    fxRates,
    errors,
    errorSummary,
  };
}

async function collectExchangeSnapshot(account) {
  const exchange = String(account.exchange || "").toLowerCase();

  if (exchange === "binance") return collectBinanceSnapshot(account);
  if (exchange === "bitget") return collectBitgetSnapshot(account);
  if (exchange === "okx") return collectOkxSnapshot(account);

  throw new Error(`暂不支持的交易所: ${exchange || "unknown"}`);
}

async function collectDefiSnapshot(position) {
  if (position.resolver === "zerion") {
    return collectZerionDefiSnapshot(position, position.providers.zerionApiKey);
  }
  if (position.resolver === "venus") {
    return collectVenusSnapshot(position);
  }
  if (position.resolver === "morpho") {
    return collectMorphoSnapshot(position);
  }
  if (position.resolver === "wlfi_unlock") {
    return collectWlfiUnlockSnapshot(position);
  }

  throw new Error(`暂不支持的 DeFi 查询方案: ${position.resolver}`);
}

function normalizeExchangeAccount(account) {
  const exchange = String(account.exchange || "").toLowerCase();
  const scope = String(account.accountScope || "");
  const normalized = {
    ...account,
    exchange,
  };

  if (!scope || hasMismatchedScope(exchange, scope)) {
    normalized.accountScope = EXCHANGE_SCOPE_DEFAULTS[exchange] || scope;
  }

  if (exchange === "binance") {
    normalized.passphrase = "";
  }

  if (!normalized.environment) {
    normalized.environment = "production";
  }

  return normalized;
}

function normalizeWallet(wallet, providers) {
  return {
    label: wallet.label || "",
    chain: inferWalletChain(wallet),
    address: String(wallet.address || "").trim(),
    assetScope: "auto",
    rpcUrl: String(wallet.rpcUrl || "").trim(),
    tokenContracts: String(wallet.tokenContracts || "").trim(),
    tags: wallet.tags || "",
    notes: wallet.notes || "",
    providers,
  };
}

function inferWalletChain(wallet) {
  const explicit = String(wallet.chain || "").trim().toLowerCase();
  if (["bitcoin", "solana", "tron"].includes(explicit)) return explicit;
  return "all_evm";
}

function normalizeDefiPosition(position, providers) {
  return {
    protocol: String(position.protocol || "").trim(),
    chain: String(position.chain || "").trim(),
    rpcUrl: String(position.rpcUrl || "").trim(),
    address: String(position.address || "").trim(),
    positionType: String(position.positionType || "").trim(),
    resolver: String(position.resolver || "zerion").trim().toLowerCase(),
    assets: String(position.assets || "").trim(),
    notes: String(position.notes || "").trim(),
    providers,
  };
}

function buildAutoDefiPositions(wallets, providers) {
  const dedupe = new Set();
  const positions = [];

  for (const wallet of wallets) {
    const address = String(wallet.address || "").toLowerCase();
    if (!address) continue;

    const venusKey = `venus:bsc:${address}`;
    if (!dedupe.has(venusKey)) {
      dedupe.add(venusKey);
      positions.push({
        protocol: "Venus",
        chain: "bsc",
        rpcUrl: "",
        address: wallet.address,
        positionType: "lending",
        resolver: "venus",
        assets: "",
        notes: "auto-detected",
        providers,
        autoDetected: true,
        ownerAccountLabel: wallet.label || wallet.address,
        ownerExchange: "wallet",
      });
    }

    if (providers.zerionApiKey) {
      for (const chain of ["ethereum", "arbitrum", "base", "optimism", "polygon", "bsc"]) {
        const key = `zerion:${chain}:${address}`;
        if (dedupe.has(key)) continue;
        dedupe.add(key);
        positions.push({
          protocol: "Auto DeFi",
          chain,
          rpcUrl: "",
          address: wallet.address,
          positionType: "portfolio",
          resolver: "zerion",
          assets: "",
          notes: "auto-detected",
          providers,
          autoDetected: true,
          ownerAccountLabel: wallet.label || wallet.address,
          ownerExchange: "wallet",
        });
      }
    }

    const wlfiKey = `wlfi_unlock:${address}`;
    if (!dedupe.has(wlfiKey)) {
      dedupe.add(wlfiKey);
      positions.push({
        protocol: "WLFI Unlock",
        chain: "ethereum",
        rpcUrl: "",
        address: wallet.address,
        positionType: "locked_token",
        resolver: "wlfi_unlock",
        assets: "WLFI",
        notes: "auto-detected",
        providers,
        autoDetected: true,
        ownerAccountLabel: wallet.label || wallet.address,
        ownerExchange: "wallet",
      });
    }

    const morphoKey = `morpho:worldchain:${address}`;
    if (!dedupe.has(morphoKey)) {
      dedupe.add(morphoKey);
      positions.push({
        protocol: "Morpho",
        chain: "worldchain",
        rpcUrl: "",
        address: wallet.address,
        positionType: "vault",
        resolver: "morpho",
        assets: "",
        notes: "auto-detected",
        providers,
        autoDetected: true,
        ownerAccountLabel: wallet.label || wallet.address,
        ownerExchange: "wallet",
      });
    }
  }

  return positions;
}

function hasMismatchedScope(exchange, scope) {
  if (!scope) return true;
  if (exchange === "bitget" || exchange === "okx") {
    return scope.includes("simple_earn") || scope.includes("subaccount_") || scope.includes("cross_margin");
  }
  if (exchange === "binance") {
    return scope.includes("trading") || scope.includes("overview");
  }
  return false;
}

async function getUsdtPrices() {
  if (
    Date.now() - tickerCache.updatedAt < 30000 &&
    Object.values(tickerCache.prices).some((book) => book.size > 0)
  ) {
    return tickerCache.prices;
  }

  const [binanceResult, okxResult, bitgetResult] = await Promise.allSettled([
    getBinanceUsdtPrices(),
    getOkxUsdtPrices(),
    getBitgetUsdtPrices(),
  ]);
  const prices = {
    binance: binanceResult.status === "fulfilled" ? binanceResult.value : new Map(),
    okx: okxResult.status === "fulfilled" ? okxResult.value : new Map(),
    bitget: bitgetResult.status === "fulfilled" ? bitgetResult.value : new Map(),
  };

  tickerCache = {
    updatedAt: Date.now(),
    prices,
  };

  return prices;
}

async function getBinanceUsdtPrices() {
  const payload = await fetchPublicJson("https://api.binance.com/api/v3/ticker/price");
  const prices = new Map();

  for (const item of payload || []) {
    if (!item.symbol || !item.price) continue;
    prices.set(String(item.symbol).toUpperCase(), Number(item.price));
  }

  return prices;
}

async function getOkxUsdtPrices() {
  const payload = await fetchPublicJson("https://www.okx.com/api/v5/market/tickers?instType=SPOT");
  const prices = new Map();
  const rows = payload && Array.isArray(payload.data) ? payload.data : [];

  for (const item of rows) {
    if (!item.instId || !item.last) continue;
    prices.set(String(item.instId).toUpperCase(), Number(item.last));
  }

  return prices;
}

async function getBitgetUsdtPrices() {
  const payload = await fetchPublicJson("https://api.bitget.com/api/v2/spot/market/tickers");
  const prices = new Map();
  const rows = payload && Array.isArray(payload.data) ? payload.data : [];

  for (const item of rows) {
    if (!item.symbol || !item.lastPr) continue;
    prices.set(String(item.symbol).toUpperCase(), Number(item.lastPr));
  }

  return prices;
}

async function fetchPublicJson(url) {
  const { stdout } = await execFileAsync("curl", ["-sS", "--max-time", "20", url], {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout ? JSON.parse(stdout) : null;
}

async function fetchPublicText(url) {
  const { stdout } = await execFileAsync("curl", ["-sS", "--max-time", "20", url], {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout || "";
}

async function getFxRates() {
  const now = Date.now();
  if (now - fxCache.updatedAt < 6 * 60 * 60 * 1000 && fxCache.rates?.usdCny) {
    return fxCache.rates;
  }

  try {
    const xml = await fetchPublicText("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml");
    const usdRate = extractEcbRate(xml, "USD");
    const cnyRate = extractEcbRate(xml, "CNY");
    const asOf = extractEcbDate(xml);

    if (!usdRate || !cnyRate) {
      throw new Error("ECB 汇率数据不完整");
    }

    const rates = {
      usdCny: cnyRate / usdRate,
      asOf,
      source: "ecb",
    };

    fxCache = {
      updatedAt: now,
      rates,
    };

    return rates;
  } catch {
    return fxCache.rates;
  }
}

function extractEcbRate(xml, currency) {
  const match = String(xml || "").match(new RegExp(`currency=['"]${currency}['"]\\s+rate=['"]([0-9.]+)['"]`, "i"));
  return match ? Number(match[1]) : null;
}

function extractEcbDate(xml) {
  const match = String(xml || "").match(/time=['"]([0-9-]+)['"]/i);
  return match ? match[1] : null;
}

function buildDashboard(snapshots, prices, fxRates, validation) {
  const threshold = Number(validation.minBalanceThreshold || 0);
  const ignoredTokens = parseCsvSet(validation.ignoredTokens);
  const focusAssets = parseCsvSet(validation.focusAssets);
  const stablecoinSymbols = parseCsvSet(validation.stablecoinSymbols);
  const stablecoinSet = stablecoinSymbols.size ? stablecoinSymbols : new Set(Object.keys(STABLECOIN_PRICES));
  const totals = [];
  const assets = new Map();
  const accounts = new Map();
  let grandTotalUsdt = 0;
  for (const snapshot of snapshots) {
    let accountTotalUsdt = 0;
    const rows = [];
    const accountKey = `${snapshot.accountOwnerExchange || snapshot.exchange}:${snapshot.accountOwnerLabel || snapshot.accountLabel}`;
    const sourceLabel = snapshot.accountOwnerLabel || snapshot.accountLabel || translateExchange(snapshot.accountOwnerExchange || snapshot.exchange);

    for (const holding of snapshot.holdings) {
      if (holding.nonAdditive) continue;
      const priceInfo = getAssetPriceInfo(holding.asset, prices);
      const amount = Number(holding.amount);
      const estimatedUsdt = priceInfo.price !== null && Number.isFinite(amount) ? amount * priceInfo.price : null;

      const translatedAccountType = translateAccountType(holding.accountType);
      const translatedScope = translateScope(holding.scope);
      rows.push({
        asset: holding.asset,
        scope: holding.scope,
        scopeLabel: translatedScope,
        accountType: holding.accountType,
        accountTypeLabel: translatedAccountType,
        amount: holding.amount,
        estimatedUsdt,
        priceSource: priceInfo.source,
      });

      if (estimatedUsdt !== null) {
        accountTotalUsdt += estimatedUsdt;
      }
    }

    const existingAccount = accounts.get(accountKey) || {
      accountLabel: snapshot.accountOwnerLabel || snapshot.accountLabel,
      exchange: snapshot.accountOwnerExchange || snapshot.exchange,
      exchangeLabel: translateExchange(snapshot.accountOwnerExchange || snapshot.exchange),
      totalUsdt: 0,
      nonZeroAssets: 0,
      scopesSucceeded: [],
      scopesFailed: [],
      rows: [],
    };

    existingAccount.totalUsdt += accountTotalUsdt;
    existingAccount.nonZeroAssets += snapshot.summary.nonZeroAssets;
    existingAccount.scopesSucceeded = [...new Set([...existingAccount.scopesSucceeded, ...(snapshot.scopesSucceeded || [])])];
    existingAccount.scopesFailed = [...new Set([...existingAccount.scopesFailed, ...(snapshot.scopesFailed || [])])];
    existingAccount.rows.push(...rows);

    accounts.set(accountKey, existingAccount);

    grandTotalUsdt += accountTotalUsdt;

    for (const item of snapshot.consolidatedBalances) {
      const priceInfo = getAssetPriceInfo(item.asset, prices);
      const totalAmount = Number(item.totalAmount);
      const estimatedUsdt = priceInfo.price !== null && Number.isFinite(totalAmount) ? totalAmount * priceInfo.price : null;
      const existingAsset = assets.get(item.asset);

      if (!existingAsset) {
        assets.set(item.asset, {
          asset: item.asset,
          totalAmount: totalAmount,
          estimatedUsdt,
          price: priceInfo.price,
          priceSource: priceInfo.source,
          scopes: Array.isArray(item.scopes) ? [...item.scopes] : [],
          sourceLabels: [sourceLabel],
        });
        continue;
      }

      existingAsset.totalAmount += totalAmount;
      existingAsset.estimatedUsdt =
        existingAsset.estimatedUsdt !== null && estimatedUsdt !== null
          ? existingAsset.estimatedUsdt + estimatedUsdt
          : existingAsset.estimatedUsdt ?? estimatedUsdt;
      existingAsset.scopes = [...new Set([...(existingAsset.scopes || []), ...((Array.isArray(item.scopes) && item.scopes) || [])])];
      existingAsset.sourceLabels = [...new Set([...(existingAsset.sourceLabels || []), sourceLabel])];
      if (existingAsset.priceSource === "missing" && priceInfo.source !== "missing") {
        existingAsset.price = priceInfo.price;
        existingAsset.priceSource = priceInfo.source;
      }
    }
  }

  const assetRows = [...assets.values()]
    .map((item) => ({
      ...item,
      totalAmount: String(item.totalAmount),
      sourceLabels: Array.isArray(item.sourceLabels) ? item.sourceLabels : [],
    }))
    .filter((item) => shouldKeepAssetRow(item, threshold, ignoredTokens, focusAssets))
    .sort((left, right) => {
    const leftValue = left.estimatedUsdt ?? -1;
    const rightValue = right.estimatedUsdt ?? -1;
    return rightValue - leftValue;
  });

  const stablecoinRows = assetRows.filter((item) => isStablecoinAsset(item.asset, stablecoinSet) && item.estimatedUsdt !== null);
  const stablecoinUsdt = stablecoinRows.reduce((sum, item) => sum + Number(item.estimatedUsdt || 0), 0);
  const nonStablecoinUsdt = Math.max(0, grandTotalUsdt - stablecoinUsdt);
  const nonStablecoinRatio = grandTotalUsdt > 0 ? nonStablecoinUsdt / grandTotalUsdt : 0;
  const stablecoinAssets = stablecoinRows.map((item) => item.asset);

  const accountRows = [...accounts.values()].sort((left, right) => right.totalUsdt - left.totalUsdt);
  for (const account of accountRows) {
    account.rows = account.rows
      .filter((item) => shouldKeepAssetRow(item, threshold, ignoredTokens, focusAssets))
      .filter((item) => item.estimatedUsdt !== null)
      .sort((left, right) => {
        const leftValue = left.estimatedUsdt ?? -1;
        const rightValue = right.estimatedUsdt ?? -1;
        return rightValue - leftValue;
      })
      .slice(0, 10);
  }

  totals.push({
    label: "总资产估值",
    value: formatUsdt(grandTotalUsdt),
    secondaryValue: formatCny(grandTotalUsdt * Number(fxRates?.usdCny || 0)),
    marketPrices: buildReferencePrices(prices),
    exposure: {
      stablecoinUsdt: formatUsdt(stablecoinUsdt),
      nonStablecoinUsdt: formatUsdt(nonStablecoinUsdt),
      nonStablecoinRatio: formatPercent(nonStablecoinRatio),
      stablecoinAssets,
    },
    helper: fxRates?.asOf ? `汇率来源 ECB · ${fxRates.asOf}` : "汇率来源 ECB",
  });

  return {
    totals,
    assetRows,
    accountRows,
    rawSummary: {
      grandTotalUsdt,
      grandTotalCny: grandTotalUsdt * Number(fxRates?.usdCny || 0),
      usdCny: Number(fxRates?.usdCny || 0),
      stablecoinUsdt,
      nonStablecoinUsdt,
      nonStablecoinRatio,
      stablecoinAssets,
      assetCount: assetRows.length,
      accountCount: accountRows.length,
    },
  };
}

function classifyErrorSeverity(item) {
  if (item.kind === "cex" || item.kind === "wallet") {
    return "core";
  }

  if (item.kind === "defi") {
    if (item.source?.autoDetected) {
      return "supplemental";
    }

    return "core";
  }

  return "supplemental";
}

function classifyErrorSourceType(item) {
  if (item.kind === "cex") return "cex";
  if (item.kind === "wallet") return "wallet";
  if (item.kind === "defi") {
    return item.source?.autoDetected ? "auto_defi" : "manual_defi";
  }
  return "unknown";
}

function summarizeErrors(errors) {
  const grouped = {
    core: {
      count: 0,
      items: [],
    },
    supplemental: {
      count: 0,
      items: [],
    },
  };

  for (const error of errors || []) {
    const bucket = error.severity === "core" ? grouped.core : grouped.supplemental;
    bucket.count += 1;
    bucket.items.push(error);
  }

  return grouped;
}

function isStablecoinAsset(asset, stablecoinSet = new Set(Object.keys(STABLECOIN_PRICES))) {
  return stablecoinSet.has(String(asset || "").toUpperCase());
}

function getAssetPriceInfo(asset, prices) {
  const normalizedAsset = ASSET_PRICE_ALIASES[asset] || asset;

  if (asset in STABLECOIN_PRICES) {
    return { price: STABLECOIN_PRICES[asset], source: "stablecoin" };
  }

  const candidates = [
    { price: prices.binance.get(`${normalizedAsset}USDT`), source: normalizedAsset === asset ? "binance_spot" : "alias_binance_spot" },
    { price: prices.okx.get(`${normalizedAsset}-USDT`), source: normalizedAsset === asset ? "okx_spot" : "alias_okx_spot" },
    { price: prices.bitget.get(`${normalizedAsset}USDT`), source: normalizedAsset === asset ? "bitget_spot" : "alias_bitget_spot" },
    { price: prices.binance.get(`${normalizedAsset}USDC`), source: normalizedAsset === asset ? "binance_spot_usdc" : "alias_binance_spot_usdc" },
    { price: prices.okx.get(`${normalizedAsset}-USDC`), source: normalizedAsset === asset ? "okx_spot_usdc" : "alias_okx_spot_usdc" },
    { price: prices.bitget.get(`${normalizedAsset}USDC`), source: normalizedAsset === asset ? "bitget_spot_usdc" : "alias_bitget_spot_usdc" },
    { price: prices.okx.get(`${normalizedAsset}-USD`), source: normalizedAsset === asset ? "okx_spot_usd" : "alias_okx_spot_usd" },
  ];

  for (const candidate of candidates) {
    if (typeof candidate.price === "number" && Number.isFinite(candidate.price)) {
      return candidate;
    }
  }

  return { price: null, source: "missing" };
}

function buildReferencePrices(prices) {
  return ["BTC", "ETH", "BNB"]
    .map((asset) => {
      const priceInfo = getAssetPriceInfo(asset, prices);
      if (!Number.isFinite(priceInfo.price)) return null;
      return {
        asset,
        value: formatPriceQuote(priceInfo.price),
      };
    })
    .filter(Boolean);
}

function shouldKeepAssetRow(item, threshold, ignoredTokens, focusAssets) {
  const asset = String(item.asset || "").toUpperCase();
  if (ignoredTokens.has(asset)) return false;
  if (focusAssets.has(asset)) return true;
  if (!Number.isFinite(threshold) || threshold <= 0) return true;
  if (item.estimatedUsdt !== null && item.estimatedUsdt !== undefined) {
    return item.estimatedUsdt >= threshold;
  }
  const rawAmount = Number(item.totalAmount ?? item.amount ?? 0);
  return Number.isFinite(rawAmount) && rawAmount >= threshold;
}

function parseCsvSet(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean),
  );
}

function translateExchange(exchange) {
  const map = {
    binance: "币安",
    bitget: "Bitget",
    okx: "OKX",
    wallet: "链上钱包",
    defi: "DeFi 仓位",
  };
  return map[String(exchange || "").toLowerCase()] || String(exchange || "未知交易所");
}

function translateScope(scope) {
  const map = {
    spot: "现货账户",
    funding: "资金账户",
    simple_earn_flexible: "活期理财",
    simple_earn_locked: "定期理财",
    cross_margin: "全仓杠杆",
    isolated_margin: "逐仓杠杆",
    um_futures: "U 本位合约",
    cm_futures: "币本位合约",
    subaccount_spot: "子账户现货",
    subaccount_margin: "子账户杠杆",
    subaccount_um_futures: "子账户 U 本位合约",
    subaccount_cm_futures: "子账户币本位合约",
    futures: "合约账户",
    overview: "账户总览",
    trading: "交易账户",
    savings: "余币宝/理财",
    savings_flexible: "活期理财",
    savings_fixed: "定期理财",
    native: "原生资产",
    erc20: "ERC20 代币",
    defi: "DeFi 仓位",
    wlfi_unlock: "WLFI 解锁",
  };
  return map[scope] || scope;
}

function translateAccountType(accountType) {
  const map = {
    spot: "现货账户",
    funding: "资金账户",
    simple_earn_flexible: "活期理财",
    simple_earn_locked: "定期理财",
    cross_margin: "全仓杠杆",
    isolated_margin: "逐仓杠杆",
    um_futures: "U 本位合约",
    cm_futures: "币本位合约",
    subaccount_spot: "子账户现货",
    subaccount_margin: "子账户杠杆",
    subaccount_um_futures: "子账户 U 本位合约",
    subaccount_cm_futures: "子账户币本位合约",
    futures: "合约账户",
    trading: "交易账户",
    savings: "余币宝/理财",
    savings_flexible: "活期理财",
    savings_fixed: "定期理财",
    ethereum_native: "Ethereum 原生资产",
    arbitrum_native: "Arbitrum 原生资产",
    base_native: "Base 原生资产",
    optimism_native: "Optimism 原生资产",
    bsc_native: "BSC 原生资产",
    polygon_native: "Polygon 原生资产",
    xlayer_native: "X Layer 原生资产",
    worldchain_native: "World Chain 原生资产",
    ethereum_erc20: "Ethereum ERC20",
    arbitrum_erc20: "Arbitrum ERC20",
    base_erc20: "Base ERC20",
    optimism_erc20: "Optimism ERC20",
    bsc_erc20: "BSC ERC20",
    polygon_erc20: "Polygon ERC20",
    xlayer_erc20: "X Layer ERC20",
    worldchain_erc20: "World Chain ERC20",
    earn_account: "理财账户补充",
    defi_position: "DeFi 协议仓位",
    venus_supply: "Venus 存款仓位",
    venus_borrow: "Venus 借款仓位",
    venus_reward: "Venus 奖励仓位",
    morpho_supply: "Morpho 存款仓位",
    morpho_borrow: "Morpho 借款仓位",
    morpho_collateral: "Morpho 抵押仓位",
    morpho_vault: "Morpho 金库仓位",
    wlfi_locked: "WLFI 锁仓余额",
    overview_spot: "总览-现货",
    overview_futures: "总览-合约",
    overview_earn: "总览-理财",
    overview_trading: "总览-交易",
    overview_funding: "总览-资金",
    overview_classic: "总览-经典账户",
  };
  return map[accountType] || accountType;
}

function formatUsdt(value) {
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    minimumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value || 0);
  return `${formatted} USDT`;
}

function formatPriceQuote(value) {
  const numeric = Number(value || 0);
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: numeric >= 1000 ? 0 : 2,
    minimumFractionDigits: numeric >= 1000 ? 0 : 2,
  }).format(numeric);
  return `${formatted} USDT`;
}

function formatCny(value) {
  const formatted = new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    minimumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value || 0);
  return `≈ ${formatted} RMB`;
}

function formatPercent(value) {
  return new Intl.NumberFormat("zh-CN", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

module.exports = {
  createServer,
  collectPortfolioPayload,
  getFxRates,
};
