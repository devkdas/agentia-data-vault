import {Command, Flags} from '@oclif/core'
import {writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {
  asRecordArray,
  ensureDir,
  makeSnapshotId,
  parseJson,
  runAgentia,
  snapshotPath,
  type SnapshotFile,
} from '../../lib.js'

function resolveTemplateId(template: string): {id: string; name: string | null} {
  try {
    const out = runAgentia(['cicd', 'data', 'template', 'get', template, '--json'])
    const parsed = parseJson(out)
    const node = parsed?.result ?? parsed
    const id = typeof node?.id === 'string' ? node.id : template
    const name = typeof node?.name === 'string' ? node.name : null
    return {id, name}
  } catch {
    const out = runAgentia(['cicd', 'data', 'template', 'list', '--name', template, '--json'])
    const parsed = parseJson(out)
    const rows = asRecordArray(parsed?.result?.data ?? parsed?.result ?? parsed)
    if (rows.length === 0) throw new Error(`No data template found for "${template}".`)
    const first = rows[0]
    const id = typeof first['id'] === 'string' ? (first['id'] as string) : template
    const name = typeof first['name'] === 'string' ? (first['name'] as string) : template
    return {id, name}
  }
}

export default class VaultSnapshot extends Command {
  static description = 'Snapshot a data template export graph plus records into a versioned file.'

  static examples = [
    '<%= config.bin %> <%= command.id %> --template "Account Seed" --credential-id a11xxx --story US-0000024',
    '<%= config.bin %> <%= command.id %> --template a0Xxxx --credential-id a11xxx --output-dir ./vault --json',
  ]

  static flags = {
    template: Flags.string({char: 't', description: 'Data template name or ID.', required: true}),
    'credential-id': Flags.string({description: 'Org credential ID for record search.', required: true}),
    story: Flags.string({char: 's', description: 'User story ID owning this snapshot.'}),
    'output-dir': Flags.string({char: 'o', description: 'Directory for snapshot files.', default: './vault'}),
    json: Flags.boolean({char: 'j', description: 'Machine readable JSON summary.', default: false}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(VaultSnapshot)
    const templateArg = flags.template as string
    const credentialId = flags['credential-id'] as string
    const story = (flags.story as string | undefined) ?? null
    const outDir = resolve(process.cwd(), (flags['output-dir'] as string) ?? './vault')
    const asJson = (flags.json as boolean) ?? false

    let resolved: {id: string; name: string | null}
    try {
      resolved = resolveTemplateId(templateArg)
    } catch (error: any) {
      const detail = `Template resolution failed: ${(error?.message ?? String(error)).split('\n')[0]}`
      if (asJson) this.log(JSON.stringify({status: 'error', detail}, null, 2))
      else this.log(detail)
      this.exit(1)
    }

    let graph: unknown = null
    try {
      const out = runAgentia(['cicd', 'data', 'template', 'get', (resolved as {id: string}).id, '--json'])
      graph = parseJson(out)?.result ?? parseJson(out)
    } catch {
      graph = null
    }

    let records: Array<Record<string, unknown>> = []
    try {
      const out = runAgentia([
        'cicd',
        'data',
        'records',
        'search',
        '--credential-id',
        credentialId,
        '--data-template-id',
        (resolved as {id: string}).id,
        '--json',
      ])
      const parsed = parseJson(out)
      records = asRecordArray(parsed?.result ?? parsed)
    } catch (error: any) {
      const detail = `Record search failed: ${(error?.message ?? String(error)).split('\n')[0]}`
      if (asJson) this.log(JSON.stringify({status: 'error', detail}, null, 2))
      else this.log(detail)
      this.exit(1)
    }

    const snapshotId = makeSnapshotId()
    const snapshot: SnapshotFile = {
      vaultVersion: 1,
      snapshotId,
      createdAt: new Date().toISOString(),
      story,
      templateId: (resolved as {id: string}).id,
      templateName: (resolved as {name: string | null}).name,
      credentialId,
      graph,
      records,
    }

    ensureDir(outDir)
    const file = snapshotPath(outDir, snapshot.templateName ?? snapshot.templateId, snapshotId)
    writeFileSync(file, JSON.stringify(snapshot, null, 2), 'utf8')

    const summary = {
      status: 'captured',
      snapshotId,
      file,
      story,
      templateId: snapshot.templateId,
      templateName: snapshot.templateName,
      recordCount: records.length,
      graphCaptured: graph !== null,
    }
    if (asJson) this.log(JSON.stringify(summary, null, 2))
    else this.log(`Snapshot ${snapshotId} captured: ${records.length} records from template ${snapshot.templateName ?? snapshot.templateId} into ${file}.`)
  }
}
