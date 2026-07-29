// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import { createVerify, createHash, randomBytes } from "node:crypto";
import { sha256 } from "@noble/hashes/sha256";
import { signAsync } from "@noble/ed25519";
import { canonicalize } from "bitgraph";
import { Constructor } from "bitgraph";
import type { HostCapabilities, BitGraphProof, SignedBody, AgencyEnvelope, AuthorizationPayload, WebAuthnAuthorization, PolicyBinding } from "bitgraph";
import { StubHost } from "@bitgraph/stub";
import type {
  EnclaveClient,
  EnclaveRequest,
  EnclaveResponse,
  CommitRequest,
  ChallengeRequest,
} from "../parent/vsock-client.js";

const CHALLENGE_TTL_MS = 60_000;

export class MockEnclave implements EnclaveClient {
  #stub: StubHost;
  #ctor: Constructor;
  #publicKeyB64: string;
  #measurement: string;
  #pendingChallenges = new Map<string, number>(); // challenge → expiresAt

  private constructor(stub: StubHost, ctor: Constructor, publicKeyB64: string, measurement: string) {
    this.#stub = stub;
    this.#ctor = ctor;
    this.#publicKeyB64 = publicKeyB64;
    this.#measurement = measurement;
  }

  static async create(): Promise<MockEnclave> {
    const stub = await StubHost.create({ enableCounter: true, enableTime: true });
    const ctor = await Constructor.initialize({ host: stub.host });
    const publicKeyB64 = Buffer.from(stub.publicKeyBytes).toString("base64");
    const measurement = await stub.host.getMeasurement();
    return new MockEnclave(stub, ctor, publicKeyB64, measurement);
  }

  get publicKeyB64(): string { return this.#publicKeyB64; }
  get measurement(): string { return this.#measurement; }

  async send(request: EnclaveRequest): Promise<EnclaveResponse> {
    try {
      switch (request.type) {
        case "commit": return await this.#handleCommit(request);
        case "challenge": return this.#handleChallenge();
        case "key": return this.#handleKey();
        default:
          return { ok: false, error: `Unknown request type: ${(request as { type: string }).type}` };
      }
    } catch (err) {
      return { ok: false, error: `MockEnclave error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  #handleChallenge(): EnclaveResponse {
    // Clean expired challenges
    const now = Date.now();
    for (const [c, exp] of this.#pendingChallenges) {
      if (now >= exp) this.#pendingChallenges.delete(c);
    }

    // Generate fresh challenge from crypto RNG
    const challenge = randomBytes(32).toString("base64");
    this.#pendingChallenges.set(challenge, now + CHALLENGE_TTL_MS);
    return { ok: true, data: { challenge } };
  }

  #verifyAgency(agency: AgencyEnvelope, digestB64: string): void {
    const { actor, authorization } = agency;
    const isWebAuthn = "format" in authorization && authorization.format === "webauthn";

    // Clean expired challenges
    const now = Date.now();
    for (const [c, exp] of this.#pendingChallenges) {
      if (now >= exp) this.#pendingChallenges.delete(c);
    }

    // Validate challenge
    if (!this.#pendingChallenges.has(authorization.challenge)) {
      throw new Error("Agency: challenge not found or expired");
    }

    // Validate purpose
    if (authorization.purpose !== "bitgraph/commit-authorize/v1") {
      throw new Error(`Agency: invalid purpose "${authorization.purpose}"`);
    }

    // Validate actorKeyId matches actor.keyId
    if (authorization.actorKeyId !== actor.keyId) {
      throw new Error("Agency: actorKeyId does not match actor.keyId");
    }

    // Validate artifactHash matches digest
    if (authorization.artifactHash !== digestB64) {
      throw new Error("Agency: artifactHash does not match committed digest");
    }

    // Validate keyId = SHA-256(pubkey DER)
    const pubKeyDer = Buffer.from(actor.publicKeyB64, "base64");
    const computedKeyId = createHash("sha256").update(pubKeyDer).digest("hex");
    if (computedKeyId !== actor.keyId) {
      throw new Error("Agency: actor.keyId does not match SHA-256 of public key");
    }

    // Validate timestamp freshness
    if (Math.abs(now - authorization.timestamp) > CHALLENGE_TTL_MS) {
      throw new Error("Agency: authorization timestamp too far from current time");
    }

    if (isWebAuthn) {
      // ── WebAuthn assertion verification ──
      const webauthn = authorization as WebAuthnAuthorization;

      let clientData: { type?: string; challenge?: string; origin?: string };
      try {
        clientData = JSON.parse(webauthn.clientDataJSON);
      } catch {
        throw new Error("Agency: clientDataJSON is not valid JSON");
      }

      if (clientData.type !== "webauthn.get") {
        throw new Error(`Agency: clientDataJSON.type must be "webauthn.get"`);
      }

      // Verify challenge in clientDataJSON (base64url → base64)
      if (!clientData.challenge) {
        throw new Error("Agency: clientDataJSON missing challenge field");
      }
      let clientChallenge = clientData.challenge
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      while (clientChallenge.length % 4) clientChallenge += "=";
      if (clientChallenge !== authorization.challenge) {
        throw new Error("Agency: clientDataJSON challenge does not match enclave nonce");
      }

      // Check authenticatorData flags
      const authData = Buffer.from(webauthn.authenticatorDataB64, "base64");
      if (authData.length < 37) throw new Error("Agency: authenticatorData too short");
      const flags = authData[32]!;
      if (!(flags & 0x01)) throw new Error("Agency: UP flag not set");
      if (!(flags & 0x04)) throw new Error("Agency: UV flag not set");

      // Build signed data and verify P-256 signature
      const clientDataHash = createHash("sha256")
        .update(Buffer.from(webauthn.clientDataJSON, "utf8"))
        .digest();
      const signedData = Buffer.concat([authData, clientDataHash]);

      const sigBytes = Buffer.from(webauthn.signatureB64, "base64");
      const verifier = createVerify("SHA256");
      verifier.update(signedData);
      const valid = verifier.verify(
        { key: pubKeyDer, format: "der", type: "spki" },
        sigBytes
      );
      if (!valid) throw new Error("Agency: WebAuthn P-256 signature verification failed");
    } else {
      // ── Direct P-256 signature verification ──
      const canonicalPayload: Record<string, unknown> = {
        purpose: authorization.purpose,
        actorKeyId: authorization.actorKeyId,
        artifactHash: authorization.artifactHash,
        challenge: authorization.challenge,
        timestamp: authorization.timestamp,
      };
      // Include protocolVersion when present (backward-compatible)
      if ("protocolVersion" in authorization && (authorization as unknown as Record<string, unknown>).protocolVersion !== undefined) {
        canonicalPayload.protocolVersion = (authorization as unknown as Record<string, unknown>).protocolVersion;
      }
      const payloadBytes = Buffer.from(
        JSON.stringify(canonicalPayload, Object.keys(canonicalPayload).sort()),
        "utf8"
      );

      const sigBytes = Buffer.from(authorization.signatureB64, "base64");
      const verifier = createVerify("SHA256");
      verifier.update(payloadBytes);
      const valid = verifier.verify(
        { key: pubKeyDer, format: "der", type: "spki" },
        sigBytes
      );
      if (!valid) throw new Error("Agency: P-256 signature verification failed");
    }

    // Consume challenge
    this.#pendingChallenges.delete(authorization.challenge);
  }

  async #handleCommit(req: CommitRequest): Promise<EnclaveResponse> {
    const proofs: BitGraphProof[] = [];

    // Verify agency once against the first digest
    if (req.agency) {
      const firstDigest = req.digests[0]?.digestB64;
      if (!firstDigest) {
        return { ok: false, error: "Agency provided but no digests to commit" };
      }
      this.#verifyAgency(req.agency, firstDigest);
    }

    for (const { digestB64 } of req.digests) {
      const digestBytes = Buffer.from(digestB64, "base64");
      if (digestBytes.length !== 32) {
        return { ok: false, error: `Invalid SHA-256 digest length: ${digestBytes.length}` };
      }

      const counter = this.#stub.host.nextCounter ? await this.#stub.host.nextCounter() : undefined;
      const nonceBytes = await this.#stub.host.getFreshNonce();
      const time = this.#stub.host.secureTime ? await this.#stub.host.secureTime() : undefined;
      const publicKeyBytes = await this.#stub.host.getPublicKey();
      const measurement = await this.#stub.host.getMeasurement();
      const publicKeyB64 = Buffer.from(publicKeyBytes).toString("base64");

      const commitFields: BitGraphProof["commit"] = {
        nonceB64: Buffer.from(nonceBytes).toString("base64"),
      };
      if (counter !== undefined) commitFields.counter = counter;
      if (time !== undefined) commitFields.time = time;

      const signedBody: SignedBody = {
        version: "bitgraph/1",
        artifact: { hashAlg: "sha256", digestB64 },
        commit: commitFields,
        publicKeyB64,
        enforcement: this.#stub.host.enforcementTier,
        measurement,
      };

      // Include verified actor in signed body
      if (req.agency) {
        signedBody.actor = req.agency.actor;
      }

      // Include attribution in signed body when present
      if (req.attribution) {
        const attr: Record<string, string> = {};
        if (req.attribution.name) attr.name = req.attribution.name;
        if (req.attribution.title) attr.title = req.attribution.title;
        if (req.attribution.message) attr.message = req.attribution.message;
        if (Object.keys(attr).length > 0) {
          signedBody.attribution = attr as SignedBody["attribution"];
        }
      }

      // Include policy binding in signed body when present
      if (req.policy) {
        signedBody.policy = req.policy;
      }

      const canonicalBytes = canonicalize(signedBody);
      const signatureBytes = await this.#stub.host.sign(canonicalBytes);

      const proof: BitGraphProof = {
        version: "bitgraph/1",
        artifact: signedBody.artifact,
        commit: signedBody.commit,
        signer: {
          publicKeyB64,
          signatureB64: Buffer.from(signatureBytes).toString("base64"),
        },
        environment: {
          enforcement: this.#stub.host.enforcementTier,
          measurement,
        },
      };

      if (req.agency) proof.agency = req.agency;
      if (req.policy) proof.policy = req.policy;
      if (signedBody.attribution) proof.attribution = signedBody.attribution;
      if (req.metadata !== undefined) proof.metadata = req.metadata;
      proofs.push(proof);
    }

    return { ok: true, data: proofs };
  }

  #handleKey(): EnclaveResponse {
    return {
      ok: true,
      data: {
        publicKeyB64: this.#publicKeyB64,
        measurement: this.#measurement,
        enforcement: this.#stub.host.enforcementTier,
      },
    };
  }

  close(): void {}
}
