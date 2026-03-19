const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const ZERION_BASE_URL = "https://api.zerion.io";

async function collectZerionDefiSnapshot(position, apiKey) {
  const address = String(position.address || "").trim();
  if (!address) {
    throw new Error("DeFi 地址不能为空。");
  }
  if (!apiKey) {
    throw new Error("未配置 Zerion API Key。");
  }

  const chain = normalizeChain(position.chain);
  const query = buildQuery({
    "filter[positions]": "only_complex",
    "filter[chain_ids]": chain || "",
    "page[size]": 100,
  });
  const response = await zerionRequest({
    apiKey,
    path: `/v1/wallets/${address}/positions/`,
    query,
  });

  const rows = Array.isArray(response.data) ? response.data : [];
  const holdings = [];

  for (const row of rows) {
    const attributes = row.attributes || {};
    const fungibles = Array.isArray(attributes.fungible_info_list) ? attributes.fungible_info_list : [];
    const protocolName = attributes.protocol || attributes.dapp_name || position.protocol || "DeFi";
    const positionName = attributes.name || attributes.position_name || position.positionType || "position";

    for (const item of fungibles) {
      const asset = String(
        item.symbol || item.asset_code || item.optimized_symbol || item.name || "",
      ).toUpperCase();
      const amount = normalizeDecimalString(
        item.quantity?.numeric || item.amount?.numeric || item.value || item.balance || "0",
      );
      if (!asset || isZeroDecimal(amount)) continue;

      holdings.push({
        asset,
        amount,
        scope: "defi",
        accountType: "defi_position",
        breakdown: {
          chain: chain || "",
          protocol: protocolName,
          positionName,
          resolver: "zerion",
          rawType: attributes.position_type || null,
        },
      });
    }
  }

  const consolidatedBalances = consolidateHoldings(holdings);

  return {
    exchange: "defi",
    accountLabel: position.protocol || `DeFi ${address.slice(0, 6)}`,
    accountOwnerLabel: position.ownerAccountLabel || position.protocol || `DeFi ${address.slice(0, 6)}`,
    accountOwnerExchange: position.ownerExchange || "defi",
    collectedAt: new Date().toISOString(),
    scopesRequested: ["defi"],
    scopesSucceeded: ["defi"],
    scopesFailed: [],
    holdings,
    consolidatedBalances,
    summary: {
      totalHoldingRows: holdings.length,
      nonZeroAssets: consolidatedBalances.length,
      scopeAssetCounts: { defi: holdings.length },
    },
    errors: [],
    defi: {
      protocol: position.protocol || "",
      chain: chain || "",
      address,
      resolver: "zerion",
    },
  };
}

async function zerionRequest({ apiKey, path, query }) {
  const url = `${ZERION_BASE_URL}${path}${query ? `?${query}` : ""}`;
  const auth = Buffer.from(`${apiKey}:`).toString("base64");
  const { stdout } = await execFileAsync(
    "curl",
    ["-sS", "--max-time", "20", "-H", `Authorization: Basic ${auth}`, "-H", "accept: application/json", url],
    {
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  const payload = stdout ? JSON.parse(stdout) : null;
  if (payload && payload.errors && payload.errors.length > 0) {
    const first = payload.errors[0];
    throw new Error(first.detail || first.title || "Zerion API 请求失败");
  }

  return payload;
}

function normalizeChain(chain) {
  const value = String(chain || "").trim().toLowerCase();
  const map = {
    ethereum: "ethereum",
    eth: "ethereum",
    arbitrum: "arbitrum",
    base: "base",
    optimism: "optimism",
    polygon: "polygon",
    bsc: "binance-smart-chain",
    binance: "binance-smart-chain",
  };
  return map[value] || value;
}

function buildQuery(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function consolidateHoldings(holdings) {
  const map = new Map();

  for (const holding of holdings) {
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
  collectZerionDefiSnapshot,
};
