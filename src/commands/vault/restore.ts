import {Command, Flags} from '@oclif/core'
import {readFileSync} from 'node:fs'
import {
  RESTORE_TTL_MS,
  loadPendingRestores,
  makeRestoreCode,
  parseJson,
  runAgentiaWithInput,
  savePendingRestores,
  type PendingRestore,
  type SnapshotFile,
} from '../../lib.js'

export default class VaultRestore extends Command {
  static description = 'Restore a vault snapshot through a data commit, gated by approval plus explicit confirm.'

  static examples = [
    '<%= config.bin %> <%= command.id %> --snapshot vault-x.json --story US-0000024',
    '<%= config.bin %> <%= command.id %> --snapshot vault-x.json --story US-0000024 --approve-code VR-XXXXXX --yes',
  ]

  static flags = {
    snapshot: Flags.string({description: 'Snapshot file to restore.', required: true}),
    story: Flags.string({char: 's', description: 'User story ID receiving the data commit.'}),
    'approve-code': Flags.string({description: 'One time restore approval code.'}),
    yes: Flags.boolean({char: 'y', description: 'Confirm the destructive restore.', default: false}),
    json: Flags.boolean({char: 'j', description: 'Machine readable JSON output.', default: false}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(VaultRestore)
    const snapshotPath = flags.snapshot as string
    const story = (flags.story as string | undefined) ?? null
    const approveCode = (flags['approve-code'] as string | undefined) ?? null
    const confirmed = (flags.yes as boolean) ?? false
    const asJson = (flags.json as boolean) ?? false

    let snapshot: SnapshotFile
    try {
      const parsed: unknown = JSON.parse(readFileSync(snapshotPath, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as any).records)) {
        throw new Error('not a vault snapshot file')
      }
      snapshot = parsed as SnapshotFile
    } catch (error: any) {
      const detail = `Could not read snapshot: ${(error?.message ?? String(error)).split('\n')[0]}`
      if (asJson) this.log(JSON.stringify({status: 'error', detail}, null, 2))
      else this.log(detail)
      this.exit(1)
    }

    const now = Date.now()
    const live = loadPendingRestores().filter((r) => Date.parse(r.expiresAt) > now)
    savePendingRestores(live)

    const respond = (status: string, extra: Record<string, unknown>, exitCode: number | null, lines: string[]) => {
      if (asJson) this.log(JSON.stringify({status, snapshotId: (snapshot as SnapshotFile).snapshotId, story, ...extra}, null, 2))
      else for (const line of lines) this.log(line)
      if (exitCode !== null) this.exit(exitCode)
    }

    if (!approveCode) {
      const existing = live.find((r) => r.snapshotId === (snapshot as SnapshotFile).snapshotId && (r.story ?? null) === story)
      const record: PendingRestore = existing ?? {
        code: makeRestoreCode(),
        snapshotId: (snapshot as SnapshotFile).snapshotId,
        story,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(now + RESTORE_TTL_MS).toISOString(),
        approved: false,
        approvedAt: null,
      }
      if (!existing) {
        live.push(record)
        savePendingRestores(live)
      }
      respond(
        'approval-required',
        {code: record.code, recordCount: (snapshot as SnapshotFile).records.length},
        1,
        [
          `Restore of ${(snapshot as SnapshotFile).records.length} records needs approval. Code ${record.code} issued.`,
          `Approve it, then re-run with --approve-code ${record.code} --yes to send the data commit.`,
          'Without --yes this command only previews and changes nothing.',
        ],
      )
    }

    const match = live.find((r) => r.code === approveCode)
    if (!match) {
      respond('blocked', {}, 1, ['Unknown or already consumed restore code. Run restore without a code to issue one.'])
    }
    if ((match as PendingRestore).snapshotId !== (snapshot as SnapshotFile).snapshotId || ((match as PendingRestore).story ?? null) !== story) {
      respond('blocked', {}, 1, [`Code ${approveCode} was issued for a different snapshot or story.`])
    }

    if (!confirmed) {
      const body = {
        userStoryId: story,
        dataTemplateId: (snapshot as SnapshotFile).templateId,
        recordCount: (snapshot as SnapshotFile).records.length,
        snapshotId: (snapshot as SnapshotFile).snapshotId,
      }
      respond(
        'preview',
        {code: approveCode, commitBody: body},
        1,
        [
          `Dry run only. Would create a data commit for story ${story ?? 'none'} with ${(snapshot as SnapshotFile).records.length} records from snapshot ${(snapshot as SnapshotFile).snapshotId}.`,
          `Commit body: ${JSON.stringify(body)}`,
          'Re-run with --yes to send cicd data commit create.',
        ],
      )
    }

    try {
      const body = JSON.stringify({
        userStoryId: story,
        dataTemplateId: (snapshot as SnapshotFile).templateId,
        snapshotId: (snapshot as SnapshotFile).snapshotId,
        records: (snapshot as SnapshotFile).records,
      })
      const out = runAgentiaWithInput(['cicd', 'data', 'commit', 'create', '--stdin', '--json'], body)
      savePendingRestores(live.filter((r) => r.code !== approveCode))
      const parsed = parseJson(out)
      respond('restored', {commit: parsed?.result ?? parsed}, null, [
        `Restore sent for story ${story ?? 'none'} from snapshot ${(snapshot as SnapshotFile).snapshotId}.`,
      ])
    } catch (error: any) {
      const raw = error?.stdout ? String(error.stdout) : (error?.message ?? String(error))
      respond('error', {cliOutput: raw.split('\n').slice(0, 20).join('\n')}, 1, [
        'Restore was rejected by the CLI. Nothing was approved twice and the code stays valid.',
        raw.split('\n').slice(0, 8).join('\n'),
      ])
    }
  }
}
