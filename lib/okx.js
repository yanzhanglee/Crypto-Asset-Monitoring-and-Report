const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const OKX_BASE_URL = "https://www.okx.com";
const DEFAULT_SCOPES = ["trading", "funding", "savings", "overview"];

async function collectOkxSnapshot(account) {
  const apiKey = String(account.apiKey || "").trim();
  const apiSecret = String(account.apiSecret || "").trim();
  const passphrase = String(account.passphrase || "").trim();

  if (!apiKey || !apiSecret || !passphrase) {
    throw new Error("OKX API Key / Secret / Passphrase 不能为空。");
  }

  const scopes = parseScopes(account.accountScope);
  const results = [];
  const errors = [];

  const tasks = {
    trading: () => fetchTradingBalances({ apiKey, apiSecret, passphrase, simulated: isOkxDemo(account) }),
    funding: () => fetchFundingBalances({ apiKey, apiSecret, passphrase, simulated: isOkxDemo(account) }),
    savings: () => fetchSavingsBalances({ apiKey, apiSecret, passphrase, simulated: isOkxDemo(account) }),
    overview: () => fetchOverviewBalances({ apiKey, apiSecret, passphrase, simulated: isOkxDemo(account) }),
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
    exchange: "okx",
    accountLabel: account.label || "OKX Account",
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

function isOkxDemo(account) {
  return String(account.environment || "").toLowerCase() === "demo";
}

async function fetchTradingBalances(credentials) {
  const payload = await okxRequest({
    ...credentials,
    path: "/api/v5/account/balance",
  });

  const details = (payload.data || []).flatMap((item) => item.details || []);
  const holdings = details
    .map((item) => ({
      asset: String(item.ccy || "").toUpperCase(),
      amount: normalizeDecimalString(item.eq || item.cashBal || item.availBal || "0"),
      scope: "trading",
      accountType: "trading",
      breakdown: {
        eq: normalizeDecimalString(item.eq),
        availBal: normalizeDecimalString(item.availBal),
        cashBal: normalizeDecimalString(item.cashBal),
        frozenBal: normalizeDecimalString(item.frozenBal),
        eqUsd: normalizeDecimalString(item.eqUsd),
      },
    }))
    .filter((item) => item.asset && !isZeroDecimal(item.amount));

  return { scope: "trading", holdings };
}

async function fetchFundingBalances(credentials) {
  const payload = await okxRequest({
    ...credentials,
    path: "/api/v5/asset/balances",
  });

  const holdings = (payload.data || [])
    .map((item) => ({
      asset: String(item.ccy || "").toUpperCase(),
      amount: normalizeDecimalString(item.bal),
      scope: "funding",
      accountType: "funding",
      breakdown: {
        bal: normalizeDecimalString(item.bal),
        availBal: normalizeDecimalString(item.availBal),
        frozenBal: normalizeDecimalString(item.frozenBal),
      },
    }))
    .filter((item) => item.asset && !isZeroDecimal(item.amount));

  return { scope: "funding", holdings };
}

async function fetchSavingsBalances(credentials) {
  const payload = await okxRequest({
    ...credentials,
    path: "/api/v5/finance/savings/balance",
  });

  const holdings = (payload.data || [])
    .map((item) => ({
      asset: String(item.ccy || "").toUpperCase(),
      amount: normalizeDecimalString(item.amt || item.bal || "0"),
      scope: "savings",
      accountType: "savings",
      breakdown: {
        amount: normalizeDecimalString(item.amt || item.bal),
        rate: normalizeDecimalString(item.rate),
        earnings: normalizeDecimalString(item.earnings),
      },
    }))
    .filter((item) => item.asset && !isZeroDecimal(item.amount));

  return { scope: "savings", holdings };
}

async function fetchOverviewBalances(credentials) {
  const payload = await okxRequest({
    ...credentials,
    path: "/api/v5/asset/asset-valuation",
    query: { ccy: "USDT" },
  });

  const detail = payload.data && payload.data[0] ? payload.data[0] : {};
  const breakdown = detail.details || {};
  const holdings = Object.entries(breakdown)
    .map(([key, value]) => ({
      asset: "USDT",
      amount: normalizeDecimalString(value),
      scope: "overview",
      accountType: `overview_${key}`,
      nonAdditive: true,
      breakdown: {
        sourceAccountType: key,
        valuationUsdt: normalizeDecimalString(value),
      },
    }))
    .filter((item) => !isZeroDecimal(item.amount));

  return { scope: "overview", holdings };
}

async function okxRequest({ apiKey, apiSecret, passphrase, path, method = "GET", query = {}, body = "", simulated }) {
  const queryString = buildQuery(query);
  const requestPath = queryString ? `${path}?${queryString}` : path;
  const timestamp = new Date().toISOString();
  const prehash = `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
  const sign = crypto.createHmac("sha256", apiSecret).update(prehash).digest("base64");

  const headers = {
    "OK-ACCESS-KEY": apiKey,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": passphrase,
    "Content-Type": "application/json",
  };

  if (simulated) {
    headers["x-simulated-trading"] = "1";
  }

  const response = await curlJsonRequest({
    url: `${OKX_BASE_URL}${requestPath}`,
    method,
    headers,
    body,
  });

  if (!response.ok || response.payload.code !== "0") {
    const error = new Error(
      response.payload && typeof response.payload.msg === "string"
        ? `OKX API 错误(${response.status}${response.payload.code ? ` / ${response.payload.code}` : ""}): ${response.payload.msg}`
        : `OKX API 请求失败，HTTP ${response.status}`,
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
  if (body) args.push("--data", body);
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

  return { ok: status >= 200 && status < 300, status, payload, stderr };
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

function addDecimalStrings(left, right) {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const scale = Math.max(a.scale, b.scale);
  const leftInt = scaleDecimal(a.value, a.scale, scale);
  const rightInt = scaleDecimal(b.value, b.scale, scale);
  return formatDecimal(leftInt + rightInt, scale);
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
  return { value: BigInt(digits) * (negative ? -1n : 1n), scale: fraction.length };
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
  collectOkxSnapshot,
};
