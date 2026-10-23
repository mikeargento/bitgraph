#!/usr/bin/env bash
# Adds /convert-bw route to the http-server.js proxy and restarts it.
set -euo pipefail

FILE="/home/ec2-user/nsm-test/http-server.js"
if [ -z "$FILE" ]; then echo "ERROR: http-server.js not found"; exit 1; fi
echo "Patching: $FILE"

# Check if already patched
if grep -q "convert-bw" "$FILE" 2>/dev/null; then
  echo "Already patched — skipping file edit"
else
  ROUTE='
  // POST /convert-bw — grayscale conversion inside TEE (public demo)
  if (method === "POST" && path === "/convert-bw") {
    try {
      const cid = getEnclaveCid();
      if (!cid) { sendJson(res, 503, { error: "no enclave running" }); return; }
      const rawBytes = await readBody(req);
      const body = JSON.parse(rawBytes.toString("utf8"));
      if (!body.imageB64) { sendJson(res, 400, { error: "missing imageB64" }); return; }
      const result = await vsockRequest(cid, JSON.stringify({ action: "convertBW", imageB64: body.imageB64 }), 30000);
      if (result.error) { sendJson(res, 500, { error: result.error }); return; }
      if (result.proof && !anchorProof(result.proof)) { sendJson(res, 503, { error: "counter rollback detected" }); return; }
      if (result.proof) {
        try {
          var artTsa = await requestTimestamp(result.digestB64).catch(function() { return null; });
          var pDigest = computeProofDigest(result.proof);
          var pTsa = await requestTimestamp(pDigest).catch(function() { return null; });
          if (artTsa || pTsa) { result.proof.timestamps = {}; if (artTsa) result.proof.timestamps.artifact = artTsa; if (pTsa) result.proof.timestamps.proof = pTsa; }
        } catch(e) { console.warn("[tsa] convert-bw timestamp error:", e.message); }
      }
      sendJson(res, 200, result);
    } catch (e) { console.error("[http-server] convert-bw error:", e.message); sendJson(res, 500, { error: e.message }); }
    return;
  }
'
  # Insert route before the 404 catch-all
  sudo node -e "
    const fs = require('fs');
    let code = fs.readFileSync('$FILE', 'utf8');
    const marker = 'sendJson(res, 404, { error: \"not found\" });';
    const route = $(printf '%s' "$ROUTE" | node -e "process.stdout.write(JSON.stringify(require('fs').readFileSync('/dev/stdin','utf8')))");
    code = code.replace(marker, route + '\n  ' + marker);
    fs.writeFileSync('$FILE', code);
    console.log('Route added to ' + '$FILE');
  "
fi

# Restart http-server
PID=$(pgrep -f "node.*http-server.js" || true)
DIR=$(dirname "$FILE")
if [ -n "$PID" ]; then
  echo "Killing old http-server (PID $PID)..."
  sudo kill "$PID" 2>/dev/null || true
  sleep 1
fi
echo "Starting http-server from $DIR..."
cd "$DIR" && sudo nohup node http-server.js > /tmp/http-server.log 2>&1 &
sleep 2
echo "Testing endpoint..."
curl -s -X POST https://nitro.occproof.com/convert-bw -H "Content-Type: application/json" -d '{"imageB64":"aGVsbG8="}' | head -c 300
echo ""
echo "Done!"
