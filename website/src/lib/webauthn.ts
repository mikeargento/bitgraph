/**
 * WebAuthn / Passkey helpers for BitGraph Proof Authorship.
 *
 * Uses platform authenticators (Face ID, Touch ID, Windows Hello) to
 * produce P-256 device-bound proofs of biometric user presence.
 *
 * The private key lives in the device Secure Enclave, never extractable.
 */

// ---------------------------------------------------------------------------
// Storage key for localStorage
// ---------------------------------------------------------------------------

const STORAGE_KEY = "bitgraph-passkey";

export interface StoredCredential {
  credentialIdB64: string;   // base64(rawId)
  publicKeyB64: string;      // base64(SPKI DER P-256)
  keyId: string;             // hex(SHA-256(SPKI DER))
  createdAt: number;
  /** What this device calls its holder.
   *
   *  ⚠️ COSMETIC AND LOCAL. It labels the passkey in the keychain and gives
   *  the page something to print. It never enters a proof: the envelope
   *  carries keyId and provider, and the authority on "which person is this
   *  key" is the published registry, not a string somebody typed into their
   *  own browser. Someone typing "Adobe" here changes nothing a verifier
   *  reads, which is the property that makes typing it harmless. */
  name: string;
}

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

export function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator.credentials?.create === "function" &&
    typeof navigator.credentials?.get === "function"
  );
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnAvailable()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/** Standard base64 → Uint8Array */
function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Uint8Array → standard base64 */
function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Base64url → standard base64 */
function base64urlToBase64(b64url: string): string {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return b64;
}

/** Standard base64 → base64url (no padding) */
function base64ToBase64url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Uint8Array → hex string */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Compute hex(SHA-256(bytes)) */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return bytesToHex(new Uint8Array(hash));
}

// ---------------------------------------------------------------------------
// Credential storage
// ---------------------------------------------------------------------------

export function getStoredCredential(): StoredCredential | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function storeCredential(cred: StoredCredential): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cred));
}

export function clearStoredCredential(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ---------------------------------------------------------------------------
// Registration - create a platform passkey
// ---------------------------------------------------------------------------

export async function registerPasskey(displayName: string): Promise<StoredCredential> {
  // Random user handle (not sensitive - just for WebAuthn)
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const label = displayName.trim() || "BitGraph";

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: {
        name: "BitGraph",
        id: location.hostname,
      },
      // What the system passkey sheet shows, and what the keychain entry is
      // called from now on. It was hardcoded "Proof Author" for everyone.
      user: {
        id: userId,
        name: label,
        displayName: label,
      },
      pubKeyCredParams: [
        { alg: -7, type: "public-key" }, // ES256 = P-256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("Passkey registration was cancelled or failed");
  }

  const response = credential.response as AuthenticatorAttestationResponse;

  // Extract public key as SPKI DER (getPublicKey returns SPKI format directly)
  const publicKeySpki = response.getPublicKey();
  if (!publicKeySpki) {
    throw new Error("Could not extract public key from credential");
  }

  const publicKeyBytes = new Uint8Array(publicKeySpki);
  const publicKeyB64 = bytesToB64(publicKeyBytes);
  const keyId = await sha256Hex(publicKeyBytes);
  const credentialIdB64 = bytesToB64(new Uint8Array(credential.rawId));

  const stored: StoredCredential = {
    credentialIdB64,
    publicKeyB64,
    keyId,
    createdAt: Date.now(),
    name: label,
  };

  storeCredential(stored);
  return stored;
}

// ---------------------------------------------------------------------------
// Assertion - biometric authorization for a specific commit
// ---------------------------------------------------------------------------

export interface WebAuthnAssertion {
  authenticatorDataB64: string;  // raw authenticator data
  clientDataJSON: string;        // full JSON string (UTF-8)
  signatureB64: string;          // DER ECDSA P-256 signature
}

/**
 * Request biometric authorization via WebAuthn.
 *
 * @param challengeB64 - Base64-encoded enclave challenge nonce
 * @param credentialIdB64 - Base64-encoded credential ID from registration
 * @returns The WebAuthn assertion data needed for the agency envelope
 */
export async function requestAssertion(
  challengeB64: string,
  credentialIdB64: string
): Promise<WebAuthnAssertion> {
  // WebAuthn wants the challenge as an ArrayBuffer
  const challengeBytes = b64ToBytes(challengeB64);
  const credentialId = b64ToBytes(credentialIdB64);

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: challengeBytes.buffer as ArrayBuffer,
      allowCredentials: [
        {
          id: credentialId.buffer as ArrayBuffer,
          type: "public-key",
        },
      ],
      userVerification: "required",
      rpId: location.hostname,
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) {
    throw new Error("Biometric authorization was cancelled or failed");
  }

  const response = assertion.response as AuthenticatorAssertionResponse;

  return {
    authenticatorDataB64: bytesToB64(new Uint8Array(response.authenticatorData)),
    clientDataJSON: new TextDecoder().decode(response.clientDataJSON),
    signatureB64: bytesToB64(new Uint8Array(response.signature)),
  };
}

// ---------------------------------------------------------------------------
// Build agency envelope from WebAuthn assertion
// ---------------------------------------------------------------------------

export function buildAgencyEnvelope(
  credential: StoredCredential,
  assertion: WebAuthnAssertion,
  artifactDigestB64: string,
  challengeB64: string
): {
  actor: {
    keyId: string;
    publicKeyB64: string;
    algorithm: "ES256";
    provider: string;
  };
  authorization: {
    purpose: "bitgraph/commit-authorize/v1";
    format: "webauthn";
    actorKeyId: string;
    artifactHash: string;
    challenge: string;
    timestamp: number;
    authenticatorDataB64: string;
    clientDataJSON: string;
    signatureB64: string;
  };
  batchContext?: {
    batchSize: number;
    batchIndex: number;
    batchDigests: string[];
  };
} {
  return {
    actor: {
      keyId: credential.keyId,
      publicKeyB64: credential.publicKeyB64,
      algorithm: "ES256",
      provider: "passkey",
    },
    authorization: {
      purpose: "bitgraph/commit-authorize/v1",
      format: "webauthn",
      actorKeyId: credential.keyId,
      artifactHash: artifactDigestB64,
      challenge: challengeB64,
      timestamp: Date.now(),
      authenticatorDataB64: assertion.authenticatorDataB64,
      clientDataJSON: assertion.clientDataJSON,
      signatureB64: assertion.signatureB64,
    },
  };
}
