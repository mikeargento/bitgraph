/**
 * The browser's recovery queue: after a tree is minted, its sealed recovery
 * entries (recovery.ts) are written to POST /api/recovery from here, in the
 * background, until every member's entries are in.
 *
 *   const q = browserRecoveryQueue();
 *   q.resume();                                  // once per page load: picks up whatever a closed tab left
 *   const { id } = await q.enqueueTree({ ...madeTree, keepRecoveryCopy });
 *   q.fileStatus(id, member.leafIndex);          // "pending" | "recoverable" | "blocked" | "not-kept"
 *   q.subscribe((id) => ...);                    // after every batch
 *
 * WHAT IS PERSISTED, AND WHY NOT THE ENVELOPES. The obvious queue keeps the
 * sealed entries themselves, and it does not scale to the trees tree/1 makes:
 * a 100,000-file tree is 200,000 envelopes of up to 4 KB, hundreds of
 * megabytes, and the protocol allows ten times that. So a job keeps the
 * tree's own list instead (the owner's list: 65 bytes per leaf, the same
 * bytes an owner's export carries), the advisory names, and ONE PROGRESS BYTE
 * per member; batches are sealed at send time, with fresh nonces, from the
 * list. After a restart the list rebuilds the tree, is checked against the
 * root document again, and the queue carries on.
 *
 * Progress may be saved lazily (at most every persistEveryMs, and when a job
 * ends) because a rewrite costs nothing but a request: entry keys are
 * deterministic and writes create-only, so an entry written before a crash
 * answers "exists" the second time, opens to this same member, and counts.
 * Saving merges by OR, so progress only moves forward: two tabs working the
 * same job, or a stale save landing late, can never undo a kept entry.
 *
 * A FILE'S STATUS. "pending" until every entry it needs is kept (two for a
 * placed file: origin and committed bytes; one as-is), then "recoverable".
 * A key that holds somebody else's entry (only someone who knows the file's
 * digest can do that, and it never counts as success: see
 * existingEntryHoldsMember) is not the end of it: the entry is written again
 * under its salted name (SPEC section 13), with a fresh salt saved in the job
 * BEFORE the write so a retry lands on the same name. "blocked" only when the
 * salted name is held too; the file's other entry is still written, so it
 * may be recoverable from one of its two forms. "not-kept" for a tree marked
 * "keep no recovery copy": nothing is written for it, nothing of its files is
 * stored here, only a marker that says so.
 *
 * RETRIES. A request that fails (network, 429, 503 with writes off, anything
 * not 200) is sent again after a backoff that doubles from 1 s to 5 min with
 * jitter; entries answered "conflict" or "error" are retried on the next
 * pass. Nothing gives up: a pending entry stays pending, persisted, until it
 * is written.
 */

import {
  base64ToBytes,
  bytesEqual,
  bytesToBase64,
  bytesToHex,
  hexToBytes,
  parseTreeRootDocument,
  readTreeMetadata,
  TREE_LEAF_BYTES,
} from "@mikeargento/bitgraph-verify";
import {
  MAX_BATCH_ENTRIES,
  RECOVERY_SIDE_BITS,
  RecoveryInputError,
  existingEntryHoldsMember,
  findOwnRecoveryEntry,
  leavesBytesOf,
  newRecoverySalt,
  recoveryDigestOf,
  recoveryMemberStatus,
  recoveryPlaintextFor,
  recoveryProofParts,
  recoverySaltKey,
  recoverySaltsFor,
  recoverySideResolved,
  recoverySideState,
  recoverySidesOf,
  recoveryTreeFrom,
  recoveryTreeFromParts,
  sealRecoveryMember,
  type FetchLike,
  type RecoveredEntry,
  type RecoveryLocator,
  type RecoveryPlaintext,
  type RecoverySide,
  type RecoverySideState,
  type RecoveryTree,
  type RecoveryTreeInput,
  type RecoveryWrite,
} from "./recovery.ts";

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type RecoveryFileStatus = "pending" | "recoverable" | "blocked" | "not-kept";
export type { RecoverySideState };

// The progress byte (one per member) and its readers live in recovery.ts
// (RECOVERY_SIDE_BITS, recoveryMemberStatus, recoverySideState), shared with
// the CLI's writer so a job saved by either reads the same.

/** OR two progress records; the longer length wins (they are always equal in practice). */
export function mergeProgressBytes(stored: unknown, incoming: Uint8Array): Uint8Array {
  const a = stored instanceof Uint8Array ? stored : new Uint8Array(0);
  const out = new Uint8Array(Math.max(a.length, incoming.length));
  for (let i = 0; i < out.length; i++) out[i] = (a[i] ?? 0) | (incoming[i] ?? 0);
  return out;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export interface RecoveryJobRecord {
  /** Lowercase hex of the proof hash: one job per recording. */
  id: string;
  createdAt: number;
  /** False: the tree was marked "keep no recovery copy". */
  keep: boolean;
  count: number;
  /** base64 computeProofHash(proof). */
  proofHash: string;
  locator: RecoveryLocator;
  /** The root document, hex; null for a tree kept nowhere. */
  rootDocument: string | null;
  /** The owner's list (count x 65 bytes, tree order) while the job has work; null once done, and always for a tree kept nowhere. */
  leaves: Uint8Array | null;
  /** A name per leaf, tree order; null once done. */
  names: Array<string | null> | null;
  /** Salts chosen for entries whose deterministic key was held, base64 by recoverySaltKey (recovery.ts); saved before the salted write. Absent on jobs saved before 2026-10-03. */
  salts?: Record<string, string>;
  done: boolean;
}

export interface RecoveryQueueStore {
  loadJobs(): Promise<RecoveryJobRecord[]>;
  saveJob(job: RecoveryJobRecord): Promise<void>;
  loadProgress(id: string): Promise<Uint8Array | null>;
  /** OR `progress` into what is stored, store the result, and return it. */
  mergeProgress(id: string, progress: Uint8Array): Promise<Uint8Array>;
  /** Add `salts` to the stored job's salts, a salt already stored winning (two tabs never end up with two salts for one side), and return the merged table. */
  mergeSalts(id: string, salts: Record<string, string>): Promise<Record<string, string>>;
  deleteJob(id: string): Promise<void>;
}

/** The stored salts win: a salt already saved may already name an entry. */
export function mergeSaltTables(stored: Record<string, string> | undefined, incoming: Record<string, string>): Record<string, string> {
  return { ...incoming, ...(stored ?? {}) };
}

const cloneJob = (j: RecoveryJobRecord): RecoveryJobRecord => structuredClone(j);

/** The same contract in memory: tests, and the fallback where IndexedDB is unavailable (some private windows). `failing` makes every call throw. */
export class MemoryRecoveryQueueStore implements RecoveryQueueStore {
  readonly jobs = new Map<string, RecoveryJobRecord>();
  readonly progress = new Map<string, Uint8Array>();
  failing = false;

  private check(): void {
    if (this.failing) throw new Error("storage unavailable");
  }
  async loadJobs(): Promise<RecoveryJobRecord[]> {
    this.check();
    return [...this.jobs.values()].map(cloneJob);
  }
  async saveJob(job: RecoveryJobRecord): Promise<void> {
    this.check();
    this.jobs.set(job.id, cloneJob(job));
  }
  async loadProgress(id: string): Promise<Uint8Array | null> {
    this.check();
    return this.progress.get(id)?.slice() ?? null;
  }
  async mergeProgress(id: string, progress: Uint8Array): Promise<Uint8Array> {
    this.check();
    const merged = mergeProgressBytes(this.progress.get(id), progress);
    this.progress.set(id, merged);
    return merged.slice();
  }
  async mergeSalts(id: string, salts: Record<string, string>): Promise<Record<string, string>> {
    this.check();
    const job = this.jobs.get(id);
    if (job === undefined) throw new Error("no such job");
    const merged = mergeSaltTables(job.salts, salts);
    this.jobs.set(id, { ...job, salts: merged });
    return { ...merged };
  }
  async deleteJob(id: string): Promise<void> {
    this.check();
    this.jobs.delete(id);
    this.progress.delete(id);
  }
}

const DB_NAME = "bitgraph-recovery";
const DB_VERSION = 1;
const JOBS = "jobs";
const PROGRESS = "progress";

/**
 * IndexedDB, database "bitgraph-recovery": store "jobs" (the record above,
 * keyed by id) and store "progress" (the progress bytes, keyed by id). Its own
 * database rather than a store in "bitgraph-files": adding a store there is
 * a version bump at every open() site (file-cache.ts). Every read-modify-
 * write happens inside one transaction's callbacks, never across an await,
 * so the transaction cannot auto-commit halfway through a merge.
 */
export class IndexedDbRecoveryQueueStore implements RecoveryQueueStore {
  private db: Promise<IDBDatabase> | null = null;
  private readonly dbName: string;

  constructor(dbName: string = DB_NAME) {
    this.dbName = dbName;
  }

  private open(): Promise<IDBDatabase> {
    if (this.db === null) {
      const opening = new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(this.dbName, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(JOBS)) db.createObjectStore(JOBS);
          if (!db.objectStoreNames.contains(PROGRESS)) db.createObjectStore(PROGRESS);
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => {
            db.close();
            this.db = null;
          };
          resolve(db);
        };
        req.onerror = () => reject(req.error ?? new Error("the recovery database could not be opened"));
        req.onblocked = () => reject(new Error("the recovery database is held open by an older tab"));
      });
      opening.catch(() => {
        this.db = null;
      });
      this.db = opening;
    }
    return this.db;
  }

  private async run<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction, set: (v: T) => void) => void): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value: T | undefined;
      tx.oncomplete = () => resolve(value as T);
      tx.onerror = () => reject(tx.error ?? new Error("recovery database transaction failed"));
      tx.onabort = () => reject(tx.error ?? new Error("recovery database transaction aborted"));
      work(tx, (v) => {
        value = v;
      });
    });
  }

  loadJobs(): Promise<RecoveryJobRecord[]> {
    return this.run<RecoveryJobRecord[]>([JOBS], "readonly", (tx, set) => {
      const r = tx.objectStore(JOBS).getAll();
      r.onsuccess = () => set((r.result as RecoveryJobRecord[]) ?? []);
    });
  }

  saveJob(job: RecoveryJobRecord): Promise<void> {
    return this.run<void>([JOBS], "readwrite", (tx) => {
      tx.objectStore(JOBS).put(job, job.id);
    });
  }

  loadProgress(id: string): Promise<Uint8Array | null> {
    return this.run<Uint8Array | null>([PROGRESS], "readonly", (tx, set) => {
      const r = tx.objectStore(PROGRESS).get(id);
      r.onsuccess = () => set(r.result instanceof Uint8Array ? r.result : null);
    });
  }

  mergeProgress(id: string, progress: Uint8Array): Promise<Uint8Array> {
    return this.run<Uint8Array>([PROGRESS], "readwrite", (tx, set) => {
      const store = tx.objectStore(PROGRESS);
      const r = store.get(id);
      r.onsuccess = () => {
        const merged = mergeProgressBytes(r.result, progress);
        store.put(merged, id);
        set(merged);
      };
    });
  }

  mergeSalts(id: string, salts: Record<string, string>): Promise<Record<string, string>> {
    return this.run<Record<string, string>>([JOBS], "readwrite", (tx, set) => {
      const store = tx.objectStore(JOBS);
      const r = store.get(id);
      r.onsuccess = () => {
        const job = r.result as RecoveryJobRecord | undefined;
        if (job === undefined) {
          tx.abort();
          return;
        }
        const merged = mergeSaltTables(job.salts, salts);
        store.put({ ...job, salts: merged }, id);
        set(merged);
      };
    });
  }

  deleteJob(id: string): Promise<void> {
    return this.run<void>([JOBS, PROGRESS], "readwrite", (tx) => {
      tx.objectStore(JOBS).delete(id);
      tx.objectStore(PROGRESS).delete(id);
    });
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface RecoveryPostEntry {
  key: string;
  /** Standard base64. */
  envelope: string;
}

export type RecoveryPostResult =
  | { key: string; status: "created" }
  | { key: string; status: "exists"; envelope: string }
  | { key: string; status: "conflict" }
  | { key: string; status: "error" };

export interface RecoveryTransport {
  /** One request; throws when it fails as a whole. Results may come back in any order; a key with no result is retried. */
  post(entries: RecoveryPostEntry[]): Promise<RecoveryPostResult[]>;
}

export class RecoveryTransportError extends Error {
  /** The HTTP status, or null when there was no usable answer. */
  readonly status: number | null;

  constructor(status: number | null, message: string) {
    super(message);
    this.name = "RecoveryTransportError";
    this.status = status;
  }
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

/** The results of a POST, read strictly: only well-formed results for keys that were sent. */
export function parsePostResults(body: unknown, sent: readonly RecoveryPostEntry[]): RecoveryPostResult[] {
  if (!isPlainObject(body) || !Array.isArray(body["results"])) throw new RecoveryTransportError(null, "the answer is not { results }");
  const keys = new Set(sent.map((e) => e.key));
  const out: RecoveryPostResult[] = [];
  for (const r of body["results"] as unknown[]) {
    if (!isPlainObject(r) || typeof r["key"] !== "string" || !keys.has(r["key"])) continue;
    const key = r["key"];
    const status = r["status"];
    if (status === "created" || status === "conflict" || status === "error") out.push({ key, status });
    else if (status === "exists" && typeof r["envelope"] === "string") out.push({ key, status, envelope: r["envelope"] });
  }
  return out;
}

/** POST /api/recovery on this origin (or baseUrl). */
export function httpRecoveryTransport(opts: { fetch?: FetchLike; baseUrl?: string; timeoutMs?: number } = {}): RecoveryTransport {
  return {
    async post(entries) {
      const f: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
      const res = await f(`${opts.baseUrl ?? ""}/api/recovery`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries }),
        cache: "no-store",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
      });
      if (!res.ok) throw new RecoveryTransportError(res.status, `POST /api/recovery answered ${res.status}`);
      return parsePostResults(await res.json(), entries);
    },
  };
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export interface RecoveryEnqueueInput extends RecoveryTreeInput {
  /** A file name per leaf, tree order (fuse-tree-make's MadeTree.names). Advisory, sealed with each entry. */
  names?: ReadonlyArray<string | null | undefined>;
  /** False marks the tree "keep no recovery copy": nothing is written for it. Default true. */
  keepRecoveryCopy?: boolean;
}

export interface RecoveryEnqueueResult {
  id: string;
  count: number;
  keep: boolean;
  /** False when the job could not be saved (no IndexedDB, quota): it is worked in memory and lost with the tab. */
  persisted: boolean;
}

export interface RecoveryTreeStatus {
  id: string;
  count: number;
  keep: boolean;
  recoverable: number;
  pending: number;
  blocked: number;
  /** Every entry this tree needs is kept or blocked. */
  done: boolean;
  persisted: boolean;
  /** Why a resumed job cannot be worked (its saved list no longer rebuilds the root), else null. */
  broken: string | null;
}

export interface RecoveryQueueOptions {
  store: RecoveryQueueStore;
  transport: RecoveryTransport;
  /** Reads the recovery routes (GET /api/recovery/<address>) before a salted write, to find an entry of the member already there. Default: fetch on this origin. */
  lookupFetch?: FetchLike;
  baseUrl?: string;
  /** Entries per request; at most MAX_BATCH_ENTRIES. */
  maxBatchEntries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Progress is saved at most this often while a job runs, and always when it ends. */
  persistEveryMs?: number;
  /** Tests replace the timer; the real one is cut short by wake(). */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  log?: (line: string) => void;
}

interface LiveJob {
  rec: RecoveryJobRecord;
  progress: Uint8Array;
  tree: RecoveryTree | null;
  broken: string | null;
  cursor: number;
  dirty: boolean;
  persisted: boolean;
  lastPersist: number;
  recoverable: number;
  blocked: number;
  /** Members with an entry still to write. */
  unresolved: number;
}

interface PlannedWrite {
  index: number;
  plaintext: RecoveryPlaintext;
  write: RecoveryWrite;
}

interface Batch {
  job: LiveJob;
  start: number;
  writes: PlannedWrite[];
  entries: RecoveryPostEntry[];
}

/** The job id of a recording: lowercase hex of its proof hash. */
export function recoveryJobId(proofHash: string): string {
  const b = base64ToBytes(proofHash);
  if (b === null || b.length !== 32) throw new RecoveryInputError("the proof hash is not the base64 of 32 bytes");
  return bytesToHex(b);
}

function checkNames(names: RecoveryEnqueueInput["names"], count: number): Array<string | null> | null {
  if (names === undefined || names === null) return null;
  if (!Array.isArray(names) || names.length !== count) throw new RecoveryInputError(`names lists ${Array.isArray(names) ? names.length : "no"} entries for ${count} leaves`);
  return names.map((n) => (typeof n === "string" && n.length > 0 ? n : null));
}

export class RecoveryQueue {
  private readonly jobs = new Map<string, LiveJob>();
  private readonly listeners = new Set<(id: string) => void>();
  private readonly wakers = new Set<() => void>();
  private loaded: Promise<void> | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;
  private readonly maxBatch: number;
  private readonly opts: RecoveryQueueOptions;

  constructor(opts: RecoveryQueueOptions) {
    this.opts = opts;
    this.maxBatch = Math.max(2, Math.min(MAX_BATCH_ENTRIES, opts.maxBatchEntries ?? MAX_BATCH_ENTRIES));
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private log(line: string): void {
    (this.opts.log ?? ((l: string) => console.warn(l)))(line);
  }

  // ── Loading and enqueueing ──

  /** Load every saved job once (idempotent). */
  private load(): Promise<void> {
    if (this.loaded === null) {
      this.loaded = (async () => {
        let records: RecoveryJobRecord[] = [];
        try {
          records = await this.opts.store.loadJobs();
        } catch (e) {
          this.log(`[recovery] saved jobs could not be read: ${(e as Error).message}`);
        }
        for (const rec of records) {
          if (this.jobs.has(rec.id)) continue;
          let progress: Uint8Array | null = null;
          try {
            progress = await this.opts.store.loadProgress(rec.id);
          } catch {
            progress = null;
          }
          this.adopt(rec, progress, true);
        }
      })();
    }
    return this.loaded;
  }

  /** Pick up every job a previous page left, and work them. Call once per page load; later calls only make sure the work is running. */
  async resume(): Promise<void> {
    await this.load();
    for (const id of this.jobs.keys()) this.emit(id);
    this.kick();
  }

  private adopt(rec: RecoveryJobRecord, saved: Uint8Array | null, persisted: boolean): LiveJob {
    const progress = new Uint8Array(rec.count);
    if (saved !== null) progress.set(saved.subarray(0, rec.count));
    const job: LiveJob = {
      rec, progress, tree: null, broken: null, cursor: 0, dirty: false, persisted,
      lastPersist: this.now(), recoverable: 0, blocked: 0, unresolved: 0,
    };
    this.recount(job);
    this.jobs.set(rec.id, job);
    return job;
  }

  /** The sides member `index` needs, from the job's own list (present while the job has work). */
  private sidesOf(job: LiveJob, index: number): RecoverySide[] {
    const leaves = job.tree?.leaves ?? job.rec.leaves;
    return leaves === null ? [] : recoverySidesOf({ leaves }, index);
  }

  private recount(job: LiveJob): void {
    let recoverable = 0;
    let blocked = 0;
    let unresolved = 0;
    const working = job.rec.keep && !job.rec.done && job.rec.leaves !== null;
    for (let i = 0; i < job.rec.count; i++) {
      const b = job.progress[i]!;
      const s = recoveryMemberStatus(b);
      if (s === "recoverable") recoverable++;
      else if (s === "blocked") blocked++;
      if (working && this.sidesOf(job, i).some((side) => !recoverySideResolved(b, side))) unresolved++;
    }
    job.recoverable = recoverable;
    job.blocked = blocked;
    job.unresolved = unresolved;
  }

  /**
   * Queue a minted tree. Everything is checked first (recoveryTreeFrom: the
   * proof is tree/1 with a position, the root document hashes to its signed
   * digest, the list rebuilds the root), and a tree that fails is refused
   * with a RecoveryInputError before anything is saved or sent. Enqueueing
   * the same recording again returns the job already there; a tree first
   * marked "keep no recovery copy" may be enqueued again to keep one, but a
   * kept tree is never turned off (what was written stays written).
   */
  async enqueueTree(input: RecoveryEnqueueInput): Promise<RecoveryEnqueueResult> {
    await this.load();
    const keep = input.keepRecoveryCopy !== false;
    const { proofHash, locator } = recoveryProofParts(input.proof);
    const id = recoveryJobId(proofHash);
    const existing = this.jobs.get(id);
    // The same recording again is the job already there, unless that job was
    // saved broken (its list no longer rebuilds the root) and this call
    // brings a list that does: then the fresh data replaces it, and the
    // progress already made carries over.
    const repair = existing !== undefined && existing.broken !== null && existing.rec.keep && keep;
    if (existing !== undefined && !repair && (existing.rec.keep || !keep)) {
      return { id, count: existing.rec.count, keep: existing.rec.keep, persisted: existing.persisted };
    }

    let rec: RecoveryJobRecord;
    let tree: RecoveryTree | null = null;
    if (!keep) {
      // Nothing of the files is stored for a tree kept nowhere: only the
      // count, so every member can answer "not-kept".
      const doc = parseTreeRootDocument(input.rootDocument ?? readTreeMetadata(input.proof) ?? new Uint8Array(0));
      let count = doc?.count ?? 0;
      if (count === 0) {
        try {
          count = Math.floor(leavesBytesOf(input).length / TREE_LEAF_BYTES);
        } catch {
          count = 0;
        }
      }
      rec = { id, createdAt: this.now(), keep: false, count, proofHash, locator, rootDocument: null, leaves: null, names: null, done: true };
    } else {
      tree = recoveryTreeFrom(input);
      const names = checkNames(input.names, tree.count);
      rec = { id, createdAt: this.now(), keep: true, count: tree.count, proofHash, locator, rootDocument: tree.rootDocumentHex, leaves: tree.leaves, names, done: false };
    }
    let persisted = true;
    try {
      await this.opts.store.saveJob(rec);
    } catch (e) {
      persisted = false;
      this.log(`[recovery] job ${id.slice(0, 12)} could not be saved; it runs in memory only: ${(e as Error).message}`);
    }
    const job = this.adopt(rec, existing?.progress ?? null, persisted);
    job.tree = tree;
    this.emit(id);
    this.kick();
    return { id, count: rec.count, keep, persisted };
  }

  /** Remove a job and its progress from this browser (its entries stay on the server, create-only). */
  async forget(id: string): Promise<void> {
    this.jobs.delete(id);
    try {
      await this.opts.store.deleteJob(id);
    } catch (e) {
      this.log(`[recovery] job ${id.slice(0, 12)} could not be removed: ${(e as Error).message}`);
    }
    this.emit(id);
  }

  // ── Status ──

  jobIds(): string[] {
    return [...this.jobs.keys()];
  }

  status(id: string): RecoveryTreeStatus | null {
    const job = this.jobs.get(id);
    if (job === undefined) return null;
    const { count, keep, done } = job.rec;
    return {
      id, count, keep,
      recoverable: keep ? job.recoverable : 0,
      blocked: keep ? job.blocked : 0,
      pending: keep ? count - job.recoverable - job.blocked : 0,
      done: done || (keep && job.unresolved === 0 && job.broken === null),
      persisted: job.persisted,
      broken: job.broken,
    };
  }

  /** Member `index` (its leafIndex, tree order) of job `id`; null for an unknown job or index. */
  fileStatus(id: string, index: number): RecoveryFileStatus | null {
    const job = this.jobs.get(id);
    if (job === undefined) return null;
    if (!job.rec.keep) return "not-kept";
    if (!Number.isInteger(index) || index < 0 || index >= job.rec.count) return null;
    return recoveryMemberStatus(job.progress[index]!);
  }

  /** Each entry of member `index` on its own: the original's and the committed bytes' (the same for an as-is member). */
  fileDetail(id: string, index: number): { origin: RecoverySideState; artifact: RecoverySideState } | null {
    const job = this.jobs.get(id);
    if (job === undefined || !job.rec.keep || !Number.isInteger(index) || index < 0 || index >= job.rec.count) return null;
    const b = job.progress[index]!;
    return { origin: recoverySideState(b, "origin"), artifact: recoverySideState(b, "artifact") };
  }

  /**
   * The entries this browser still owes for a file: the members of working
   * jobs (trees made here whose writes are not all in) whose original or
   * committed bytes have this digest, in the shape a lookup returns. A file
   * dropped again before its entries land is found here, not called new.
   */
  async localEntriesFor(digest32: Uint8Array): Promise<Array<Omit<RecoveredEntry, "objectKey" | "entryId">>> {
    await this.load();
    const out: Array<Omit<RecoveredEntry, "objectKey" | "entryId">> = [];
    for (const job of this.jobs.values()) {
      if (!job.rec.keep || job.rec.done || job.rec.leaves === null) continue;
      const tree = this.treeOf(job);
      if (tree === null) continue;
      for (let i = 0; i < tree.count; i++) {
        const sides = recoverySidesOf(tree, i).filter((side) => bytesEqual(recoveryDigestOf(tree, i, side), digest32));
        if (sides.length === 0) continue;
        const { plaintext } = recoveryPlaintextFor(tree, i, job.rec.names?.[i] ?? null);
        out.push({
          salted: false,
          salt: null,
          matched: sides[0]!,
          proofHash: plaintext.proofHash,
          leafIndex: plaintext.leafIndex,
          rootDocument: plaintext.rootDocument,
          member: plaintext.member,
          proof: plaintext.proof,
          name: plaintext.name ?? null,
        });
      }
    }
    return out;
  }

  /** Called with a job id whenever that job's status may have changed. Returns the unsubscribe. */
  subscribe(listener: (id: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(id: string): void {
    for (const l of this.listeners) {
      try {
        l(id);
      } catch {
        /* a listener's failure is its own */
      }
    }
  }

  // ── The pump ──

  /** Cut a backoff short (the browser came back online, a new tree arrived). */
  wake(): void {
    for (const w of [...this.wakers]) w();
    this.kick();
  }

  /** Resolves when the work in flight is finished: every job done, or stop() called. */
  async idle(): Promise<void> {
    while (this.running !== null) await this.running;
  }

  /** Stop working (pending entries stay pending, and saved) and save what is unsaved. */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const w of [...this.wakers]) w();
    await this.idle();
    await this.persistDirty();
  }

  private kick(): void {
    if (this.running !== null || this.stopped) return;
    this.running = this.run().finally(() => {
      this.running = null;
    });
  }

  private nap(ms: number): Promise<void> {
    if (this.opts.sleep) return this.opts.sleep(ms);
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.wakers.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wakers.add(done);
    });
  }

  /** Attempt n (from 1) waits base x 2^(n-1), capped, with half of it jittered. */
  private delay(attempt: number): number {
    const base = this.opts.baseDelayMs ?? 1_000;
    const cap = this.opts.maxDelayMs ?? 300_000;
    const d = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
    return Math.round(d / 2 + (d / 2) * (this.opts.random ?? Math.random)());
  }

  private working(): LiveJob[] {
    return [...this.jobs.values()].filter((j) => j.rec.keep && !j.rec.done && j.broken === null && j.unresolved > 0);
  }

  private async run(): Promise<void> {
    // A saved job whose progress already covers every member (another tab
    // finished it, or the page closed between the last batch and the end)
    // is closed out here, so its list does not sit in storage.
    for (const job of this.jobs.values()) {
      if (job.rec.keep && !job.rec.done && job.rec.leaves !== null && job.broken === null && job.unresolved === 0) await this.finish(job);
    }
    let attempt = 0;
    let progressedThisPass = false;
    while (!this.stopped) {
      let batch: Batch | null;
      try {
        batch = await this.nextBatch();
      } catch (e) {
        this.log(`[recovery] a batch could not be built: ${(e as Error).message}`);
        return;
      }
      if (batch === null) {
        await this.persistDirty();
        if (this.working().length === 0 || this.stopped) return;
        // A pass ended with entries answered "conflict" or "error": wait,
        // then go round again from the start of every job.
        attempt = progressedThisPass ? 1 : attempt + 1;
        progressedThisPass = false;
        for (const j of this.working()) j.cursor = 0;
        await this.nap(this.delay(attempt));
        continue;
      }
      let results: RecoveryPostResult[];
      try {
        results = await this.opts.transport.post(batch.entries);
      } catch (e) {
        attempt++;
        batch.job.cursor = batch.start;
        const wait = this.delay(attempt);
        this.log(`[recovery] ${batch.entries.length} entries not sent (${(e as Error).message}); again in ${Math.round(wait / 1000)} s`);
        await this.nap(wait);
        continue;
      }
      if (await this.apply(batch, results)) {
        attempt = 0;
        progressedThisPass = true;
      }
      await this.afterBatch(batch.job);
      this.emit(batch.job.rec.id);
    }
  }

  private treeOf(job: LiveJob): RecoveryTree | null {
    if (job.tree !== null) return job.tree;
    try {
      job.tree = recoveryTreeFromParts({
        proofHash: job.rec.proofHash,
        locator: job.rec.locator,
        rootDocument: (job.rec.rootDocument !== null ? hexToBytes(job.rec.rootDocument) : null) ?? new Uint8Array(0),
        leaves: job.rec.leaves ?? new Uint8Array(0),
      });
      return job.tree;
    } catch (e) {
      job.broken = (e as Error).message;
      this.log(`[recovery] job ${job.rec.id.slice(0, 12)} cannot be worked: ${job.broken}`);
      this.emit(job.rec.id);
      return null;
    }
  }

  private async nextBatch(): Promise<Batch | null> {
    for (const job of this.working()) {
      if (job.cursor >= job.rec.count) continue;
      const tree = this.treeOf(job);
      if (tree === null) continue;
      const start = job.cursor;
      const members: Array<{ index: number; sides: RecoverySide[] }> = [];
      let n = 0;
      while (job.cursor < job.rec.count) {
        const i = job.cursor;
        const b = job.progress[i]!;
        const sides = recoverySidesOf(tree, i).filter((s) => !recoverySideResolved(b, s));
        if (sides.length > 0) {
          if (n + sides.length > this.maxBatch) break;
          members.push({ index: i, sides });
          n += sides.length;
        }
        job.cursor++;
      }
      if (members.length === 0) continue;
      let sealed: PlannedWrite[][];
      try {
        sealed = await Promise.all(members.map(async (m) => {
          const { plaintext, writes } = await sealRecoveryMember(tree, m.index, job.rec.names?.[m.index] ?? null, m.sides, recoverySaltsFor(job.rec.salts, m.index));
          return writes.map((write): PlannedWrite => ({ index: m.index, plaintext, write }));
        }));
      } catch (e) {
        // Sealing does not fail for a tree that passed its checks unless the
        // page cannot seal at all (no WebCrypto outside a secure context).
        // That job is set aside and named; the others carry on.
        job.cursor = start;
        job.broken = `entries could not be sealed: ${(e as Error).message}`;
        this.log(`[recovery] job ${job.rec.id.slice(0, 12)}: ${job.broken}`);
        this.emit(job.rec.id);
        continue;
      }
      const writes = sealed.flat();
      return { job, start, writes, entries: writes.map((w) => ({ key: w.write.objectKey, envelope: bytesToBase64(w.write.envelope) })) };
    }
    return null;
  }

  /** Apply one request's results. True when anything was kept, settled as blocked, or given a salted name to try. */
  private async apply(batch: Batch, results: RecoveryPostResult[]): Promise<boolean> {
    const byKey = new Map(results.map((r) => [r.key, r]));
    let progressed = false;
    const toSalt: Array<{ index: number; side: RecoverySide }> = [];
    for (const w of batch.writes) {
      const r = byKey.get(w.write.objectKey);
      if (r === undefined) continue;
      const bits = RECOVERY_SIDE_BITS[w.write.side];
      if (r.status === "created") {
        this.setBits(batch.job, w.index, bits.kept);
        progressed = true;
      } else if (r.status === "exists") {
        const there = base64ToBytes(r.envelope);
        // Not even base64 is our server's fault, not somebody's entry: it
        // stays pending.
        if (there === null) continue;
        const mine = await existingEntryHoldsMember(w.write.digest, w.write.objectKey, there, w.plaintext);
        if (mine) {
          this.setBits(batch.job, w.index, bits.kept);
        } else if (w.write.salted) {
          // Even the salted name is held: nothing more to try for this side.
          this.log(`[recovery] member ${w.index} of ${batch.job.rec.id.slice(0, 12)}: its salted ${w.write.side} key holds another entry too`);
          this.setBits(batch.job, w.index, bits.blocked);
        } else {
          // Another member's entry holds the deterministic key (SPEC section
          // 13, squatting). The same entry goes under a salted name on the
          // next pass; the salt is saved first, so a retry lands on the same
          // name. The side stays pending until then.
          this.log(`[recovery] member ${w.index} of ${batch.job.rec.id.slice(0, 12)}: its ${w.write.side} key holds another entry; trying a salted name`);
          toSalt.push({ index: w.index, side: w.write.side });
          continue;
        }
        progressed = true;
      }
      // "conflict" and "error" leave the entry pending for the next pass.
    }
    if (toSalt.length > 0 && (await this.saltFor(batch.job, toSalt))) progressed = true;
    return progressed;
  }

  /**
   * Salts for sides whose deterministic key is held, chosen and SAVED before
   * any write under them. First the address is read: an entry of the member
   * may already sit under a salted name (a tab whose save failed, a job
   * finished and gone); found, it counts and its salt is kept. The save
   * merges, so two tabs end with one salt per side. False when nothing could
   * be settled (the address unreadable, the save failed): the sides stay
   * pending and the pass backs off, and no salted write goes out unsaved.
   */
  private async saltFor(job: LiveJob, sides: ReadonlyArray<{ index: number; side: RecoverySide }>): Promise<boolean> {
    const tree = this.treeOf(job);
    if (tree === null) return false;
    const chosen: Record<string, string> = {};
    let settled = false;
    for (const s of sides) {
      const key = recoverySaltKey(s.index, s.side);
      if (job.rec.salts?.[key] !== undefined) continue;
      const digest = recoveryDigestOf(tree, s.index, s.side);
      const { plaintext } = recoveryPlaintextFor(tree, s.index, job.rec.names?.[s.index] ?? null);
      let own: Awaited<ReturnType<typeof findOwnRecoveryEntry>>;
      try {
        own = await findOwnRecoveryEntry(digest, plaintext, this.opts.lookupFetch ?? ((u, i) => fetch(u, i)), this.opts.baseUrl !== undefined ? { baseUrl: this.opts.baseUrl } : {});
      } catch (e) {
        this.log(`[recovery] member ${s.index} of ${job.rec.id.slice(0, 12)}: the address could not be read before a salted write (${(e as Error).message})`);
        continue;
      }
      if (own !== null) {
        this.setBits(job, s.index, RECOVERY_SIDE_BITS[s.side].kept);
        settled = true;
        if (own.salt !== null) chosen[key] = bytesToBase64(own.salt);
        continue;
      }
      chosen[key] = bytesToBase64(newRecoverySalt());
    }
    if (Object.keys(chosen).length === 0) return settled;
    if (!job.persisted) {
      // A job that runs in memory only (no storage): its salts live with it; a reload loses the tree anyway.
      job.rec = { ...job.rec, salts: mergeSaltTables(job.rec.salts, chosen) };
      return true;
    }
    try {
      const merged = await this.opts.store.mergeSalts(job.rec.id, chosen);
      job.rec = { ...job.rec, salts: merged };
      return true;
    } catch (e) {
      this.log(`[recovery] salts of ${job.rec.id.slice(0, 12)} could not be saved; no salted write until they are: ${(e as Error).message}`);
      return settled;
    }
  }

  private setBits(job: LiveJob, index: number, add: number): void {
    const before = job.progress[index]!;
    const after = before | add;
    if (after === before) return;
    const sides = this.sidesOf(job, index);
    const wasUnresolved = sides.some((s) => !recoverySideResolved(before, s));
    const isUnresolved = sides.some((s) => !recoverySideResolved(after, s));
    const s0 = recoveryMemberStatus(before);
    const s1 = recoveryMemberStatus(after);
    if (s0 !== s1) {
      if (s0 === "recoverable") job.recoverable--;
      if (s0 === "blocked") job.blocked--;
      if (s1 === "recoverable") job.recoverable++;
      if (s1 === "blocked") job.blocked++;
    }
    if (wasUnresolved && !isUnresolved) job.unresolved--;
    job.progress[index] = after;
    job.dirty = true;
  }

  private async afterBatch(job: LiveJob): Promise<void> {
    if (job.unresolved === 0) {
      await this.finish(job);
      return;
    }
    if (this.now() - job.lastPersist >= (this.opts.persistEveryMs ?? 1_000)) await this.persist(job);
  }

  private async persist(job: LiveJob): Promise<void> {
    if (!job.dirty) return;
    try {
      const sent = job.progress.slice();
      const merged = await this.opts.store.mergeProgress(job.rec.id, sent);
      // Another tab's progress comes back in the merge; take it.
      let changed = false;
      for (let i = 0; i < job.rec.count; i++) {
        const v = (merged[i] ?? 0) | job.progress[i]!;
        if (v !== job.progress[i]) {
          job.progress[i] = v;
          changed = true;
        }
      }
      if (changed) this.recount(job);
      job.dirty = false;
      job.lastPersist = this.now();
    } catch (e) {
      this.log(`[recovery] progress of ${job.rec.id.slice(0, 12)} could not be saved: ${(e as Error).message}`);
    }
  }

  /** Every entry is kept or blocked: save the progress, drop the list and the names, keep the progress for status. */
  private async finish(job: LiveJob): Promise<void> {
    job.dirty = true;
    await this.persist(job);
    job.rec = { ...job.rec, done: true, leaves: null, names: null };
    job.tree = null;
    try {
      await this.opts.store.saveJob(job.rec);
    } catch (e) {
      this.log(`[recovery] job ${job.rec.id.slice(0, 12)} finished but could not be marked done: ${(e as Error).message}`);
    }
  }

  private async persistDirty(): Promise<void> {
    for (const job of this.jobs.values()) if (job.dirty) await this.persist(job);
  }
}

let shared: RecoveryQueue | null = null;

/**
 * The page's one queue: IndexedDB where the browser has it (memory where it
 * does not, e.g. some private windows), POST /api/recovery on this origin,
 * and a wake-up when the browser comes back online. Call resume() on it once
 * per page load.
 */
export function browserRecoveryQueue(): RecoveryQueue {
  if (shared === null) {
    const store: RecoveryQueueStore = typeof indexedDB !== "undefined" ? new IndexedDbRecoveryQueueStore() : new MemoryRecoveryQueueStore();
    const queue = new RecoveryQueue({ store, transport: httpRecoveryTransport() });
    if (typeof window !== "undefined") window.addEventListener("online", () => queue.wake());
    shared = queue;
  }
  return shared;
}
