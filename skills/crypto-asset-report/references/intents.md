# Intent Routing

Use this file to map natural language requests to the local CLI commands.

## Routing order

Classify the user request in this order:

1. Setup or installation
2. Config inspection
3. Config mutation
4. Report execution
5. Output target selection

If a request spans multiple categories, perform them in sequence and narrate the result clearly.

## 1. Setup or installation

Typical phrases:

- "帮我初始化"
- "先把配置文件建好"
- "怎么开始用"
- "初始化一下这个技能"

Preferred action:

```bash
node skills/crypto-asset-report/scripts/invoke-project-cli.js config init
```

If dependencies may be missing, run `npm install` first.

## 2. Config inspection

Typical phrases:

- "看看现在的配置"
- "当前都配了哪些账户"
- "show config"
- "检查一下 Notion 配置"

Preferred action:

```bash
node skills/crypto-asset-report/scripts/invoke-project-cli.js config show
```

Then summarize masked values instead of dumping secrets.

## 3. Config mutation

### 3a. Set meta values

Typical phrases:

- "Notion Token 是 ..."
- "把 Alchemy key 设成 ..."
- "Obsidian 路径改成 ..."
- "设置净值汇总库 ID 为 ..."

Route to:

```bash
node skills/crypto-asset-report/scripts/invoke-project-cli.js config set-meta --key <metaKey> --value <value>
```

Common mapping:

- `notion token` -> `notionToken`
- `alchemy key` -> `alchemyApiKey`
- `zerion key` -> `zerionApiKey`
- `obsidian vault` -> `obsidianVaultPath`
- `obsidian root dir` -> `obsidianRootDir`
- `summary db` -> `notionSummaryDatabaseId`
- `account db` -> `notionAccountDatabaseId`
- `asset db` -> `notionAssetDatabaseId`
- `summary template` -> `notionSummaryTemplateId`

### 3b. Set validation values

Typical phrases:

- "参考成本设为 758000"
- "目标利润改成 300000"
- "稳定币列表加上 USDe"
- "忽略代币加上 POINTS"

Route to:

```bash
node skills/crypto-asset-report/scripts/invoke-project-cli.js config set-validation --key <validationKey> --value <value>
```

Common mapping:

- `reference cost` -> `referenceCost`
- `target profit` -> `targetProfit`
- `ignored tokens` -> `ignoredTokens`
- `focus assets` -> `focusAssets`
- `stablecoin list` -> `stablecoinSymbols`
- `threshold` -> `minBalanceThreshold`

When the user says "加上" or "删除", first read current config, then update the comma-separated list instead of overwriting blindly.

### 3c. Add or update wallets

Typical phrases:

- "新增钱包 0xabc...，名字叫主钱包"
- "增加一个 World Chain 地址 ..."
- "把主钱包地址改成 ..."

Route to:

```bash
node skills/crypto-asset-report/scripts/invoke-project-cli.js config add-wallet --label "<label>" --address <address>
```

Optional fields:

- `--chain`
- `--rpc-url`
- `--token-contracts`

If a wallet label already exists, `add-wallet` becomes an update.

### 3d. Remove wallets

Typical phrases:

- "删除主钱包"
- "把 OKX Pay 钱包移除"

Route to:

```bash
node skills/crypto-asset-report/scripts/invoke-project-cli.js config remove-wallet --label "<label>"
```

### 3e. Add or update CEX accounts

Typical phrases:

- "新增 Binance 账户，名字叫主账户"
- "Binance API Key 是 ..."
- "添加一个 OKX 账户"
- "把 Bitget 账户更新一下"

Route to:

```bash
node skills/crypto-asset-report/scripts/invoke-project-cli.js config add-cex --exchange <binance|bitget|okx> --label "<label>" ...
```

Use optional flags as needed:

- `--api-key`
- `--api-secret`
- `--passphrase`
- `--account-scope`
- `--recv-window`
- `--environment`

If the user only gives credentials but not a label, pick a safe descriptive label and mention it in the confirmation.

### 3f. Remove CEX accounts

Typical phrases:

- "删除 Binance 主账户"
- "把 OKX 账户移除"

Route to:

```bash
node skills/crypto-asset-report/scripts/invoke-project-cli.js config remove-cex --label "<label>"
```

## 4. Report execution

Typical phrases:

- "刷新资产统计"
- "重新跑一次"
- "总结一下当前净值"
- "输出 JSON"

Default route:

```bash
node skills/crypto-asset-report/scripts/invoke-project-cli.js report --config ./config.local.json
```

If the user wants machine-readable output, add:

```bash
--output json
```

## 5. Output target selection

### Notion

Typical phrases:

- "同步到 Notion"
- "写入 Notion"
- "更新净值到 Notion"

Add:

```bash
--sync-notion
```

### Obsidian

Typical phrases:

- "写入 Obsidian"
- "保存到 Obsidian"

Add:

```bash
--write-obsidian
```

### Overrides for a single run

Typical phrases:

- "这次按参考成本 758000 跑"
- "这次目标利润按 300000"

Add:

```bash
--reference-cost <value>
--target-profit <value>
```

Do not persist those values unless the user explicitly asks to update the saved config.

## Ambiguity policy

Ask a direct follow-up only when a missing value would make the command unsafe or meaningless.

Examples:

- Missing wallet label for a removal request
- Missing exchange name when adding a new CEX account
- Missing address for a wallet add request

Make a reasonable assumption when the user intent is still safe:

- If the user says "刷新一下"，run the default report
- If the user says "看看配置"，show masked config
- If the user says "同步到 Notion"，run a report with `--sync-notion` only if a valid config already exists

## Sensitive data handling

- Never repeat raw API keys, secrets, passphrases, or tokens back to the user
- Prefer short masked confirmations
- Avoid printing shell commands containing secrets in the final response
