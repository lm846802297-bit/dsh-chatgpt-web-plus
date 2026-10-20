// Simulates the real DSH Desktop host: Electron + execPath=DSH Desktop.exe + a PATH
// that does NOT contain nodejs, and no DSH_CHATGPT_WEB_NODE override. This forces
// resolveNodeRuntime() down to the "known install locations" branch, and (with
// MODE=electron-fallback) down to the ELECTRON_RUN_AS_NODE=1 branch.
import { execFileSync } from "node:child_process";

const MODE = process.env.MODE ?? "known-locations"; // known-locations | electron-fallback

Object.defineProperty(process.versions, "electron", {
  value: "39.2.7",
  configurable: true,
  enumerable: true,
  writable: false,
});
process.execPath = "C:\\Users\\84680\\AppData\\Local\\Programs\\DSH Desktop\\DSH Desktop.exe";
delete process.env.DSH_CHATGPT_WEB_NODE;

if (MODE === "electron-fallback") {
  // Hide every well-known install location too, so only the Electron fallback is left.
  process.env.ProgramFiles = "C:\\__nonexistent__";
  process.env["ProgramFiles(x86)"] = "C:\\__nonexistent__";
  process.env.LOCALAPPDATA = "C:\\__nonexistent__";
  process.env.NVM_SYMLINK = "";
}
process.env.PATH = "C:\\Windows\\system32;C:\\Windows";

const mod = await import("file:///C:/Users/84680/.dsh/profiles/desktop/vendor/dsh-chatgpt-web/lib/plugin.js");

let launcherLine = "";
const sink = {
  info: (m) => {
    if (m.includes("daemon via")) launcherLine = m;
    console.log("INFO  " + m);
  },
  warn: (m) => console.log("WARN  " + m),
  error: (m) => console.log("ERROR " + m),
  debug: (m) => console.log("DEBUG " + m),
};
// ctx.logger must be a FACTORY (name => logger object), not the logger object itself.
const loggerFactory = () => sink;

console.log(`MODE = ${MODE}`);
console.log(`PATH = ${process.env.PATH}`);
console.log(`faked execPath = ${process.execPath}`);
console.log(`faked electron = ${process.versions.electron}`);

mod.apply({ logger: loggerFactory, effect: (cb) => cb() }, { host: "127.0.0.1", port: 17841 });

function commandLineOf(pid) {
  // powershell.exe is addressed absolutely: PATH has been deliberately stripped.
  const ps = "(Get-CimInstance Win32_Process -Filter \"ProcessId=" + pid + "\").CommandLine";
  try {
    return execFileSync("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", ["-NoProfile", "-Command", ps], {
      encoding: "utf8",
    }).trim();
  } catch (err) {
    return `<could not inspect: ${err.message}>`;
  }
}

for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 500));
  let body;
  try {
    const res = await fetch("http://127.0.0.1:17841/healthz");
    if (!res.ok) continue;
    body = await res.json();
  } catch {
    continue; // not listening yet — the ONLY expected transient failure
  }
  const commandLine = commandLineOf(body.pid);
  console.log("--- results ---");
  console.log("post-check healthy = true, pid =", body.pid, "accepting =", body.accepting_turns);
  console.log("launcher line:", launcherLine);
  console.log("sidecar command line =", commandLine);
  const usedElectron = commandLine.toLowerCase().includes("dsh desktop.exe");
  console.log("used Electron run-as-node fallback?", usedElectron ? "YES" : "no (real node.exe resolved)");
  console.log("RESULT: PASS");
  process.exit(0);
}

console.log("--- results ---");
console.log("launcher line:", launcherLine);
console.log("TIMEOUT: sidecar never became healthy");
console.log("RESULT: FAIL");
process.exit(1);
