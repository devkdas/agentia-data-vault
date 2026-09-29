# Agentia Data Vault

Snapshot, diff and restore for Copado data deployments in Agentia CLI.

Built for the Agentia Headless Virtual Hackathon as an oclif plugin on top of
the public `agentia` CLI. The docs confirm there are no data specific
rollback, retry, resume, validation only or deployment status commands, and
template updates replace the full document with no diff or preview. Vault
fills that gap with versioned snapshots plus a gated restore.

## Install

```sh
npm install
npm run build
agentia plugins link .
```

## Usage

```sh
agentia vault snapshot --template "Account Seed" --credential-id a11xxx --story US-0000024
agentia vault diff --from vault-Account-Seed-<id1>.json --to vault-Account-Seed-<id2>.json
agentia vault restore --snapshot vault-Account-Seed-<id>.json --story US-0000024
agentia vault restore --snapshot vault-Account-Seed-<id>.json --story US-0000024 --approve-code VR-XXXXXX --yes
```

Snapshot resolves the template by ID or name through `cicd data template
list` and `cicd data template get`, captures records through
`cicd data records search`, and writes a versioned JSON file to the output
directory. Diff compares two snapshots locally with zero CLI calls. Restore
previews the commit body without `--yes`, and only sends
`cicd data commit create` after explicit confirmation plus a one time
approval code.

## License

MIT
