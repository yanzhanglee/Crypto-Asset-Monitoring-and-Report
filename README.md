# Crypto Asset Monitoring and Report

[中文版](./README.zh-CN.md)

Track crypto net worth across exchanges, wallets, and selected DeFi protocols in one place. This project is built for people whose assets are scattered across Binance, Bitget, OKX, EVM wallets, and onchain positions, and who want a practical dashboard plus reliable exports to Notion or Obsidian.

## What It Looks Like

![Full dashboard overview](./assets/readme-dashboard-overview.png)

![Portfolio breakdown detail](./assets/readme-dashboard-detail.png)

## Why People Use It

- See total net worth in `USDT` and `RMB` at a glance
- Aggregate balances across multiple CEX accounts and EVM wallets
- Track selected DeFi positions without maintaining separate spreadsheets
- Export weekly records to `Notion` and `Obsidian`
- Run everything locally instead of uploading portfolio data to a hosted service

## What You Get

- A browser dashboard for daily use
- A CLI for repeatable reporting and automation
- Optional sync to `Notion`
- Optional markdown export to `Obsidian`
- A Skill-ready execution layer for local agent workflows

## Current Coverage

### Exchanges

- `Binance`
  - `spot`
  - `funding`
  - `simple_earn_flexible`
  - `simple_earn_locked`
  - `cross_margin`
  - `isolated_margin`
  - `um_futures`
  - `cm_futures`
  - subaccounts for spot, margin, and futures
- `Bitget`
  - `spot`
  - `funding`
  - `futures`
  - `cross_margin`
  - `savings_flexible`
  - `savings_fixed`
  - `overview`
- `OKX`
  - `trading`
  - `funding`
  - `savings`
  - `overview`

### Wallets and Onchain

- EVM support across:
  - `Ethereum`
  - `Arbitrum`
  - `Base`
  - `Optimism`
  - `BSC`
  - `Polygon`
  - `World Chain`
  - `X Layer`
- Native token balances
- ERC20 discovery via `Alchemy`
- Manual ERC20 fallback when discovery is unavailable

### Selected DeFi

- `Zerion` address-based discovery
- `Venus`
- `Morpho`
- `WLFI Unlock`

## What You Need Before First Use

Depending on your setup, prepare some or all of the following:

- `Binance` API Key / Secret
- `Bitget` API Key / Secret / Passphrase
- `OKX` API Key / Secret / Passphrase
- `Alchemy` API Key for richer ERC20 discovery
- `Zerion` API Key for broader DeFi coverage
- `Notion` Integration Token and target database IDs if you want Notion sync
- `Obsidian` vault path if you want local markdown exports

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Start the browser app

```bash
npm start
```

Then open [http://localhost:4173](http://localhost:4173).

### 3. Fill settings and refresh

Use the browser UI to:

- add exchange accounts
- add wallet addresses
- set optional Notion / Obsidian destinations
- refresh the latest snapshot

## CLI Usage

If you want to reuse the reporting engine without the browser UI:

```bash
cp config.example.json config.local.json
npm run report -- --config ./config.local.json
```

Common variants:

```bash
npm run report -- --config ./config.local.json --output json
npm run report -- --config ./config.local.json --sync-notion
npm run report -- --config ./config.local.json --write-obsidian
```

Initialize and inspect config from the command line:

```bash
npm run config -- init
npm run config -- show
```

Examples:

```bash
npm run config -- set-meta --key notionToken --value <token>
npm run config -- add-wallet --label "Main Wallet" --address 0x123...
npm run config -- add-cex --exchange binance --label "Binance Main" --api-key <key> --api-secret <secret>
```

## Notion and Obsidian

### Notion

Use the browser settings or local config to provide:

- `Notion Token`
- summary database ID
- account detail database ID
- asset detail database ID

The app can write:

- summary snapshots
- account-level rows
- asset-level rows

### Obsidian

Use the browser settings or local config to provide:

- local vault path
- output root directory

The app can write:

- weekly markdown notes
- summary images
- an index page inside the configured output folder

## Skill-Ready Backend

This repository also ships with a Skill-oriented execution layer:

- `scripts/manage-config.js`
- `scripts/run-report.js`
- `skills/crypto-asset-report/`

That makes it possible to reuse the same reporting core from a local agent or Skill workflow, instead of rebuilding exchange and wallet logic from scratch.

## Security Notes

- Do not commit real API keys, secrets, tokens, exported configs, or local vault paths
- Keep `config.local.json` on your machine only
- Rotate credentials if they were used during local testing before sharing the project publicly

