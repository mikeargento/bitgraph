import type { BitGraphProof } from "@/lib/bitgraph";

/** A single entry in a proof.jsonl file produced by bitgraph-mcp-proxy --wrap */
export interface ProofLogEntry {
  timestamp: string;
  tool: string;
  args: Record<string, unknown>;
  output: unknown;
  proofDigestB64?: string;
  receipt?: {
    format: string;
    envelope: ExecutionEnvelope;
    proof: BitGraphProof;
  };
}

export interface ExecutionEnvelope {
  type: string;
  tool: string;
  toolVersion: string;
  runtime: string;
  adapter: string;
  inputHashB64: string;
  outputHashB64: string;
  timestamp: number;
}

/** Result of verifying a single proof log entry */
export interface EntryVerification {
  index: number;
  checks: CheckResult[];
  allPassed: boolean;
}

export interface CheckResult {
  label: string;
  status: "pass" | "fail" | "warn" | "info" | "skip";
  detail: string;
}

/** Result of verifying an entire proof log */
export interface LogVerification {
  entries: EntryVerification[];
  summary: {
    total: number;
    verified: number;
    failures: number;
    skipped: number;
    signerPublicKeyB64: string | null;
    firstTimestamp: string | null;
    lastTimestamp: string | null;
  };
}
