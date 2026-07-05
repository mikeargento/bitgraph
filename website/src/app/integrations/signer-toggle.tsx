"use client";

import { useState } from "react";

function CopyInline({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="absolute top-3 right-3 p-1.5 text-text-tertiary hover:text-text hover:bg-bg-subtle/50 transition-colors duration-150"
      title="Copy"
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      )}
    </button>
  );
}

export function SignerToggle({ onChange }: { onChange?: (mode: "local" | "tee") => void }) {
  const [mode, setMode] = useState<"local" | "tee">("local");

  function toggle(m: "local" | "tee") {
    setMode(m);
    onChange?.(m);
  }

  return (
    <div className="inline-flex items-center border border-border-subtle bg-bg p-1 gap-0.5">
      <button
        onClick={() => toggle("local")}
        className={`px-5 py-1.5 text-sm font-medium transition-all duration-150 ${
          mode === "local"
            ? "bg-blue-500 text-white "
            : "text-text-tertiary hover:text-text"
        }`}
      >
        Local
      </button>
      <button
        onClick={() => toggle("tee")}
        className={`px-5 py-1.5 text-sm font-medium transition-all duration-150 ${
          mode === "tee"
            ? "bg-blue-500 text-white "
            : "text-text-tertiary hover:text-text"
        }`}
      >
        TEE
      </button>
    </div>
  );
}

export function SignerDescription({ mode }: { mode: "local" | "tee" }) {
  if (mode === "local") {
    return (
      <p className="text-text-secondary text-sm leading-relaxed">
        <strong className="text-text">Local signing</strong> — Ed25519 keypair generated on your machine.
        Proofs stored locally. No external dependencies. Fully offline.
        <br />
        <span className="text-text-tertiary">You don&apos;t have to trust anyone. That&apos;s the point.</span>
      </p>
    );
  }
  return (
    <p className="text-text-secondary text-sm leading-relaxed">
      <strong className="text-text">TEE signing</strong> — Hardware-attested via AWS Nitro Enclave.
      Only a cryptographic hash leaves your machine. The enclave is sealed — not even BitGraph can access it.
      <br />
      <span className="text-text-tertiary">Source available. Verify the attestation yourself.</span>
    </p>
  );
}

const localBash = `npx bitgraph-mcp-proxy --wrap npx -y @modelcontextprotocol/server-filesystem ~/Desktop`;
const teeBash = `npx bitgraph-mcp-proxy --wrap --signer bitgraph-cloud npx -y @modelcontextprotocol/server-filesystem ~/Desktop`;

const localConfig = `{
  "command": "npx",
  "args": ["bitgraph-mcp-proxy", "--wrap",
    "npx", "-y",
    "@modelcontextprotocol/server-filesystem",
    "/home"]
}`;

const teeConfig = `{
  "command": "npx",
  "args": ["bitgraph-mcp-proxy", "--wrap",
    "--signer", "bitgraph-cloud",
    "npx", "-y",
    "@modelcontextprotocol/server-filesystem",
    "/home"]
}`;

export function InteractiveSignerSection() {
  const [mode, setMode] = useState<"local" | "tee">("local");

  const bashCmd = mode === "local" ? localBash : teeBash;
  const configCmd = mode === "local" ? localConfig : teeConfig;

  return (
    <div className="border border-border bg-bg-elevated/80 backdrop-blur-sm p-4 sm:p-8 md:p-10 mb-20 sm:mb-32 overflow-hidden">
      <div className="flex flex-col gap-3 mb-6">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.02em] mb-1">
            Choose your signer
          </h2>
          <p className="text-sm text-text-tertiary">
            Every integration supports both modes. Switch anytime.
          </p>
        </div>
        <div className="flex justify-center sm:justify-start">
          <SignerToggle onChange={setMode} />
        </div>
      </div>

      <SignerDescription mode={mode} />

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Terminal command */}
        <div className="relative border border-border-subtle overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle bg-bg-subtle/30">
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 bg-text-tertiary/30" />
                <div className="w-2.5 h-2.5 bg-text-tertiary/30" />
                <div className="w-2.5 h-2.5 bg-text-tertiary/30" />
              </div>
              <span className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider ml-1">Terminal</span>
            </div>
            <CopyInline text={bashCmd} />
          </div>
          <div className="p-4 bg-bg flex-1 flex items-start">
            <pre className="text-sm font-mono text-blue-400 leading-relaxed whitespace-pre-wrap break-all">
              <span className="text-text-tertiary select-none">$ </span><code>{bashCmd}</code>
            </pre>
          </div>
          <div className="px-4 py-3 border-t border-border-subtle/50 bg-bg mt-auto">
            <p className="text-xs text-text-tertiary leading-relaxed">
              {mode === "local"
                ? "Wraps any MCP server. Proofs written to ./proof.jsonl. No network calls."
                : "Same command, one extra flag. Your data never leaves your machine — only a SHA-256 hash is sent to the enclave."}
            </p>
          </div>
        </div>

        {/* Claude Desktop config */}
        <div className="relative border border-border-subtle overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle bg-bg-subtle/30">
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider">claude_desktop_config.json</span>
            </div>
            <CopyInline text={configCmd} />
          </div>
          <div className="p-4 bg-bg flex-1 flex items-start">
            <pre className="text-sm font-mono text-text-secondary leading-relaxed">
              <code>{configCmd}</code>
            </pre>
          </div>
          <div className="px-4 py-3 border-t border-border-subtle/50 bg-bg mt-auto">
            <p className="text-xs text-text-tertiary leading-relaxed">
              Add to <code className="text-[11px] font-mono text-text-tertiary">mcpServers</code> in your config. Claude routes all tool calls through the proxy.
            </p>
          </div>
        </div>
      </div>

      {/* What's the difference */}
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="border border-border-subtle p-5 bg-bg/50">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="font-medium text-text text-sm">Local signing</div>
          </div>
          <ul className="space-y-2 text-text-secondary text-xs">
            <li className="flex items-start gap-2">
              <span className="text-blue-400 mt-0.5 shrink-0">&#x2713;</span>
              Ed25519 keypair on your disk
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-400 mt-0.5 shrink-0">&#x2713;</span>
              Zero network dependencies
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-400 mt-0.5 shrink-0">&#x2713;</span>
              You control the key
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-400 mt-0.5 shrink-0">&#x2713;</span>
              Good for development &amp; self-hosted
            </li>
          </ul>
        </div>
        <div className="border border-border-subtle p-5 bg-bg/50">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="font-medium text-text text-sm">TEE signing (Hardware)</div>
            </div>
          </div>
          <ul className="space-y-2 text-text-secondary text-xs">
            <li className="flex items-start gap-2">
              <span className="text-blue-500 mt-0.5 shrink-0">&#x2713;</span>
              AWS Nitro Enclave — sealed, auditable
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-500 mt-0.5 shrink-0">&#x2713;</span>
              Only a 32-byte hash crosses the network
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-500 mt-0.5 shrink-0">&#x2713;</span>
              Attestation certificate in every proof
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-500 mt-0.5 shrink-0">&#x2713;</span>
              Good for production &amp; compliance
            </li>
          </ul>
        </div>
      </div>

    </div>
  );
}
