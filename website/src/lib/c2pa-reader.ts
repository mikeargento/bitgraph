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

    // Normalize to an object with a name (the toolkit uses the name for
    // some format detection paths).
    const input =
      file instanceof File
        ? file
        : { blob: file, name: filename || "upload.bin" };

    const result = await c2pa.read(input);
    const store = result.manifestStore as {
      activeManifest?: unknown;
      validationStatus?: Array<{ code: string; url?: string; explanation?: string }>;
    } | null;

    if (!store || !store.activeManifest) return null;

    const active = store.activeManifest as {
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
    };

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
