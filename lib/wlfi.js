const { Interface } = require("ethers");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const ETH_RPC_URL = "https://1rpc.io/eth";
const WLFI_TOKEN_ADDRESS = "0xda5e1988097297dcdc1f90d4dfe7909e847cbef6";
const WLFI_UNLOCK_PROXY = "0x74b4f6a2e579d730aacb9dd23cfbbaeb95029583";
const WLFI_UNLOCK_IMPLEMENTATION_SLOT =
  "0x360894A13BA1A3210667C828492DB98DCA3E2076CC3735A920A3CA505D382BBC";

const VESTER_ABI = new Interface([
  "function WLFI() view returns (address)",
  "function allocation(address) view returns (uint256)",
  "function claimable(address) view returns (uint256)",
  "function claimed(address) view returns (uint256)",
  "function unclaimed(address) view returns (uint256)",
]);

async function collectWlfiUnlockSnapshot(position) {
  const address = normalizeEvmAddress(position.address);
  const rpcUrl = String(position.rpcUrl || "").trim() || ETH_RPC_URL;
  const [implementation, wlfiAddress, allocation, claimed, claimable, unclaimed] = await Promise.all([
    getImplementationAddress(rpcUrl, WLFI_UNLOCK_PROXY),
    callView(rpcUrl, WLFI_UNLOCK_PROXY, "WLFI", []),
    callView(rpcUrl, WLFI_UNLOCK_PROXY, "allocation", [address]),
    callView(rpcUrl, WLFI_UNLOCK_PROXY, "claimed", [address]),
    callView(rpcUrl, WLFI_UNLOCK_PROXY, "claimable", [address]),
    callView(rpcUrl, WLFI_UNLOCK_PROXY, "unclaimed", [address]),
  ]);

  const normalizedWlfi = normalizeEvmAddress(wlfiAddress);
  if (normalizedWlfi !== WLFI_TOKEN_ADDRESS) {
    throw new Error(`WLFI Unlock 合约返回了未知的 WLFI 地址: ${wlfiAddress}`);
  }

  const holdings = [];
  const allocationAmount = formatUnits(allocation);
  const claimedAmount = formatUnits(claimed);
  const claimableAmount = formatUnits(claimable);
  const unclaimedAmount = formatUnits(unclaimed);

  if (!isZeroDecimal(unclaimedAmount)) {
    holdings.push({
      asset: "WLFI",
      amount: unclaimedAmount,
      scope: "wlfi_unlock",
      accountType: "wlfi_locked",
      breakdown: {
        chain: "ethereum",
        address,
        assetType: "locked_token",
        protocol: "WLFI Unlock",
        tokenAddress: WLFI_TOKEN_ADDRESS,
        unlockContract: WLFI_UNLOCK_PROXY,
        allocation: allocationAmount,
        claimed: claimedAmount,
        claimable: claimableAmount,
        unclaimed: unclaimedAmount,
      },
    });
  }

  return {
    exchange: "defi",
    accountLabel: position.protocol || "WLFI Unlock",
    accountOwnerLabel: position.ownerAccountLabel || position.address,
    accountOwnerExchange: position.ownerExchange || "wallet",
    collectedAt: new Date().toISOString(),
    scopesRequested: ["wlfi_unlock"],
    scopesSucceeded: ["wlfi_unlock"],
    scopesFailed: [],
    holdings,
    consolidatedBalances: consolidateHoldings(holdings),
    summary: {
      totalHoldingRows: holdings.length,
      nonZeroAssets: holdings.length,
      scopeAssetCounts: {
        wlfi_unlock: holdings.length,
      },
    },
    errors: [],
    defi: {
      protocol: "WLFI Unlock",
      chain: "ethereum",
      address,
      resolver: "wlfi_unlock",
      unlockContract: WLFI_UNLOCK_PROXY,
      implementation,
      wlfiToken: WLFI_TOKEN_ADDRESS,
      allocation: allocationAmount,
      claimed: claimedAmount,
      claimable: claimableAmount,
      unclaimed: unclaimedAmount,
    },
  };
}

async function getImplementationAddress(rpcUrl, contractAddress) {
  const raw = await rpcRequest(rpcUrl, "eth_getStorageAt", [
    contractAddress,
    WLFI_UNLOCK_IMPLEMENTATION_SLOT,
    "latest",
  ]);
  return `0x${String(raw || "0x").slice(-40)}`.toLowerCase();
}

async function callView(rpcUrl, contractAddress, method, args) {
  const data = VESTER_ABI.encodeFunctionData(method, args);
  const raw = await rpcRequest(rpcUrl, "eth_call", [{ to: contractAddress, data }, "latest"]);
  const [value] = VESTER_ABI.decodeFunctionResult(method, raw);
  return value;
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
        : "WLFI Unlock RPC 请求失败";
    throw new Error(`${method} 请求失败: ${detail}`);
  }

  return payload.result;
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

function formatUnits(value, decimals = 18) {
  return formatDecimal(value, decimals);
}

function isZeroDecimal(value) {
  return formatDecimal(parseDecimal(value).value, parseDecimal(value).scale) === "0";
}

function normalizeEvmAddress(address) {
  const value = String(address || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`无效的 EVM 地址: ${address}`);
  }
  return value.toLowerCase();
}

module.exports = {
  collectWlfiUnlockSnapshot,
  WLFI_TOKEN_ADDRESS,
  WLFI_UNLOCK_PROXY,
};
