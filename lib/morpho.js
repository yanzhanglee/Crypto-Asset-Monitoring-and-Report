const { Interface } = require("ethers");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const MORPHO_GRAPHQL_URL = "https://api.morpho.org/graphql";

const CHAIN_CONFIG = {
  worldchain: {
    chainId: 480,
    rpcUrl: "https://worldchain-mainnet.g.alchemy.com/public",
  },
};

const ERC4626_ABI = new Interface([
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
]);

async function collectMorphoSnapshot(position) {
  const address = normalizeAddress(position.address);
  const chain = normalizeChain(position.chain);
  const chainConfig = CHAIN_CONFIG[chain];

  if (!chainConfig) {
    throw new Error(`Morpho 暂不支持链: ${position.chain || "unknown"}`);
  }

  const rpcUrl = String(position.rpcUrl || "").trim() || chainConfig.rpcUrl;
  const payload = await morphoRequest({
    query: `
      query($address: String!, $chainId: Int!) {
        userByAddress(address: $address, chainId: $chainId) {
          address
          marketPositions {
            market {
              uniqueKey
              loanAsset {
                symbol
                address
                decimals
              }
              collateralAsset {
                symbol
                address
                decimals
              }
            }
            supplyAssets
            borrowAssets
            collateral
          }
          vaultPositions {
            vault {
              address
              name
              symbol
              asset {
                symbol
                address
                decimals
              }
            }
            shares
            assets
          }
        }
      }
    `,
    variables: {
      address,
      chainId: chainConfig.chainId,
    },
  });

  const user = payload?.data?.userByAddress;
  const marketPositions = Array.isArray(user?.marketPositions) ? user.marketPositions : [];
  const vaultPositions = Array.isArray(user?.vaultPositions) ? user.vaultPositions : [];
  const holdings = [];

  for (const row of marketPositions) {
    const market = row.market || {};
    const loanAsset = market.loanAsset || {};
    const collateralAsset = market.collateralAsset || {};

    const supplyAmount = normalizeDecimalString(row.supplyAssets || "0");
    if (!isZeroDecimal(supplyAmount)) {
      holdings.push({
        asset: String(loanAsset.symbol || "").toUpperCase(),
        amount: supplyAmount,
        scope: "defi",
        accountType: "morpho_supply",
        breakdown: {
          protocol: "Morpho",
          chain,
          address,
          positionType: "supply",
          market: market.uniqueKey || "",
          loanAssetAddress: loanAsset.address || "",
          resolver: "morpho",
        },
      });
    }

    const borrowAmount = normalizeDecimalString(row.borrowAssets || "0");
    if (!isZeroDecimal(borrowAmount)) {
      holdings.push({
        asset: String(loanAsset.symbol || "").toUpperCase(),
        amount: negateDecimalString(borrowAmount),
        scope: "defi",
        accountType: "morpho_borrow",
        breakdown: {
          protocol: "Morpho",
          chain,
          address,
          positionType: "borrow",
          market: market.uniqueKey || "",
          loanAssetAddress: loanAsset.address || "",
          resolver: "morpho",
        },
      });
    }

    const collateralAmount = normalizeDecimalString(row.collateral || "0");
    if (!isZeroDecimal(collateralAmount)) {
      holdings.push({
        asset: String(collateralAsset.symbol || "").toUpperCase(),
        amount: collateralAmount,
        scope: "defi",
        accountType: "morpho_collateral",
        breakdown: {
          protocol: "Morpho",
          chain,
          address,
          positionType: "collateral",
          market: market.uniqueKey || "",
          collateralAssetAddress: collateralAsset.address || "",
          resolver: "morpho",
        },
      });
    }
  }

  for (const row of vaultPositions) {
    const shares = normalizeDecimalString(row.shares || "0");
    if (isZeroDecimal(shares)) continue;

    const vault = row.vault || {};
    const asset = vault.asset || {};
    const assetSymbol = String(asset.symbol || vault.symbol || "").toUpperCase();
    const assetDecimals = Number(asset.decimals ?? 18) || 18;
    const assetAmount = await resolveVaultAssets({
      rpcUrl,
      vaultAddress: vault.address,
      sharesRaw: row.shares || "0",
      assetDecimals,
      fallbackAssets: row.assets || "0",
    });

    if (isZeroDecimal(assetAmount)) continue;

    holdings.push({
      asset: assetSymbol,
      amount: assetAmount,
      scope: "defi",
      accountType: "morpho_vault",
      breakdown: {
        protocol: "Morpho",
        chain,
        address,
        positionType: "vault",
        vaultAddress: vault.address || "",
        vaultName: vault.name || vault.symbol || "Morpho Vault",
        vaultSymbol: vault.symbol || "",
        assetAddress: asset.address || "",
        shares: normalizeShareDisplay(row.shares || "0"),
        resolver: "morpho",
      },
    });
  }

  const consolidatedBalances = consolidateHoldings(holdings);

  return {
    exchange: "defi",
    accountLabel: position.protocol || "Morpho",
    accountOwnerLabel: position.ownerAccountLabel || position.address,
    accountOwnerExchange: position.ownerExchange || "wallet",
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
      protocol: "Morpho",
      chain,
      address,
      resolver: "morpho",
    },
  };
}

async function resolveVaultAssets({ rpcUrl, vaultAddress, sharesRaw, assetDecimals, fallbackAssets }) {
  const sharesInteger = parseShareInteger(sharesRaw);

  try {
    const preview = await callErc4626(rpcUrl, vaultAddress, "previewRedeem", [sharesInteger]);
    return formatDecimal(preview, assetDecimals);
  } catch {}

  try {
    const converted = await callErc4626(rpcUrl, vaultAddress, "convertToAssets", [sharesInteger]);
    return formatDecimal(converted, assetDecimals);
  } catch {}

  return normalizeDecimalString(fallbackAssets || "0");
}

function parseShareInteger(value) {
  const raw = String(value ?? "0").trim();
  if (!raw) return 0n;
  if (/^-?\d+$/.test(raw)) {
    return BigInt(raw);
  }
  const parsed = parseDecimal(raw);
  return scaleDecimal(parsed.value, parsed.scale, 18);
}

function normalizeShareDisplay(value) {
  return formatDecimal(parseShareInteger(value), 18);
}

async function callErc4626(rpcUrl, vaultAddress, method, args) {
  const data = ERC4626_ABI.encodeFunctionData(method, args);
  const result = await rpcRequest(rpcUrl, "eth_call", [{ to: vaultAddress, data }, "latest"]);
  const [value] = ERC4626_ABI.decodeFunctionResult(method, result);
  return value;
}

async function morphoRequest({ query, variables }) {
  const body = JSON.stringify({ query, variables });
  const { stdout } = await execFileAsync(
    "curl",
    ["-sS", "--max-time", "20", "-H", "content-type: application/json", "--data-binary", body, MORPHO_GRAPHQL_URL],
    {
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  const payload = stdout ? JSON.parse(stdout) : null;
  if (!payload) {
    throw new Error("Morpho API 未返回有效数据");
  }

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const hardErrors = payload.errors.filter((item) => item.status && item.status !== "NOT_FOUND");
    if (hardErrors.length > 0) {
      throw new Error(hardErrors[0].message || "Morpho API 请求失败");
    }
  }

  return payload;
}

async function rpcRequest(rpcUrl, method, params) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  });

  const { stdout } = await execFileAsync(
    "curl",
    ["-sS", "--max-time", "20", "-X", "POST", "-H", "Content-Type: application/json", "--data", body, rpcUrl],
    {
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  const payload = stdout ? JSON.parse(stdout) : null;
  if (!payload || payload.error) {
    const detail =
      payload && payload.error && payload.error.message
        ? `${payload.error.message}${payload.error.code ? ` (${payload.error.code})` : ""}`
        : "Morpho RPC 请求失败";
    throw new Error(`${method} 请求失败: ${detail}`);
  }

  return payload.result;
}

function normalizeChain(chain) {
  const value = String(chain || "").trim().toLowerCase();
  const map = {
    worldchain: "worldchain",
    world: "worldchain",
    "world chain": "worldchain",
  };
  return map[value] || value;
}

function normalizeAddress(address) {
  const value = String(address || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`无效的 EVM 地址: ${address}`);
  }
  return value;
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

function negateDecimalString(value) {
  const parsed = parseDecimal(value);
  return formatDecimal(-parsed.value, parsed.scale);
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
  if (fromScale > toScale) return value / 10n ** BigInt(fromScale - toScale);
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
  collectMorphoSnapshot,
};
