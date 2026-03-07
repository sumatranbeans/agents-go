#!/bin/bash
# ============================================================================
# Agents: Go — Installer
# ============================================================================
# curl -fsSL https://raw.githubusercontent.com/waqasburney/agents-go/main/install.sh | bash
# ============================================================================
set -euo pipefail

G='\033[0;32m';Y='\033[1;33m';R='\033[0;31m';B='\033[1m';N='\033[0m'

echo ""
echo -e "${G}${B}  ■ AGENTS: GO — Installer${N}"
echo ""

[[ "$(uname)" != "Darwin" ]] && { echo -e "${R}macOS only.${N}"; exit 1; }
! command -v node &>/dev/null && { echo -e "${R}Node.js required: https://nodejs.org${N}"; exit 1; }
[[ $(node -v|sed 's/v//'|cut -d. -f1) -lt 18 ]] && { echo -e "${R}Node.js 18+ needed. You have $(node -v).${N}"; exit 1; }

CB=$(bash -lc "which claude" 2>/dev/null || echo "")
if [ -z "$CB" ]; then
  for P in /opt/homebrew/bin/claude /usr/local/bin/claude "$HOME/.npm-global/bin/claude" "$HOME/.local/bin/claude" "$HOME/.claude/bin/claude"; do
    [ -f "$P" ] && { CB="$P"; break; }
  done
fi
[ -z "$CB" ] && echo -e "${Y}Warning: Claude Code CLI not found. Install later.${N}" || echo -e "  Claude: ${G}$CB${N}"

DIR="$HOME/.agents-go"
NODE=$(which node)
echo -e "  Node:   ${G}$NODE${N}"
echo -e "  Dir:    ${G}$DIR${N}"
echo ""

mkdir -p "$DIR/logs"

SD="$(cd "$(dirname "${BASH_SOURCE[0]}" 2>/dev/null)" && pwd 2>/dev/null || echo "")"
if [ -f "$SD/dashboard.js" ]; then cp "$SD/dashboard.js" "$DIR/dashboard.js"
else curl -fsSL "https://raw.githubusercontent.com/waqasburney/agents-go/main/dashboard.js" -o "$DIR/dashboard.js"; fi

if [ -f "$SD/ui.html" ]; then cp "$SD/ui.html" "$DIR/ui.html"
else curl -fsSL "https://raw.githubusercontent.com/waqasburney/agents-go/main/ui.html" -o "$DIR/ui.html"; fi

if [ -f "$SD/uninstall.sh" ]; then cp "$SD/uninstall.sh" "$DIR/uninstall.sh"
else curl -fsSL "https://raw.githubusercontent.com/waqasburney/agents-go/main/uninstall.sh" -o "$DIR/uninstall.sh"; fi
chmod +x "$DIR/uninstall.sh"

PL="$HOME/Library/LaunchAgents/com.agentsgo.dashboard.plist"
cat > "$PL" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.agentsgo.dashboard</string>
    <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/dashboard.js</string></array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>/tmp/agentsgo-dashboard-out.log</string>
    <key>StandardErrorPath</key><string>/tmp/agentsgo-dashboard-err.log</string>
</dict>
</plist>
EOF

launchctl unload -w "$PL" 2>/dev/null || true
launchctl load -w "$PL"

sleep 2
echo ""
echo -e "${G}${B}  ✓ Agents: Go installed!${N}"
echo ""
echo -e "  ${B}Dashboard:${N} ${G}http://localhost:3847${N}"
echo ""
echo "  Add projects, add agents, set schedules, hit Start."
echo -e "  Uninstall: ${Y}~/.agents-go/uninstall.sh${N}"
echo ""
