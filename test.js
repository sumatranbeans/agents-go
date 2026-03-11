#!/usr/bin/env node
// ============================================================================
// AGENTS: GO — Tests for sprint.sh generation (genScript)
// ============================================================================
// Zero dependencies. Run: node test.js
// ============================================================================

var child = require("child_process");
var fs = require("fs");
var path = require("path");
var os = require("os");

var passed = 0;
var failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log("  PASS: " + msg); }
  else { failed++; console.log("  FAIL: " + msg); }
}

// ── Extract genScript by loading dashboard.js in a sandbox ──────────────────
// We can't require() dashboard.js directly (it starts an HTTP server),
// so we extract the genScript function and its dependencies.

var src = fs.readFileSync(path.join(__dirname, "dashboard.js"), "utf8");

// Build a sandboxed module that exposes genScript without starting the server
var sandbox = [
  'var http = { createServer: function() { return { listen: function(){} }; } };',
  'var child = require("child_process");',
  'var fs = require("fs");',
  'var path = require("path");',
  'var os = require("os");',
  'var HOME = os.homedir();',
  'var NCDIR = path.join(HOME, ".agents-go");',
  'var LOGDIR = path.join(NCDIR, "logs");',
  'var CFGPATH = path.join(NCDIR, "config.json");',
  'var SCRIPT = "/tmp/_agentsgo_test_sprint.sh";',
  'var PLIST = "com.agentsgo.plist";',
  'var PPATH = path.join(HOME, "Library", "LaunchAgents", PLIST);',
  'var CLAUDE_PATH = "/opt/homebrew/bin/claude";',
  'var CLAUDE_DIR = "/opt/homebrew/bin";',
  'var FULL_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";',
  'var PORT = 3847;',
  'var DEF = { sessionTimeout:1500, onboarded:false, visibleMode:true, projects:[] };'
].join("\n");

// Extract just the functions we need from dashboard.js
var fnNames = ["genScript", "genPlist", "genSetup", "genAgents"];
fnNames.forEach(function(name) {
  var re = new RegExp("(function " + name + "\\([^)]*\\)\\s*\\{)");
  var match = src.match(re);
  if (!match) return;
  // Find the matching closing brace
  var start = src.indexOf(match[0]);
  var depth = 0;
  var end = start;
  for (var i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    if (src[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  sandbox += "\n" + src.slice(start, end) + "\n";
});

// Extract bashEsc helper (not a function declaration, it's a function expression)
var bashEscMatch = src.match(/function bashEsc\([^)]*\)\{[^}]+\}/);
if (bashEscMatch) sandbox += "\n" + bashEscMatch[0] + "\n";

sandbox += "\nmodule.exports = { genScript: genScript };\n";

// Write and load sandbox
var sandboxPath = "/tmp/_agentsgo_test_sandbox.js";
fs.writeFileSync(sandboxPath, sandbox);
var mod = require(sandboxPath);

// ── Test config fixtures ────────────────────────────────────────────────────

var cfgOneAgent = {
  projects: [{
    name: "TestProject",
    path: "/tmp/test-project",
    agents: [{
      id: "adam",
      name: "ADAM",
      enabled: true,
      hours: [0, 1, 2, 3, 4, 23],
      days: [1, 2, 3, 4, 5],
      interval: 60,
      prompt: "ADAM, you have been invoked.",
      invisible: false
    }]
  }]
};

var cfgPausedAgent = {
  projects: [{
    name: "TestProject",
    path: "/tmp/test-project",
    agents: [{
      id: "safe",
      name: "SAFE",
      enabled: false,
      hours: [0, 1],
      days: [1, 2, 3, 4, 5],
      interval: 30,
      prompt: "SAFE, go.",
      invisible: false
    }]
  }]
};

var cfgMultiAgent = {
  projects: [{
    name: "TestProject",
    path: "/tmp/test-project",
    agents: [
      { id: "a1", name: "ALPHA", enabled: true, hours: [9, 10], days: [1, 2, 3], interval: 30, prompt: "Go alpha.", invisible: false },
      { id: "a2", name: "BETA", enabled: true, hours: [22, 23], days: [1, 2, 3, 4, 5], interval: 15, prompt: "Go beta.", invisible: true },
      { id: "a3", name: "GAMMA", enabled: false, hours: [0], days: [6, 7], interval: 60, prompt: "Go gamma.", invisible: false }
    ]
  }]
};

var cfgEmpty = { projects: [] };

var cfgEmptyHours = {
  projects: [{
    name: "TestProject",
    path: "/tmp/test-project",
    agents: [{
      id: "clippie",
      name: "CLIPPIE",
      enabled: true,
      hours: [],
      days: [1, 2, 3, 4, 5],
      interval: 60,
      prompt: "Clippie, go.",
      invisible: false
    }]
  }]
};

var cfgEmptyDays = {
  projects: [{
    name: "TestProject",
    path: "/tmp/test-project",
    agents: [{
      id: "ghost",
      name: "GHOST",
      enabled: true,
      hours: [0, 1, 2],
      days: [],
      interval: 60,
      prompt: "Ghost, go.",
      invisible: false
    }]
  }]
};

// ── Tests ───────────────────────────────────────────────────────────────────

var SCRIPT_PATH = "/tmp/_agentsgo_test_sprint.sh";

console.log("\n=== Test Suite: genScript ===\n");

// --- Test 1: Syntax validity ---
console.log("1. Generated script has valid bash syntax");
mod.genScript(cfgOneAgent);
var script = fs.readFileSync(SCRIPT_PATH, "utf8");
try {
  child.execSync("bash -n " + SCRIPT_PATH + " 2>&1", { encoding: "utf8" });
  assert(true, "bash -n passes (no syntax errors)");
} catch (e) {
  assert(false, "bash -n fails: " + e.stdout);
}

// --- Test 2: No 2>/dev/null in for-loop word list (THE BUG) ---
console.log("\n2. No redirect in for-loop word list (regression test for the bug)");
var lines = script.split("\n");
var forLines = lines.filter(function(l) { return l.match(/^for\s+\w+\s+in\s/); });
forLines.forEach(function(l) {
  // Check that the word list portion (between 'in' and '; do' or 'do') has no bare redirects
  var wordListMatch = l.match(/\bin\s+(.*?);\s*do/);
  if (wordListMatch) {
    var wordList = wordListMatch[1];
    // 2>/dev/null in $() subshells is fine — only flag it at the top level
    var stripped = wordList.replace(/\$\([^)]*\)/g, "");
    var hasBareRedirect = /[^$]\d*>/.test(stripped) || /^\d*>/.test(stripped);
    assert(!hasBareRedirect, "No bare redirect in for-loop word list: " + l.trim().slice(0, 60));
  }
});
assert(forLines.length > 0, "Found for-loops to check (" + forLines.length + " total)");

// --- Test 3: Enabled agent gets condition block ---
console.log("\n3. Enabled agent produces scheduling condition");
assert(script.indexOf('Summoning ADAM') !== -1, "ADAM summoning appears in script");
assert(script.indexOf('"$DOW" == "1"') !== -1, "Day-of-week condition for Monday");
assert(script.indexOf('"$H" == "23"') !== -1, "Hour condition for 23 (11 PM)");
assert(script.indexOf("min_ok 60") !== -1, "Interval check for 60 minutes");

// --- Test 4: Paused agent gets commented out ---
console.log("\n4. Paused agent is commented out");
mod.genScript(cfgPausedAgent);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
assert(script.indexOf("# SAFE PAUSED") !== -1, "SAFE is marked as PAUSED");
assert(script.indexOf('Summoning SAFE') === -1, "SAFE summoning does NOT appear");

// --- Test 5: Multi-agent with mixed enabled/disabled/invisible ---
console.log("\n5. Multi-agent config (enabled + disabled + invisible)");
mod.genScript(cfgMultiAgent);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
try {
  child.execSync("bash -n " + SCRIPT_PATH + " 2>&1", { encoding: "utf8" });
  assert(true, "Multi-agent script passes bash -n");
} catch (e) {
  assert(false, "Multi-agent script has syntax error: " + e.stdout);
}
assert(script.indexOf('Summoning ALPHA') !== -1, "ALPHA (visible, enabled) is summoned");
assert(script.indexOf('run_bg "BETA"') !== -1, "BETA (invisible, enabled) uses run_bg");
assert(script.indexOf("# GAMMA PAUSED") !== -1, "GAMMA (disabled) is paused");
assert(script.indexOf("run_bg()") !== -1, "run_bg helper is defined (invisible agent present)");

// --- Test 6: No run_bg when no invisible agents ---
console.log("\n6. run_bg helper omitted when no invisible agents");
mod.genScript(cfgOneAgent);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
assert(script.indexOf("run_bg()") === -1, "run_bg NOT defined (no invisible agents)");

// --- Test 7: Empty config produces valid script ---
console.log("\n7. Empty config");
mod.genScript(cfgEmpty);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
try {
  child.execSync("bash -n " + SCRIPT_PATH + " 2>&1", { encoding: "utf8" });
  assert(true, "Empty config script passes bash -n");
} catch (e) {
  assert(false, "Empty config script has syntax error: " + e.stdout);
}

// --- Test 8: Hour padding ---
console.log("\n8. Hours are zero-padded in conditions");
mod.genScript(cfgOneAgent);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
assert(script.indexOf('"$H" == "00"') !== -1, "Hour 0 padded to '00'");
assert(script.indexOf('"$H" == "01"') !== -1, "Hour 1 padded to '01'");
assert(script.indexOf('"$H" == "23"') !== -1, "Hour 23 stays '23'");

// --- Test 9: Timeout calculation ---
console.log("\n9. Timeout is (interval-1)*60");
mod.genScript(cfgOneAgent);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
assert(script.indexOf("TIMEOUT=3540") !== -1, "60-min interval => 3540s timeout");

mod.genScript(cfgMultiAgent);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
assert(script.indexOf("TIMEOUT=1740") !== -1, "30-min interval => 1740s timeout for ALPHA");

// --- Test 10: Script starts with set -euo pipefail ---
console.log("\n10. Script safety flags");
mod.genScript(cfgOneAgent);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
assert(script.split("\n")[0] === "#!/bin/bash", "Shebang is #!/bin/bash");
assert(script.split("\n")[1] === "set -euo pipefail", "set -euo pipefail on line 2");

// --- Test 11: defaults read has || true fallback (set -euo safety) ---
console.log("\n11. defaults read has || true fallback");
mod.genScript(cfgOneAgent);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
assert(script.indexOf('defaults read com.apple.Terminal "Default Window Settings" 2>/dev/null || true') !== -1,
  "defaults read has || true to survive set -e");

// --- Test 12: log() function has || true on tee ---
console.log("\n12. log() function tolerates tee failure");
assert(script.indexOf('tee -a "$LF" || true') !== -1,
  "log() has || true after tee to survive set -e");

// --- Test 13: xargs uses -r flag for empty-input safety ---
console.log("\n13. xargs -r flag on watchdog kill commands");
mod.genScript(cfgOneAgent);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
var xargsLines = script.split("\n").filter(function(l) { return l.indexOf("xargs") !== -1 && l.indexOf("kill") !== -1; });
xargsLines.forEach(function(l) {
  assert(l.indexOf("xargs -r kill") !== -1, "xargs uses -r: " + l.trim().slice(0, 70));
});
assert(xargsLines.length > 0, "Found xargs kill lines to check (" + xargsLines.length + " total)");

// --- Test 14: Multi-agent xargs also has -r ---
console.log("\n14. Multi-agent watchdog xargs -r");
mod.genScript(cfgMultiAgent);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
var xargsAll = script.split("\n").filter(function(l) { return l.indexOf("xargs") !== -1 && l.indexOf("kill") !== -1; });
xargsAll.forEach(function(l) {
  assert(l.indexOf("xargs -r kill") !== -1, "xargs -r in multi-agent: " + l.trim().slice(0, 70));
});
assert(xargsAll.length > 0, "Found xargs kill lines in multi-agent (" + xargsAll.length + " total)");

// --- Test 15: Empty hours array produces valid script (CLIPPIE bug) ---
console.log("\n15. Empty hours array does not produce invalid bash");
mod.genScript(cfgEmptyHours);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
try {
  child.execSync("bash -n " + SCRIPT_PATH + " 2>&1", { encoding: "utf8" });
  assert(true, "Empty hours script passes bash -n");
} catch (e) {
  assert(false, "Empty hours script has syntax error: " + e.stdout);
}
assert(script.indexOf("CLIPPIE SKIPPED") !== -1, "CLIPPIE is skipped (no hours)");
assert(script.indexOf('Summoning CLIPPIE') === -1, "CLIPPIE is NOT summoned");

// --- Test 16: Empty days array produces valid script ---
console.log("\n16. Empty days array does not produce invalid bash");
mod.genScript(cfgEmptyDays);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
try {
  child.execSync("bash -n " + SCRIPT_PATH + " 2>&1", { encoding: "utf8" });
  assert(true, "Empty days script passes bash -n");
} catch (e) {
  assert(false, "Empty days script has syntax error: " + e.stdout);
}
assert(script.indexOf("GHOST SKIPPED") !== -1, "GHOST is skipped (no days)");
assert(script.indexOf('Summoning GHOST') === -1, "GHOST is NOT summoned");

// --- Test 17: Interval=0 does not produce division by zero ---
console.log("\n17. Invalid interval defaults to 60");
var cfgBadInterval = {
  projects: [{
    name: "TestProject",
    path: "/tmp/test-project",
    agents: [{ id: "z1", name: "ZERO", enabled: true, hours: [0], days: [1], interval: 0, prompt: "go.", invisible: false }]
  }]
};
mod.genScript(cfgBadInterval);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
try {
  child.execSync("bash -n " + SCRIPT_PATH + " 2>&1", { encoding: "utf8" });
  assert(true, "interval=0 script passes bash -n");
} catch (e) {
  assert(false, "interval=0 script has syntax error: " + e.stdout);
}
assert(script.indexOf("min_ok 60") !== -1, "interval=0 defaults to min_ok 60");
assert(script.indexOf("min_ok 0") === -1, "min_ok 0 does NOT appear");

// --- Test 18: Prompt with special bash chars is escaped ---
console.log("\n18. Prompt with $, backticks, backslashes escaped");
var cfgSpecialPrompt = {
  projects: [{
    name: "TestProject",
    path: "/tmp/test-project",
    agents: [{ id: "sp1", name: "SPECIAL", enabled: true, hours: [0], days: [1], interval: 60, prompt: 'test $HOME `whoami` "quotes" \\path', invisible: false }]
  }]
};
mod.genScript(cfgSpecialPrompt);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
try {
  child.execSync("bash -n " + SCRIPT_PATH + " 2>&1", { encoding: "utf8" });
  assert(true, "Special chars prompt passes bash -n");
} catch (e) {
  assert(false, "Special chars prompt syntax error: " + e.stdout);
}
assert(script.indexOf("\\$HOME") !== -1, "Dollar sign is escaped");
assert(script.indexOf("\\`whoami\\`") !== -1, "Backticks are escaped");

// --- Test 19: Agent name with special chars escaped ---
console.log("\n19. Agent name with special chars escaped");
var cfgSpecialName = {
  projects: [{
    name: "TestProject",
    path: "/tmp/test-project",
    agents: [{ id: "dollar", name: "AGENT$test", enabled: true, hours: [0], days: [1], interval: 60, prompt: "go.", invisible: false }]
  }]
};
mod.genScript(cfgSpecialName);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
try {
  child.execSync("bash -n " + SCRIPT_PATH + " 2>&1", { encoding: "utf8" });
  assert(true, "Special name passes bash -n");
} catch (e) {
  assert(false, "Special name syntax error: " + e.stdout);
}

// --- Test 20: Heredoc delimiter is unique per agent ---
console.log("\n20. Heredoc uses unique delimiter per agent");
mod.genScript(cfgOneAgent);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
assert(script.indexOf("AGENTEOF_ADAM") !== -1, "Heredoc uses AGENTEOF_ADAM");
assert(script.indexOf("'AGENTEOF'") === -1, "Generic AGENTEOF not used");

// --- Test 21: safeName uses agent ID to avoid collisions ---
console.log("\n21. safeName collision avoidance with agent ID");
var cfgCollision = {
  projects: [{
    name: "TestProject",
    path: "/tmp/test-project",
    agents: [
      { id: "agent-a", name: "Test Agent", enabled: true, hours: [0], days: [1], interval: 60, prompt: "go a.", invisible: false },
      { id: "agent-b", name: "test_agent", enabled: true, hours: [0], days: [1], interval: 60, prompt: "go b.", invisible: false }
    ]
  }]
};
mod.genScript(cfgCollision);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
try {
  child.execSync("bash -n " + SCRIPT_PATH + " 2>&1", { encoding: "utf8" });
  assert(true, "Collision config passes bash -n");
} catch (e) {
  assert(false, "Collision config syntax error: " + e.stdout);
}
assert(script.indexOf(".sched-agenta") !== -1, "Agent A uses id-based safeName");
assert(script.indexOf(".sched-agentb") !== -1, "Agent B uses id-based safeName");

// --- Test 22: Invisible agent uses process substitution for correct PID ---
console.log("\n22. Invisible agent tracks claude PID (not tee)");
mod.genScript(cfgMultiAgent);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
assert(script.indexOf("> >(tee") !== -1, "Uses process substitution for tee");
assert(script.indexOf("2>&1|tee") === -1, "Does NOT pipe to tee (would capture wrong PID)");

// --- Test 23: No blanket pkill in generated script ---
console.log("\n23. No blanket pkill of all agents");
mod.genScript(cfgOneAgent);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
assert(script.indexOf('pkill -f "claude.*dangerously-skip-permissions"') === -1,
  "No blanket pkill of all claude processes");
assert(script.indexOf('pgrep -f "\\.sched-"') === -1,
  "No blanket pgrep of all sched processes");

// --- Test 24: Per-agent skip-if-running logic ---
console.log("\n24. Per-agent skip-if-running check");
assert(script.indexOf('agent_running "adam"') !== -1,
  "ADAM has agent_running check");
assert(script.indexOf('still running, skipping this cycle') !== -1,
  "Skip message present for running agents");

// --- Test 25: agent_running helper function exists ---
console.log("\n25. agent_running helper defined");
assert(script.indexOf('agent_running()') !== -1,
  "agent_running function defined");
assert(script.indexOf('.running-$1') !== -1,
  "Uses .running-<safename> PID files");

// --- Test 26: PID file tracking in visible agent heredoc ---
console.log("\n26. Visible agent writes PID file");
assert(script.indexOf('echo $$ > "$PIDFILE"') !== -1,
  "Writes PID to file");
assert(script.indexOf("trap") !== -1 && script.indexOf('rm -f "$PIDFILE"') !== -1,
  "Trap cleans up PID file on exit");

// --- Test 27: PID file tracking in invisible (run_bg) agent ---
console.log("\n27. Invisible agent writes PID file");
mod.genScript(cfgMultiAgent);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
// run_bg should accept safeName parameter
assert(script.indexOf('run_bg(){') !== -1, "run_bg defined");
assert(script.indexOf('local N="$1" P="$2" PP="$3" TO="$4" SN="$5"') !== -1,
  "run_bg accepts 5th param (safeName)");
// run_bg should write PID file (search full script since run_bg has nested braces)
assert(script.indexOf('PIDFILE="$SD/.running-$SN"') !== -1,
  "run_bg writes .running-<safename> PID file");

// --- Test 28: Window cleanup only closes finished windows ---
console.log("\n28. Window cleanup respects busy status");
mod.genScript(cfgOneAgent);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
// Should check busy status before closing
var windowLoop = script.slice(script.indexOf('for WF in'), script.indexOf('done', script.indexOf('for WF in'))+4);
assert(windowLoop.indexOf('busy of window id') !== -1,
  "Checks window busy status before closing");
assert(windowLoop.indexOf('WBUSY') !== -1,
  "Uses WBUSY variable to gate closure");

// --- Test 29: Multi-agent all have independent running checks ---
console.log("\n29. Multi-agent independent skip checks");
mod.genScript(cfgMultiAgent);
script = fs.readFileSync(SCRIPT_PATH, "utf8");
assert(script.indexOf('agent_running "a1"') !== -1, "ALPHA has running check via id");
assert(script.indexOf('agent_running "a2"') !== -1, "BETA has running check via id");

// ── Cleanup ─────────────────────────────────────────────────────────────────
try { fs.unlinkSync(SCRIPT_PATH); } catch(e) {}
try { fs.unlinkSync(sandboxPath); } catch(e) {}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log("\n=== Results: " + passed + " passed, " + failed + " failed ===\n");
process.exit(failed > 0 ? 1 : 0);
