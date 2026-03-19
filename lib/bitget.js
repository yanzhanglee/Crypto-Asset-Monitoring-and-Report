const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const BITGET_BASE_URL = "https://api.bitget.com";
const DEFAULT_SCOPES = ["spot", "futures", "cross_margin", "savings_flexible", "savings_fixed", "overview"];

async function collectBitgetSnapshot(account) {
  const apiKey = String(account.apiKey || "").trim();
  const apiSecret = String(account.apiSecret || "").trim();
  const passphrase = String(account.passphrase || "").trim();

  if (!apiKey || !apiSecret || !passphrase) {
    throw new Error("Bitget API Key / Secret / Passphrase 不能为空。");
  }

  const scopes = parseScopes(account.accountScope);
  const results = [];
  const errors = [];

  const tasks = {
    spot: () => fetchSpotBalances({ apiKey, apiSecret, passphrase }),
    funding: () => fetchFundingBalances({ apiKey, apiSecret, passphrase }),
    futures: () => fetchFuturesBalances({ apiKey, apiSecret, passphrase }),
    cross_margin: () => fetchCrossMarginBalances({ apiKey, apiSecret, passphrase }),
    savings_flexible: () => fetchSavingsBalances({ apiKey, apiSecret, passphrase, periodType: "flexible" }),
    savings_fixed: () => fetchSavingsBalances({ apiKey, apiSecret, passphrase, periodType: "fixed" }),
    overview: () => fetchOverviewBalances({ apiKey, apiSecret, passphrase }),
  };

  for (const scope of scopes) {
    const task = tasks[scope];
    if (!task) {
      errors.push({ scope, message: `不支持的 scope: ${scope}` });
      continue;
    }

    try {
      results.push(await task());
    } catch (error) {
      errors.push({
        scope,
        message: error.message,
        code: error.code || null,
        status: error.status || null,
      });
    }
  }

  const holdings = results.flatMap((item) => item.holdings);
  const consolidatedBalances = consolidateHoldings(holdings);

  return {
    exchange: "bitget",
    accountLabel: account.label || "Bitget Account",
    collectedAt: new Date().toISOString(),
    scopesRequested: scopes,
    scopesSucceeded: results.map((item) => item.scope),
    scopesFailed: errors.map((item) => item.scope),
    holdings,
    consolidatedBalances,
    summary: {
      totalHoldingRows: holdings.length,
      nonZeroAssets: consolidatedBalances.length,
      scopeAssetCounts: Object.fromEntries(results.map((item) => [item.scope, item.holdings.length])),
    },
    errors,
  };
}

function parseScopes(accountScope) {
  const scopes = String(accountScope || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return scopes.length > 0 ? scopes : [...DEFAULT_SCOPES];
}

async function fetchSpotBalances(credentials) {
  const payload = await bitgetRequest({
    ...credentials,
    path: "/api/v2/spot/account/assets",
    query: { assetType: "all" },
  });

  const holdings = (payload.data || [])
    .map((item) => ({
      asset: String(item.coin || "").toUpperCase(),
      amount: sumDecimalStrings([item.available, item.frozen, item.locked]),
      scope: "spot",
      accountType: "spot",
      breakdown: {
        available: normalizeDecimalString(item.available),
        frozen: normalizeDecimalString(item.frozen),
        locked: normalizeDecimalString(item.locked),
      },
    }))
    .filter((item) => item.asset && !isZeroDecimal(item.amount));

  return { scope: "spot", holdings };
}

async function fetchFundingBalances(credentials) {
  const payload = await bitgetRequest({
    ...credentials,
    path: "/api/v3/account/funding-assets",
  });

  const holdings = (payload.data || [])
    .map((item) => ({
      asset: String(item.coin || "").toUpperCase(),
      amount: normalizeDecimalString(item.balance),
      scope: "funding",
      accountType: "funding",
      breakdown: {
        available: normalizeDecimalString(item.available),
        frozen: normalizeDecimalString(item.frozen),
        balance: normalizeDecimalString(item.balance),
      },
    }))
    .filter((item) => item.asset && !isZeroDecimal(item.amount));

  return { scope: "funding", holdings };
}

async function fetchFuturesBalances(credentials) {
  const productTypes = ["USDT-FUTURES", "COIN-FUTURES", "USDC-FUTURES"];
  const holdings = [];

  for (const productType of productTypes) {
    try {
      const payload = await bitgetRequest({
        ...credentials,
        path: "/api/v2/mix/account/accounts",
        query: { productType },
      });

      for (const item of payload.data || []) {
        const asset = String(item.marginCoin || "").toUpperCase();
        const amount = normalizeDecimalString(item.accountEquity || item.usdtEquity || item.available || "0");
        if (!asset || isZeroDecimal(amount)) continue;

        holdings.push({
          asset,
          amount,
          scope: "futures",
          accountType: "futures",
          breakdown: {
            productType,
            available: normalizeDecimalString(item.available),
            locked: normalizeDecimalString(item.locked),
            unrealizedPL: normalizeDecimalString(item.unrealizedPL),
            accountEquity: normalizeDecimalString(item.accountEquity),
          },
        });
      }
    } catch (error) {
      if (!String(error.message).includes("404")) {
        throw error;
      }
    }
  }

  return { scope: "futures", holdings };
}

async function fetchOverviewBalances(credentials) {
  const payload = await bitgetRequest({
    ...credentials,
    path: "/api/v2/account/all-account-balance",
  });

  const holdings = (payload.data || [])
    .map((item) => ({
      asset: "USDT",
      amount: normalizeDecimalString(item.usdtBalance),
      scope: "overview",
      accountType: `overview_${String(item.accountType || "").toLowerCase()}`,
      nonAdditive: true,
      breakdown: {
        sourceAccountType: item.accountType,
        usdtBalance: normalizeDecimalString(item.usdtBalance),
      },
    }))
    .filter((item) => !isZeroDecimal(item.amount));

  return { scope: "overview", holdings };
}

async function fetchCrossMarginBalances(credentials) {
  const payload = await bitgetRequest({
    ...credentials,
    path: "/api/v2/margin/crossed/account/assets",
  });

  const holdings = (payload.data || [])
    .map((item) => ({
      asset: String(item.coin || "").toUpperCase(),
      amount: normalizeDecimalString(item.net || item.totalAmount),
      scope: "cross_margin",
      accountType: "cross_margin",
      breakdown: {
        totalAmount: normalizeDecimalString(item.totalAmount),
        available: normalizeDecimalString(item.available),
        frozen: normalizeDecimalString(item.frozen),
        borrow: normalizeDecimalString(item.borrow),
        interest: normalizeDecimalString(item.interest),
        net: normalizeDecimalString(item.net),
      },
    }))
    .filter((item) => item.asset && !isZeroDecimal(item.amount));

  return { scope: "cross_margin", holdings };
}

async function fetchSavingsBalances({ periodType, ...credentials }) {
  const payload = await bitgetRequest({
    ...credentials,
    path: "/api/v2/earn/savings/assets",
    query: {
      periodType,
      limit: 100,
    },
  });

  const rows = payload.data && Array.isArray(payload.data.resultList) ? payload.data.resultList : [];
  const holdings = rows
    .filter((item) => item.status === "in_holding")
    .map((item) => ({
      asset: String(item.productCoin || "").toUpperCase(),
      amount: normalizeDecimalString(item.holdAmount),
      scope: periodType === "flexible" ? "savings_flexible" : "savings_fixed",
      accountType: periodType === "flexible" ? "savings_flexible" : "savings_fixed",
      breakdown: {
        productId: item.productId || null,
        orderId: item.orderId || null,
        holdAmount: normalizeDecimalString(item.holdAmount),
        totalProfit: normalizeDecimalString(item.totalProfit),
        lastProfit: normalizeDecimalString(item.lastProfit),
      },
    }))
    .filter((item) => item.asset && !isZeroDecimal(item.amount));

  if (periodType === "flexible") {
    const earnAccountHoldings = await fetchEarnAccountBalances(credentials);
    return {
      scope: "savings_flexible",
      holdings: mergeEarnAccountHoldings(holdings, earnAccountHoldings),
    };
  }

  return {
    scope: periodType === "flexible" ? "savings_flexible" : "savings_fixed",
    holdings,
  };
}

async function fetchEarnAccountBalances(credentials) {
  const payload = await bitgetRequest({
    ...credentials,
    path: "/api/v2/earn/account/assets",
  });

  return (payload.data || [])
    .map((item) => ({
      asset: String(item.coin || "").toUpperCase(),
      amount: normalizeDecimalString(item.amount),
      scope: "savings_flexible",
      accountType: "earn_account",
      breakdown: {
        source: "earn_account_assets",
        aggregatedAmount: normalizeDecimalString(item.amount),
      },
    }))
    .filter((item) => item.asset && !isZeroDecimal(item.amount));
}

function mergeEarnAccountHoldings(detailHoldings, aggregateHoldings) {
  const detailedTotals = new Map();

  for (const holding of detailHoldings) {
    const current = detailedTotals.get(holding.asset) || "0";
    detailedTotals.set(holding.asset, addDecimalStrings(current, holding.amount));
  }

  const merged = [...detailHoldings];

  for (const aggregateHolding of aggregateHoldings) {
    const coveredAmount = detailedTotals.get(aggregateHolding.asset) || "0";
    const missingAmount = subtractDecimalStrings(aggregateHolding.amount, coveredAmount);
    if (compareDecimalStrings(missingAmount, "0") <= 0) continue;

    merged.push({
      ...aggregateHolding,
      amount: missingAmount,
      breakdown: {
        ...aggregateHolding.breakdown,
        detailedCoveredAmount: coveredAmount,
        missingSupplementAmount: missingAmount,
      },
    });
  }

  return merged;
}

async function bitgetRequest({ apiKey, apiSecret, passphrase, path, method = "GET", query = {}, body = "" }) {
  const timestamp = Date.now().toString();
  const queryString = buildQuery(query);
  const requestPath = queryString ? `${path}?${queryString}` : path;
  const payload = `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
  const sign = crypto.createHmac("sha256", apiSecret).update(payload).digest("base64");

  const response = await curlJsonRequest({
    url: `${BITGET_BASE_URL}${requestPath}`,
    method,
    headers: {
      "ACCESS-KEY": apiKey,
      "ACCESS-SIGN": sign,
      "ACCESS-TIMESTAMP": timestamp,
      "ACCESS-PASSPHRASE": passphrase,
      "Content-Type": "application/json",
      locale: "en-US",
    },
    body,
  });

  if (!response.ok || response.payload.code !== "00000") {
    const error = new Error(
      response.payload && response.payload.msg
        ? `Bitget API 错误(${response.status}${response.payload.code ? ` / ${response.payload.code}` : ""}): ${response.payload.msg}`
        : `Bitget API 请求失败，HTTP ${response.status}`,
    );
    error.status = response.status;
    error.code = response.payload && response.payload.code ? response.payload.code : null;
    throw error;
  }

  return response.payload;
}

async function curlJsonRequest({ url, method, headers, body }) {
  const args = ["-sS", "--max-time", "20", "-X", method];
  for (const [key, value] of Object.entries(headers || {})) {
    args.push("-H", `${key}: ${value}`);
  }
  if (body) {
    args.push("--data", body);
  }
  args.push("-w", "\n__CURL_STATUS__:%{http_code}", url);

  const { stdout, stderr } = await execFileAsync("curl", args, {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });

  const marker = "\n__CURL_STATUS__:";
  const index = stdout.lastIndexOf(marker);
  const rawBody = index >= 0 ? stdout.slice(0, index) : stdout;
  const status = Number(index >= 0 ? stdout.slice(index + marker.length).trim() : "0");
  let payload = rawBody;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {}

  return {
    ok: status >= 200 && status < 300,
    status,
    payload,
    stderr,
  };
}

function consolidateHoldings(holdings) {
  const map = new Map();

  for (const holding of holdings) {
    if (holding.nonAdditive) continue;
    const existing = map.get(holding.asset) || { asset: holding.asset, totalAmount: "0", scopes: [] };
    existing.totalAmount = addDecimalStrings(existing.totalAmount, holding.amount);
    existing.scopes.push({
      scope: holding.scope,
      amount: holding.amount,
      accountType: holding.accountType,
    });
    map.set(holding.asset, existing);
  }

  return [...map.values()].filter((item) => !isZeroDecimal(item.totalAmount));
}

function buildQuery(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function sumDecimalStrings(values) {
  return values.reduce((sum, value) => addDecimalStrings(sum, value), "0");
}

function addDecimalStrings(left, right) {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const scale = Math.max(a.scale, b.scale);
  const leftInt = scaleDecimal(a.value, a.scale, scale);
  const rightInt = scaleDecimal(b.value, b.scale, scale);
  return formatDecimal(leftInt + rightInt, scale);
}

function subtractDecimalStrings(left, right) {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const scale = Math.max(a.scale, b.scale);
  const leftInt = scaleDecimal(a.value, a.scale, scale);
  const rightInt = scaleDecimal(b.value, b.scale, scale);
  return formatDecimal(leftInt - rightInt, scale);
}

function compareDecimalStrings(left, right) {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const scale = Math.max(a.scale, b.scale);
  const leftInt = scaleDecimal(a.value, a.scale, scale);
  const rightInt = scaleDecimal(b.value, b.scale, scale);
  if (leftInt === rightInt) return 0;
  return leftInt > rightInt ? 1 : -1;
}

function normalizeDecimalString(value) {
  const parsed = parseDecimal(value);
  return formatDecimal(parsed.value, parsed.scale);
}

function isZeroDecimal(value) {
  return normalizeDecimalString(value) === "0";
}

function parseDecimal(value) {
  const raw = String(value ?? "0").trim();
  if (!raw) return { value: 0n, scale: 0 };
  const negative = raw.startsWith("-");
  const normalized = raw.replace(/^[-+]/, "");
  const [integer = "0", fraction = ""] = normalized.split(".");
  const digits = `${integer}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  return {
    value: BigInt(digits) * (negative ? -1n : 1n),
    scale: fraction.length,
  };
}

function scaleDecimal(value, fromScale, toScale) {
  if (fromScale === toScale) return value;
  return value * 10n ** BigInt(toScale - fromScale);
}

function formatDecimal(value, scale) {
  const negative = value < 0;
  const absolute = negative ? -value : value;
  const digits = absolute.toString().padStart(scale + 1, "0");
  const integer = scale === 0 ? digits : digits.slice(0, -scale) || "0";
  const fraction = scale === 0 ? "" : digits.slice(-scale).replace(/0+$/, "");
  const output = fraction ? `${integer}.${fraction}` : integer;
  const normalized = output.replace(/^0+(?=\d)/, "") || "0";
  return negative && normalized !== "0" ? `-${normalized}` : normalized;
}

module.exports = {
  collectBitgetSnapshot,
};
