#!/bin/bash
# OCC Hook for Claude Code
# Reads tool call from stdin, sends to OCC for approval.
# Exit 0 = allow (OCC token forged), Exit 2 = deny (no token).
#
# Config: set OCC_TOKEN in your environment
# Get your token from agent.occ.wtf → Settings

OCC_URL="${OCC_URL:-https://agent.occ.wtf}"
TOKEN="${OCC_TOKEN:-}"

if [ -z "$TOKEN" ]; then
  exit 0 # No token = no enforcement, pass through
fi

# Read hook input from stdin
INPUT=$(cat)

# Extract tool name and args
TOOL=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)
TOOL_INPUT=$(echo "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(JSON.stringify(j.tool_input||{}))}catch{console.log('{}')}})" 2>/dev/null || echo '{}')

if [ -z "$TOOL" ]; then
  exit 0
fi

# Skip read-only tools — no token needed
case "$TOOL" in
  Read|Glob|Grep|WebSearch|TodoRead|TaskOutput)
    exit 0
    ;;
esac

# Call OCC — blocks until user approves/denies (up to 55s)
RESPONSE=$(curl -s -m 60 -X POST "${OCC_URL}/api/v2/hook/check" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"tool\":\"$TOOL\",\"args\":$TOOL_INPUT}")

# Check for token (user said Yes) or denial (user said No / timeout)
HAS_TOKEN=$(echo "$RESPONSE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.token?'yes':'no')}catch{console.log('no')}})" 2>/dev/null || echo 'no')
IS_DENIED=$(echo "$RESPONSE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.denied?'yes':'no')}catch{console.log('no')}})" 2>/dev/null || echo 'no')

if [ "$HAS_TOKEN" = "yes" ]; then
  # Token forged — user authorized this action
  DIGEST=$(echo "$RESPONSE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.token.proofDigest||'unknown')}catch{console.log('unknown')}})" 2>/dev/null || echo 'unknown')
  echo "{\"hookSpecificOutput\":{\"permissionDecision\":\"allow\",\"additionalContext\":\"[OCC AUTHORIZED] Proof digest: ${DIGEST}\"}}"
  exit 0
elif [ "$IS_DENIED" = "yes" ]; then
  # No token — user denied or timed out
  REASON=$(echo "$RESPONSE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.reason||'Denied')}catch{console.log('Denied')}})" 2>/dev/null || echo 'Denied')
  echo "OCC: Action denied — ${REASON}" >&2
  exit 2
else
  # Unexpected response — deny by default (safe)
  echo "OCC: Unexpected response from server" >&2
  exit 2
fi
