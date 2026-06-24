/**
 * Thin wrapper around Adobe's c2pa-js library.
 *
 * Responsibilities:
 *   - Lazy-load the ~6 MB WASM toolkit only when a file is actually read
 *   - Normalize the c2pa manifest store into a flat, UI-friendly shape
 *   - Fail soft: if parsing throws or returns no manifest, return null so the
 *     BitGraph proof flow is never blocked by C2PA issues
 *
 * This file is client-only. Do not import it from a server component.
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
  /** Raw validation status codes from the toolkit (empty array = clean). */
  validationStatus?: Array<{ code: string; url?: string; explanation?: string }>;
  /** Whether the manifest's active signature validated cleanly. */
  signatureValid?: boolean;
}

// Cached promise of the c2pa instance so we don't re-init the WASM worker.
let c2paInstancePromise: Promise<unknown> | null = null;

async function getC2pa() {
  if (c2paInstancePromise) return c2paInstancePromise;
  c2paInstancePromise = (async () => {
    // Dynamic import so the WASM isn't pulled into the main bundle.
    const mod = await import("c2pa");
    return await mod.createC2pa({
      wasmSrc: "/c2pa/toolkit_bg.wasm",
      workerSrc: "/c2pa/c2pa.worker.min.js",
    });
  })();
  return c2paInstancePromise;
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
 * Returns null if:
 *   - The file has no C2PA manifest
 *   - The library or WASM fails to load (no c2pa support on this browser)
 *   - Any exception is thrown during parsing
 *
 * Never throws. Never blocks the BitGraph flow.
 */
export async function readC2PA(file: File | Blob, filename?: string): Promise<C2PAReadResult | null> {
  try {
    const c2pa = (await getC2pa()) as {
      read: (input: File | Blob | { blob: Blob; name: string }) => Promise<{ manifestStore: unknown }>;
    };

    // The toolkit leans on the asset name/extension to pick a parser, and AI
    // exports / downloads sometimes arrive with no usable extension, so it
    // never looks for the manifest. Sniff the real type from magic bytes and,
    // only when the name carries no recognized image extension, hand the
    // toolkit a corrected name so it can find a manifest it would otherwise
    // miss. Files that already have a good extension (a camera/Lightroom JPEG)
    // pass through unchanged, so the working path is untouched.
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const sniffedExt = sniffExtension(head);
    const currentName = (file instanceof File ? file.name : filename) || "";
    const hasImageExt = /\.(jpe?g|png|gif|webp|avif|bmp|tiff?|heic|heif|dng|cr2|cr3|nef|arw)$/i.test(currentName);
    const input =
      !hasImageExt && sniffedExt
        ? { blob: file, name: `upload.${sniffedExt}` }
        : file instanceof File
          ? file
          : { blob: file, name: filename || "upload.bin" };

    const result = await c2pa.read(input);
    const store = result.manifestStore as {
      activeManifest?: unknown;
      manifests?: Record<string, unknown>;
      validationStatus?: Array<{ code: string; url?: string; explanation?: string }>;
    } | null;

    if (!store) return null;

    // Resolve the active manifest. C2PA 2.x manifests (such as OpenAI's) can
    // come back with activeManifest unset even though the manifest parsed fine
    // and sits in the manifests map, which left the card blank. Fall back to
    // the last manifest in the map (the active / most recent one) so it shows.
    const active = (store.activeManifest ??
      (store.manifests ? Object.values(store.manifests).pop() : undefined)) as {
      claimGenerator?: string;
      claimGeneratorInfo?: Array<{ name?: string; version?: string }>;
      title?: string;
      format?: string;
      signatureInfo?: {
        issuer?: string;
        time?: string;
        cert_serial_number?: string;
      };
      assertions?: {
        data?: Array<{ label: string; data: unknown }>;
      };
      thumbnail?: { getUrl?: () => { url: string; dispose?: () => void } };
      ingredients?: unknown[];
    } | undefined;

    if (!active) return null;

    const assertions = active.assertions?.data ?? [];

    // NOTE: We deliberately do not render the c2pa.actions assertion.
    // Lightroom (and most Adobe tools) emit one entry per edit tagged
    // as the generic "c2pa.color_adjustments" with no parameter values,
    // which produces lists like "Color adjustments ×10" with zero added
    // signal. If a future C2PA producer starts including meaningful
    // per-action detail (parameters / descriptions), we can re-add
    // extraction and rendering here.

    // Creator assertion → first author's name
    let creator: string | undefined;
    const creativeWork = assertions.find((a) =>
      a.label?.startsWith("stds.schema-org.CreativeWork")
    );
    if (creativeWork) {
      const data = (creativeWork.data ?? {}) as {
        author?: Array<{ name?: string }> | { name?: string };
      };
      if (Array.isArray(data.author)) {
        creator = data.author.find((a) => a?.name)?.name;
      } else if (data.author && typeof data.author === "object" && "name" in data.author) {
        creator = (data.author as { name?: string }).name;
      }
    }

    // Origin signal: pull ONLY digitalSourceType off c2pa.actions and ignore
    // everything else in the assertion. This is the standards-based "how was
    // this made" flag (IPTC DigitalSourceType: trainedAlgorithmicMedia =
    // AI-generated, digitalCapture = camera, etc.), distinct from the noisy
    // per-edit action list we deliberately don't render (see note above).
    let digitalSourceType: string | undefined;
    const actionsAssertion = assertions.find((a) =>
      a.label === "c2pa.actions" || a.label?.startsWith("c2pa.actions")
    );
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

    // Thumbnail (best effort; older toolkit versions don't expose getUrl)
    let thumbnailDataUrl: string | undefined;
    try {
      const tb = active.thumbnail;
      if (tb && typeof tb.getUrl === "function") {
        const { url } = tb.getUrl();
        thumbnailDataUrl = url;
      }
    } catch {
      /* ignore — thumbnail is optional */
    }

    const validationStatus = store.validationStatus ?? [];

    return {
      present: true,
      claimGenerator: active.claimGenerator,
      claimGeneratorInfo: active.claimGeneratorInfo,
      digitalSourceType,
      creator,
      title: active.title,
      format: active.format,
      signatureIssuer: active.signatureInfo?.issuer,
      signatureTime: active.signatureInfo?.time,
      thumbnailDataUrl,
      ingredientCount: Array.isArray(active.ingredients) ? active.ingredients.length : 0,
      validationStatus,
      signatureValid: validationStatus.length === 0,
    };
  } catch (err) {
    if (typeof window !== "undefined") {
      console.warn("[c2pa] read failed:", err);
    }
    return null;
  }
}
