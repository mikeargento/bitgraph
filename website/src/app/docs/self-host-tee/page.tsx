import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Self-Host TEE",
  description: "Deploy your own BitGraph Trusted Execution Environment using AWS Nitro Enclaves.",
};

export default function SelfHostTEEPage() {
  return (
    <div className="prose-doc">
      <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 8 }}>Self-Host TEE</h1>
      <p style={{ color: "#636a78", marginBottom: 32 }}>
        Deploy your own BitGraph Trusted Execution Environment using AWS Nitro Enclaves. This guide assumes no prior TEE experience.
      </p>

      <h2>Architecture</h2>
      <p>The BitGraph TEE consists of three components running on a single EC2 instance:</p>
      <ul>
        <li><strong>Enclave</strong> — isolated TEE that holds the Ed25519 signing key and produces cryptographically signed proofs. The key is generated inside the enclave and never leaves.</li>
        <li><strong>Parent server</strong> — HTTP server running on the EC2 host. Receives proof requests, forwards them to the enclave via vsock, returns signed proofs.</li>
        <li><strong>Vsock bridge</strong> — socat process that bridges TCP (parent) to vsock (enclave). Required because Node.js doesn&apos;t support AF_VSOCK natively.</li>
      </ul>

      <p>Communication flow:</p>
      <div className="code-block">
        <pre>{`Client (HTTPS) → Parent Server (port 8080) → Socat (TCP:9000 ↔ Vsock:5000) → Enclave App`}</pre>
      </div>

      <h2>Prerequisites</h2>
      <ul>
        <li>AWS account with EC2 access</li>
        <li>A Nitro-capable EC2 instance (c5, c6, m5, m6, r5, r6 families — <strong>not</strong> t2/t3)</li>
        <li>At least 2 vCPUs and 4 GB RAM (the enclave needs dedicated CPU/memory)</li>
        <li>Docker installed on the instance</li>
        <li>Node.js 20+ installed on the instance</li>
      </ul>

      <h2>Step 1: Launch EC2 Instance</h2>
      <p>Launch a Nitro-capable instance with enclave support enabled:</p>
      <div className="code-block">
        <div className="code-block-header">AWS Console or CLI</div>
        <pre>{`# Example: c6a.xlarge (4 vCPU, 8 GB RAM)
# AMI: Amazon Linux 2023

# IMPORTANT: Enable "Nitro Enclave" in Advanced Details when launching
# Or via CLI:
aws ec2 run-instances \\
  --instance-type c6a.xlarge \\
  --image-id ami-0abcdef1234567890 \\
  --enclave-options Enabled=true \\
  --key-name your-key-pair`}</pre>
      </div>

      <p>Security group — allow inbound:</p>
      <table>
        <thead><tr><th>Port</th><th>Protocol</th><th>Source</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td>22</td><td>TCP</td><td>Your IP</td><td>SSH</td></tr>
          <tr><td>8080</td><td>TCP</td><td>Your app server</td><td>Parent HTTP API</td></tr>
        </tbody>
      </table>

      <h2>Step 2: Install Dependencies</h2>
      <p>SSH into the instance and install everything:</p>
      <div className="code-block">
        <div className="code-block-header">Shell</div>
        <pre>{`# Install Nitro CLI
sudo amazon-linux-extras install aws-nitro-enclaves-cli -y
sudo yum install aws-nitro-enclaves-cli-devel -y

# Install Docker
sudo yum install docker -y
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER

# Install Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install nodejs -y

# Install socat
sudo yum install socat -y

# Install build tools (for NSM helper)
sudo yum install gcc musl-devel -y

# Start the Nitro enclave allocator
sudo systemctl start nitro-enclaves-allocator
sudo systemctl enable nitro-enclaves-allocator

# Add yourself to the enclave group
sudo usermod -aG ne $USER

# IMPORTANT: Log out and back in for group changes
exit`}</pre>
      </div>

      <h2>Step 3: Configure Enclave Resources</h2>
      <p>The enclave needs dedicated CPU and memory allocated from the host. Edit the allocator config:</p>
      <div className="code-block">
        <div className="code-block-header">/etc/nitro_enclaves/allocator.yaml</div>
        <pre>{`# Allocate 2 CPUs and 1024 MB to the enclave
memory_mib: 1024
cpu_count: 2`}</pre>
      </div>
      <div className="code-block">
        <pre>{`# Restart allocator after changes
sudo systemctl restart nitro-enclaves-allocator`}</pre>
      </div>

      <h2>Step 4: Clone and Build</h2>
      <div className="code-block">
        <div className="code-block-header">Shell</div>
        <pre>{`# Clone the repo
git clone https://github.com/mikeargento/bitgraph.git
cd bitgraph

# Build the enclave EIF reproducibly. This pins every input (base image by
# digest, OS packages by version, sharp by lockfile, and nitro-cli 1.4.4 which
# fixes the kernel measured into PCR0), builds the image with kaniko in
# --reproducible mode, and packs the EIF with a pinned nitro-cli. Requires
# Docker + git on a linux/amd64 host; Nitro hardware is NOT needed to build the
# EIF (only to run it). Build the tagged enclave source release: the production
# enclave is built from the enclave-v4 tag, not necessarily the latest commit.
./server/commit-service/reproducible-build/build-eif.sh enclave-v4

# PCR0 is printed at the end and written to eif-out/pcr0.txt.`}</pre>
      </div>

      <h2>Step 5: Verify the PCR0 is reproducible</h2>
      <p>PCR0 is a SHA-384 measurement of the entire EIF, and it is the enclave&apos;s identity that every proof embeds. Because the build above pins all of its inputs, you can prove the build is deterministic: build it twice and confirm the PCR0 is byte-identical, and that it equals the value BitGraph publishes. If it matches, you have independently confirmed the production enclave runs exactly the code at the tagged enclave source release (<code>enclave-v4</code>) in this repository, trusting no one.</p>
      <div className="code-block">
        <div className="code-block-header">Shell</div>
        <pre>{`# Build twice from clean state and assert identical PCR0 == the published value:
./server/commit-service/reproducible-build/verify-pcr0.sh enclave-v4 \\
  e2fccbae77ee40aac4830e84f195e05d69eb4547bbd961f4d3459feba10807140424aca42ad03810354982598c86b9cb

# PASS: two independent builds produced identical PCR0:
#   e2fccbae...8c86b9cb
# PASS: matches the published PCR0.

# See server/commit-service/reproducible-build/PINS.md for every pinned
# digest/version, and README.md for how the determinism is achieved.`}</pre>
      </div>

      <div style={{ padding: "16px 18px", background: "rgba(0,101,164,0.04)", border: "1px solid rgba(0,101,164,0.15)", borderRadius: 0, margin: "16px 0" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#0065A4", marginBottom: 8 }}>BitGraph&apos;s published measurement</div>
        <p style={{ marginTop: 0, marginBottom: 10 }}>The BitGraph enclave image in production measures as:</p>
        <div style={{ fontSize: 12, fontFamily: "var(--font-mono), monospace", wordBreak: "break-all", background: "#fff", border: "1px solid #d0d5dd", padding: "10px 12px", marginBottom: 10 }}>
          PCR0 e2fccbae77ee40aac4830e84f195e05d69eb4547bbd961f4d3459feba10807140424aca42ad03810354982598c86b9cb
        </div>
        <p style={{ marginTop: 0, marginBottom: 0, fontSize: 13, color: "#374151" }}>
          This is the value BitGraph publishes and stands behind. Every proof embeds this measurement, and the &quot;Verify Attestation&quot; check confirms the attestation&apos;s PCR0 matches it. The build is <strong>bit-for-bit reproducible</strong>: rebuild from this source on any linux/amd64 host with <code>verify-pcr0.sh</code> and you will re-derive exactly this PCR0. You do not have to trust BitGraph&apos;s assertion, you can recompute it yourself. The one input you trust AWS for is their signed enclave kernel, which is what PCR1 independently measures; everything else folded into PCR0 is built from the auditable source in this repository.
        </p>
      </div>

      <h2>Step 6: Launch the Enclave</h2>
      <div className="code-block">
        <div className="code-block-header">Shell</div>
        <pre>{`# Terminate any existing enclave
nitro-cli terminate-enclave --all 2>/dev/null

# Launch the enclave
nitro-cli run-enclave \\
  --eif-path enclave.eif \\
  --cpu-count 2 \\
  --memory 1024

# Verify it's running
nitro-cli describe-enclaves
# Should show: State: "RUNNING", EnclaveCID: <number>

# Save the CID — you need it for the vsock bridge
ENCLAVE_CID=$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveCID')`}</pre>
      </div>

      <h2>Step 7: Start the Vsock Bridge</h2>
      <p>The bridge connects the parent server (TCP) to the enclave (vsock):</p>
      <div className="code-block">
        <div className="code-block-header">Shell</div>
        <pre>{`# Start socat bridge in background
nohup socat TCP-LISTEN:9000,fork,reuseaddr \\
  VSOCK-CONNECT:$ENCLAVE_CID:5000 \\
  > /tmp/socat-bridge.log 2>&1 &

# Verify it's listening
ss -tlnp | grep 9000
# Should show: LISTEN 0 5 0.0.0.0:9000`}</pre>
      </div>

      <h2>Step 8: Build and Start the Parent Server</h2>
      <div className="code-block">
        <div className="code-block-header">Shell</div>
        <pre>{`# Build the parent server (TypeScript → JavaScript)
cd /path/to/bitgraph/server/commit-service
npx tsc -p tsconfig.parent.json

# Set environment variables
export PORT=8080
export VSOCK_BRIDGE_PORT=9000
export API_KEYS="your-secret-api-key-here"

# Start the parent server
nohup node dist/parent/server.js > /tmp/parent.log 2>&1 &`}</pre>
      </div>

      <h2>Step 9: Verify</h2>
      <div className="code-block">
        <div className="code-block-header">Shell</div>
        <pre>{`# Health check
curl http://localhost:8080/health
# { "ok": true }

# Get the enclave's public key and measurement
curl http://localhost:8080/key
# {
#   "publicKeyB64": "...",
#   "measurement": "abc123...",
#   "enforcement": "measured-tee"
# }

# Test a commit
DIGEST=$(echo -n "hello world" | openssl dgst -sha256 -binary | base64)
curl -X POST http://localhost:8080/commit \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer your-secret-api-key-here" \\
  -d "{
    \\"digests\\": [{\\"digestB64\\": \\"$DIGEST\\", \\"hashAlg\\": \\"sha256\\"}]
  }"
# Returns: signed BitGraph proof with TEE attestation`}</pre>
      </div>

      <h2>Step 10: Point BitGraph Dashboard at Your TEE</h2>
      <p>By default, the hosted dashboard at occ.bitgraph.ing points to <code>nitro.occproof.com</code>. To use your own TEE, set the <code>TEE_URL</code> environment variable on your hosted server:</p>
      <div className="code-block">
        <pre>{`# In your hosted server environment (Railway, etc.)
TEE_URL=https://your-tee-domain.com`}</pre>
      </div>
      <p>The hosted server at <code>packages/hosted/src/authorization.ts</code> reads this variable:</p>
      <div className="code-block">
        <pre>{`const TEE_URL = process.env.TEE_URL || "https://nitro.occproof.com";`}</pre>
      </div>

      <h2>Production Checklist</h2>
      <ul>
        <li>Put an ALB or CloudFront in front of port 8080 with TLS termination</li>
        <li>Restrict security group to only allow your app server&apos;s IP</li>
        <li>Set strong API keys via the <code>API_KEYS</code> environment variable</li>
        <li>Save the PCR0 measurement — this is your enclave&apos;s identity for verification</li>
        <li>Set up monitoring on <code>/health</code> endpoint</li>
        <li>Configure log rotation for parent server and socat logs</li>
        <li>The enclave generates a new keypair on each restart — the epochId changes and the counter resets to 1. Cross-epoch sequencing is established by Ethereum anchors, not by an in-enclave chain.</li>
      </ul>

      <h2>Using the Deploy Script</h2>
      <p>For automated deployment, use the included script:</p>
      <div className="code-block">
        <div className="code-block-header">Shell</div>
        <pre>{`cd bitgraph/server/commit-service
./deploy.sh

# This runs all steps automatically:
# 1. Builds Docker image
# 2. Builds EIF
# 3. Terminates existing enclave
# 4. Launches new enclave
# 5. Starts vsock bridge
# 6. Builds and starts parent server`}</pre>
      </div>

      <h2>Key Files</h2>
      <table>
        <thead><tr><th>File</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><code>server/commit-service/Dockerfile.enclave</code></td><td>Builds the enclave Docker image</td></tr>
          <tr><td><code>server/commit-service/src/enclave/app.ts</code></td><td>Enclave application — proof signing, slot management</td></tr>
          <tr><td><code>server/commit-service/src/parent/server.ts</code></td><td>Parent HTTP API — commit, key, health endpoints</td></tr>
          <tr><td><code>server/commit-service/src/parent/vsock-client.ts</code></td><td>TCP bridge client to enclave</td></tr>
          <tr><td><code>server/commit-service/deploy.sh</code></td><td>Automated deployment script</td></tr>
          <tr><td><code>packages/adapter-nitro/src/nitro-host.ts</code></td><td>NSM device interface — attestation, measurement</td></tr>
          <tr><td><code>packages/hosted/src/authorization.ts</code></td><td>Dashboard integration — calls TEE_URL</td></tr>
        </tbody>
      </table>

      <h2>How the Enclave Works Internally</h2>
      <p>On startup, the enclave:</p>
      <ol>
        <li>Generates a fresh Ed25519 keypair in memory (never exported)</li>
        <li>Fetches the PCR0 measurement from the NSM device (<code>/dev/nsm</code>)</li>
        <li>Generates a boot nonce from the NSM hardware RNG</li>
        <li>Computes <code>epochId = SHA-256(publicKeyB64 + &quot;:&quot; + bootNonceB64)</code></li>
        <li>Listens on a Unix socket for proof requests</li>
      </ol>

      <p>For each proof request:</p>
      <ol>
        <li>Validates the slot exists (BitGraph causal gate — no slot, no proof)</li>
        <li>Increments the chain counter</li>
        <li>Builds the signed body: artifact, commit, policy, principal</li>
        <li>Signs with Ed25519</li>
        <li>Gets a Nitro attestation report from the NSM device</li>
        <li>Returns the complete BitGraph proof with attestation embedded</li>
      </ol>

      <h2>Epoch Transitions</h2>
      <p>When the enclave restarts (deploy, crash, reboot):</p>
      <ul>
        <li>A fresh Ed25519 keypair is generated inside the enclave from hardware entropy. The previous key is destroyed and exists nowhere outside the terminated enclave.</li>
        <li>A new <code>epochId</code> is derived from the new public key plus a fresh boot nonce.</li>
        <li>The monotonic counter resets to 1. The first proof of the new epoch has no <code>prevB64</code> — the prior chain is closed, and the new chain begins at genesis.</li>
        <li>During restart, all commit requests fail closed.</li>
      </ul>
      <p>This is a containment property, not a limitation. Each epoch is a sealed compartment: any compromise of the live epoch cannot retroactively forge proofs under a prior epoch&apos;s key. Cross-epoch sequencing is established externally by Ethereum anchors, not by an in-enclave chain.</p>
    </div>
  );
}
