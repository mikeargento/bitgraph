/**
 * C2PA manifest reader.
 *
 * Reads embedded Content Credentials directly from the low-level
 * @contentauth/toolkit WASM (getManifestStoreFromArrayBuffer) and normalizes
 * the raw report into a flat, UI-friendly shape.
 *
 * Why not the high-level `c2pa` SDK: its manifest post-processing throws on
 * C2PA 2.x manifests (e.g. OpenAI's gpt-image), even though the underlying
 * WASM reads them perfectly. The low-level call returns the same report shape
 * for v1 and v2, so we parse it ourselves and skip the fragile wrapper.
 *
 * Fail soft: any parse error or missing manifest returns null so the BitGraph
 * flow is never blocked by C2PA issues. Client-only; do not import from a
 * server component.
 */

export interface C2PAReadResult {
  /** Was a C2PA manifest store successfully read from the file? */
  present: boolean;
  /** Human name of the claim generator (camera, software, etc.) if available. */
  claimGenerator?: string;
  /** Producer claim generator info details (device, software version, etc.). */
  claimGeneratorInfo?: Array<{ name?: string; version?: string }>;
  /**
   * IPTC DigitalSourceType (last URI segment) declared in the c2pa.actions
   * assertion, e.g. "trainedAlgorithmicMedia" for AI-generated content or
   * "digitalCapture" for a camera. Absent when the manifest declares none.
   */
  digitalSourceType?: string;
  /** Creator / author as reported by the active manifest, if signed. */
  creator?: string;
  /** Title / filename recorded in the manifest. */
  title?: string;
  /** Format / MIME recorded in the manifest. */
  format?: string;
  /** Signature issuer / CA that signed the manifest. */
  signatureIssuer?: string;
  /** Signature timestamp (ISO) if present. */
  signatureTime?: string;
  /** Thumbnail data URL if the manifest embeds one. */
  thumbnailDataUrl?: string;
  /** Count of ingredient parent manifests (derived / edited from …). */
  ingredientCount?: number;
  /**
   * The ancestor manifests carried inside the same file, walked outward from
   * the active one, nearest first. Each entry is one edge: how the referring
   * manifest described the ancestor, and who signed the ancestor.
   *
   * A file's chain is the most informative thing in its credential and it was
   * being thrown away: the toolkit decodes every ancestor manifest, and this
   * reader kept only a COUNT of the active manifest's own ingredients, which
   * was then never rendered anywhere. A four-manifest file looked identical to
   * a one-manifest file on screen.
   *
   * Relationships are reported as declared, not normalised into "parent".
   * `inputTo` and `parentOf` are different claims and the difference is the
   * whole point: an ancestor attached as an input is not reached by walking
   * parents at all.
   */
  chain?: Array<{ relationship?: string; signer?: string }>;
  /** Validation failures from the toolkit (empty = signature validated cleanly). */
  validationStatus?: Array<{ code?: string; url?: string; explanation?: string }>;
  /** Whether the manifest's active signature validated cleanly. */
  signatureValid?: boolean;
}

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
};

// Shape of a single manifest in the raw @contentauth/toolkit report (snake_case).
interface RawManifest {
  claim_generator?: string;
  claim_generator_info?: Array<{ name?: string; version?: string }>;
  title?: string;
  format?: string;
  signature_info?: { issuer?: string; time?: string };
  assertions?: Array<{ label?: string; data?: unknown }>;
  ingredients?: Array<{ relationship?: string; active_manifest?: string }>;
}

// Cached promise of the initialized toolkit so the ~6 MB WASM loads once.
let toolkitPromise: Promise<{
  getManifestStoreFromArrayBuffer: (buf: ArrayBuffer, mimeType: string, settings?: string) => Promise<unknown>;
}> | null = null;

async function getToolkit() {
  if (toolkitPromise) return toolkitPromise;
  toolkitPromise = (async () => {
    // Dynamic import so the WASM glue isn't pulled into the main bundle.
    const tk = (await import("@contentauth/toolkit")) as unknown as {
      default: (init: { module_or_path: string }) => Promise<unknown>;
      getManifestStoreFromArrayBuffer: (buf: ArrayBuffer, mimeType: string, settings?: string) => Promise<unknown>;
    };
    await tk.default({ module_or_path: "/c2pa/toolkit_core.wasm" });
    return tk;
  })();
  return toolkitPromise;
}

/** Identify a C2PA-relevant image type from magic bytes, or undefined. */
function sniffExtension(b: Uint8Array): string | undefined {
  if (b.length < 4) return undefined;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
  if (b[0] === 0x42 && b[1] === 0x4d) return "bmp";
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
      (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)) return "tiff";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    if (b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69 && b[11] === 0x66) return "avif";
    return "heic"; // heic / heif / mif1 brands
  }
  return undefined;
}

/**
 * Read any embedded C2PA manifest from a File or Blob.
 *
 * Returns null if the file has no manifest, the WASM fails to load, or anything
 * throws during parsing. Never throws; never blocks the BitGraph flow.
 */
export async function readC2PA(file: File | Blob): Promise<C2PAReadResult | null> {
  try {
    const buf = await file.arrayBuffer();
    // The toolkit picks its parser from the MIME type. Sniff it from the bytes
    // so a missing or wrong file extension (common for AI exports) can't hide
    // the manifest; fall back to the blob's declared type.
    const head = new Uint8Array(buf, 0, Math.min(16, buf.byteLength));
    const ext = sniffExtension(head);
    const mimeType = (ext && EXT_MIME[ext]) || file.type || "application/octet-stream";

    const tk = await getToolkit();
    const report = (await tk.getManifestStoreFromArrayBuffer(buf, mimeType)) as {
      manifest_store?: {
        active_manifest?: string;
        manifests?: Record<string, RawManifest>;
        validation_results?: {
          activeManifest?: { failure?: Array<{ code?: string; url?: string; explanation?: string }> };
        };
      };
    } | null;

    const ms = report?.manifest_store;
    if (!ms || !ms.manifests) return null;

    // Resolve the active manifest by label, falling back to the last entry.
    const active: RawManifest | undefined =
      (ms.active_manifest ? ms.manifests[ms.active_manifest] : undefined) ??
      Object.values(ms.manifests).pop();
    if (!active) return null;

    const assertions = active.assertions ?? [];

    /* Creator, from EITHER place the creator's name is written.

       ⚠️ Two assertions carry it and a reader that knows only the older one
       silently reports no creator for current exports. Lightroom Classic 15.4.1
       wrote `stds.schema-org.CreativeWork` with an `author` array; 15.5 moved to
       c2pa_rs 0.85 / spec 2.4.0 and writes `cawg.metadata` with a Dublin Core
       `dc:creator` instead. Both were measured on real exports, a month apart,
       from the same application. Nothing was deprecated loudly; the field just
       moved, so this failed silently and looked like Lightroom had stopped
       recording the name at all.

       CreativeWork is tried first so files that carry both keep the name they
       have always shown here. Neither shape is verified by the signature: this
       is a self-asserted string that the signer's certificate covers only in
       the sense that it covers every byte. Rendering it as "Creator" would
       overstate it, which is why the proof page files it under the submitter's
       note rather than presenting it as established identity. */
    let creator: string | undefined;
    const creativeWork = assertions.find((a) => a.label?.startsWith("stds.schema-org.CreativeWork"));
    if (creativeWork) {
      const data = (creativeWork.data ?? {}) as { author?: Array<{ name?: string }> | { name?: string } };
      if (Array.isArray(data.author)) {
        creator = data.author.find((a) => a?.name)?.name;
      } else if (data.author && typeof data.author === "object" && "name" in data.author) {
        creator = (data.author as { name?: string }).name;
      }
    }
    if (!creator) {
      const cawg = assertions.find((a) => a.label?.startsWith("cawg.metadata"));
      if (cawg) {
        // dc:creator is formally an ordered sequence, so a bare string, an
        // array of strings, and an array of {name} objects all occur in the
        // wild. Take the first non-empty name in any of those shapes.
        const raw = ((cawg.data ?? {}) as Record<string, unknown>)["dc:creator"];
        const first = Array.isArray(raw) ? raw.find((v) => v) : raw;
        if (typeof first === "string") {
          creator = first.trim() || undefined;
        } else if (first && typeof first === "object" && "name" in first) {
          const n = (first as { name?: unknown }).name;
          if (typeof n === "string") creator = n.trim() || undefined;
        }
      }
    }

    // Origin signal: IPTC digitalSourceType off the actions assertion (v1
    // "c2pa.actions" or v2 "c2pa.actions.v2"). trainedAlgorithmicMedia =
    // AI-generated, digitalCapture = camera, etc. We pull only that field.
    let digitalSourceType: string | undefined;
    const actionsAssertion = assertions.find((a) => a.label?.startsWith("c2pa.actions"));
    if (actionsAssertion) {
      const data = (actionsAssertion.data ?? {}) as {
        digitalSourceType?: string;
        actions?: Array<{ action?: string; digitalSourceType?: string }>;
      };
      const raw =
        data.digitalSourceType ||
        data.actions?.find((act) => act?.digitalSourceType)?.digitalSourceType;
      if (raw) digitalSourceType = raw.split("/").pop() || raw;
    }

    /* Walk the ancestors the file actually carries, breadth first from the
       active manifest, recording each edge as the REFERRING manifest declared
       it. Cycles are impossible in a well formed store but a `seen` set and a
       depth cap keep a malformed one from hanging the page. */
    const chain: Array<{ relationship?: string; signer?: string }> = [];
    {
      const seen = new Set<string>(ms.active_manifest ? [ms.active_manifest] : []);
      let frontier: RawManifest[] = [active];
      for (let depth = 0; frontier.length && depth < 8; depth++) {
        const next: RawManifest[] = [];
        for (const m of frontier) {
          for (const ing of m.ingredients ?? []) {
            const label = ing?.active_manifest;
            if (!label || seen.has(label)) continue;
            seen.add(label);
            const ancestor = ms.manifests?.[label];
            if (!ancestor) continue;
            chain.push({ relationship: ing.relationship, signer: ancestor.signature_info?.issuer });
            next.push(ancestor);
          }
        }
        frontier = next;
      }
    }

    const failures = ms.validation_results?.activeManifest?.failure ?? [];

    return {
      chain: chain.length ? chain : undefined,
      present: true,
      claimGenerator: active.claim_generator,
      claimGeneratorInfo: active.claim_generator_info,
      digitalSourceType,
      creator,
      title: active.title,
      format: active.format,
      signatureIssuer: active.signature_info?.issuer,
      signatureTime: active.signature_info?.time,
      thumbnailDataUrl: undefined,
      ingredientCount: Array.isArray(active.ingredients) ? active.ingredients.length : 0,
      validationStatus: failures,
      signatureValid: failures.length === 0,
    };
  } catch (err) {
    if (typeof window !== "undefined") {
      console.warn("[c2pa] read failed:", err);
    }
    return null;
  }
}
