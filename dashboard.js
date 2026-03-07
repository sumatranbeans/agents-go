#!/usr/bin/env node
// ============================================================================
// AGENTS: GO — Autonomous Claude Code Agents: Go
// ============================================================================
// Zero dependencies. http://localhost:3847
// Developed by Waqas Burney & Claude
// ============================================================================

var http = require("http");
var child = require("child_process");
var fs = require("fs");
var path = require("path");
var os = require("os");

var PORT = 3847;
var HOME = os.homedir();
var NCDIR = path.join(HOME, ".agents-go");
var LOGDIR = path.join(NCDIR, "logs");
var CFGPATH = path.join(NCDIR, "config.json");
var SCRIPT = path.join(NCDIR, "sprint.sh");
var PLIST = "com.agentsgo.plist";
var PPATH = path.join(HOME, "Library", "LaunchAgents", PLIST);

try { fs.mkdirSync(LOGDIR, { recursive: true }); } catch(e) {}

// ── Auto-detect claude CLI ─────────────────────────────────────────────────
var CLAUDE_PATH = "";
try { var f = child.execSync('bash -lc "which claude" 2>/dev/null',{encoding:"utf8"}).trim(); if(f&&fs.existsSync(f)) CLAUDE_PATH=f; } catch(e){}
if(!CLAUDE_PATH){["/opt/homebrew/bin/claude","/usr/local/bin/claude",HOME+"/.npm-global/bin/claude",HOME+"/.local/bin/claude",HOME+"/.claude/bin/claude"].forEach(function(p){if(!CLAUDE_PATH&&fs.existsSync(p))CLAUDE_PATH=p})}
var CLAUDE_DIR=CLAUDE_PATH?path.dirname(CLAUDE_PATH):"";
var FULL_PATH=["/opt/homebrew/bin","/usr/local/bin","/usr/bin","/bin",CLAUDE_DIR,HOME+"/.npm-global/bin",HOME+"/.local/bin",HOME+"/.claude/bin"].filter(Boolean).join(":");

// ── Config ─────────────────────────────────────────────────────────────────
var DEF = { sessionTimeout:1500, onboarded:false, visibleMode:true, projects:[] };

function loadCfg(){
  try{var c=JSON.parse(fs.readFileSync(CFGPATH,"utf8"));if(!c.projects)c.projects=[];return c}
  catch(e){fs.writeFileSync(CFGPATH,JSON.stringify(DEF,null,2));return JSON.parse(JSON.stringify(DEF))}
}
function saveCfg(c){fs.writeFileSync(CFGPATH,JSON.stringify(c,null,2));genScript(c);genPlist(c)}

// ── Generate sprint script ─────────────────────────────────────────────────
function genScript(cfg){
  var visible = cfg.visibleMode !== false; // default true
  var L=[];
  L.push("#!/bin/bash");
  L.push("set -euo pipefail");
  L.push('export PATH="'+FULL_PATH+':$PATH"');
  L.push('LD="$HOME/.agents-go/logs"');
  L.push('SD="$HOME/.agents-go"');
  L.push('mkdir -p "$LD"');
  L.push('find "$LD" -name "sprint_*.log" -mtime +14 -delete 2>/dev/null || true');
  L.push('find "$LD" -name "manual_*.log" -mtime +14 -delete 2>/dev/null || true');
  L.push('H=$(date +"%H")');
  L.push('M=$(date +"%M")');
  L.push('DOW=$(date +"%u")'); // 1=Mon 7=Sun
  L.push('MIN=$(echo $M | sed "s/^0//")'); // strip leading zero
  L.push('TS=$(date +"%Y-%m-%d_%H%M")');
  L.push('LF="$LD/sprint_${TS}.log"');
  L.push('log(){ echo "[$(date \'+%Y-%m-%d %H:%M:%S\')] $*"|tee -a "$LF"; }');
  L.push("# Check if minute aligns with interval: min_ok <interval>");
  L.push('min_ok(){ local iv=$1; [ $(( MIN % iv )) -eq 0 ] && return 0 || return 1; }');

  if (!visible) {
    // Background mode: headless, no Terminal window
    L.push("# run_bg <name> <prompt> <project_path> <timeout_seconds>");
    L.push("run_bg(){");
    L.push('  local N="$1" P="$2" PP="$3" TO="$4" T0=$(date +%s)');
    L.push('  cd "$PP" || { log "Cannot cd to $PP"; return; }');
    L.push('  log "Summoning ${N}..."');
    L.push('  claude --print --dangerously-skip-permissions "$P" 2>&1|tee -a "$LF" &');
    L.push("  local CP=$!");
    L.push("  while kill -0 $CP 2>/dev/null;do sleep 5");
    L.push("    [ $(( $(date +%s)-T0 )) -ge $TO ]&&{ log \"Timeout. Stopping ${N}...\";kill $CP 2>/dev/null;wait $CP 2>/dev/null;break; }");
    L.push("  done; wait $CP 2>/dev/null||true");
    L.push('  log "${N} ended after $(( $(date +%s)-T0 ))s"');
    L.push("}");
  }

  L.push('log "===== Sprint - Hour:${H} Day:${DOW} ====="');

  cfg.projects.forEach(function(proj){
    var sp=proj.path.replace(/"/g,'\\"');
    L.push('log "-- Project: '+proj.name+' --"');
    (proj.agents||[]).forEach(function(a){
      if(!a.enabled){L.push('# '+a.name+' PAUSED');return}
      // Day check
      var days=a.days||[1,2,3,4,5,6,7];
      var dayCond=days.map(function(d){return '"$DOW" == "'+d+'"'}).join(" || ");
      // Hour check
      var hrCond=a.hours.map(function(h){return '"$H" == "'+String(h).padStart(2,"0")+'"'}).join(" || ");
      var interval = a.interval || 60;
      var timeout = (interval - 1) * 60; // 1 minute before next scheduled run
      var pr=(a.prompt||a.name+", go.").replace(/"/g,'\\"');
      L.push("if [[ ("+dayCond+") && ("+hrCond+") ]] && min_ok "+interval+";then");
      if (visible) {
        // Visible mode: write a self-contained temp script per agent, open in Terminal
        var safeName = a.name.toLowerCase().replace(/[^a-z0-9]/g,"");
        L.push('  log "Summoning '+a.name+' (visible)..."');
        L.push('  ATMP="$SD/.sched-'+safeName+'.sh"');
        L.push('  ALF="$LD/sprint_'+safeName+'_${TS}.log"');
        L.push('  cat > "$ATMP" << \'AGENTEOF\'');
        L.push('#!/bin/bash');
        L.push('export PATH="'+FULL_PATH+':$PATH"');
        L.push('AGENT_NAME="'+a.name+'"');
        L.push('AGENT_PROMPT="'+pr+'"');
        L.push('PROJECT_PATH="'+sp+'"');
        L.push('TIMEOUT='+timeout);
        L.push('LOGFILE="$1"');
        L.push('echo "================================================"');
        L.push('echo "  AGENTS: GO — Scheduled: $AGENT_NAME"');
        L.push('echo "  Project: $PROJECT_PATH"');
        L.push('echo "  Timeout: ${TIMEOUT}s ('+Math.floor(timeout/60)+' min)"');
        L.push('echo "================================================"');
        L.push('echo ""');
        L.push('cd "$PROJECT_PATH" || { echo "Cannot cd to $PROJECT_PATH"; exit 1; }');
        L.push('echo "[$(date \'+%Y-%m-%d %H:%M:%S\')] Summoning $AGENT_NAME..." | tee -a "$LOGFILE"');
        L.push('echo ""');
        L.push('T0=$(date +%s)');
        L.push('claude --dangerously-skip-permissions "$AGENT_PROMPT" 2>&1 | tee -a "$LOGFILE" &');
        L.push('CP=$!');
        L.push('while kill -0 $CP 2>/dev/null; do');
        L.push('  sleep 5');
        L.push('  ELAPSED=$(( $(date +%s) - T0 ))');
        L.push('  if [ $ELAPSED -ge $TIMEOUT ]; then');
        L.push('    echo "" | tee -a "$LOGFILE"');
        L.push('    echo "[$(date \'+%Y-%m-%d %H:%M:%S\')] Timeout (${ELAPSED}s). Stopping $AGENT_NAME..." | tee -a "$LOGFILE"');
        L.push('    kill $CP 2>/dev/null; wait $CP 2>/dev/null');
        L.push('    break');
        L.push('  fi');
        L.push('done');
        L.push('wait $CP 2>/dev/null || true');
        L.push('DUR=$(( $(date +%s) - T0 ))');
        L.push('echo "" | tee -a "$LOGFILE"');
        L.push('echo "[$(date \'+%Y-%m-%d %H:%M:%S\')] $AGENT_NAME ended after ${DUR}s" | tee -a "$LOGFILE"');
        L.push('sleep 2');
        L.push('exit 0');
        L.push('AGENTEOF');
        L.push('  chmod +x "$ATMP"');
        // Use execFile-safe osascript: pass log file as single arg
        L.push('  osascript -e "tell application \\"Terminal\\"" -e "activate" -e "do script \\"bash \'$ATMP\' \'$ALF\'\\"" -e "end tell" &');
      } else {
        L.push('  run_bg "'+a.name+'" "'+pr+'" "'+sp+'" '+timeout);
      }
      L.push("fi");
    });
  });
  L.push('log "===== Sprint complete ====="');
  fs.writeFileSync(SCRIPT,L.join("\n"),{mode:0o755});
}

// ── Generate plist ─────────────────────────────────────────────────────────
function genPlist(cfg){
  // Find smallest interval across all active agents
  var minInterval = 60;
  cfg.projects.forEach(function(p){(p.agents||[]).forEach(function(a){if(a.enabled){var iv=a.interval||60;if(iv<minInterval)minInterval=iv}})});
  // Build StartCalendarInterval entries for clock-aligned firing
  // e.g. 30-min interval → fire at :00 and :30 every hour
  var minutes=[];for(var m=0;m<60;m+=minInterval)minutes.push(m);
  var calEntries=minutes.map(function(m){return '        <dict>\n            <key>Minute</key>\n            <integer>'+m+'</integer>\n        </dict>'}).join("\n");
  var xml=['<?xml version="1.0" encoding="UTF-8"?>','<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">','<plist version="1.0">','<dict>','    <key>Label</key>','    <string>com.agentsgo</string>','    <key>ProgramArguments</key>','    <array>','        <string>/bin/bash</string>','        <string>'+SCRIPT+'</string>','    </array>','    <key>StartCalendarInterval</key>','    <array>',calEntries,'    </array>','    <key>StandardOutPath</key>','    <string>/tmp/agentsgo-stdout.log</string>','    <key>StandardErrorPath</key>','    <string>/tmp/agentsgo-stderr.log</string>','    <key>EnvironmentVariables</key>','    <dict>','        <key>PATH</key>','        <string>'+FULL_PATH+'</string>','    </dict>','</dict>','</plist>'].join("\n");
  fs.writeFileSync(PPATH,xml);
}

function launchStart(){try{child.execSync('launchctl unload -w "'+PPATH+'" 2>/dev/null')}catch(e){}child.execSync('launchctl load -w "'+PPATH+'" 2>&1')}
function launchStop(){child.execSync('launchctl unload -w "'+PPATH+'" 2>&1')}
function isLoaded(){try{var o=child.execSync("launchctl list 2>/dev/null",{encoding:"utf8"}).split("\n");for(var i=0;i<o.length;i++){if(o[i].match(/\tcom\.agentsgo$/))return true}return false}catch(e){return false}}

function getLogs(){try{return fs.readdirSync(LOGDIR).filter(function(f){return f.endsWith(".log")}).sort().reverse().map(function(f){var st=fs.statSync(path.join(LOGDIR,f));var t=fs.readFileSync(path.join(LOGDIR,f),"utf8");var ag=[],su=[],pr=[],m;var r1=/Summoning (\w+)/g;while((m=r1.exec(t))!==null)ag.push(m[1]);var r2=/(\w+) ended after (\d+)s/g;while((m=r2.exec(t))!==null)su.push({name:m[1],dur:parseInt(m[2])});var r3=/Project: (.+?) --/g;while((m=r3.exec(t))!==null)pr.push(m[1]);return{file:f,date:st.mtime.toISOString().slice(0,10),size:st.size,agents:ag,success:su,projects:pr,manual:f.indexOf("manual_")===0}})}catch(e){return[]}}
function getLog(f){try{return fs.readFileSync(path.join(LOGDIR,path.basename(f)),"utf8")}catch(e){return"Not found."}}
function getRunning(){try{var o=child.execSync("ps aux 2>/dev/null",{encoding:"utf8"});return o.split("\n").filter(function(l){return l.indexOf("claude")!==-1&&l.indexOf("dangerously-skip-permissions")!==-1&&l.indexOf("grep")===-1&&l.indexOf(".sched-")===-1}).map(function(l){return{pid:l.trim().split(/\s+/)[1]}})}catch(e){return[]}}

function invokeInTerminal(pp,an,pr,to,cb){
  var ts=new Date().toISOString().replace(/[T:]/g,"-").slice(0,16);
  var lf=path.join(LOGDIR,"manual_"+an.toLowerCase()+"_"+ts+".log");
  var tmp=path.join(NCDIR,".invoke-"+an.toLowerCase()+".sh");
  var s=["#!/bin/bash",'export PATH="'+FULL_PATH+':$PATH"','','echo "================================================"','echo "  AGENTS: GO - Invoking: '+an+'"','echo "  Project: '+pp+'"','echo "  Log: '+lf+'"','echo "  Close this window to stop"','echo "================================================"','echo ""','CLAUDE_BIN=$(command -v claude 2>/dev/null||echo "")','if [ -z "$CLAUDE_BIN" ];then','  echo "ERROR: claude not found in PATH"','  echo "Install: https://docs.anthropic.com/en/docs/claude-code"','  read -n 1 -s;exit 1','fi','echo "Using: $CLAUDE_BIN"','echo ""','cd "'+pp.replace(/"/g,'\\"')+'"||{ echo "Cannot cd"; read -n 1 -s; exit 1; }','echo "Directory: $(pwd)"','echo ""','T0=$(date +%s)','echo "[$(date \'+%Y-%m-%d %H:%M:%S\')] Summoning '+an+'..."|tee -a "'+lf+'"','echo ""','claude --dangerously-skip-permissions "'+(pr||"").replace(/"/g,'\\"')+'"','DUR=$(( $(date +%s)-T0 ))','echo ""','echo "[$(date \'+%Y-%m-%d %H:%M:%S\')] '+an+' ended after ${DUR}s"|tee -a "'+lf+'"','echo "Done. Close this window or press any key."','read -n 1 -s'].join("\n");
  fs.writeFileSync(tmp,s,{mode:0o755});
  var as='tell application "Terminal"\nactivate\ndo script "bash \''+tmp+'\'"\nend tell';
  child.execFile("osascript",["-e",as],function(err){cb(err)});
}

// ── About ──────────────────────────────────────────────────────────────────
var HF={};for(var i=0;i<24;i++){var ap=i<12?"AM":"PM";var h12=i===0?12:(i>12?i-12:i);HF[i]=h12+" "+ap}
var DN={1:"Mon",2:"Tue",3:"Wed",4:"Thu",5:"Fri",6:"Sat",7:"Sun"};

function genSetup(cfg){
  var L=["# Agents: Go","# Your autonomous Claude Code agent scheduler","# Developed by Waqas Burney & Claude","# GitHub: https://github.com/sumatranbeans/agents-go","","## What It Is","","Agents: Go runs your Claude Code agents on a schedule, day or night.","Each agent gets a fresh, stateless session, reads its own context,","does its work, and exits cleanly. No memory bleed, no orphans.","","## Dashboard","","BOOKMARK THIS: http://localhost:"+PORT,"The dashboard runs as a background service and auto-starts on login.","This is your single control center. You never need Terminal.","","## How Invocation Works","","When an agent is scheduled:","1. Scheduler checks current hour, minute, and day of week","2. If the agent matches, a Terminal window opens","3. The terminal cd's into the project directory","4. Runs: claude --dangerously-skip-permissions \"<prompt>\"","5. The prompt is a simple invocation, e.g.:","   \"SCOUT, you've been invoked. Please do what you have to do.\"","6. The agent reads its own logs/files -- it already knows what to do","7. Session auto-terminates 1 minute before next scheduled run","   (e.g. 15-min interval = 14-min timeout, 60-min = 59-min timeout)","8. The Terminal window closes automatically after completion","9. Each agent's exact prompt is in the Active Agents section below","","## Run Mode","","Toggle 'Run visibly' on the dashboard to control how agents run:","- VISIBLE (default): Each agent opens a live Terminal window so","  you can watch it work in real time.","- BACKGROUND: Agents run headless with --print flag. No windows.","","## Intervals","","Agents can repeat every 15, 30, 45, or 60 minutes within each hour.","If an agent finishes quickly, shorter intervals let it spin up again","sooner instead of waiting for the next full hour.","","## Schedule","","All times are your local machine time.","Hours: 0-23 (select which hours each agent is active)","Days: Mon-Sun (select which days each agent runs)","Interval: 15/30/45/60 min (how often within each active hour)","","## Manual Invoke","","'Invoke Now' opens a live Terminal with the full Claude Code UI.","You watch the agent work in real time. Close the window to stop.","","## Watchouts","","TOKEN USAGE: Each session burns API tokens. An agent at 15-min","intervals across 8 hours = 32 sessions/night. Start conservative","(60 min) and check your Anthropic usage dashboard after the first night.","","MEMORY/STORAGE: No sessions persist. Logs auto-clean after 14 days.","Close Terminal windows after manual invokes to kill processes.","","FIRST RUN: Claude Code shows a bypass permissions warning once.","Select 'Yes, I accept'. It remembers permanently.","","KILL STUCK AGENTS: Use 'Kill All Running' button or:","  pkill -f \"claude.*dangerously-skip-permissions\"","","## File Locations","","Dashboard:  ~/.agents-go/dashboard.js (background service)","Sprint:     ~/.agents-go/sprint.sh (auto-generated)","Config:     ~/.agents-go/config.json","Logs:       ~/.agents-go/logs/","Scheduler:  ~/Library/LaunchAgents/com.agentsgo.plist","Dashboard:  ~/Library/LaunchAgents/com.agentsgo.dashboard.plist","","## Terminal Commands","","  launchctl list | grep agentsgo","  pkill -f \"claude.*dangerously-skip-permissions\"","  cat ~/.agents-go/logs/$(ls -t ~/.agents-go/logs|head -1)","  ~/.agents-go/uninstall.sh","","---","Developed by Waqas Burney & Claude","GitHub: https://github.com/sumatranbeans/agents-go","Generated: "+new Date().toLocaleString()];
  return L.join("\n");
}

function genAgents(cfg){
  var L=["# Active Projects & Agents",""];
  var ta=0,aa=0;cfg.projects.forEach(function(p){ta+=(p.agents||[]).length;(p.agents||[]).forEach(function(a){if(a.enabled)aa++})});
  L.push(cfg.projects.length+" project(s), "+aa+" active / "+ta+" total");L.push("");
  cfg.projects.forEach(function(proj){
    L.push("---");L.push("## "+proj.name);L.push("Directory: "+proj.path);L.push("");
    if(!(proj.agents||[]).length){L.push("No agents.");L.push("");return}
    (proj.agents||[]).forEach(function(a){
      var sched=(a.hours||[]).map(function(h){return HF[h]||h}).join(", ");
      var days=(a.days||[1,2,3,4,5,6,7]).map(function(d){return DN[d]||d}).join(", ");
      L.push("### "+a.name+" ["+(a.enabled?"ACTIVE":"PAUSED")+"]");
      L.push("Schedule: "+sched);L.push("Days: "+days);L.push("Interval: every "+(a.interval||60)+" minutes");
      L.push("Invocation prompt: \""+a.prompt+"\"");L.push("");
    });
  });
  L.push("---");L.push("Developed by Waqas Burney & Claude");L.push("Generated: "+new Date().toLocaleString());
  return L.join("\n");
}

// ── HTML ───────────────────────────────────────────────────────────────────
var UIPATH = path.join(__dirname, "ui.html");
function getHTML(){try{return fs.readFileSync(UIPATH,"utf8")}catch(e){return "<h1>Error: ui.html not found at "+UIPATH+"</h1>"}}

// ── Server ─────────────────────────────────────────────────────────────────
var server=http.createServer(function(req,res){
  var url=new URL(req.url,"http://localhost:"+PORT);var p=url.pathname;
  function json(d,s){res.writeHead(s||200,{"Content-Type":"application/json"});res.end(JSON.stringify(d))}
  if(p==="/"||p==="/index.html"){res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-store"});res.end(getHTML());return}
  if(p==="/api/status"&&req.method==="GET"){var c=loadCfg();var diag={claudeFound:!!CLAUDE_PATH,badPaths:[]};c.projects.forEach(function(pr){try{fs.accessSync(pr.path)}catch(e){diag.badPaths.push({name:pr.name,path:pr.path})}});return json({loaded:isLoaded(),config:c,logs:getLogs(),running:getRunning(),diagnostics:diag})}
  if(p==="/api/about"&&req.method==="GET"){var c=loadCfg();return json({setup:genSetup(c),agents:genAgents(c)})}
  if(p.indexOf("/api/log/")===0&&req.method==="GET")return json({content:getLog(decodeURIComponent(p.replace("/api/log/","")))});
  if(p==="/api/config"&&req.method==="POST"){var b="";req.on("data",function(c){b+=c});req.on("end",function(){try{var c=JSON.parse(b);saveCfg(c);if(isLoaded()){try{launchStop()}catch(e){}try{launchStart()}catch(e){}}json({ok:true})}catch(e){json({ok:false,error:e.message},400)}});return}
  if(p==="/api/scheduler/start"&&req.method==="POST"){try{var c=loadCfg();genScript(c);genPlist(c);launchStart();return json({ok:true})}catch(e){return json({ok:false,error:e.message})}}
  if(p==="/api/scheduler/stop"&&req.method==="POST"){try{launchStop();return json({ok:true})}catch(e){return json({ok:false,error:e.message})}}
  if(p==="/api/sprint/run"&&req.method==="POST"){child.exec('bash "'+SCRIPT+'"',function(err){json({ok:!err,error:err?err.message:undefined})});return}
  if(p==="/api/agent/invoke"&&req.method==="POST"){var b2="";req.on("data",function(c){b2+=c});req.on("end",function(){try{var d=JSON.parse(b2);var c=loadCfg();invokeInTerminal(d.projectPath,d.agentName,d.prompt,c.sessionTimeout,function(err){json({ok:!err,error:err?err.message:undefined})})}catch(e){json({ok:false,error:e.message},400)}});return}
  if(p==="/api/kill"&&req.method==="POST"){try{child.execSync('pkill -f "claude.*dangerously-skip-permissions" 2>/dev/null||true')}catch(e){}try{child.execSync("osascript -e 'tell application \"Terminal\" to close (every window whose name contains \".invoke-\")' 2>/dev/null||true")}catch(e){}return json({ok:true})}
  if(p==="/api/logs/clear"&&req.method==="POST"){try{var fl=fs.readdirSync(LOGDIR).filter(function(f){return f.endsWith(".log")});fl.forEach(function(f){try{fs.unlinkSync(path.join(LOGDIR,f))}catch(e){}});return json({ok:true})}catch(e){return json({ok:false})}}
  res.writeHead(404);res.end("Not found");
});

var sc=loadCfg();genScript(sc);genPlist(sc);
server.listen(PORT,function(){console.log("\n  AGENTS: GO\n  http://localhost:"+PORT+"\n  Claude: "+(CLAUDE_PATH||"runtime")+"\n")});
