/**
 * The recovery store on the ledger bucket: recovery/v1/<address>/<entryId>,
 * one opaque envelope per object (formats in recovery.ts, contract in
 * recovery-store.ts). Server only.
 *
 * CREATE-ONLY, AND WHY THE BUCKET POLICY IS PART OF IT. Every write is a
 * PutObject with If-None-Match: *, so a key that holds an entry answers 412
 * and is never replaced. On a versioned bucket (Object Lock requires
 * versioning) that guarantee has one hole, in AWS's own words: "if there's no
 * current object version with the same name, or if the current object
 * version is a delete marker, the write operation succeeds". A plain
 * DeleteObject does not remove a locked version; it stacks a delete marker on
 * top, and the next conditional write then lands as a SECOND locked version
 * under the same key, which every GET and LIST serves instead of the first.
 * So deletes under recovery/ must be denied outright, and so must any write
 * without the condition (a privileged writer's plain PUT stacks a new current
 * version the same way). Neither statement is applied by this code; they are
 * merged into the existing policy of the bucket by hand:
 *
 *   {
 *     "Sid": "RecoveryEntriesAreNeverDeleted",
 *     "Effect": "Deny",
 *     "Principal": "*",
 *     "Action": ["s3:DeleteObject", "s3:DeleteObjectVersion"],
 *     "Resource": "arn:aws:s3:::occ-ledger-prod/recovery/*"
 *   },
 *   {
 *     "Sid": "RecoveryEntriesAreCreateOnly",
 *     "Effect": "Deny",
 *     "Principal": "*",
 *     "Action": "s3:PutObject",
 *     "Resource": "arn:aws:s3:::occ-ledger-prod/recovery/*",
 *     "Condition": {
 *       "Null": { "s3:if-none-match": "true" },
 *       "Bool": { "s3:ObjectCreationOperation": "true" }
 *     }
 *   }
 *
 * The second is AWS's documented enforcement of conditional writes
 * (condition key s3:if-none-match; s3:ObjectCreationOperation exempts the
 * multipart part uploads, which take no conditional header). It also makes
 * CopyObject into recovery/ fail, which nothing here uses. A bucket policy
 * does not bind S3 Lifecycle: no lifecycle expiration rule may ever cover
 * recovery/, because on a versioned bucket expiration IS a delete marker.
 *
 * Reads list current versions (ListObjectsV2) and get them, the same
 * permissions the ledger's other readers use; with the policy in place the
 * current version is the first and only one.
 *
 * Retention comes from the bucket's default (COMPLIANCE, ten years), exactly
 * as for the site's by-digest writes, which set none of their own. The EC2
 * parent sets ObjectLockMode and RetainUntilDate explicitly on proofs/;
 * doing the same here would need s3:PutObjectRetention on the site's role,
 * which nothing else on the site uses, so it is left to the bucket default.
 *
 * The client is this module's own, configured exactly as lib/s3.ts's (that
 * one is module-private): same region and bucket variables, adaptive retries,
 * kept-alive sockets sized to the put pool.
 */

import { Agent } from "node:https";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ENTRY_ID_PATTERN, OBJECT_KEY_PATTERN, RECOVERY_PREFIX } from "./recovery.ts";
import type { ListPage, PutOutcome, RecoveryStore, StoredEntry } from "./recovery-store.ts";

/** Gets in flight while a listing page is read. */
const READ_POOL = 16;

function httpStatusOf(err: unknown): number | undefined {
  return (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
}

function nameOf(err: unknown): string | undefined {
  return (err as { name?: string })?.name;
}

const isMissing = (err: unknown) => nameOf(err) === "NoSuchKey" || nameOf(err) === "NotFound" || httpStatusOf(err) === 404;

export class S3RecoveryStore implements RecoveryStore {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(s3: S3Client, bucket: string) {
    this.s3 = s3;
    this.bucket = bucket;
  }

  async putIfAbsent(key: string, envelope: Uint8Array): Promise<PutOutcome> {
    if (!OBJECT_KEY_PATTERN.test(key)) throw new TypeError("not a recovery object key");
    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: envelope,
        ContentType: "application/octet-stream",
        IfNoneMatch: "*",
      }));
      return { status: "created" };
    } catch (err) {
      const status = httpStatusOf(err);
      if (status === 412 || nameOf(err) === "PreconditionFailed") {
        // The key holds an entry. Hand it back for the client to open: only
        // the client can tell whether it is its own member.
        const there = await this.get(key);
        // Gone between the 412 and the read can only be a delete marker,
        // which the policy forbids; answer as a conflict, never as created.
        return there === null ? { status: "conflict" } : { status: "exists", envelope: there };
      }
      if (status === 409 || nameOf(err) === "ConditionalRequestConflict") return { status: "conflict" };
      throw err;
    }
  }

  async list(address: string, after: string | null, limit: number): Promise<ListPage> {
    const prefix = `${RECOVERY_PREFIX}${address}/`;
    const listed = await this.s3.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
      MaxKeys: limit,
      ...(after !== null ? { StartAfter: prefix + after } : {}),
    }));
    const scanned = (listed.Contents ?? []).map((o) => o.Key).filter((k): k is string => typeof k === "string");
    const keys = scanned.filter((k) => k.startsWith(prefix) && OBJECT_KEY_PATTERN.test(k));
    const bodies: Array<Uint8Array | null> = new Array(keys.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.max(1, Math.min(READ_POOL, keys.length)) }, async () => {
      while (next < keys.length) {
        const i = next++;
        bodies[i] = await this.get(keys[i]!);
      }
    }));
    // A key listed and then missing is permanent (see the header); it is
    // skipped rather than failing every lookup of this address forever.
    const entries: StoredEntry[] = [];
    keys.forEach((key, i) => {
      const envelope = bodies[i];
      if (envelope) entries.push({ key, envelope });
    });
    if (!listed.IsTruncated) return { entries, next: null };
    // More follows. The cursor is the last well-formed key on this page (a
    // malformed key cannot be an entry id the client accepts; re-listing a few
    // keys after it is harmless, dropping the rest of the listing is not). A
    // truncated page with no well-formed key at all cannot be continued.
    for (let i = scanned.length - 1; i >= 0; i--) {
      const id = scanned[i]!.slice(prefix.length);
      if (scanned[i]!.startsWith(prefix) && ENTRY_ID_PATTERN.test(id)) return { entries, next: id };
    }
    throw new Error("a truncated listing page holds no well-formed entry key to continue from");
  }

  /** The object's bytes, null when it is not there; any other failure throws. */
  private async get(key: string): Promise<Uint8Array | null> {
    try {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = await r.Body?.transformToByteArray();
      return bytes ? new Uint8Array(bytes) : null;
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }
}

let shared: S3RecoveryStore | null = null;

/** The process's one store on the ledger bucket (LEDGER_REGION, LEDGER_BUCKET, as lib/s3.ts reads them). */
export function s3RecoveryStore(): S3RecoveryStore {
  if (!shared) {
    const s3 = new S3Client({
      region: (process.env.LEDGER_REGION || "us-east-2").trim(),
      maxAttempts: 5,
      retryMode: "adaptive",
      requestHandler: { httpsAgent: new Agent({ keepAlive: true, maxSockets: 64 }) },
    });
    shared = new S3RecoveryStore(s3, (process.env.LEDGER_BUCKET || "occ-ledger-prod").trim());
  }
  return shared;
}
