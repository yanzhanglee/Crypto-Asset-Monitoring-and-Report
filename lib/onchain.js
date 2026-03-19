const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const EVM_CHAINS = {
  ethereum: {
    rpcUrl: "https://1rpc.io/eth",
    nativeSymbol: "ETH",
  },
  arbitrum: {
    rpcUrl: "https://1rpc.io/arb",
    nativeSymbol: "ETH",
  },
  base: {
    rpcUrl: "https://1rpc.io/base",
    nativeSymbol: "ETH",
  },
  optimism: {
    rpcUrl: "https://1rpc.io/op",
    nativeSymbol: "ETH",
  },
  bsc: {
    rpcUrl: "https://bsc-dataseed.binance.org",
    nativeSymbol: "BNB",
  },
  polygon: {
    rpcUrl: "https://1rpc.io/matic",
    nativeSymbol: "POL",
  },
  worldchain: {
    rpcUrl: "https://worldchain-mainnet.g.alchemy.com/public",
    nativeSymbol: "ETH",
  },
  xlayer: {
    rpcUrl: "https://rpc.xlayer.tech",
    nativeSymbol: "OKB",
  },
};
const ALL_EVM_CHAINS = Object.keys(EVM_CHAINS);
const DEFAULT_ERC20_CONTRACTS = {
  ethereum: [
    {
      symbol: "USDT",
      address: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    },
    {
      symbol: "USDC",
      address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    },
    {
      symbol: "USDS",
      address: "0xdc035d45d973e3ec169d2276ddab16f1e407384f",
    },
    {
      symbol: "WBTC",
      address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
    },
    {
      symbol: "WETH",
      address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    },
    {
      symbol: "WLFI",
      address: "0xda5e1988097297dcdc1f90d4dfe7909e847cbef6",
    },
  ],
  bsc: [
    {
      symbol: "USDT",
      address: "0x55d398326f99059ff775485246999027b3197955",
    },
    {
      symbol: "USDC",
      address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    },
    {
      symbol: "FDUSD",
      address: "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409",
    },
    {
      symbol: "WBNB",
      address: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    },
    {
      symbol: "BTCB",
      address: "0x7130d2a12b9bcbaed4f2634d864a1ee1ce3ead9c",
    },
    {
      symbol: "ETH",
      address: "0x2170ed0880ac9a755fd29b2688956bd959f933f8",
    },
    {
      symbol: "CAKE",
      address: "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82",
    },
  ],
  base: [
    {
      symbol: "USDC",
      address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    },
    {
      symbol: "USDT",
      address: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
    },
    {
      symbol: "WETH",
      address: "0x4200000000000000000000000000000000000006",
    },
    {
      symbol: "cbBTC",
      address: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
    },
    {
      symbol: "AERO",
      address: "0x940181a94a35a4569e4529a3cdfb74e38fd98631",
    },
  ],
  xlayer: [
    {
      symbol: "USDG",
      address: "0x4ae46a509f6b1d9056937ba4500cb143933d2dc8",
    },
  ],
  worldchain: [
    {
      symbol: "WLD",
      address: "0x2cfc85d8e48f8eab294be644d9e25c3030863003",
    },
  ],
};
const TRUSTED_TOKEN_CONTRACTS = {
  ethereum: {
    WLFI: "0xda5e1988097297dcdc1f90d4dfe7909e847cbef6",
  },
};

async function collectWalletSnapshot(wallet) {
  const providers = wallet.providers || {};
  const chain = String(wallet.chain || "").toLowerCase();
  const address = String(wallet.address || "").trim();

  if (!address) {
    throw new Error("链上钱包地址不能为空。");
  }

  if (chain && chain !== "all_evm" && !EVM_CHAINS[chain]) {
    throw new Error(`暂不支持的链上钱包类型: ${chain || "unknown"}`);
  }

  return collectEvmWalletSnapshot({
    ...wallet,
    providers,
    chain: chain || "all_evm",
    address,
  });
}

async function collectEvmWalletSnapshot(wallet) {
  const chainsToScan = getChainsToScan(wallet.chain);
  const chainResults = await Promise.all(
    chainsToScan.map(async (chain) => {
      try {
        return await collectSingleEvmChainSnapshot({ ...wallet, chain });
      } catch (error) {
        return {
          chain,
          scopesRequested: ["native", "erc20"],
          scopesSucceeded: [],
          scopesFailed: [chain],
          holdings: [],
          errors: [{ scope: chain, message: error.message }],
        };
      }
    }),
  );

  const holdings = chainResults.flatMap((item) => item.holdings);
  const consolidatedBalances = consolidateHoldings(holdings);
  const errors = chainResults.flatMap((item) => item.errors);

  return {
    exchange: "wallet",
    accountLabel: wallet.label || "EVM Wallet",
    collectedAt: new Date().toISOString(),
    scopesRequested: chainsToScan,
    scopesSucceeded: chainResults.filter((item) => item.holdings.length > 0).map((item) => item.chain),
    scopesFailed: [...new Set(errors.map((item) => item.scope))],
    holdings,
    consolidatedBalances,
    summary: {
      totalHoldingRows: holdings.length,
      nonZeroAssets: consolidatedBalances.length,
      scopeAssetCounts: Object.fromEntries(chainResults.map((item) => [item.chain, item.holdings.length])),
    },
    errors,
    wallet: {
      chain: "all_evm",
      chainsScanned: chainsToScan,
      address: wallet.address,
      rpcUrl: String(wallet.rpcUrl || "").trim(),
      tags: wallet.tags || "",
    },
  };
}

async function collectSingleEvmChainSnapshot(wallet) {
  const chainMeta = EVM_CHAINS[wallet.chain];
  const rpcUrl = String(wallet.rpcUrl || "").trim() || chainMeta.rpcUrl;
  const tokenContracts = parseTokenContracts(wallet.tokenContracts, wallet.chain);
  const scopes = determineWalletScopes(wallet, tokenContracts);

  if (wallet.providers.alchemyApiKey && supportsAlchemy(wallet.chain)) {
    const snapshot = await collectAlchemyWalletSnapshot(
      {
        ...wallet,
        chain: wallet.chain,
        rpcUrl,
      },
      scopes,
    );

    return {
      chain: wallet.chain,
      scopesRequested: scopes,
      scopesSucceeded: snapshot.scopesSucceeded || [],
      scopesFailed: snapshot.scopesFailed || [],
      holdings: snapshot.holdings || [],
      errors: (snapshot.errors || []).map((item) => ({
        scope: `${wallet.chain}:${item.scope}`,
        message: item.message,
      })),
    };
  }

  const results = [];
  const errors = [];

  if (scopes.includes("native")) {
    try {
      results.push(await fetchNativeBalance({ rpcUrl, address: wallet.address, chain: wallet.chain }));
    } catch (error) {
      errors.push({ scope: `${wallet.chain}:native`, message: error.message });
    }
  }

  if (scopes.includes("erc20")) {
    try {
      results.push(
        await fetchErc20Balances({
          rpcUrl,
          address: wallet.address,
          chain: wallet.chain,
          tokenContracts,
        }),
      );
    } catch (error) {
      errors.push({ scope: `${wallet.chain}:erc20`, message: error.message });
    }
  }

  return {
    chain: wallet.chain,
    scopesRequested: scopes,
    scopesSucceeded: results.map((item) => `${wallet.chain}:${item.scope}`),
    scopesFailed: errors.map((item) => item.scope),
    holdings: results.flatMap((item) => item.holdings),
    errors,
  };
}

function getChainsToScan(chain) {
  const value = String(chain || "").toLowerCase();
  if (!value || value === "all_evm") {
    return ALL_EVM_CHAINS;
  }
  return EVM_CHAINS[value] ? ALL_EVM_CHAINS : ALL_EVM_CHAINS;
}

async function collectAlchemyWalletSnapshot(wallet, scopes) {
  const network = getAlchemyNetwork(wallet.chain);
  const baseUrl = `https://${network}.g.alchemy.com/v2/${wallet.providers.alchemyApiKey}`;
  const holdings = [];
  const errors = [];
  const succeeded = [];

  if (scopes.includes("native")) {
    try {
      const result = await alchemyRpc(baseUrl, "eth_getBalance", [wallet.address, "latest"]);
      const amount = formatUnits(hexToBigInt(result), 18);
      if (!isZeroDecimal(amount)) {
        holdings.push({
          asset: EVM_CHAINS[wallet.chain].nativeSymbol,
          amount,
          scope: "native",
          accountType: `${wallet.chain}_native`,
          breakdown: {
            chain: wallet.chain,
            address: wallet.address,
            assetType: "native",
            provider: "alchemy",
          },
        });
      }
      succeeded.push("native");
    } catch (error) {
      errors.push({ scope: "native", message: error.message });
    }
  }

  if (scopes.includes("erc20")) {
    try {
      const tokenPayload = await alchemyRpc(baseUrl, "alchemy_getTokenBalances", [wallet.address, "erc20"]);
      const tokenRows = tokenPayload && Array.isArray(tokenPayload.tokenBalances) ? tokenPayload.tokenBalances : [];

      for (const item of tokenRows) {
        const balanceHex = item.tokenBalance || "0x0";
        const balance = hexToBigInt(balanceHex);
        if (balance === 0n) continue;

        const metadata = await alchemyRpc(baseUrl, "alchemy_getTokenMetadata", [item.contractAddress]);
        const decimals = Number(metadata?.decimals ?? 18) || 18;
        const symbol = String(metadata?.symbol || item.contractAddress || "").toUpperCase();
        if (!isTrustedTokenContract(wallet.chain, symbol, item.contractAddress)) continue;
        const amount = formatUnits(balance, decimals);
        if (isZeroDecimal(amount)) continue;

        holdings.push({
          asset: symbol,
          amount,
          scope: "erc20",
          accountType: `${wallet.chain}_erc20`,
          breakdown: {
            chain: wallet.chain,
            address: wallet.address,
            assetType: "erc20",
            contractAddress: String(item.contractAddress || "").toLowerCase(),
            decimals,
            provider: "alchemy",
          },
        });
      }

      succeeded.push("erc20");
    } catch (error) {
      errors.push({ scope: "erc20", message: error.message });
    }
  }

  const consolidatedBalances = consolidateHoldings(holdings);

  return {
    exchange: "wallet",
    accountLabel: wallet.label || `${EVM_CHAINS[wallet.chain].nativeSymbol} Wallet`,
    collectedAt: new Date().toISOString(),
    scopesRequested: scopes,
    scopesSucceeded: succeeded,
    scopesFailed: errors.map((item) => item.scope),
    holdings,
    consolidatedBalances,
    summary: {
      totalHoldingRows: holdings.length,
      nonZeroAssets: consolidatedBalances.length,
      scopeAssetCounts: Object.fromEntries(succeeded.map((scope) => [scope, holdings.filter((x) => x.scope === scope).length])),
    },
    errors,
    wallet: {
      chain: wallet.chain,
      address: wallet.address,
      provider: "alchemy",
    },
  };
}

function determineWalletScopes(wallet, tokenContracts) {
  const scopes = ["native"];
  if ((wallet.providers.alchemyApiKey && supportsAlchemy(wallet.chain)) || tokenContracts.length > 0) {
    scopes.push("erc20");
  }
  return scopes;
}

function parseTokenContracts(input, chain) {
  const values = String(input || "")
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const defaults = DEFAULT_ERC20_CONTRACTS[String(chain || "").toLowerCase()] || [];

  const seen = new Set();
  const entries = [];

  for (const item of defaults) {
    const address = normalizeEvmAddress(item.address);
    if (seen.has(address)) continue;
    seen.add(address);
    entries.push({
      address,
      symbol: String(item.symbol || "").trim().toUpperCase(),
    });
  }

  for (const value of values) {
    const [maybeSymbol, maybeAddress] = value.includes(":") ? value.split(":", 2) : [null, value];
    const address = normalizeEvmAddress(maybeAddress || value);
    if (seen.has(address)) continue;
    seen.add(address);
    entries.push({
      address,
      symbol: maybeSymbol ? maybeSymbol.trim().toUpperCase() : "",
    });
  }

  return entries;
}

async function fetchNativeBalance({ rpcUrl, address, chain }) {
  const chainMeta = EVM_CHAINS[chain];
  const result = await rpcRequest(rpcUrl, "eth_getBalance", [address, "latest"]);
  const raw = hexToBigInt(result);
  const amount = formatUnits(raw, 18);

  return {
    scope: "native",
    holdings: isZeroDecimal(amount)
      ? []
      : [
          {
            asset: chainMeta.nativeSymbol,
            amount,
            scope: "native",
            accountType: `${chain}_native`,
            breakdown: {
              chain,
              address,
              assetType: "native",
            },
          },
        ],
  };
}

async function fetchErc20Balances({ rpcUrl, address, chain, tokenContracts }) {
  if (tokenContracts.length === 0) {
    return { scope: "erc20", holdings: [] };
  }

  const holdings = [];

  for (const contract of tokenContracts) {
    const normalized = contract.address;
    const balanceHex = await rpcRequest(rpcUrl, "eth_call", [
      {
        to: normalized,
        data: encodeBalanceOf(address),
      },
      "latest",
    ]);
    const balance = hexToBigInt(balanceHex);
    if (balance === 0n) continue;

    const [decimalsHex, symbolHex] = await Promise.all([
      rpcRequest(rpcUrl, "eth_call", [{ to: normalized, data: "0x313ce567" }, "latest"]).catch(() => "0x12"),
      rpcRequest(rpcUrl, "eth_call", [{ to: normalized, data: "0x95d89b41" }, "latest"]).catch(() => null),
    ]);

    const decimals = Number(hexToBigInt(decimalsHex || "0x12")) || 18;
    const symbol = contract.symbol || decodeSymbol(symbolHex) || abbreviateAddress(normalized);
    if (!isTrustedTokenContract(chain, symbol, normalized)) continue;
    const amount = formatUnits(balance, decimals);

    holdings.push({
      asset: symbol.toUpperCase(),
      amount,
      scope: "erc20",
      accountType: `${chain}_erc20`,
      breakdown: {
        chain,
        address,
        assetType: "erc20",
        contractAddress: normalized,
        decimals,
      },
    });
  }

  return { scope: "erc20", holdings };
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
        : "链上 RPC 请求失败";
    throw new Error(`${method} 请求失败: ${detail}`);
  }

  return payload.result;
}

async function alchemyRpc(baseUrl, method, params) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  });

  const { stdout } = await execFileAsync(
    "curl",
    ["-sS", "--max-time", "20", "-X", "POST", "-H", "Content-Type: application/json", "--data", body, baseUrl],
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
        : "Alchemy 请求失败";
    throw new Error(`${method} 请求失败: ${detail}`);
  }

  return payload.result;
}

function encodeBalanceOf(address) {
  const normalized = normalizeEvmAddress(address).slice(2).padStart(64, "0");
  return `0x70a08231${normalized}`;
}

function normalizeEvmAddress(address) {
  const value = String(address || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`无效的 EVM 地址: ${address}`);
  }
  return value.toLowerCase();
}

function decodeSymbol(hex) {
  if (!hex || hex === "0x") return null;

  if (hex.length === 66) {
    return Buffer.from(hex.slice(2), "hex").toString("utf8").replace(/\0/g, "").trim() || null;
  }

  if (hex.length >= 194) {
    const length = Number.parseInt(hex.slice(66, 130), 16);
    if (!Number.isFinite(length) || length <= 0) return null;
    const data = hex.slice(130, 130 + length * 2);
    return Buffer.from(data, "hex").toString("utf8").replace(/\0/g, "").trim() || null;
  }

  return null;
}

function supportsAlchemy(chain) {
  return Boolean(getAlchemyNetwork(chain));
}

function getAlchemyNetwork(chain) {
  const map = {
    ethereum: "eth-mainnet",
    arbitrum: "arb-mainnet",
    base: "base-mainnet",
    optimism: "opt-mainnet",
    polygon: "polygon-mainnet",
  };
  return map[String(chain || "").toLowerCase()] || "";
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

function isZeroDecimal(value) {
  return normalizeDecimalString(value) === "0";
}

function normalizeDecimalString(value) {
  const parsed = parseDecimal(value);
  return formatDecimal(parsed.value, parsed.scale);
}

function hexToBigInt(value) {
  const raw = String(value || "0x0");
  if (raw === "0x") return 0n;
  return BigInt(raw);
}

function formatUnits(value, decimals) {
  return formatDecimal(value, decimals);
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
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function isTrustedTokenContract(chain, symbol, contractAddress) {
  const trusted = TRUSTED_TOKEN_CONTRACTS[String(chain || "").toLowerCase()];
  if (!trusted) return true;
  const expected = trusted[String(symbol || "").toUpperCase()];
  if (!expected) return true;
  return String(contractAddress || "").toLowerCase() === expected.toLowerCase();
}

module.exports = {
  collectWalletSnapshot,
};
