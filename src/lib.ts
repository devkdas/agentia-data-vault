// Shared helpers for the vault commands. Only shells out to public agentia
// commands and the local filesystem. No private Agentia imports.
import {execFileSync} from 'node:child_process'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'
import {randomBytes} from 'node:crypto'

export function runAgentia(args: string[], timeoutMs = 60_000): string {
  return execFileSync('agentia', args, {encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe']})
}

export function runAgentiaWithInput(args: string[], input: string, timeoutMs = 120_000): string {
  return execFileSync('agentia', args, {encoding: 'utf8', timeout: timeoutMs, input, stdio: ['pipe', 'pipe', 'pipe']})
}

export function parseJson(out: string): any {
  return JSON.parse(out)
}

export function asRecordArray(node: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(node)) return node.filter((r) => typeof r === 'object' && r !== null) as Array<Record<string, unknown>>
  if (typeof node === 'object' && node !== null) {
    const obj = node as Record<string, unknown>
    for (const key of ['records', 'data', 'result', 'items', 'rows']) {
      const nested = asRecordArray(obj[key])
      if (nested.length > 0 || key in obj) return nested
    }
  }
  return []
}

export interface SnapshotFile {
  vaultVersion: number
  snapshotId: string
  createdAt: string
  story: string | null
  templateId: string
  templateName: string | null
  credentialId: string
  graph: unknown
  records: Array<Record<string, unknown>>
}

export function snapshotPath(outDir: string, templateName: string, snapshotId: string): string {
  const safe = (templateName || 'template').replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 60)
  return join(outDir, `vault-${safe}-${snapshotId}.json`)
}

export function makeSnapshotId(): string {
  const now = new Date()
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const rand = randomBytes(3).toString('hex')
  return `${stamp}-${rand}`
}

export function recordKey(record: Record<string, unknown>, index: number): string {
  for (const key of ['Id', 'id', 'ID', 'ExternalId', 'Name']) {
    const v = record[key]
    if (typeof v === 'string' && v !== '') return `${key}:${v}`
  }
  return `#${index}`
}

export interface DiffResult {
  identical: boolean
  added: Array<Record<string, unknown>>
  removed: Array<Record<string, unknown>>
  changed: Array<{key: string; fields: string[]; before: Record<string, unknown>; after: Record<string, unknown>}>
}

export function diffRecords(
  before: Array<Record<string, unknown>>,
  after: Array<Record<string, unknown>>,
): DiffResult {
  const beforeMap = new Map<string, Record<string, unknown>>()
  before.forEach((r, i) => beforeMap.set(recordKey(r, i), r))
  const afterMap = new Map<string, Record<string, unknown>>()
  after.forEach((r, i) => afterMap.set(recordKey(r, i), r))

  const added: Array<Record<string, unknown>> = []
  const removed: Array<Record<string, unknown>> = []
  const changed: DiffResult['changed'] = []

  for (const [key, afterRec] of afterMap) {
    const beforeRec = beforeMap.get(key)
    if (!beforeRec) {
      added.push(afterRec)
      continue
    }
    const fields: string[] = []
    for (const field of new Set([...Object.keys(beforeRec), ...Object.keys(afterRec)])) {
      if (JSON.stringify(beforeRec[field]) !== JSON.stringify(afterRec[field])) fields.push(field)
    }
    if (fields.length > 0) changed.push({key, fields: fields.slice(0, 20), before: beforeRec, after: afterRec})
  }
  for (const [key, beforeRec] of beforeMap) {
    if (!afterMap.has(key)) removed.push(beforeRec)
  }

  return {identical: added.length === 0 && removed.length === 0 && changed.length === 0, added, removed, changed}
}

export interface PendingRestore {
  code: string
  snapshotId: string
  story: string | null
  createdAt: string
  expiresAt: string
  approved: boolean
  approvedAt: string | null
}

export const RESTORE_TTL_MS = 24 * 60 * 60 * 1000

function pendingPath(): string {
  return join(homedir(), '.agentia-data-vault', 'pending.json')
}

export function loadPendingRestores(): PendingRestore[] {
  try {
    if (!existsSync(pendingPath())) return []
    const parsed: unknown = JSON.parse(readFileSync(pendingPath(), 'utf8'))
    return Array.isArray(parsed) ? (parsed as PendingRestore[]) : []
  } catch {
    return []
  }
}

export function savePendingRestores(records: PendingRestore[]): void {
  mkdirSync(join(homedir(), '.agentia-data-vault'), {recursive: true})
  writeFileSync(pendingPath(), JSON.stringify(records, null, 2), 'utf8')
}

export function makeRestoreCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(6)
  let code = 'VR-'
  for (const b of bytes) code += alphabet[b % alphabet.length]
  return code
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, {recursive: true})
}
