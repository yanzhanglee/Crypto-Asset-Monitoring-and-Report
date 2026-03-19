# CLI Reference

Use these commands from the repository root.

If the skill is installed outside the repository, prefer the wrapper:

```bash
node skills/crypto-asset-report/scripts/invoke-project-cli.js <config|report> ...
```

## Config management

Initialize a local config file:

```bash
npm run config -- init
```

Wrapper form:

```bash
node skills/crypto-asset-report/scripts/invoke-project-cli.js config init
```

Show the current config with masked secrets:

```bash
npm run config -- show
```

Wrapper form:

```bash
node skills/crypto-asset-report/scripts/invoke-project-cli.js config show
```

Set a meta field:

```bash
npm run config -- set-meta --key notionToken --value <token>
```

Common `meta` keys:

- `alchemyApiKey`
- `zerionApiKey`
- `notionToken`
- `obsidianVaultPath`
- `obsidianRootDir`
- `notionSummaryDatabaseId`
- `notionAccountDatabaseId`
- `notionAssetDatabaseId`
- `notionSummaryTemplateId`

Set a validation field:

```bash
npm run config -- set-validation --key referenceCost --value 758000
```

Common `validation` keys:

- `minBalanceThreshold`
- `ignoredTokens`
- `focusAssets`
- `stablecoinSymbols`
- `referenceCost`
- `targetProfit`

Add a wallet:

```bash
npm run config -- add-wallet --label "Main Wallet" --address 0x123...
```

Optional wallet flags:

- `--chain all_evm`
- `--rpc-url https://...`
- `--token-contracts SYMBOL:0x...`

Remove a wallet:

```bash
npm run config -- remove-wallet --label "Main Wallet"
```

Add a CEX account:

```bash
npm run config -- add-cex --exchange binance --label "Binance Main" --api-key <key> --api-secret <secret>
```

Optional CEX flags:

- `--passphrase <value>` for Bitget or OKX
- `--account-scope <csv>`
- `--recv-window 10000`
- `--environment production`

Remove a CEX account:

```bash
npm run config -- remove-cex --label "Binance Main"
```

## Report execution

Run a fresh snapshot:

```bash
npm run report -- --config ./config.local.json
```

Wrapper form:

```bash
node skills/crypto-asset-report/scripts/invoke-project-cli.js report --config ./config.local.json
```

Get structured JSON:

```bash
npm run report -- --config ./config.local.json --output json
```

Write to Notion:

```bash
npm run report -- --config ./config.local.json --sync-notion
```

Write to Obsidian:

```bash
npm run report -- --config ./config.local.json --write-obsidian
```

Override reporting inputs for one run:

```bash
npm run report -- --config ./config.local.json --reference-cost 758000 --target-profit 300000
```

## Good defaults

- Assume the config path is `./config.local.json` unless the user says otherwise.
- Use `--output json` when you need to extract totals for a richer summary.
- Use the config CLI for persistent changes and the report CLI for one-time execution.
- Mask secrets in any user-facing recap.
- Use `--repo-root <path>` or `CRYPTO_ASSET_REPORT_ROOT` if the skill is installed outside the repo tree.
