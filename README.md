# Agents: Go

**Your autonomous Claude Code agent scheduler for macOS.**

Run your agents on autopilot — day or night. Each agent gets a fresh, stateless session, reads its own context, does its work, and exits cleanly. No memory bleed, no orphan processes.

*Developed by [Waqas Burney](https://github.com/waqasburney) & Claude.*

---

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/waqasburney/agents-go/main/install.sh | bash
```

Then open **http://localhost:3847**

## Requirements

- macOS (uses `launchd`)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed
- Node.js 18+

## Features

- **24-hour scheduling** — pick any hours of the day, any days of the week
- **Multi-project** — different agents for different codebases
- **Day-of-week control** — run agents on weekdays only, weekends only, or any combination
- **Web dashboard** at `localhost:3847` — add projects, agents, set schedules
- **Manual invoke** opens a live Terminal with the full Claude Code UI
- **Scheduled runs** are headless — no windows popping up at 2 AM
- **First-time tutorial** walks you through setup
- **Zero dependencies** — single Node.js file, no npm install

## How It Works

```
launchd (fires at scheduled hours)
  → sprint.sh
    → checks current hour + day of week
    → for each due agent:
        cd into project, run claude with agent's prompt
    → exits cleanly
```

Each agent's prompt is a simple invocation:
> "SCOUT, you've been invoked. Please do what you have to do."

The agent reads its own files on startup — it already knows what to do.

## Dashboard

**Dashboard** — Start/stop scheduler, manage projects and agents, invoke on demand

**Logs** — Filter by agent, project, or date range. Paginated. Clear all.

**About** — Full config docs, copyable. Share with your team.

**Help** — Getting started guide.

## Uninstall

```bash
~/.agents-go/uninstall.sh
```

## License

MIT
