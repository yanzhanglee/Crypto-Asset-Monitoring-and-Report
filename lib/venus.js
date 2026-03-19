const { Interface, formatUnits } = require("ethers");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const BSC_RPC_URL = "https://bsc-rpc.publicnode.com";
const VENUS_API = "https://api.venus.io";
const CORE_COMPTROLLER = "0xfD36E2c2a6789Db23113685031d7F16329158384";
const VENUS_LENS = "0xf15A9c5aaDc327B383945D5821C7aC08Cdac7430";
const POOL_LENS = "0xA179d2f1Fd53D15Bc790bE91d5fF4a0108E29621";

const VENUS_LENS_ABI = [
  "function vTokenBalancesAll(address[] vTokens, address account) external returns ((address vToken,uint256 balanceOf,uint256 borrowBalanceCurrent,uint256 balanceOfUnderlying,uint256 tokenBalance,uint256 tokenAllowance)[])",
  "function pendingRewards(address holder, address comptroller) external view returns ((address distributorAddress,address rewardTokenAddress,uint256 totalRewards,(address vTokenAddress,uint256 amount)[] pendingRewards))",
];

const POOL_LENS_ABI = [
  "function vTokenBalancesAll(address[] vTokens, address account) external returns ((address vToken,uint256 balanceOf,uint256 borrowBalanceCurrent,uint256 balanceOfUnderlying,uint256 tokenBalance,uint256 tokenAllowance)[])",
  "function getPendingRewards(address account, address comptrollerAddress) external view returns ((address distributorAddress,address rewardTokenAddress,uint256 totalRewards,(address vTokenAddress,uint256 amount)[] pendingRewards)[])",
];

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];
const execFileAsync = promisify(execFile);

const venusLensInterface = new Interface(VENUS_LENS_ABI);
const poolLensInterface = new Interface(POOL_LENS_ABI);
const erc20Interface = new Interface(ERC20_ABI);

async function collectVenusSnapshot(position) {
  const address = String(position.address || "").trim();
  if (!address) {
    throw new Error("Venus 地址不能为空。");
  }

  const rpcUrl = String(position.rpcUrl || "").trim() || BSC_RPC_URL;
  const marketCatalog = await fetchAllVenusMarkets();
  const marketMap = new Map(marketCatalog.map((item) => [item.address.toLowerCase(), item]));
  const grouped = groupByComptroller(
    marketCatalog.filter(
      (item) => String(item.poolComptrollerAddress || "").toLowerCase() === CORE_COMPTROLLER.toLowerCase(),
    ),
  );
  const holdings = [];
  const errors = [];
  const succeeded = [];

  const balanceResults = await Promise.all(
    [...grouped.entries()].map(async ([comptroller, markets]) => {
      const vTokens = markets.map((item) => item.address);
      const poolLabel = normalizePoolLabel(markets[0], comptroller);
      try {
        const balances =
          comptroller.toLowerCase() === CORE_COMPTROLLER.toLowerCase()
            ? await callLens(venusLensInterface, rpcUrl, VENUS_LENS, "vTokenBalancesAll", [vTokens, address])
            : await callLens(poolLensInterface, rpcUrl, POOL_LENS, "vTokenBalancesAll", [vTokens, address]);
        return { comptroller, markets, poolLabel, balances };
      } catch (error) {
        return { comptroller, markets, poolLabel, error };
      }
    }),
  );

  for (const result of balanceResults) {
    if (result.error) {
      errors.push({ scope: result.poolLabel, message: result.error.message });
      continue;
    }

    let poolHasPosition = false;

    for (const row of result.balances) {
      const market = marketMap.get(String(row.vToken).toLowerCase());
      if (!market) continue;

      const symbol = normalizeUnderlyingSymbol(market);
      const decimals = Number(market.underlyingDecimal ?? 18) || 18;

      if (row.balanceOfUnderlying > 0n) {
        poolHasPosition = true;
        holdings.push({
          asset: symbol,
          amount: normalizeDecimalString(formatUnits(row.balanceOfUnderlying, decimals)),
          scope: "defi",
          accountType: "venus_supply",
          breakdown: {
            protocol: "Venus",
            chain: "bsc",
            address,
            positionType: "supply",
            comptroller: result.comptroller,
            market: market.symbol,
            pool: result.poolLabel,
            vTokenAddress: market.address,
            resolver: "venus",
          },
        });
      }

      if (row.borrowBalanceCurrent > 0n) {
        poolHasPosition = true;
        holdings.push({
          asset: symbol,
          amount: negateDecimalString(normalizeDecimalString(formatUnits(row.borrowBalanceCurrent, decimals))),
          scope: "defi",
          accountType: "venus_borrow",
          breakdown: {
            protocol: "Venus",
            chain: "bsc",
            address,
            positionType: "borrow",
            comptroller: result.comptroller,
            market: market.symbol,
            pool: result.poolLabel,
            vTokenAddress: market.address,
            resolver: "venus",
          },
        });
      }
    }

    if (!poolHasPosition) {
      continue;
    }

    try {
      const rewardRows =
        result.comptroller.toLowerCase() === CORE_COMPTROLLER.toLowerCase()
          ? [await callLens(venusLensInterface, rpcUrl, VENUS_LENS, "pendingRewards", [address, result.comptroller])]
          : await callLens(poolLensInterface, rpcUrl, POOL_LENS, "getPendingRewards", [address, result.comptroller]);

      for (const reward of rewardRows) {
        const rewardToken = String(reward.rewardTokenAddress || "").toLowerCase();
        if (!rewardToken || reward.totalRewards <= 0n) continue;

        const tokenInfo = await fetchErc20Info(rpcUrl, reward.rewardTokenAddress).catch(() => ({
          symbol: abbreviateAddress(reward.rewardTokenAddress),
          decimals: 18,
        }));

        holdings.push({
          asset: tokenInfo.symbol.toUpperCase(),
          amount: normalizeDecimalString(formatUnits(reward.totalRewards, tokenInfo.decimals)),
          scope: "defi",
          accountType: "venus_reward",
          breakdown: {
            protocol: "Venus",
            chain: "bsc",
            address,
            positionType: "reward",
            comptroller: result.comptroller,
            pool: result.poolLabel,
            rewardTokenAddress: reward.rewardTokenAddress,
            resolver: "venus",
          },
        });
      }
    } catch (error) {
      errors.push({ scope: `${result.poolLabel} rewards`, message: error.message });
    }

    succeeded.push(result.poolLabel);
  }

  const consolidatedBalances = consolidateHoldings(holdings);

  return {
    exchange: "defi",
    accountLabel: position.protocol || "Venus",
    accountOwnerLabel: position.ownerAccountLabel || position.protocol || "Venus",
    accountOwnerExchange: position.ownerExchange || "defi",
    collectedAt: new Date().toISOString(),
    scopesRequested: [...grouped.keys()].map((comptroller) => normalizePoolLabel(grouped.get(comptroller)[0], comptroller)),
    scopesSucceeded: succeeded,
    scopesFailed: errors.map((item) => item.scope),
    holdings,
    consolidatedBalances,
    summary: {
      totalHoldingRows: holdings.length,
      nonZeroAssets: consolidatedBalances.length,
      scopeAssetCounts: Object.fromEntries(
        succeeded.map((scope) => [scope, holdings.filter((item) => item.breakdown.pool === scope).length]),
      ),
    },
    errors,
    defi: {
      protocol: "Venus",
      chain: "bsc",
      address,
      resolver: "venus",
    },
  };
}

async function fetchAllVenusMarkets() {
  const limit = 120;
  const url = `${VENUS_API}/markets?chainId=56&limit=${limit}`;
  const { stdout } = await execFileAsync("curl", ["-sS", "--max-time", "30", url], {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  const payload = stdout ? JSON.parse(stdout) : null;
  return Array.isArray(payload.result) ? payload.result : [];
}

function groupByComptroller(markets) {
  const grouped = new Map();
  for (const market of markets) {
    if (!market.address || !market.poolComptrollerAddress) continue;
    const key = String(market.poolComptrollerAddress);
    const rows = grouped.get(key) || [];
    rows.push(market);
    grouped.set(key, rows);
  }
  return grouped;
}

function normalizeUnderlyingSymbol(market) {
  if (market.underlyingSymbol) return String(market.underlyingSymbol).toUpperCase();
  if (String(market.symbol || "").toUpperCase() === "VBNB") return "BNB";
  if (String(market.symbol || "").toUpperCase() === "VCAN") return "CAN";
  return String(market.symbol || "").replace(/^v/i, "").toUpperCase();
}

function normalizePoolLabel(market, comptroller) {
  if (String(comptroller).toLowerCase() === CORE_COMPTROLLER.toLowerCase()) {
    return "Venus Core Pool";
  }

  const raw = String(market.pool?.name || market.poolName || market.category || "").trim();
  return raw || `Venus Pool ${String(comptroller).slice(0, 6)}`;
}

async function fetchErc20Info(rpcUrl, address) {
  const [symbol, decimals] = await Promise.all([
    callContract(erc20Interface, rpcUrl, address, "symbol", []),
    callContract(erc20Interface, rpcUrl, address, "decimals", []),
  ]);
  return {
    symbol: String(symbol || ""),
    decimals: Number(decimals || 18),
  };
}

async function callLens(iface, rpcUrl, to, method, args) {
  const result = await callContract(iface, rpcUrl, to, method, args);
  return Array.isArray(result) ? result : [result];
}

async function callContract(iface, rpcUrl, to, method, args) {
  const data = iface.encodeFunctionData(method, args);
  const result = await rpcCall(rpcUrl, to, data);
  const decoded = iface.decodeFunctionResult(method, result);
  return decoded.length === 1 ? decoded[0] : decoded;
}

async function rpcCall(rpcUrl, to, data) {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [
      {
        to,
        data,
      },
      "latest",
    ],
  });

  const { stdout } = await execFileAsync(
    "curl",
    ["-sS", "--max-time", "20", "-X", "POST", "-H", "Content-Type: application/json", "--data", payload, rpcUrl],
    {
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  const response = stdout ? JSON.parse(stdout) : null;
  if (!response || response.error) {
    throw new Error(response?.error?.message || "Venus RPC 请求失败");
  }
  return response.result;
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
  const normalized = normalizeDecimalString(value);
  if (normalized === "0") return "0";
  return normalized.startsWith("-") ? normalized.slice(1) : `-${normalized}`;
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

function abbreviateAddress(address) {
  const value = String(address || "");
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

module.exports = {
  collectVenusSnapshot,
};
