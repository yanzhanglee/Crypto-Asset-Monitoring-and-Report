---
name: crypto-asset-report
description: Configure, refresh, summarize, and export this repository's crypto asset reports by driving the local CLI entrypoints instead of the browser UI. Use when the user wants to manage exchange accounts, wallet addresses, Notion settings, Obsidian settings, or run a fresh asset snapshot through natural language in this project.
---

# Crypto Asset Report

Use the repository CLI instead of reimplementing any collection logic.

## Core workflow

1. Resolve the repository root first.
2. Use `scripts/invoke-project-cli.js config ...` to create or update `config.local.json`.
3. Use `scripts/invoke-project-cli.js report ...` to collect data or write outputs.
4. Summarize results in natural language after commands finish.
5. Mask secrets in any response. Never echo raw API keys, secrets, passphrases, or tokens.

Read [references/cli.md](references/cli.md) for exact command patterns before editing config or running reports.
Read [references/intents.md](references/intents.md) to map natural language requests into config and report commands.
Read [references/setup.md](references/setup.md) when the user needs installation or packaging guidance.

## Setup

When the user wants to start from scratch:

1. Check whether `config.local.json` exists in the repo root.
2. If it does not exist, run:

```bash
node skills/crypto-asset-report/scripts/invoke-project-cli.js config init
```

3. If dependencies may be missing, run:

```bash
npm install
```

Do not commit `config.local.json`. It is ignored on purpose.

## Config updates

Prefer the wrapper script for configuration changes.

Use it for:

- Setting `meta` values such as `notionToken`, `alchemyApiKey`, `zerionApiKey`, `obsidianVaultPath`, and Notion database IDs
- Setting `validation` values such as `referenceCost`, `targetProfit`, `ignoredTokens`, `stablecoinSymbols`
- Adding or removing wallets
- Adding or removing CEX accounts

After configuration changes, show a short masked confirmation instead of raw secrets.

When a user gives sensitive values in natural language:

- Store them through the config CLI
- Confirm success with masked values only
- Avoid printing the full command if it would expose secrets

## Intent routing

Use these high-level buckets:

1. Setup or initialization
2. Show current config
3. Mutate config
4. Run a report
5. Run a report plus Notion or Obsidian output

Prefer routing through the config CLI whenever the request changes persistent settings.
Prefer routing through the report CLI whenever the request asks for fresh totals, summaries, or exports.

Use [references/intents.md](references/intents.md) for concrete phrase-to-command mapping and ambiguity handling.

## Reporting

Use `npm run report -- ...` for collection and output.

Default behavior:

```bash
node skills/crypto-asset-report/scripts/invoke-project-cli.js report --config ./config.local.json
```

Use `--output json` when you need structured output for further summarization or follow-up operations.

Use:

- `--sync-notion` when the user wants to write to Notion
- `--write-obsidian` when the user wants to write to Obsidian
- `--reference-cost` or `--target-profit` only when the user explicitly overrides the saved config

## Response style

After successful execution, summarize:

- Total asset value
- RMB estimate
- Non-stablecoin ratio when available
- Top assets
- Top accounts
- Whether Notion or Obsidian write actions succeeded

When the command fails:

- Quote the useful error reason
- Suggest the smallest next fix
- Do not dump unrelated raw JSON unless the user asks for it

## Boundaries

- Do not modify the browser UI unless the user explicitly asks for UI work.
- Do not rewrite exchange or onchain logic inside the skill.
- Do not assume remote cloud execution. This skill runs locally in the checked-out repository.
- Do not expose secrets in terminal output, summaries, or config previews.
