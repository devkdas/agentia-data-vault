import {Command, Flags} from '@oclif/core'
import {readFileSync} from 'node:fs'
import {diffRecords, type SnapshotFile} from '../../lib.js'

function loadSnapshot(path: string): SnapshotFile {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as any).records)) {
    throw new Error(`Not a vault snapshot file: ${path}.`)
  }
  return parsed as SnapshotFile
}

export default class VaultDiff extends Command {
  static description = 'Compare two vault snapshots locally with zero CLI calls.'

  static examples = [
    '<%= config.bin %> <%= command.id %> --from vault-a.json --to vault-b.json',
    '<%= config.bin %> <%= command.id %> --from vault-a.json --to vault-b.json --json --fail-on-diff',
  ]

  static flags = {
    from: Flags.string({description: 'Older snapshot file.', required: true}),
    to: Flags.string({description: 'Newer snapshot file.', required: true}),
    'fail-on-diff': Flags.boolean({description: 'Exit 1 when snapshots differ. Useful for gates.', default: false}),
    json: Flags.boolean({char: 'j', description: 'Machine readable JSON output.', default: false}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(VaultDiff)
    const fromPath = flags.from as string
    const toPath = flags.to as string
    const failOnDiff = (flags['fail-on-diff'] as boolean) ?? false
    const asJson = (flags.json as boolean) ?? false

    let from: SnapshotFile
    let to: SnapshotFile
    try {
      from = loadSnapshot(fromPath)
      to = loadSnapshot(toPath)
    } catch (error: any) {
      const detail = `Could not read snapshots: ${(error?.message ?? String(error)).split('\n')[0]}`
      if (asJson) this.log(JSON.stringify({identical: false, error: detail}, null, 2))
      else this.log(detail)
      this.exit(1)
    }

    const diff = diffRecords((from as SnapshotFile).records, (to as SnapshotFile).records)
    const payload = {
      identical: diff.identical,
      from: {file: fromPath, snapshotId: (from as SnapshotFile).snapshotId, records: (from as SnapshotFile).records.length},
      to: {file: toPath, snapshotId: (to as SnapshotFile).snapshotId, records: (to as SnapshotFile).records.length},
      addedCount: diff.added.length,
      removedCount: diff.removed.length,
      changedCount: diff.changed.length,
      added: diff.added.slice(0, 20),
      removed: diff.removed.slice(0, 20),
      changed: diff.changed.slice(0, 20),
    }

    if (asJson) {
      this.log(JSON.stringify(payload, null, 2))
    } else if (diff.identical) {
      this.log(`Snapshots identical: ${(from as SnapshotFile).records.length} records each. Safe to proceed.`)
    } else {
      this.log(`Snapshots differ: +${diff.added.length} added, -${diff.removed.length} removed, ~${diff.changed.length} changed.`)
      for (const c of diff.changed.slice(0, 10)) {
        this.log(`  ~ ${c.key}: fields ${c.fields.join(', ')}`)
      }
    }

    if (!diff.identical && failOnDiff) this.exit(1)
  }
}
