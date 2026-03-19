# Setup and Distribution Notes

This skill is designed to work with the repository that contains the crypto asset collector.

## What users need

For real usage, users need all of the following on their own machine:

- This project repository
- Node.js
- `npm install` completed in the repository
- Their own `config.local.json`
- Their own exchange API keys, wallet addresses, and optional Notion or Obsidian settings

This skill does not call a remote hosted service. It drives the local project commands.

## Recommended install model

For SkillHub or ClawHub style sharing, prefer sharing:

1. The full repository
2. The skill folder inside it
3. A setup instruction that tells users to clone the repo first

Then the skill can call:

- `scripts/manage-config.js`
- `scripts/run-report.js`

## How the wrapper finds the repo

The wrapper script at `scripts/invoke-project-cli.js` resolves the project root in this order:

1. `--repo-root <path>`
2. `CRYPTO_ASSET_REPORT_ROOT`
3. The current working directory and its parents
4. Parent directories near the installed skill

If the user invokes the skill while already inside the repository, no extra setup is usually needed.

## What not to assume

- Do not assume browser UI access is required
- Do not assume a cloud backend exists
- Do not assume the skill package alone contains live API credentials or user config

## Recommended first-run flow

1. Clone the repo
2. Run `npm install`
3. Run `npm run config -- init`
4. Add keys and wallets through config commands
5. Run `npm run report -- --config ./config.local.json`
