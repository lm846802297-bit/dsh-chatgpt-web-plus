// BUG-7 regression test: the plugin must restart the sidecar after it dies on its own,
// and must NOT restart it during a deliberate plugin teardown.
//
// Phase 1: start the plugin, wait for health, kill the sidecar from outside,
//          and assert the plugin brings it back on a new pid.
// Phase 2: call the effect disposer (plugin teardown) and assert no new sidecar appears.
import { execFileSync } from "node:child_process";

const PLUGIN_DIR =
  process.env.PLUGIN_DIR ?? "C:/Users/84680/.dsh/profiles/desktop/vendor/dsh-chatgpt-web";

const logs = [];
const sink = {
  info: (m) => {
    logs.push(["INFO ", m]);
    console.log("INFO  " + m);
  },
  warn: (m) => {
    logs.push(["WARN ", m]);
    console.log("WARN  " + m);
  },
  error: (m) => {
    logs.push(["ERROR", m]);
    console.log("ERROR " + m);
  },
  debug: () => {},
};

const mod = await import(`file:///${PLUGIN_DIR}/lib/plugin.js`);

let dispose;
mod.apply(
  {
    logger: () => sink,
    effect: (cb) => {
      dispose = cb();
    },
  },
  { host: "127.0.0.1", port: 17841 },
);

async function healthz() {
  try {
    const res = await fetch("http://127.0.0.1:17841/healthz");
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function waitHealthy(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await healthz();
    if (body?.status === "ok") return body;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

function kill(pid) {
  try {
    execFileSync("taskkill", ["/F", "/PID", String(pid)], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const results = [];
const record = (label, ok, detail) => {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
};

// ---------- Phase 1: crash recovery ----------
const first = await waitHealthy(40_000);
record("phase1: sidecar came up initially", first !== null, first ? `pid ${first.pid}` : "never healthy");
if (!first) process.exit(1);

console.log(`\n>>> killing sidecar pid ${first.pid} to simulate a crash`);
kill(first.pid);

// The restart fires after the first backoff step (1000ms), so sample tightly to
// observe the down window rather than sleeping past it.
let sawDown = false;
let cameBack = null;
const observeDeadline = Date.now() + 8_000;
while (Date.now() < observeDeadline) {
  const body = await healthz();
  if (body === null) {
    sawDown = true;
  } else if (sawDown && body.pid !== first.pid) {
    cameBack = body;
    break;
  } else if (body.pid !== first.pid) {
    cameBack = body;
    break;
  }
  await new Promise((r) => setTimeout(r, 100));
}
record("phase1: sidecar was really down after the kill", sawDown, sawDown ? "port closed at least once" : "never observed down");

const recovered = cameBack ?? (await waitHealthy(45_000));
record(
  "phase1: plugin auto-restarted the sidecar",
  recovered !== null && recovered.pid !== first.pid,
  recovered ? `new pid ${recovered.pid} (was ${first.pid})` : "never recovered",
);
record(
  "phase1: restart used backoff logging",
  logs.some(([, m]) => m.includes("restarting in")),
  logs.filter(([, m]) => m.includes("restarting in")).map(([, m]) => m).join(" | ") || "no retry log",
);

// ---------- Phase 2: teardown must not respawn ----------
console.log("\n>>> disposing the plugin (simulated DSH Desktop shutdown)");
const beforeDispose = (await healthz())?.pid;
if (typeof dispose === "function") dispose();
else console.log("WARN  no disposer captured — teardown phase is inconclusive");

await new Promise((r) => setTimeout(r, 2_000));
const afterDispose = await healthz();

record(
  "phase2: teardown stopped the sidecar",
  afterDispose === null,
  beforeDispose ? `was pid ${beforeDispose}, now ${afterDispose ? "pid " + afterDispose.pid : "closed"}` : "n/a",
);

// Give the retry schedule a chance to misfire, then confirm it stayed down.
await new Promise((r) => setTimeout(r, 6_000));
const stillDown = (await healthz()) === null;
record("phase2: no zombie respawn after teardown", stillDown, stillDown ? "stayed closed" : "respawned!");

const failed = results.filter((r) => !r.ok);
console.log(`\n--- ${results.length - failed.length}/${results.length} checks passed ---`);
for (const f of failed) console.log("  FAILED:", f.label);
console.log(failed.length === 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(failed.length === 0 ? 0 : 1);
