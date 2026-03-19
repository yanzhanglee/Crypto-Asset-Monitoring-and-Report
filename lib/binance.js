const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const API_BASE_URL = "https://api.binance.com";
const UM_FUTURES_BASE_URL = "https://fapi.binance.com";
const CM_FUTURES_BASE_URL = "https://dapi.binance.com";
const DEFAULT_RECV_WINDOW = 10000;
const DEFAULT_SCOPES = [
  "spot",
  "funding",
  "simple_earn_flexible",
  "simple_earn_locked",
  "cross_margin",
  "isolated_margin",
  "um_futures",
  "cm_futures",
  "subaccount_spot",
  "subaccount_margin",
  "subaccount_um_futures",
  "subaccount_cm_futures",
];

const timeOffsetCache = new Map();

async function collectBinanceSnapshot(account) {
  const apiKey = String(account.apiKey || "").trim();
  const apiSecret = String(account.apiSecret || "").trim();

  if (!apiKey || !apiSecret) {
    throw new Error("Binance API Key / Secret 不能为空。");
  }

  const scopes = parseScopes(account.accountScope);
  const recvWindow = normalizeRecvWindow(account.recvWindow);
  const results = [];
  const errors = [];
  let subAccountsPromise;

  const getSubAccounts = async () => {
    if (!subAccountsPromise) {
      subAccountsPromise = fetchSubAccounts({ apiKey, apiSecret, recvWindow });
    }
    return subAccountsPromise;
  };

  const tasks = {
    spot: () => fetchSpotBalances({ apiKey, apiSecret, recvWindow }),
    funding: () => fetchFundingBalances({ apiKey, apiSecret, recvWindow }),
    simple_earn_flexible: () => fetchSimpleEarnFlexible({ apiKey, apiSecret, recvWindow }),
    simple_earn_locked: () => fetchSimpleEarnLocked({ apiKey, apiSecret, recvWindow }),
    cross_margin: () => fetchCrossMarginBalances({ apiKey, apiSecret, recvWindow }),
    isolated_margin: () => fetchIsolatedMarginBalances({ apiKey, apiSecret, recvWindow }),
    um_futures: () => fetchUmFuturesBalances({ apiKey, apiSecret, recvWindow }),
    cm_futures: () => fetchCmFuturesBalances({ apiKey, apiSecret, recvWindow }),
    subaccount_spot: async () =>
      fetchSubAccountSpotBalances({ apiKey, apiSecret, recvWindow, subAccounts: await getSubAccounts() }),
    subaccount_margin: async () =>
      fetchSubAccountMarginBalances({ apiKey, apiSecret, recvWindow, subAccounts: await getSubAccounts() }),
    subaccount_um_futures: async () =>
      fetchSubAccountFuturesBalances({
        apiKey,
        apiSecret,
        recvWindow,
        subAccounts: await getSubAccounts(),
        futuresType: 1,
        scope: "subaccount_um_futures",
      }),
    subaccount_cm_futures: async () =>
      fetchSubAccountFuturesBalances({
        apiKey,
        apiSecret,
        recvWindow,
        subAccounts: await getSubAccounts(),
        futuresType: 2,
        scope: "subaccount_cm_futures",
      }),
  };

  for (const scope of scopes) {
    const task = tasks[scope];
    if (!task) {
      errors.push({ scope, message: `不支持的 scope: ${scope}` });
      continue;
    }

    try {
      const scopeResult = await task();
      results.push(scopeResult);
      if (Array.isArray(scopeResult.warnings)) {
        errors.push(...scopeResult.warnings.map((item) => ({ scope, ...item })));
      }
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
  const consolidated = consolidateHoldings(holdings);

  return {
    exchange: "binance",
    accountLabel: account.label || "Binance Account",
    collectedAt: new Date().toISOString(),
    scopesRequested: scopes,
    scopesSucceeded: results.map((item) => item.scope),
    scopesFailed: errors.map((item) => item.scope),
    holdings,
    consolidatedBalances: consolidated,
    summary: {
      totalHoldingRows: holdings.length,
      nonZeroAssets: consolidated.length,
      scopeAssetCounts: Object.fromEntries(results.map((item) => [item.scope, item.holdings.length])),
    },
    errors,
  };
}

function parseScopes(accountScope) {
  const raw = String(accountScope || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return raw.length > 0 ? raw : [...DEFAULT_SCOPES];
}

function normalizeRecvWindow(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_RECV_WINDOW;
  return Math.min(60000, Math.max(1000, Math.floor(parsed)));
}

async function fetchSpotBalances(credentials) {
  const payload = await signedRequest({
    ...credentials,
    baseUrl: API_BASE_URL,
    path: "/api/v3/account",
  });

  const holdings = (payload.balances || [])
    .map((item) => {
      const amount = addDecimalStrings(item.free, item.locked);
      return {
        asset: item.asset,
        amount,
        scope: "spot",
        accountType: "spot",
        breakdown: {
          free: normalizeDecimalString(item.free),
          locked: normalizeDecimalString(item.locked),
        },
      };
    })
    .filter((item) => !isZeroDecimal(item.amount));

  return { scope: "spot", holdings };
}

async function fetchFundingBalances(credentials) {
  const payload = await signedRequest({
    ...credentials,
    baseUrl: API_BASE_URL,
    path: "/sapi/v1/asset/get-funding-asset",
    method: "POST",
  });

  const holdings = (payload || [])
    .map((item) => {
      const amount = sumDecimalStrings([item.free, item.locked, item.freeze, item.withdrawing]);
      return {
        asset: item.asset,
        amount,
        scope: "funding",
        accountType: "funding",
        breakdown: {
          free: normalizeDecimalString(item.free),
          locked: normalizeDecimalString(item.locked),
          freeze: normalizeDecimalString(item.freeze),
          withdrawing: normalizeDecimalString(item.withdrawing),
          btcValuation: normalizeDecimalString(item.btcValuation),
        },
      };
    })
    .filter((item) => !isZeroDecimal(item.amount));

  return { scope: "funding", holdings };
}

async function fetchSimpleEarnFlexible(credentials) {
  const rows = await fetchPagedRows({
    ...credentials,
    baseUrl: API_BASE_URL,
    path: "/sapi/v1/simple-earn/flexible/position",
  });

  const holdings = rows
    .map((item) => ({
      asset: item.asset,
      amount: normalizeDecimalString(item.totalAmount),
      scope: "simple_earn_flexible",
      accountType: "simple_earn_flexible",
      breakdown: {
        productId: item.productId || null,
        totalAmount: normalizeDecimalString(item.totalAmount),
        latestAnnualPercentageRate: normalizeDecimalString(item.latestAnnualPercentageRate),
        tierAnnualPercentageRate: item.tierAnnualPercentageRate || null,
      },
    }))
    .filter((item) => !isZeroDecimal(item.amount));

  return { scope: "simple_earn_flexible", holdings };
}

async function fetchSimpleEarnLocked(credentials) {
  const rows = await fetchPagedRows({
    ...credentials,
    baseUrl: API_BASE_URL,
    path: "/sapi/v1/simple-earn/locked/position",
  });

  const holdings = rows
    .map((item) => {
      const amount = normalizeDecimalString(item.amount || item.totalAmount);
      return {
        asset: item.asset,
        amount,
        scope: "simple_earn_locked",
        accountType: "simple_earn_locked",
        breakdown: {
          positionId: item.positionId || null,
          projectId: item.projectId || null,
          duration: item.duration || null,
          amount,
          apr: normalizeDecimalString(item.apr || item.APR || item.apy || item.APY),
        },
      };
    })
    .filter((item) => !isZeroDecimal(item.amount));

  return { scope: "simple_earn_locked", holdings };
}

async function fetchCrossMarginBalances(credentials) {
  const payload = await signedRequest({
    ...credentials,
    baseUrl: API_BASE_URL,
    path: "/sapi/v1/margin/account",
  });

  const holdings = (payload.userAssets || payload.assets || [])
    .map((item) => ({
      asset: item.asset,
      amount: normalizeDecimalString(item.netAsset),
      scope: "cross_margin",
      accountType: "cross_margin",
      breakdown: {
        free: normalizeDecimalString(item.free),
        locked: normalizeDecimalString(item.locked),
        borrowed: normalizeDecimalString(item.borrowed),
        interest: normalizeDecimalString(item.interest),
        netAsset: normalizeDecimalString(item.netAsset),
      },
    }))
    .filter(
      (item) =>
        !isZeroDecimal(item.amount) ||
        !isZeroDecimal(item.breakdown.free) ||
        !isZeroDecimal(item.breakdown.borrowed),
    );

  return { scope: "cross_margin", holdings };
}

async function fetchIsolatedMarginBalances(credentials) {
  const payload = await signedRequest({
    ...credentials,
    baseUrl: API_BASE_URL,
    path: "/sapi/v1/margin/isolated/account",
  });

  const entries = [];

  for (const pair of payload.assets || []) {
    for (const side of ["baseAsset", "quoteAsset"]) {
      const item = pair[side];
      if (!item || !item.asset) continue;
      entries.push({
        asset: item.asset,
        amount: normalizeDecimalString(item.netAsset),
        scope: "isolated_margin",
        accountType: "isolated_margin",
        breakdown: {
          symbol: pair.symbol || null,
          side,
          free: normalizeDecimalString(item.free),
          locked: normalizeDecimalString(item.locked),
          borrowed: normalizeDecimalString(item.borrowed),
          interest: normalizeDecimalString(item.interest),
          netAsset: normalizeDecimalString(item.netAsset),
          totalAsset: normalizeDecimalString(item.totalAsset),
        },
      });
    }
  }

  const holdings = entries.filter(
    (item) =>
      !isZeroDecimal(item.amount) ||
      !isZeroDecimal(item.breakdown.free) ||
      !isZeroDecimal(item.breakdown.borrowed),
  );

  return { scope: "isolated_margin", holdings };
}

async function fetchUmFuturesBalances(credentials) {
  const payload = await signedRequest({
    ...credentials,
    baseUrl: UM_FUTURES_BASE_URL,
    path: "/fapi/v2/account",
    timePath: "/fapi/v1/time",
  });

  const holdings = (payload.assets || [])
    .map((item) => ({
      asset: item.asset,
      amount: normalizeDecimalString(item.marginBalance),
      scope: "um_futures",
      accountType: "um_futures",
      breakdown: {
        walletBalance: normalizeDecimalString(item.walletBalance),
        unrealizedProfit: normalizeDecimalString(item.unrealizedProfit),
        marginBalance: normalizeDecimalString(item.marginBalance),
        availableBalance: normalizeDecimalString(item.availableBalance),
        maxWithdrawAmount: normalizeDecimalString(item.maxWithdrawAmount),
      },
    }))
    .filter(
      (item) =>
        !isZeroDecimal(item.amount) ||
        !isZeroDecimal(item.breakdown.walletBalance) ||
        !isZeroDecimal(item.breakdown.unrealizedProfit),
    );

  return { scope: "um_futures", holdings };
}

async function fetchCmFuturesBalances(credentials) {
  const payload = await signedRequest({
    ...credentials,
    baseUrl: CM_FUTURES_BASE_URL,
    path: "/dapi/v1/account",
    timePath: "/dapi/v1/time",
  });

  const holdings = (payload.assets || [])
    .map((item) => ({
      asset: item.asset,
      amount: normalizeDecimalString(item.marginBalance),
      scope: "cm_futures",
      accountType: "cm_futures",
      breakdown: {
        walletBalance: normalizeDecimalString(item.walletBalance),
        unrealizedProfit: normalizeDecimalString(item.unrealizedProfit),
        marginBalance: normalizeDecimalString(item.marginBalance),
        availableBalance: normalizeDecimalString(item.availableBalance),
        maxWithdrawAmount: normalizeDecimalString(item.maxWithdrawAmount),
      },
    }))
    .filter(
      (item) =>
        !isZeroDecimal(item.amount) ||
        !isZeroDecimal(item.breakdown.walletBalance) ||
        !isZeroDecimal(item.breakdown.unrealizedProfit),
    );

  return { scope: "cm_futures", holdings };
}

async function fetchSubAccounts(credentials) {
  const subAccounts = [];
  let page = 1;
  const limit = 200;

  while (true) {
    const payload = await signedRequest({
      ...credentials,
      baseUrl: API_BASE_URL,
      path: "/sapi/v1/sub-account/list",
      params: { page, limit },
    });

    const batch = payload.subAccounts || [];
    subAccounts.push(...batch);

    if (batch.length < limit) break;
    page += 1;
  }

  return subAccounts;
}

async function fetchSubAccountSpotBalances({ apiKey, apiSecret, recvWindow, subAccounts }) {
  const holdings = [];
  const warnings = [];

  for (const subAccount of subAccounts) {
    const email = subAccount.email;
    if (!email) continue;

    try {
      const payload = await signedRequest({
        baseUrl: API_BASE_URL,
        path: "/sapi/v4/sub-account/assets",
        apiKey,
        apiSecret,
        recvWindow,
        params: { email },
      });

      for (const item of payload.balances || []) {
        const amount = sumDecimalStrings([item.free, item.locked, item.freeze, item.withdrawing]);
        if (isZeroDecimal(amount)) continue;
        holdings.push({
          asset: item.asset,
          amount,
          scope: "subaccount_spot",
          accountType: "subaccount_spot",
          breakdown: {
            email,
            free: normalizeDecimalString(item.free),
            locked: normalizeDecimalString(item.locked),
            freeze: normalizeDecimalString(item.freeze),
            withdrawing: normalizeDecimalString(item.withdrawing),
          },
        });
      }
    } catch (error) {
      warnings.push({ email, message: error.message });
    }
  }

  return { scope: "subaccount_spot", holdings, warnings };
}

async function fetchSubAccountMarginBalances({ apiKey, apiSecret, recvWindow, subAccounts }) {
  const holdings = [];
  const warnings = [];

  for (const subAccount of subAccounts) {
    const email = subAccount.email;
    if (!email) continue;

    try {
      const payload = await signedRequest({
        baseUrl: API_BASE_URL,
        path: "/sapi/v1/sub-account/margin/account",
        apiKey,
        apiSecret,
        recvWindow,
        params: { email },
      });

      for (const item of payload.assets || []) {
        const amount = normalizeDecimalString(item.netAsset);
        if (
          isZeroDecimal(amount) &&
          isZeroDecimal(item.free) &&
          isZeroDecimal(item.borrowed) &&
          isZeroDecimal(item.interest)
        ) {
          continue;
        }

        holdings.push({
          asset: item.asset,
          amount,
          scope: "subaccount_margin",
          accountType: "subaccount_margin",
          breakdown: {
            email,
            free: normalizeDecimalString(item.free),
            locked: normalizeDecimalString(item.locked),
            borrowed: normalizeDecimalString(item.borrowed),
            interest: normalizeDecimalString(item.interest),
            netAsset: normalizeDecimalString(item.netAsset),
          },
        });
      }
    } catch (error) {
      warnings.push({ email, message: error.message });
    }
  }

  return { scope: "subaccount_margin", holdings, warnings };
}

async function fetchSubAccountFuturesBalances({
  apiKey,
  apiSecret,
  recvWindow,
  subAccounts,
  futuresType,
  scope,
}) {
  const holdings = [];
  const warnings = [];

  for (const subAccount of subAccounts) {
    const email = subAccount.email;
    if (!email) continue;

    try {
      const payload = await signedRequest({
        baseUrl: API_BASE_URL,
        path: "/sapi/v2/sub-account/futures/account",
        apiKey,
        apiSecret,
        recvWindow,
        params: { email, futuresType },
      });

      const futureAccount = payload.futureAccountResp || payload;

      for (const item of futureAccount.assets || []) {
        const amount = normalizeDecimalString(item.marginBalance);
        if (
          isZeroDecimal(amount) &&
          isZeroDecimal(item.walletBalance) &&
          isZeroDecimal(item.unrealizedProfit)
        ) {
          continue;
        }

        holdings.push({
          asset: item.asset,
          amount,
          scope,
          accountType: scope,
          breakdown: {
            email,
            futuresType,
            walletBalance: normalizeDecimalString(item.walletBalance),
            unrealizedProfit: normalizeDecimalString(item.unrealizedProfit),
            marginBalance: normalizeDecimalString(item.marginBalance),
            availableBalance: normalizeDecimalString(item.availableBalance),
            maxWithdrawAmount: normalizeDecimalString(item.maxWithdrawAmount),
          },
        });
      }
    } catch (error) {
      warnings.push({ email, message: error.message });
    }
  }

  return { scope, holdings, warnings };
}

async function fetchPagedRows({ baseUrl, path, apiKey, apiSecret, recvWindow }) {
  const size = 100;
  let current = 1;
  let total = Infinity;
  const rows = [];

  while ((current - 1) * size < total) {
    const payload = await signedRequest({
      baseUrl,
      path,
      apiKey,
      apiSecret,
      recvWindow,
      params: { current, size },
    });

    const batch = Array.isArray(payload.rows) ? payload.rows : [];
    rows.push(...batch);
    total = Number(payload.total || batch.length);

    if (batch.length < size) break;
    current += 1;
  }

  return rows;
}

async function signedRequest({
  baseUrl,
  path,
  apiKey,
  apiSecret,
  method = "GET",
  params = {},
  recvWindow = DEFAULT_RECV_WINDOW,
  timePath,
}) {
  const timestamp = await getTimestamp(baseUrl, timePath);
  const allParams = {
    ...params,
    recvWindow,
    timestamp,
  };

  const query = buildQuery(allParams);
  const signature = crypto.createHmac("sha256", apiSecret).update(query).digest("hex");
  const url = `${baseUrl}${path}?${query}&signature=${signature}`;

  const response = await safeFetch(url, {
    method,
    headers: {
      "X-MBX-APIKEY": apiKey,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
  });

  const text = await response.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const error = new Error(formatBinanceError(payload, response.status));
    error.status = response.status;
    error.code = payload && typeof payload === "object" ? payload.code : null;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function getTimestamp(baseUrl, timePath) {
  const path = timePath || "/api/v3/time";
  const cacheKey = `${baseUrl}${path}`;
  const cached = timeOffsetCache.get(cacheKey);

  if (cached && Date.now() - cached.cachedAt < 30000) {
    return Date.now() + cached.offset;
  }

  const response = await safeFetch(`${baseUrl}${path}`);
  const payload = await response.json();
  const serverTime = Number(payload.serverTime);
  const offset = Number.isFinite(serverTime) ? serverTime - Date.now() : 0;

  timeOffsetCache.set(cacheKey, { offset, cachedAt: Date.now() });
  return Date.now() + offset;
}

async function safeFetch(url, options = {}) {
  try {
    return await safeCurlFetch(url, options, null);
  } catch (error) {
    const fetchError = normalizeFetchError(url, error);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        return await fetch(url, {
          ...options,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (fallbackError) {
      throw normalizeFetchError(url, fallbackError.cause ? fallbackError : fetchError);
    }
  }
}

function normalizeFetchError(url, error) {
  const cause = error && typeof error === "object" ? error.cause : null;
  const parts = [];

  if (error && error.name === "AbortError") {
    parts.push("request timeout after 15000ms");
  } else if (error && error.message) {
    parts.push(error.message);
  } else {
    parts.push("unknown fetch error");
  }

  if (cause && typeof cause === "object") {
    if (cause.code) parts.push(`code=${cause.code}`);
    if (cause.errno) parts.push(`errno=${cause.errno}`);
    if (cause.syscall) parts.push(`syscall=${cause.syscall}`);
    if (cause.hostname) parts.push(`hostname=${cause.hostname}`);
    if (cause.address) parts.push(`address=${cause.address}`);
    if (cause.port) parts.push(`port=${cause.port}`);
    if (cause.message && cause.message !== error.message) parts.push(`cause=${cause.message}`);
  }

  const enhanced = new Error(`Network request failed for ${url}: ${parts.join(", ")}`);
  enhanced.code = cause && cause.code ? cause.code : error && error.code ? error.code : null;
  enhanced.cause = cause || null;
  return enhanced;
}

async function safeCurlFetch(url, options = {}, fetchError) {
  const method = options.method || "GET";
  const headers = options.headers || {};
  const args = ["-sS", "--max-time", "20", "-X", method];

  for (const [key, value] of Object.entries(headers)) {
    args.push("-H", `${key}: ${value}`);
  }

  args.push("-w", "\n__CURL_STATUS__:%{http_code}", url);

  try {
    const { stdout, stderr } = await execFileAsync("curl", args, {
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    });

    const marker = "\n__CURL_STATUS__:";
    const index = stdout.lastIndexOf(marker);
    const body = index >= 0 ? stdout.slice(0, index) : stdout;
    const statusRaw = index >= 0 ? stdout.slice(index + marker.length).trim() : "000";
    const status = Number(statusRaw);

    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return body;
      },
      async json() {
        return body ? JSON.parse(body) : null;
      },
      stderr,
      transport: "curl",
    };
  } catch (curlError) {
    const message = curlError.stderr
      ? `curl request failed: ${curlError.stderr.trim()}`
      : `curl request failed: ${curlError.message}`;
    if (!fetchError) {
      const error = new Error(`Network request failed for ${url}: ${message}`);
      error.code = curlError.code || null;
      error.cause = curlError;
      throw error;
    }
    const combined = new Error(`${fetchError.message}; ${message}`);
    combined.code = fetchError.code || curlError.code || null;
    combined.cause = fetchError.cause || curlError;
    throw combined;
  }
}

function formatBinanceError(payload, status) {
  if (payload && typeof payload === "object" && "msg" in payload) {
    return `Binance API 错误(${status}${payload.code ? ` / ${payload.code}` : ""}): ${payload.msg}`;
  }

  return `Binance API 请求失败，HTTP ${status}`;
}

function consolidateHoldings(holdings) {
  const byAsset = new Map();

  for (const holding of holdings) {
    if (holding.nonAdditive) continue;
    const existing = byAsset.get(holding.asset) || {
      asset: holding.asset,
      totalAmount: "0",
      scopes: [],
    };

    existing.totalAmount = addDecimalStrings(existing.totalAmount, holding.amount);
    existing.scopes.push({
      scope: holding.scope,
      amount: holding.amount,
      accountType: holding.accountType,
    });

    byAsset.set(holding.asset, existing);
  }

  return [...byAsset.values()]
    .filter((item) => !isZeroDecimal(item.totalAmount))
    .sort((left, right) => compareDecimalStrings(right.totalAmount, left.totalAmount));
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

function compareDecimalStrings(left, right) {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const scale = Math.max(a.scale, b.scale);
  const leftInt = scaleDecimal(a.value, a.scale, scale);
  const rightInt = scaleDecimal(b.value, b.scale, scale);
  if (leftInt === rightInt) return 0;
  return leftInt > rightInt ? 1 : -1;
}

function isZeroDecimal(value) {
  return normalizeDecimalString(value) === "0";
}

function normalizeDecimalString(value) {
  return formatDecimal(parseDecimal(value).value, parseDecimal(value).scale);
}

function parseDecimal(value) {
  const raw = String(value ?? "0").trim();
  if (!raw) return { value: 0n, scale: 0 };

  const negative = raw.startsWith("-");
  const normalized = raw.replace(/^[-+]/, "");
  const [integer = "0", fraction = ""] = normalized.split(".");
  const scale = fraction.length;
  const digits = `${integer}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  const signed = BigInt(digits) * (negative ? -1n : 1n);

  return { value: signed, scale };
}

function scaleDecimal(value, fromScale, toScale) {
  if (fromScale === toScale) return value;
  const factor = 10n ** BigInt(toScale - fromScale);
  return value * factor;
}

function formatDecimal(value, scale) {
  const negative = value < 0;
  const absolute = negative ? -value : value;
  const digits = absolute.toString().padStart(scale + 1, "0");
  const integer = scale === 0 ? digits : digits.slice(0, -scale) || "0";
  const fraction = scale === 0 ? "" : digits.slice(-scale).replace(/0+$/, "");
  const result = fraction ? `${integer}.${fraction}` : integer;
  const normalizedInteger = result.replace(/^0+(?=\d)/, "") || "0";
  return negative && normalizedInteger !== "0" ? `-${normalizedInteger}` : normalizedInteger;
}

function buildQuery(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

module.exports = {
  collectBinanceSnapshot,
};
