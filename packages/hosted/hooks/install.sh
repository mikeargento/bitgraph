#!/bin/bash
# OCC Installer for Claude Code
# Run: curl -fsSL https://agent.occ.wtf/install | bash
#
# What it does:
# 1. Downloads the occ-check hook script
# 2. Adds it to your global Claude Code settings
# 3. Prompts for your OCC token

set -e

OCC_URL="https://agent.occ.wtf"
HOOK_DIR="$HOME/.claude/hooks"
HOOK_PATH="$HOOK_DIR/occ-check.sh"
SETTINGS="$HOME/.claude/settings.json"

echo ""
echo "  ┌──────────────────────────────┐"
echo "  │   OCC — Install for Claude   │"
echo "  └──────────────────────────────┘"
echo ""

# Create hooks directory
mkdir -p "$HOOK_DIR"

# Download hook script
echo "  Downloading hook..."
curl -fsSL "${OCC_URL}/hooks/occ-check.sh" -o "$HOOK_PATH"
chmod +x "$HOOK_PATH"

# Ask for token
echo ""
echo "  Paste your OCC token (from agent.occ.wtf → Settings):"
echo "  (press Enter to skip — you can set OCC_TOKEN later)"
read -r TOKEN

if [ -n "$TOKEN" ]; then
  # Add to shell profile
  PROFILE="$HOME/.zshrc"
  [ -f "$HOME/.bashrc" ] && PROFILE="$HOME/.bashrc"

  # Remove old OCC_TOKEN line if exists
  grep -v "export OCC_TOKEN=" "$PROFILE" > "$PROFILE.tmp" 2>/dev/null || true
  mv "$PROFILE.tmp" "$PROFILE" 2>/dev/null || true

  echo "export OCC_TOKEN=\"$TOKEN\"" >> "$PROFILE"
  export OCC_TOKEN="$TOKEN"
  echo "  Token saved to $PROFILE"
fi

# Update Claude Code settings
if [ -f "$SETTINGS" ]; then
  # Check if hooks already configured
  if grep -q "occ-check" "$SETTINGS" 2>/dev/null; then
    echo "  Hook already configured in $SETTINGS"
  else
    echo "  Adding hook to $SETTINGS..."
    # Use node to merge JSON properly
    node -e "
      const fs = require('fs');
      const settings = JSON.parse(fs.readFileSync('$SETTINGS', 'utf-8'));
      if (!settings.hooks) settings.hooks = {};
      if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];
      const existing = settings.hooks.PreToolUse.find(h =>
        h.hooks?.some(hh => hh.command?.includes('occ-check'))
      );
      if (!existing) {
        settings.hooks.PreToolUse.push({
          matcher: '',
          hooks: [{ type: 'command', command: '$HOOK_PATH' }]
        });
      }
      fs.writeFileSync('$SETTINGS', JSON.stringify(settings, null, 2));
    "
  fi
else
  echo "  Creating $SETTINGS..."
  mkdir -p "$(dirname "$SETTINGS")"
  cat > "$SETTINGS" << SETTINGSEOF
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "$HOOK_PATH"
          }
        ]
      }
    ]
  }
}
SETTINGSEOF
fi

echo ""
echo "  ✓ OCC installed"
echo ""
echo "  Next steps:"
echo "    1. Sign up at agent.occ.wtf if you haven't"
echo "    2. Set OCC_TOKEN if you skipped it: export OCC_TOKEN=your-token"
echo "    3. Open Claude Code — every action now goes through OCC"
echo ""
