#!/bin/bash
set -euo pipefail
echo ""
echo "  ■ AGENTS: GO — Uninstaller"
echo ""
read -p "  Remove completely? (y/n) " -n 1 -r; echo ""
[[ ! $REPLY =~ ^[Yy]$ ]] && { echo "  Cancelled."; exit 0; }

echo "  Stopping services..."
launchctl unload -w "$HOME/Library/LaunchAgents/com.agentsgo.plist" 2>/dev/null || true
launchctl unload -w "$HOME/Library/LaunchAgents/com.agentsgo.dashboard.plist" 2>/dev/null || true
# Legacy
launchctl unload -w "$HOME/Library/LaunchAgents/com.waqas.night-crew.plist" 2>/dev/null || true
launchctl unload -w "$HOME/Library/LaunchAgents/com.waqas.night-crew-dashboard.plist" 2>/dev/null || true
launchctl unload -w "$HOME/Library/LaunchAgents/com.nightcrew.scheduler.plist" 2>/dev/null || true
launchctl unload -w "$HOME/Library/LaunchAgents/com.nightcrew.dashboard.plist" 2>/dev/null || true

pkill -f "claude.*dangerously-skip-permissions" 2>/dev/null || true

echo "  Removing files..."
rm -f "$HOME/Library/LaunchAgents/com.agentsgo.plist"
rm -f "$HOME/Library/LaunchAgents/com.agentsgo.dashboard.plist"
rm -f "$HOME/Library/LaunchAgents/com.waqas.night-crew.plist"
rm -f "$HOME/Library/LaunchAgents/com.waqas.night-crew-dashboard.plist"
rm -f "$HOME/Library/LaunchAgents/com.nightcrew.scheduler.plist"
rm -f "$HOME/Library/LaunchAgents/com.nightcrew.dashboard.plist"
rm -rf "$HOME/.agents-go"
rm -rf "$HOME/.night-crew"

echo ""
echo "  ✓ Agents: Go removed."
echo ""
