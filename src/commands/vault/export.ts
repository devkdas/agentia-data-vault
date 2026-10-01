import {Command, Flags} from '@oclif/core'
import {readFileSync, writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {diffRecords, type SnapshotFile} from '../../lib.js'

function loadSnapshot(path: string): SnapshotFile {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as any).records)) {
    throw new Error(`Not a vault snapshot file: ${path}.`)
  }
  return parsed as SnapshotFile
}

function csvCell(v: unknown): string {
  const s = typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default class VaultExport extends Command {
  static description =
    'Export snapshot differences as a peer review changeset file. Read only inputs, local file output.'

  static examples = [
    '<%= config.bin %> <%= command.id %> --from vault-a.json --to vault-b.json',
    '<%= config.bin %> <%= command.id %> --from vault-a.json --to vault-b.json --format csv --output ./changeset.csv --json',
  ]

  static flags = {
    from: Flags.string({description: 'Older snapshot file.', required: true}),
    to: Flags.string({description: 'Newer snapshot file.', required: true}),
    format: Flags.string({description: 'Changeset file format.', options: ['md', 'csv'], default: 'md'}),
    output: Flags.string({char: 'o', description: 'Output file path.'}),
    json: Flags.boolean({char: 'j', description: 'Machine readable JSON summary.', default: false}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(VaultExport)
    const fromPath = resolve(process.cwd(), flags.from as string)
    const toPath = resolve(process.cwd(), flags.to as string)
    const format = ((flags.format as string) ?? 'md') as 'md' | 'csv'
    const asJson = (flags.json as boolean) ?? false

    let from: SnapshotFile
    let to: SnapshotFile
    try {
      from = loadSnapshot(fromPath)
      to = loadSnapshot(toPath)
    } catch (error: any) {
      const detail = `Could not read snapshots: ${(error?.message ?? String(error)).split('\n')[0]}`
      if (asJson) this.log(JSON.stringify({status: 'error', detail}, null, 2))
      else this.log(detail)
      this.exit(1)
    }

    const diff = diffRecords((from as SnapshotFile).records, (to as SnapshotFile).records)
    const stamp = new Date().toISOString().slice(0, 10)
    const outPath = resolve(process.cwd(),
      (flags.output as string | undefined) ?? `./changeset-${(from as SnapshotFile).snapshotId}-${stamp}.${format}`)

    let body: string
    if (format === 'csv') {
      const rows = ['change,key,fields,detail']
      for (const r of diff.added) rows.push(['added', JSON.stringify(r)].map(csvCell).join(','))
      for (const r of diff.removed) rows.push(['removed', JSON.stringify(r)].map(csvCell).join(','))
      for (const c of diff.changed) rows.push(['changed', c.key, c.fields.join('|'), `before=${JSON.stringify(c.before).slice(0, 200)} after=${JSON.stringify(c.after).slice(0, 200)}`].map(csvCell).join(','))
      body = rows.join('\n') + '\n'
    } else {
      const lines: string[] = []
      lines.push(`# Changeset: ${(from as SnapshotFile).snapshotId} to ${(to as SnapshotFile).snapshotId}`)
      lines.push('')
      lines.push(`Template ${(to as SnapshotFile).templateName ?? (to as SnapshotFile).templateId}, story ${(to as SnapshotFile).story ?? 'none'}. Generated ${new Date().toISOString()} by agentia vault export.`)
      lines.push('')
      lines.push(`Added ${diff.added.length}, removed ${diff.removed.length}, changed ${diff.changed.length}.`)
      lines.push('')
      lines.push('## Review checklist')
      lines.push('')
      lines.push('- [ ] Every added record is expected in the target.')
      lines.push('- [ ] Every removed record has a recorded reason.')
      lines.push('- [ ] Every changed field value is correct.')
      lines.push('')
      for (const c of diff.changed.slice(0, 50)) {
        lines.push(`### Changed ${c.key}: ${c.fields.join(', ')}`)
        lines.push('')
      }
      if (diff.changed.length > 50) lines.push(`Plus ${diff.changed.length - 50} further changed records in JSON, omitted for length.`)
      lines.push('')
      body = lines.join('\n')
    }
    writeFileSync(outPath, body, 'utf8')

    const payload = {
      status: diff.identical ? 'identical' : 'exported',
      from: (from as SnapshotFile).snapshotId,
      to: (to as SnapshotFile).snapshotId,
      added: diff.added.length,
      removed: diff.removed.length,
      changed: diff.changed.length,
      file: outPath,
    }
    if (asJson) {
      this.log(JSON.stringify(payload, null, 2))
    } else {
      this.log(`Changeset written to ${outPath}: +${diff.added.length} added, -${diff.removed.length} removed, ~${diff.changed.length} changed.`)
    }
  }
}
