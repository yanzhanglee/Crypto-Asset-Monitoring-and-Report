const STORAGE_KEY = "crypto-asset-tracker-config";
const SNAPSHOT_STORAGE_KEY = "crypto-asset-tracker-last-snapshot";
const PRIVACY_MODE_STORAGE_KEY = "crypto-asset-tracker-privacy-mode";
const DEFAULT_STABLECOIN_SYMBOLS =
  "USDT,USDC,BUSD,FDUSD,USDP,TUSD,USDS,USDG,DAI,PYUSD,USDE,USD1,RLUSD,GHO,FRAX,FRXUSD,LUSD,CRVUSD,USD0,USDT0,SUSDS";
const ASSET_LOGO_URL_OVERRIDES = {
  USD1: "https://coin-images.coingecko.com/coins/images/54977/thumb/USD1_1000x1000_transparent.png",
  USDG: "https://coin-images.coingecko.com/coins/images/51281/thumb/GDN_USDG_Token_200x200.png",
  HYPE: "https://coin-images.coingecko.com/coins/images/50882/thumb/hyperliquid.jpg",
  OKB: "https://coin-images.coingecko.com/coins/images/4463/thumb/WeChat_Image_20220118095654.png",
  BGB: "https://coin-images.coingecko.com/coins/images/11610/thumb/Bitget_logo.png",
  WLD: "https://coin-images.coingecko.com/coins/images/31069/thumb/worldcoin.jpeg",
  OPN: "https://coin-images.coingecko.com/coins/images/36612/thumb/TOKEN.png",
};
const ASSET_LOGO_SLUG_OVERRIDES = {
  BTCB: "btc",
  WBTC: "btc",
  ETH: "eth",
  WETH: "eth",
  WBETH: "eth",
  BNB: "bnb",
  WBNB: "bnb",
  BTC: "btc",
  OKB: "okb",
  BGB: "bgb",
  WLD: "wld",
  USDT0: "usdt",
  USD0: "usd",
};

const defaultConfig = {
  version: "v1",
  meta: {
    alchemyApiKey: "",
    zerionApiKey: "",
    notionToken: "",
    obsidianVaultPath: "",
    obsidianRootDir: "NetWorth",
    notionSummaryDatabaseId: "",
    notionAccountDatabaseId: "",
    notionAssetDatabaseId: "",
    notionSummaryTemplateId: "",
  },
  cexAccounts: [
    {
      label: "币安主账户",
      exchange: "binance",
      apiKey: "",
      apiSecret: "",
      passphrase: "",
      accountScope:
        "spot,funding,simple_earn_flexible,simple_earn_locked,cross_margin,isolated_margin,um_futures,cm_futures,subaccount_spot,subaccount_margin,subaccount_um_futures,subaccount_cm_futures",
      recvWindow: "10000",
      environment: "production",
    },
  ],
  wallets: [],
  defiPositions: [],
  validation: {
    minBalanceThreshold: "0",
    ignoredTokens: "NFT,DUST",
    focusAssets: "BTC,ETH,SOL,USDT,BNB",
    stablecoinSymbols: DEFAULT_STABLECOIN_SYMBOLS,
    referenceCost: "",
    targetProfit: "",
  },
  updatedAt: null,
};

const EXCHANGE_DEFAULTS = {
  binance: {
    accountScope:
      "spot,funding,simple_earn_flexible,simple_earn_locked,cross_margin,isolated_margin,um_futures,cm_futures,subaccount_spot,subaccount_margin,subaccount_um_futures,subaccount_cm_futures",
    passphrase: "",
    environment: "production",
  },
  bitget: {
    accountScope: "spot,futures,cross_margin,savings_flexible,savings_fixed,overview",
    passphrase: "",
    environment: "production",
  },
  okx: {
    accountScope: "trading,funding,savings,overview",
    passphrase: "",
    environment: "production",
  },
};

const EXCHANGE_SCOPE_OPTIONS = {
  binance: [
    { value: "spot", label: "现货账户" },
    { value: "funding", label: "资金账户" },
    { value: "simple_earn_flexible", label: "活期理财" },
    { value: "simple_earn_locked", label: "定期理财" },
    { value: "cross_margin", label: "全仓杠杆" },
    { value: "isolated_margin", label: "逐仓杠杆" },
    { value: "um_futures", label: "U 本位合约" },
    { value: "cm_futures", label: "币本位合约" },
    { value: "subaccount_spot", label: "子账户现货" },
    { value: "subaccount_margin", label: "子账户杠杆" },
    { value: "subaccount_um_futures", label: "子账户 U 本位合约" },
    { value: "subaccount_cm_futures", label: "子账户币本位合约" },
  ],
  bitget: [
    { value: "spot", label: "现货账户" },
    { value: "funding", label: "资金账户" },
    { value: "futures", label: "合约账户" },
    { value: "cross_margin", label: "全仓杠杆" },
    { value: "savings_flexible", label: "活期理财" },
    { value: "savings_fixed", label: "定期理财" },
    { value: "overview", label: "账户总览" },
  ],
  okx: [
    { value: "trading", label: "交易账户" },
    { value: "funding", label: "资金账户" },
    { value: "savings", label: "余币宝/理财" },
    { value: "overview", label: "账户总览" },
  ],
};

const state = loadConfig();

const metaForm = document.querySelector("#meta-form");
const validationForm = document.querySelector("#validation-form");
const cexList = document.querySelector("#cex-list");
const walletList = document.querySelector("#wallet-list");
const preview = document.querySelector("#config-preview");
const resultPreview = document.querySelector("#result-preview");
const runStatus = document.querySelector("#run-status");
const dashboardEmpty = document.querySelector("#dashboard-empty");
const dashboardContent = document.querySelector("#dashboard-content");
const totalCards = document.querySelector("#total-cards");
const assetChart = document.querySelector("#asset-chart");
const assetChartLegend = document.querySelector("#asset-chart-legend");
const accountChart = document.querySelector("#account-chart");
const accountChartLegend = document.querySelector("#account-chart-legend");
const assetTableBody = document.querySelector("#asset-table-body");
const accountCards = document.querySelector("#account-cards");
const accountViewToggle = document.querySelector("#account-view-toggle");
const accountViewHint = document.querySelector("#account-view-hint");
const tabButtons = Array.from(document.querySelectorAll("[data-tab-target]"));
const tabPanels = Array.from(document.querySelectorAll("[data-tab-panel]"));
const lastRunAt = document.querySelector("#last-run-at");
const toast = document.querySelector("#toast");
let toastTimer = null;
let progressHintTimer = null;
let showAllAccounts = false;
let fxState = {
  usdCny: null,
  asOf: null,
};
let privacyMode = loadPrivacyMode();

initialize();

function initialize() {
  hydrateForm(metaForm, state.meta);
  hydrateForm(validationForm, state.validation);
  renderCollection("cex", state.cexAccounts, cexList, "#cex-template");
  renderCollection("wallet", state.wallets, walletList, "#wallet-template");
  bindTopLevelEvents();
  setActiveTab("stats");
  hydrateLastSnapshot();
  hydrateFxRate();
  syncView();
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultConfig);
    return mergeConfig(JSON.parse(raw));
  } catch {
    return structuredClone(defaultConfig);
  }
}

function mergeConfig(input) {
  const cexAccounts = Array.isArray(input.cexAccounts) ? input.cexAccounts.map(normalizeCexAccount) : [];
  const wallets = Array.isArray(input.wallets) ? input.wallets.map(normalizeWallet) : [];
  const validationInput = { ...(input.validation || {}) };
  if (!String(validationInput.stablecoinSymbols || "").trim()) {
    validationInput.stablecoinSymbols = DEFAULT_STABLECOIN_SYMBOLS;
  }
  return {
    ...structuredClone(defaultConfig),
    ...input,
    meta: { ...defaultConfig.meta, ...(input.meta || {}) },
    validation: { ...defaultConfig.validation, ...validationInput },
    cexAccounts,
    wallets,
    defiPositions: [],
  };
}

function normalizeCexAccount(account) {
  const exchange = String(account.exchange || "binance").toLowerCase();
  const defaults = EXCHANGE_DEFAULTS[exchange] || EXCHANGE_DEFAULTS.binance;
  const next = {
    ...account,
    exchange,
    environment: account.environment || defaults.environment,
  };

  if (!account.accountScope || looksMismatchedScope(exchange, String(account.accountScope || ""))) {
    next.accountScope = defaults.accountScope;
  }

  if (exchange === "binance") {
    next.passphrase = "";
  }

  return next;
}

function normalizeWallet(wallet) {
  return {
    label: wallet.label || "",
    chain: inferWalletChain(wallet),
    address: wallet.address || "",
    assetScope: "auto",
    rpcUrl: wallet.rpcUrl || "",
    tokenContracts: wallet.tokenContracts || "",
  };
}

function inferWalletChain(wallet) {
  const explicit = String(wallet.chain || "").trim().toLowerCase();
  if (["bitcoin", "solana", "tron"].includes(explicit)) return explicit;
  return "all_evm";
}

function looksMismatchedScope(exchange, scopeText) {
  const scope = String(scopeText || "");
  if (!scope) return true;
  if (exchange === "bitget" || exchange === "okx") {
    return scope.includes("simple_earn") || scope.includes("subaccount_") || scope.includes("cross_margin");
  }
  if (exchange === "binance") {
    return scope.includes("trading") || scope.includes("overview");
  }
  return false;
}

function hydrateForm(form, values) {
  hydrateFormValues(form, values);
  form.addEventListener("input", () => {
    const target = form === metaForm ? state.meta : state.validation;
    Object.keys(target).forEach((key) => {
      const input = form.elements.namedItem(key);
      if (input) target[key] = input.value;
    });
    syncView();
  });
}

function hydrateFormValues(form, values) {
  Object.entries(values).forEach(([key, value]) => {
    const input = form.elements.namedItem(key);
    if (input) input.value = value ?? "";
  });
}

function renderCollection(type, items, container, templateSelector) {
  container.innerHTML = "";

  items.forEach((item, index) => {
    const template = document.querySelector(templateSelector);
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".card");

    card.querySelectorAll("[data-field]").forEach((field) => {
      const key = field.dataset.field;
      if (key === "accountScopeOptions") {
        renderScopePicker(field, items[index]);
        return;
      }

      field.value = item[key] ?? "";
      field.addEventListener("input", (event) => {
        items[index][key] = event.target.value;
        if (key === "exchange") {
          Object.assign(items[index], applyExchangeDefaults(items[index]));
          renderAllCollections();
        }
        syncView();
      });
    });

    card.querySelector(".remove-item").addEventListener("click", () => {
      items.splice(index, 1);
      renderAllCollections();
      syncView();
    });

    container.appendChild(fragment);
  });
}

function renderAllCollections() {
  renderCollection("cex", state.cexAccounts, cexList, "#cex-template");
  renderCollection("wallet", state.wallets, walletList, "#wallet-template");
}

function bindTopLevelEvents() {
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.tabTarget || "config");
    });
  });

  document.querySelector("#add-cex").addEventListener("click", () => {
    state.cexAccounts.push({
      label: "",
      exchange: "binance",
      apiKey: "",
      apiSecret: "",
      passphrase: "",
      accountScope: EXCHANGE_DEFAULTS.binance.accountScope,
      recvWindow: "10000",
      environment: EXCHANGE_DEFAULTS.binance.environment,
    });
    renderAllCollections();
    syncView();
  });

  document.querySelector("#add-wallet").addEventListener("click", () => {
    state.wallets.push({
      label: "",
      chain: "all_evm",
      address: "",
      assetScope: "auto",
      rpcUrl: "",
      tokenContracts: "",
    });
    renderAllCollections();
    syncView();
  });

  document.querySelector("#save-config").addEventListener("click", saveConfig);
  document.querySelector("#refresh-stats").addEventListener("click", collectPortfolioSnapshot);
  document.querySelector("#toggle-privacy").addEventListener("click", togglePrivacyMode);
  document.querySelectorAll('[data-action="sync-notion"]').forEach((button) => {
    button.addEventListener("click", syncSnapshotToNotion);
  });
  document.querySelectorAll('[data-action="sync-obsidian"]').forEach((button) => {
    button.addEventListener("click", syncSnapshotToObsidian);
  });
  document.querySelectorAll("[data-collapse-toggle]").forEach((button) => {
    button.addEventListener("click", () => toggleCollapsiblePanel(button));
  });
  accountViewToggle?.addEventListener("click", () => {
    showAllAccounts = !showAllAccounts;
    const payload = readLastSnapshot();
    if (payload?.dashboard) {
      renderDashboard(payload.dashboard);
    }
  });
  document.querySelector("#export-config").addEventListener("click", exportConfig);
  document.querySelector("#import-config").addEventListener("change", importConfig);
  document.querySelector("#reset-config").addEventListener("click", resetConfig);
  document.querySelector("#collect-binance").addEventListener("click", collectPortfolioSnapshot);
}

function toggleCollapsiblePanel(button) {
  const panel = button.closest(".collapsible-panel");
  if (!panel) return;
  const collapsed = panel.classList.toggle("is-collapsed");
  button.textContent = collapsed ? "展开" : "收起";
  button.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function buildSnapshot() {
  return {
    version: state.version,
    meta: state.meta,
    cexAccounts: state.cexAccounts,
    wallets: state.wallets,
    defiPositions: [],
    validation: state.validation,
    updatedAt: state.updatedAt,
  };
}

function syncView() {
  const snapshot = buildSnapshot();
  preview.textContent = JSON.stringify(maskSecrets(snapshot), null, 2);
  syncPrivacyButton();
}

function maskSecrets(snapshot) {
  const clone = structuredClone(snapshot);
  clone.cexAccounts = clone.cexAccounts.map((account) => ({
    ...account,
    apiKey: maskValue(account.apiKey),
    apiSecret: maskValue(account.apiSecret),
    passphrase: maskValue(account.passphrase),
  }));
  clone.meta = {
    ...clone.meta,
    alchemyApiKey: maskValue(clone.meta.alchemyApiKey),
    zerionApiKey: maskValue(clone.meta.zerionApiKey),
    notionToken: maskValue(clone.meta.notionToken),
  };
  return clone;
}

function maskValue(value) {
  if (!value) return "";
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function saveConfig() {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(buildSnapshot()));
  syncView();
  setRunStatus("配置已保存到浏览器。", "default");
}

function exportConfig() {
  const blob = new Blob([JSON.stringify(buildSnapshot(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "crypto-asset-config.json";
  link.click();
  URL.revokeObjectURL(url);
}

function importConfig(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = mergeConfig(JSON.parse(String(reader.result)));
      Object.assign(state, imported);
      hydrateImportedState();
      syncView();
      setRunStatus("配置已导入。", "default");
    } catch {
      window.alert("JSON 解析失败，请检查配置文件格式。");
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
}

function hydrateImportedState() {
  hydrateFormValues(metaForm, state.meta);
  hydrateFormValues(validationForm, state.validation);
  state.cexAccounts = state.cexAccounts.map(normalizeCexAccount);
  state.wallets = state.wallets.map(normalizeWallet);
  state.defiPositions = [];
  renderAllCollections();
}

function resetConfig() {
  Object.assign(state, structuredClone(defaultConfig));
  localStorage.removeItem(STORAGE_KEY);
  hydrateImportedState();
  resultPreview.textContent = privacyMode ? buildMaskedJsonPlaceholder() : "尚未执行采集。";
  resetDashboard();
  syncView();
  setRunStatus("已恢复为示例配置。", "default");
}

async function collectPortfolioSnapshot() {
  setOperationLoading("collect", true);
  setRunStatus("正在采集交易所与链上钱包资产，请稍候。", "default");
  resultPreview.textContent = privacyMode ? "请求中...\n***" : "请求中...";
  showToast("正在刷新统计...", "default", 0);

  try {
    const response = await fetch("/api/binance/snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: buildSnapshot() }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "采集失败");
    }

    renderDashboard(payload.dashboard);
    hydrateFxRate();
    resultPreview.textContent = privacyMode ? buildMaskedJsonPlaceholder() : JSON.stringify(payload, null, 2);
    persistLastSnapshot(payload);
    const total = Array.isArray(payload.snapshots) ? payload.snapshots.length : 0;
    const errorSummary = payload.errorSummary || {};
    const coreErrors = Number(errorSummary.core?.count || 0);
    const supplementalErrors = Number(errorSummary.supplemental?.count || 0);
    setRunStatus(
      buildErrorSummaryStatus(total, coreErrors, supplementalErrors),
      coreErrors ? "error" : supplementalErrors ? "default" : "default",
    );
    showToast(
      buildErrorSummaryToast(coreErrors, supplementalErrors),
      coreErrors ? "error" : supplementalErrors ? "default" : "success",
      coreErrors || supplementalErrors ? 3800 : 2200,
    );
    lastRunAt.textContent = payload.collectedAt
      ? new Date(payload.collectedAt).toLocaleString("zh-CN", { hour12: false })
      : new Date().toLocaleString("zh-CN", { hour12: false });
    setActiveTab("stats");
  } catch (error) {
    resultPreview.textContent = privacyMode ? '{\n  "error": "***"\n}' : JSON.stringify({ error: error.message }, null, 2);
    setRunStatus(
      `采集失败：${error.message}。如果你是直接打开 HTML，请改用 node server.js 启动本地服务。`,
      "error",
    );
    showToast(`刷新失败：${error.message}`, "error");
  } finally {
    setOperationLoading("collect", false);
  }
}

async function syncSnapshotToNotion() {
  const latestSnapshot = readLastSnapshot();
  if (!latestSnapshot?.dashboard) {
    setRunStatus("请先执行一次“刷新统计”，再同步到 Notion。", "error");
    showToast("请先刷新统计，再同步 Notion", "error");
    return;
  }

  setOperationLoading("notion", true);
  setRunStatus("正在同步最新统计结果到 Notion，请稍候。", "default");
  showToast("正在同步到 Notion，过程可能需要十几秒...", "default", 0);
  startProgressHints("notion");

  try {
    const response = await fetch("/api/notion/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: buildSnapshot(), payload: latestSnapshot }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "同步失败");
    }

    renderDashboard(payload.dashboard);
    hydrateFxRate();
    resultPreview.textContent = privacyMode ? buildMaskedJsonPlaceholder() : JSON.stringify(payload, null, 2);
    persistLastSnapshot(payload);
    lastRunAt.textContent = payload.collectedAt
      ? new Date(payload.collectedAt).toLocaleString("zh-CN", { hour12: false })
      : new Date().toLocaleString("zh-CN", { hour12: false });

    const notionSummary = payload.notion?.summaryPageUrl
      ? `Notion 已更新：${payload.notion.accountRowsWritten} 个账户，${payload.notion.assetRowsWritten} 个币种。`
      : "Notion 已同步。";
    setRunStatus(notionSummary, "default");
    showToast(
      payload.notion?.summaryPageUrl
        ? `Notion 同步完成，已更新汇总页和 ${payload.notion.accountRowsWritten + payload.notion.assetRowsWritten} 条明细`
        : "Notion 同步完成",
      "success",
      4200,
    );
    setActiveTab("stats");
  } catch (error) {
    setRunStatus(`Notion 同步失败：${error.message}`, "error");
    showToast(`Notion 同步失败：${error.message}`, "error");
  } finally {
    stopProgressHints();
    setOperationLoading("notion", false);
  }
}

async function syncSnapshotToObsidian() {
  const latestSnapshot = readLastSnapshot();
  if (!latestSnapshot?.dashboard) {
    setRunStatus("请先执行一次“刷新统计”，再写入 Obsidian。", "error");
    showToast("请先刷新统计，再写入 Obsidian", "error");
    return;
  }

  setOperationLoading("obsidian", true);
  setRunStatus("正在写入最新统计结果到 Obsidian，请稍候。", "default");
  showToast("正在写入 Obsidian，本地 Markdown 正在生成...", "default", 0);
  startProgressHints("obsidian");

  try {
    const response = await fetch("/api/obsidian/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: buildSnapshot(), payload: latestSnapshot }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "写入失败");
    }

    renderDashboard(payload.dashboard);
    hydrateFxRate();
    resultPreview.textContent = privacyMode ? buildMaskedJsonPlaceholder() : JSON.stringify(payload, null, 2);
    persistLastSnapshot(payload);
    lastRunAt.textContent = payload.collectedAt
      ? new Date(payload.collectedAt).toLocaleString("zh-CN", { hour12: false })
      : new Date().toLocaleString("zh-CN", { hour12: false });

    const filePath = payload.obsidian?.filePath || "";
    setRunStatus(filePath ? `Obsidian 已写入：${filePath}` : "Obsidian 已写入。", "default");
    showToast("Obsidian 写入完成", "success", 3200);
    setActiveTab("stats");
  } catch (error) {
    setRunStatus(`Obsidian 写入失败：${error.message}`, "error");
    showToast(`Obsidian 写入失败：${error.message}`, "error");
  } finally {
    stopProgressHints();
    setOperationLoading("obsidian", false);
  }
}

function setActiveTab(tabName) {
  tabButtons.forEach((button) => {
    const active = button.dataset.tabTarget === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });

  tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.tabPanel === tabName);
  });
}

function setRunStatus(message, tone) {
  runStatus.textContent = message;
  runStatus.dataset.tone = tone;
}

function togglePrivacyMode() {
  privacyMode = !privacyMode;
  localStorage.setItem(PRIVACY_MODE_STORAGE_KEY, privacyMode ? "1" : "0");
  syncPrivacyButton();
  rehydrateSnapshotView();
  showToast(privacyMode ? "截图模式已开启" : "截图模式已关闭", "default");
}

function syncPrivacyButton() {
  const button = document.querySelector("#toggle-privacy");
  if (!button) return;
  button.textContent = privacyMode ? "显示数据" : "截图模式";
  button.classList.toggle("is-active", privacyMode);
}

function rehydrateSnapshotView() {
  const payload = readLastSnapshot();
  if (!payload) {
    resultPreview.textContent = privacyMode ? buildMaskedJsonPlaceholder() : "尚未执行采集。";
    return;
  }

  if (payload?.dashboard) {
    renderDashboard(payload.dashboard);
  }
  resultPreview.textContent = privacyMode ? buildMaskedJsonPlaceholder() : JSON.stringify(payload, null, 2);
}

function readLastSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadPrivacyMode() {
  try {
    return localStorage.getItem(PRIVACY_MODE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function buildErrorSummaryStatus(total, coreErrors, supplementalErrors) {
  if (coreErrors > 0) {
    return `采集完成：${total} 个数据源，${coreErrors} 个核心错误，${supplementalErrors} 个补充错误。`;
  }
  if (supplementalErrors > 0) {
    return `采集完成：${total} 个数据源，核心数据正常，${supplementalErrors} 个补充错误。`;
  }
  return `采集完成：${total} 个数据源，未发现核心错误。`;
}

function buildErrorSummaryToast(coreErrors, supplementalErrors) {
  if (coreErrors > 0) {
    return `刷新完成，存在 ${coreErrors} 个核心错误${supplementalErrors > 0 ? `，另有 ${supplementalErrors} 个补充错误` : ""}`;
  }
  if (supplementalErrors > 0) {
    return `刷新完成，核心数据正常；${supplementalErrors} 个补充错误已降级处理`;
  }
  return "刷新完成";
}

function hydrateLastSnapshot() {
  const payload = readLastSnapshot();
  if (!payload) {
    localStorage.removeItem(SNAPSHOT_STORAGE_KEY);
    return;
  }

  if (payload?.dashboard) {
    renderDashboard(payload.dashboard);
  }
  resultPreview.textContent = privacyMode ? buildMaskedJsonPlaceholder() : JSON.stringify(payload, null, 2);
  if (payload?.collectedAt) {
    lastRunAt.textContent = new Date(payload.collectedAt).toLocaleString("zh-CN", { hour12: false });
  }
}

async function hydrateFxRate() {
  try {
    const response = await fetch("/api/fx");
    if (!response.ok) return;
    const payload = await response.json();
    if (!Number.isFinite(Number(payload.usdCny))) return;
    fxState = {
      usdCny: Number(payload.usdCny),
      asOf: payload.asOf || null,
    };

    const existingSecondary = document.querySelector(".metric-secondary-value");
    if (!existingSecondary) return;
    const totalValueNode = document.querySelector(".metric-value-primary");
    const helperNode = document.querySelector(".metric-helper");
    if (!totalValueNode) return;
    const totalUsdt = parseUsdtValue(totalValueNode.textContent);
    if (!Number.isFinite(totalUsdt)) return;
    existingSecondary.textContent = formatCny(totalUsdt * fxState.usdCny);
    if (helperNode && fxState.asOf) {
      helperNode.textContent = `汇率来源 ECB · ${fxState.asOf}`;
    }
  } catch {
    // Ignore FX hydration failures; the USDT total remains usable.
  }
}

function persistLastSnapshot(payload) {
  localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(payload));
}

function renderDashboard(dashboard) {
  if (!dashboard) {
    resetDashboard();
    return;
  }

  dashboardEmpty.classList.add("hidden");
  dashboardContent.classList.remove("hidden");

  const totalCard = dashboard.totals?.[0] || {
    label: "总资产估值",
    value: "0.00 USDT",
    helper: "",
  };
  const rawSummary = dashboard.rawSummary || {};
  const secondaryValue =
    totalCard.secondaryValue ||
    (Number.isFinite(Number(rawSummary.grandTotalCny))
      ? formatCny(Number(rawSummary.grandTotalCny))
      : Number.isFinite(Number(fxState.usdCny))
        ? formatCny(parseUsdtValue(totalCard.value) * fxState.usdCny)
        : "");
  const helperText =
    totalCard.helper ||
    (fxState.asOf ? `汇率来源 ECB · ${fxState.asOf}` : "");
  const marketPrices = Array.isArray(totalCard.marketPrices) ? totalCard.marketPrices : [];
  const exposure = totalCard.exposure || {};
  const stablecoinAssets = Array.isArray(exposure.stablecoinAssets) ? exposure.stablecoinAssets : [];
  totalCards.innerHTML = `
    <article class="metric-card metric-card-primary">
      <div class="metric-primary-layout">
        <div class="metric-primary-main">
          <span class="metric-label">${escapeHtml(totalCard.label)}</span>
          <strong class="metric-value metric-value-primary">${escapeHtml(maskSensitiveText(totalCard.value))}</strong>
          ${secondaryValue ? `<span class="metric-secondary-value">${escapeHtml(maskSensitiveText(secondaryValue))}</span>` : ""}
          ${
            stablecoinAssets.length
              ? `<p class="metric-stablecoin-note">稳定币口径：${escapeHtml(stablecoinAssets.join("、"))}</p>`
              : ""
          }
          <p class="metric-helper">${escapeHtml(helperText)}</p>
        </div>
        <div class="metric-primary-side">
          ${
            exposure.nonStablecoinUsdt || exposure.stablecoinUsdt || exposure.nonStablecoinRatio
              ? `<div class="metric-exposure-grid">
                  <div class="metric-exposure-item">
                    <span class="metric-exposure-label">非稳币资产</span>
                    <strong>${escapeHtml(maskSensitiveText(exposure.nonStablecoinUsdt || "-"))}</strong>
                  </div>
                  <div class="metric-exposure-item">
                    <span class="metric-exposure-label">非稳币占比</span>
                    <strong>${escapeHtml(maskSensitiveText(exposure.nonStablecoinRatio || "-"))}</strong>
                  </div>
                  <div class="metric-exposure-item">
                    <span class="metric-exposure-label">稳定币资产</span>
                    <strong>${escapeHtml(maskSensitiveText(exposure.stablecoinUsdt || "-"))}</strong>
                  </div>
                </div>`
              : ""
          }
          ${
            marketPrices.length
              ? `<div class="metric-market-prices">${marketPrices
                  .map(
                    (item) => `
                      <span class="metric-market-price-item">
                        ${renderAssetIdentity(item.asset, "xs")}
                        <span class="metric-market-price-asset">${escapeHtml(item.asset)}</span>
                        <strong>${escapeHtml(maskSensitiveText(item.value))}</strong>
                      </span>
                    `,
                  )
                  .join("")}</div>`
              : ""
          }
        </div>
      </div>
    </article>
  `;

  const assetRows = Array.isArray(dashboard.assetRows) ? dashboard.assetRows : [];
  const displayAssetRows = assetRows.filter((item) => item.estimatedUsdt !== null && item.estimatedUsdt !== undefined);
  renderAssetChart(displayAssetRows);

  assetTableBody.innerHTML = displayAssetRows
    .slice(0, 24)
    .map((item) => {
      const scopeCount = Array.isArray(item.scopes) ? item.scopes.length : 0;
      return `
        <tr class="asset-table-row" data-asset="${escapeHtml(item.asset)}">
          <td>
            <div class="asset-cell-title">
              ${renderAssetIdentity(item.asset, "sm")}
              <strong>${escapeHtml(item.asset)}</strong>
            </div>
            <span class="table-note">${scopeCount} 个账户范围</span>
          </td>
          <td>${escapeHtml(maskSensitiveText(formatAssetAmount(item.asset, item.totalAmount)))}</td>
          <td>${item.estimatedUsdt !== null ? escapeHtml(maskSensitiveText(formatUsdt(item.estimatedUsdt))) : "未定价"}</td>
          <td>${escapeHtml(formatAssetSources(item.sourceLabels || []))}</td>
        </tr>
      `;
    })
    .join("");

  bindAssetRowInteractions();

  const accountRows = Array.isArray(dashboard.accountRows) ? dashboard.accountRows : [];
  const visibleAccountRows = showAllAccounts ? accountRows : accountRows.slice(0, 5);
  const hiddenAccountCount = Math.max(0, accountRows.length - visibleAccountRows.length);
  renderAccountChart(accountRows);
  if (accountViewToggle) {
    const shouldShowToggle = accountRows.length > 5;
    accountViewToggle.classList.toggle("hidden", !shouldShowToggle);
    accountViewToggle.textContent = showAllAccounts ? "仅看重点账户" : "展开全部";
  }
  if (accountViewHint) {
    const shouldShowHint = hiddenAccountCount > 0;
    accountViewHint.classList.toggle("hidden", !shouldShowHint);
    accountViewHint.textContent = showAllAccounts
      ? `当前展示全部 ${accountRows.length} 个账户。`
      : `当前先展示前 5 个账户，另外还有 ${hiddenAccountCount} 个账户。`;
  }

  accountCards.innerHTML = visibleAccountRows
    .map((item) => {
      const topAssets = (item.rows || [])
        .slice(0, 5)
        .map(
          (row) => `
            <div class="top-asset-row">
              <span class="top-asset-label">${renderAssetIdentity(row.asset, "xs")}<span>${escapeHtml(row.asset)} <span class="table-note">${escapeHtml(row.scopeLabel || row.scope)}</span></span></span>
              <strong>${escapeHtml(maskSensitiveText(formatUsdt(row.estimatedUsdt || 0)))}</strong>
            </div>
          `,
        )
        .join("");

      return `
        <article class="account-card account-card-item" data-account="${escapeHtml(item.accountLabel)}">
          <div class="account-head">
            <div>
              <strong>${escapeHtml(item.accountLabel)}</strong>
              <span class="mini-label">${escapeHtml(item.exchangeLabel || item.exchange || "")} · ${item.nonZeroAssets} 个非零币种</span>
            </div>
            <div class="account-value">${escapeHtml(maskSensitiveText(formatUsdt(item.totalUsdt || 0)))}</div>
          </div>
          <div class="top-assets">${topAssets || '<span class="table-note">暂无可定价资产</span>'}</div>
        </article>
      `;
    })
    .join("");

  bindAccountCardInteractions();
}

function resetDashboard() {
  showAllAccounts = false;
  dashboardEmpty.classList.remove("hidden");
  dashboardContent.classList.add("hidden");
  totalCards.innerHTML = "";
  assetChart.innerHTML = "";
  assetChartLegend.innerHTML = "";
  accountChart.innerHTML = "";
  accountChartLegend.innerHTML = "";
  assetTableBody.innerHTML = "";
  accountCards.innerHTML = "";
  if (accountViewToggle) accountViewToggle.classList.add("hidden");
  if (accountViewHint) {
    accountViewHint.classList.add("hidden");
    accountViewHint.textContent = "";
  }
}

function renderAssetChart(assetRows) {
  const pricedRows = assetRows
    .filter((item) => Number(item.estimatedUsdt) > 0)
    .sort((left, right) => Number(right.estimatedUsdt || 0) - Number(left.estimatedUsdt || 0));

  if (!pricedRows.length) {
    assetChart.innerHTML = '<div class="chart-empty">暂无可视化资产</div>';
    assetChartLegend.innerHTML = "";
    return;
  }

  const chartRows = pricedRows.slice(0, 7).map((item) => ({
    key: item.asset,
    label: item.asset,
    value: Number(item.estimatedUsdt || 0),
  }));

  const remainingValue = pricedRows.slice(7).reduce((sum, item) => sum + Number(item.estimatedUsdt || 0), 0);
  if (remainingValue > 0) {
    chartRows.push({
      key: "__other__",
      label: "其他",
      value: remainingValue,
    });
  }

  const total = chartRows.reduce((sum, item) => sum + item.value, 0);
  const totalDisplay = formatUsdt(total);
  const [totalNumber, totalUnit = "USDT"] = totalDisplay.split(" ");
  const centerValueClass = totalNumber.length >= 8 ? "asset-chart-center-value compact" : "asset-chart-center-value";
  const radius = 76;
  const circumference = 2 * Math.PI * radius;
  const colors = ["#0f766e", "#d97706", "#b45309", "#2563eb", "#0891b2", "#be123c", "#7c3aed", "#6b7280"];
  let offset = 0;

  const segments = chartRows
    .map((item, index) => {
      const ratio = item.value / total;
      const segmentLength = circumference * ratio;
      const dashOffset = -offset;
      offset += segmentLength;
      return `
        <circle
          class="asset-ring-segment"
          data-asset="${escapeHtml(item.key)}"
          cx="100"
          cy="100"
          r="${radius}"
          fill="none"
          stroke="${colors[index % colors.length]}"
          stroke-width="24"
          stroke-linecap="butt"
          stroke-dasharray="${segmentLength} ${circumference - segmentLength}"
          stroke-dashoffset="${dashOffset}"
          transform="rotate(-90 100 100)"
          tabindex="0"
          role="button"
          aria-label="${escapeHtml(item.label)} ${Math.round(ratio * 1000) / 10}%"
        ></circle>
      `;
    })
    .join("");

  assetChart.innerHTML = `
    <div class="asset-chart-card">
      <svg class="asset-donut" viewBox="0 0 200 200" aria-label="资产分布图">
        <circle cx="100" cy="100" r="${radius}" fill="none" stroke="rgba(38, 23, 12, 0.08)" stroke-width="24"></circle>
        ${segments}
      </svg>
      <div class="asset-chart-center">
        <span class="asset-chart-center-label">总资产估值</span>
        <strong class="${centerValueClass}">${escapeHtml(privacyMode ? "***" : totalNumber)}</strong>
        <span class="asset-chart-center-unit">${escapeHtml(privacyMode ? "" : totalUnit)}</span>
      </div>
    </div>
  `;

  assetChartLegend.innerHTML = chartRows
    .map((item, index) => {
      const percent = total ? ((item.value / total) * 100).toFixed(1) : "0.0";
      return `
        <button class="asset-legend-item" type="button" data-asset="${escapeHtml(item.key)}">
          <span class="asset-legend-main">
            ${renderAssetIdentity(item.label, "sm", colors[index % colors.length])}
            <span class="asset-legend-label">${escapeHtml(item.label)}</span>
          </span>
          <span class="asset-legend-meta">
            <strong>${escapeHtml(maskSensitiveText(`${percent}%`))}</strong>
            <span>${escapeHtml(maskSensitiveText(formatUsdt(item.value)))}</span>
          </span>
        </button>
      `;
    })
    .join("");

  bindAssetChartInteractions();
}

function bindAssetChartInteractions() {
  const chartItems = Array.from(document.querySelectorAll("[data-asset]")).filter((node) =>
    node.classList.contains("asset-ring-segment") || node.classList.contains("asset-legend-item"),
  );

  chartItems.forEach((node) => {
    node.addEventListener("mouseenter", () => setAssetFocus(node.dataset.asset || ""));
    node.addEventListener("focus", () => setAssetFocus(node.dataset.asset || ""));
    node.addEventListener("mouseleave", clearAssetFocus);
    node.addEventListener("blur", clearAssetFocus);
  });
}

function bindAssetRowInteractions() {
  document.querySelectorAll(".asset-table-row").forEach((row) => {
    row.addEventListener("mouseenter", () => setAssetFocus(row.dataset.asset || ""));
    row.addEventListener("mouseleave", clearAssetFocus);
  });
}

function setAssetFocus(assetKey) {
  if (!assetKey) return;

  document.querySelectorAll(".asset-ring-segment, .asset-legend-item, .asset-table-row").forEach((node) => {
    const matches = node.dataset.asset === assetKey;
    node.classList.toggle("is-active", matches);
    node.classList.toggle("is-dimmed", !matches);
  });

  if (assetKey === "__other__") {
    document.querySelectorAll(".asset-table-row").forEach((row) => {
      row.classList.remove("is-active", "is-dimmed");
    });
  }
}

function clearAssetFocus() {
  document.querySelectorAll(".asset-ring-segment, .asset-legend-item, .asset-table-row").forEach((node) => {
    node.classList.remove("is-active", "is-dimmed");
  });
}

function renderAccountChart(accountRows) {
  const pricedRows = accountRows
    .filter((item) => Number(item.totalUsdt) > 0)
    .sort((left, right) => Number(right.totalUsdt || 0) - Number(left.totalUsdt || 0));

  if (!pricedRows.length) {
    accountChart.innerHTML = '<div class="chart-empty">暂无账户分布</div>';
    accountChartLegend.innerHTML = "";
    return;
  }

  const chartRows = pricedRows.slice(0, 7).map((item) => ({
    key: item.accountLabel,
    label: item.accountLabel,
    value: Number(item.totalUsdt || 0),
  }));

  const remainingValue = pricedRows.slice(7).reduce((sum, item) => sum + Number(item.totalUsdt || 0), 0);
  if (remainingValue > 0) {
    chartRows.push({
      key: "__other_accounts__",
      label: "其他",
      value: remainingValue,
    });
  }

  const total = chartRows.reduce((sum, item) => sum + item.value, 0);
  const totalDisplay = formatUsdt(total);
  const [totalNumber, totalUnit = "USDT"] = totalDisplay.split(" ");
  const centerValueClass = totalNumber.length >= 8 ? "asset-chart-center-value compact" : "asset-chart-center-value";
  const radius = 76;
  const circumference = 2 * Math.PI * radius;
  const colors = ["#0f766e", "#d97706", "#b45309", "#2563eb", "#0891b2", "#be123c", "#7c3aed", "#6b7280"];
  let offset = 0;

  const segments = chartRows
    .map((item, index) => {
      const ratio = item.value / total;
      const segmentLength = circumference * ratio;
      const dashOffset = -offset;
      offset += segmentLength;
      return `
        <circle
          class="account-ring-segment"
          data-account="${escapeHtml(item.key)}"
          cx="100"
          cy="100"
          r="${radius}"
          fill="none"
          stroke="${colors[index % colors.length]}"
          stroke-width="24"
          stroke-linecap="butt"
          stroke-dasharray="${segmentLength} ${circumference - segmentLength}"
          stroke-dashoffset="${dashOffset}"
          transform="rotate(-90 100 100)"
          tabindex="0"
          role="button"
          aria-label="${escapeHtml(item.label)} ${Math.round(ratio * 1000) / 10}%"
        ></circle>
      `;
    })
    .join("");

  accountChart.innerHTML = `
    <div class="asset-chart-card">
      <svg class="asset-donut" viewBox="0 0 200 200" aria-label="账户分布图">
        <circle cx="100" cy="100" r="${radius}" fill="none" stroke="rgba(38, 23, 12, 0.08)" stroke-width="24"></circle>
        ${segments}
      </svg>
      <div class="asset-chart-center">
        <span class="asset-chart-center-label">账户分布</span>
        <strong class="${centerValueClass}">${escapeHtml(privacyMode ? "***" : totalNumber)}</strong>
        <span class="asset-chart-center-unit">${escapeHtml(privacyMode ? "" : totalUnit)}</span>
      </div>
    </div>
  `;

  accountChartLegend.innerHTML = chartRows
    .map((item, index) => {
      const percent = total ? ((item.value / total) * 100).toFixed(1) : "0.0";
      return `
        <button class="account-legend-item asset-legend-item" type="button" data-account="${escapeHtml(item.key)}">
          <span class="asset-legend-main">
            <span class="asset-legend-dot" style="--legend-color:${colors[index % colors.length]}"></span>
            <span class="asset-legend-label">${escapeHtml(item.label)}</span>
          </span>
          <span class="asset-legend-meta">
            <strong>${escapeHtml(maskSensitiveText(`${percent}%`))}</strong>
            <span>${escapeHtml(maskSensitiveText(formatUsdt(item.value)))}</span>
          </span>
        </button>
      `;
    })
    .join("");

  bindAccountChartInteractions();
}

function bindAccountChartInteractions() {
  const chartItems = Array.from(document.querySelectorAll("[data-account]")).filter((node) =>
    node.classList.contains("account-ring-segment") || node.classList.contains("account-legend-item"),
  );

  chartItems.forEach((node) => {
    node.addEventListener("mouseenter", () => setAccountFocus(node.dataset.account || ""));
    node.addEventListener("focus", () => setAccountFocus(node.dataset.account || ""));
    node.addEventListener("mouseleave", clearAccountFocus);
    node.addEventListener("blur", clearAccountFocus);
  });
}

function bindAccountCardInteractions() {
  document.querySelectorAll(".account-card-item").forEach((card) => {
    card.addEventListener("mouseenter", () => setAccountFocus(card.dataset.account || ""));
    card.addEventListener("mouseleave", clearAccountFocus);
  });
}

function setAccountFocus(accountKey) {
  if (!accountKey) return;

  document.querySelectorAll(".account-ring-segment, .account-legend-item, .account-card-item").forEach((node) => {
    const matches = node.dataset.account === accountKey;
    node.classList.toggle("is-active", matches);
    node.classList.toggle("is-dimmed", !matches);
  });

  if (accountKey === "__other_accounts__") {
    document.querySelectorAll(".account-card-item").forEach((card) => {
      card.classList.remove("is-active", "is-dimmed");
    });
  }
}

function clearAccountFocus() {
  document.querySelectorAll(".account-ring-segment, .account-legend-item, .account-card-item").forEach((node) => {
    node.classList.remove("is-active", "is-dimmed");
  });
}

function showToast(message, tone = "default", duration = 2200) {
  if (!toast) return;
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.remove("hidden");
  toast.classList.add("is-visible");

  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }

  if (duration > 0) {
    toastTimer = window.setTimeout(() => {
      hideToast();
    }, duration);
  }
}

function hideToast() {
  if (!toast) return;
  toast.classList.remove("is-visible");
  toast.classList.add("hidden");
}

function setOperationLoading(kind, active) {
  const buttons =
    kind === "notion"
      ? document.querySelectorAll('[data-action="sync-notion"]')
      : kind === "obsidian"
        ? document.querySelectorAll('[data-action="sync-obsidian"]')
      : [document.querySelector("#refresh-stats"), document.querySelector("#collect-binance")].filter(Boolean);

  buttons.forEach((button) => {
    button.disabled = active;
    button.classList.toggle("is-loading", active);
    if (active) {
      button.dataset.originalLabel = button.textContent.trim();
      button.textContent = kind === "notion" ? "同步中..." : kind === "obsidian" ? "写入中..." : "刷新中...";
    } else if (button.dataset.originalLabel) {
      button.textContent = button.dataset.originalLabel;
      delete button.dataset.originalLabel;
    }
  });
}

function startProgressHints(kind) {
  stopProgressHints();
  const messages =
    kind === "notion"
      ? [
          { delay: 6000, text: "正在同步到 Notion，正在整理汇总与明细..." },
          { delay: 14000, text: "仍在同步中，Notion 写入通常会比普通刷新更久一些..." },
        ]
      : kind === "obsidian"
        ? [
            { delay: 4000, text: "正在生成 Obsidian 周报 Markdown..." },
            { delay: 10000, text: "仍在写入中，正在更新周报文件和索引..." },
          ]
      : [
          { delay: 6000, text: "正在刷新统计，正在等待交易所与链上数据返回..." },
        ];

  let index = 0;
  const scheduleNext = () => {
    if (index >= messages.length) return;
    const current = messages[index++];
    progressHintTimer = window.setTimeout(() => {
      showToast(current.text, "default", 0);
      scheduleNext();
    }, current.delay);
  };

  scheduleNext();
}

function stopProgressHints() {
  if (progressHintTimer) {
    window.clearTimeout(progressHintTimer);
    progressHintTimer = null;
  }
}

function formatCny(value) {
  const formatted = new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    minimumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value || 0);
  return `≈ ${formatted} RMB`;
}

function formatAssetAmount(asset, value) {
  const numeric = Number(value || 0);
  const maximumFractionDigits = String(asset || "").toUpperCase() === "USDT" ? 1 : 3;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(numeric);
}

function formatAssetSources(sourceLabels) {
  const labels = Array.isArray(sourceLabels) ? sourceLabels.filter(Boolean) : [];
  if (!labels.length) return "-";
  if (labels.length <= 2) return labels.join("、");
  return `${labels.slice(0, 2).join("、")} 等 ${labels.length} 个账户`;
}

function renderAssetIdentity(asset, size = "sm", fallbackColor = "") {
  const symbol = String(asset || "").toUpperCase();
  const logoUrl = getAssetLogoUrl(symbol);
  const initials = escapeHtml(symbol.slice(0, 4));
  const colorStyle = fallbackColor ? ` style="--asset-fallback-color:${fallbackColor}"` : "";
  return `
    <span class="asset-logo asset-logo-${size}" data-asset-symbol="${escapeHtml(symbol)}"${colorStyle}>
      <img
        class="asset-logo-image"
        src="${escapeHtml(logoUrl)}"
        alt="${escapeHtml(symbol)}"
        loading="lazy"
        onerror="this.parentElement.classList.add('is-fallback'); this.remove();"
      />
      <span class="asset-logo-fallback">${initials.slice(0, 1)}</span>
    </span>
  `;
}

function getAssetLogoUrl(asset) {
  if (ASSET_LOGO_URL_OVERRIDES[asset]) {
    return ASSET_LOGO_URL_OVERRIDES[asset];
  }
  const slug = ASSET_LOGO_SLUG_OVERRIDES[asset] || asset.toLowerCase();
  return `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${slug}.png`;
}

function parseUsdtValue(value) {
  const normalized = String(value || "").replace(/[^0-9.-]/g, "");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function maskSensitiveText(value) {
  if (!privacyMode) return String(value ?? "");
  return String(value ?? "").replace(/[0-9][0-9,.\-]*/g, "***");
}

function buildMaskedJsonPlaceholder() {
  return '{\n  "summary": "***",\n  "dashboard": "***",\n  "details": "***"\n}';
}

function applyExchangeDefaults(account) {
  const exchange = String(account.exchange || "binance").toLowerCase();
  const defaults = EXCHANGE_DEFAULTS[exchange] || EXCHANGE_DEFAULTS.binance;
  return {
    ...account,
    exchange,
    accountScope: defaults.accountScope,
    environment: defaults.environment,
    passphrase: exchange === "binance" ? "" : account.passphrase,
  };
}

function renderScopePicker(container, account) {
  const exchange = String(account.exchange || "binance").toLowerCase();
  const options = EXCHANGE_SCOPE_OPTIONS[exchange] || EXCHANGE_SCOPE_OPTIONS.binance;
  const selected = new Set(String(account.accountScope || "").split(",").map((item) => item.trim()).filter(Boolean));

  container.innerHTML = "";

  const toolbar = document.createElement("div");
  toolbar.className = "scope-picker-toolbar";

  const actions = document.createElement("div");
  actions.className = "scope-picker-actions";

  const selectAllButton = document.createElement("button");
  selectAllButton.type = "button";
  selectAllButton.className = "scope-action-button";
  selectAllButton.textContent = "全选";

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "scope-action-button";
  clearButton.textContent = "清空";

  const summary = document.createElement("span");
  summary.className = "scope-picker-summary";

  actions.appendChild(selectAllButton);
  actions.appendChild(clearButton);
  toolbar.appendChild(actions);
  toolbar.appendChild(summary);
  container.appendChild(toolbar);

  const optionsGrid = document.createElement("div");
  optionsGrid.className = "scope-options-grid";
  container.appendChild(optionsGrid);

  const syncSelectedScopes = () => {
    const next = options
      .filter((item) => {
        const input = optionsGrid.querySelector(`input[data-scope="${item.value}"]`);
        return input && input.checked;
      })
      .map((item) => item.value);

    account.accountScope = next.join(",");
    summary.textContent = `已选 ${next.length} / ${options.length}`;
    syncView();
  };

  for (const option of options) {
    const label = document.createElement("label");
    label.className = "scope-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected.has(option.value);
    checkbox.addEventListener("change", syncSelectedScopes);
    checkbox.dataset.scope = option.value;

    const text = document.createElement("span");
    text.textContent = option.label;

    label.appendChild(checkbox);
    label.appendChild(text);
    optionsGrid.appendChild(label);
  }

  selectAllButton.addEventListener("click", () => {
    optionsGrid.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = true;
    });
    syncSelectedScopes();
  });

  clearButton.addEventListener("click", () => {
    optionsGrid.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = false;
    });
    syncSelectedScopes();
  });

  const note = document.createElement("div");
  note.className = "field-note";
  note.textContent = "默认全选。可取消不需要统计的账户类型。";
  container.appendChild(note);
  syncSelectedScopes();
}

function formatUsdt(value) {
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    minimumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value || 0);
  return `${formatted} USDT`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
