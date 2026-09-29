# Agentia Data Vault

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node 18+](https://img.shields.io/badge/node-%3E%3D18-blue.svg)](package.json)
[![Agentia 0.122](https://img.shields.io/badge/agentia-0.122.0--alpha.1-blue.svg)](https://developer.copado.com/docs)

**Data Vault** brings rollback discipline to data deployments. Snapshot
before promotion, diff for preview, restore through a gated commit when
things go wrong.

Preview everything, recover anything. Built for the **Agentia Headless
Virtual Hackathon** as an oclif plugin on top of the public `agentia` CLI.

---

## Table of Contents

- [The Problem](#the-problem)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Live Demo Workflow](#live-demo-workflow)
- [Command Reference](#command-reference)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [How It Works](#how-it-works)
- [Security](#security)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Hackathon Fit](#hackathon-fit)
- [License](#license)

---

## The Problem

Data has the thinnest CLI support of any surface. The docs confirm no data
specific rollback, retry, resume, validation only or deployment status
commands. Template updates replace the full document with no diff, preview
or concurrent change warning, and applied sync entries are never verified
against the deployed commit. When a data deploy corrupts records, teams
rebuild from memory and spreadsheets.

## Features

- **Versioned snapshots** — template export graph plus records captured
  into timestamped JSON files through verified `cicd data` commands.
  Resolves templates by ID or name.
- **Local diff** — compare any two snapshots with zero CLI calls. Added,
  removed and changed records with exact fields, plus `--fail-on-diff`
  for gates.
- **Gated restore** — issues a one time code (`VR-XXXXXX`, 24 hour TTL),
  previews the commit body without `--yes`, and only sends
  `cicd data commit create` after code plus explicit confirmation.
- **Single use codes** — consumed on first successful restore, scoped to
  snapshot plus story.
- **Dual output** — human summaries plus `--json` throughout.
- **Zero private imports** — only shells out to public `agentia`
  commands.

## Installation

### Prerequisites

- Node 18 or newer.
- Agentia CLI beta: `npm install -g @copado/agentia-cli@beta`
- Authenticated machine: `agentia setup` (CICD at minimum).
- At least one data template in the org for live snapshots.

### Install from source

```sh
git clone https://github.com/devkdas/agentia-data-vault.git
cd agentia-data-vault
npm install
npm run build
agentia plugins link .
```

Re-run `npm run build` after every change to the TypeScript files.

## Quick Start

### 1. Snapshot before promotion

```sh
agentia vault snapshot --template "Account Seed" --credential-id a11xxx --story US-0000024
```

### 2. Preview what changed

```sh
agentia vault diff --from vault-Account-Seed-<id1>.json --to vault-Account-Seed-<id2>.json
```

### 3. Restore when things break

```sh
agentia vault restore --snapshot vault-Account-Seed-<id>.json --story US-0000024
agentia vault restore --snapshot vault-Account-Seed-<id>.json --story US-0000024 --approve-code VR-XXXXXX --yes
```

## Live Demo Workflow

Verified live with fixture plus approval flows:

```text
1. agentia vault diff --from vault-a.json --to vault-b.json
   -> Snapshots differ: +1 added, -1 removed, ~1 changed (field Amount)
2. agentia vault restore --snapshot vault-a.json --story US-0000024
   -> approval required, code VR-GPZ5VA issued, nothing changed
3. Re-run with --approve-code VR-GPZ5VA without --yes
   -> dry run previewing the exact commit body, still nothing sent
4. Re-run with code plus --yes -> cicd data commit create sent via stdin
```

Snapshot shape per file:

```json
{
  "vaultVersion": 1,
  "snapshotId": "2026-09-29T05-15-22-a1b2c3",
  "createdAt": "2026-09-29T05:15:22Z",
  "story": "US-0000024",
  "templateId": "a0Xxxx",
  "templateName": "Account Seed",
  "credentialId": "a11xxx",
  "graph": {},
  "records": []
}
```

## Command Reference

### `agentia vault snapshot`

| Flag | Description |
|---|---|
| `-t, --template <name\|id>` | Data template name or ID (required) |
| `--credential-id <id>` | Org credential ID for record search (required) |
| `-s, --story <id>` | Owning user story ID |
| `-o, --output-dir <dir>` | Snapshot directory (default `./vault`) |
| `-j, --json` | Machine readable summary |

### `agentia vault diff`

| Flag | Description |
|---|---|
| `--from <file>` | Older snapshot file (required) |
| `--to <file>` | Newer snapshot file (required) |
| `--fail-on-diff` | Exit 1 when snapshots differ, for gates |
| `-j, --json` | Counts plus capped record samples |

Records match on `Id`, `ExternalId` or `Name`, falling back to position.
Changed entries list up to 20 differing fields each.

### `agentia vault restore`

| Flag | Description |
|---|---|
| `--snapshot <file>` | Snapshot file to restore (required) |
| `-s, --story <id>` | Story receiving the data commit |
| `--approve-code <code>` | One time restore code |
| `-y, --yes` | Confirm the destructive send |
| `-j, --json` | Machine readable output |

Without a code it issues one and changes nothing. With a code but
without `--yes` it previews the commit body and changes nothing. Only
code plus `--yes` sends.

## Configuration

Snapshots go to the chosen output directory with safe filename slugs.
Pending restore codes live in `~/.agentia-data-vault/pending.json` with
24 hour expiry and purge on every run. No environment variables needed.

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| No data template found | Name typo or zero templates in org | Create a template, then retry |
| Record search failed | Wrong credential ID | Resolve via `cicd credential list` |
| Unknown restore code | Consumed or mistyped | Issue a fresh one without a code |
| Restore rejected by CLI | Commit body shape refused server side | Read the surfaced CLI error, code stays valid |
| Not a vault snapshot file | Wrong file passed | Pass a file written by snapshot |
| ESM auto-transpile warning | Linked ESM plugin notice | Benign, compiled output is used |

## How It Works

```text
snapshot: template list/get -> records search -> versioned JSON file
diff:     two files -> key matched compare, zero CLI calls
restore:  issue code -> preview body -> code + --yes -> commit create --stdin
```

Verified primitives: `cicd data template list`, `cicd data template get`,
`cicd data records search`, `cicd data commit create`, `cicd data commit
list`, `cicd data dataset-file list`.

## Security

Restore is destructive by nature, so it carries two independent locks:
the one time scoped code and the explicit `--yes` flag. Snapshots are
plain JSON the team can inspect before anything is sent. No tokens are
printed or stored.

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript on Node 18+ |
| CLI Framework | oclif v4 (ESM, matching the host CLI) |
| Runtime calls | `node:child_process` to public `agentia` commands |
| Storage | Versioned JSON snapshots plus pending code file |

## Architecture

```text
Developer / Agent
       |
agentia vault snapshot / diff / restore
       |
Data Vault (this plugin)
  |- resolver  -> template list/get by name or ID
  |- capturer  -> records search -> versioned file
  |- comparer  -> pure local key matched diff
  |- restorer  -> code ceremony -> commit create --stdin
       |
Snapshot files / JSON summaries
```

## Hackathon Fit

Addresses the largest documented product gap head on: data safety. Adds
validation, safeguards and auditability where the CLI has none, extends an
existing capability, and combines snapshot plus preview plus gated recovery
in one flow.

## License

MIT License — see [LICENSE](LICENSE) for details.
