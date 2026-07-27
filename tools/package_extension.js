const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const extensionDir = path.join(root, "extension");
const packageRoot = path.join(root, "dist", "package");
const stagedDir = path.join(packageRoot, "sop-recorder-mvp");
const zipPath = path.join(packageRoot, "sop-recorder-mvp.zip");

fs.rmSync(stagedDir, { recursive: true, force: true });
fs.mkdirSync(stagedDir, { recursive: true });
copyDirectory(extensionDir, stagedDir);

const manifest = JSON.parse(fs.readFileSync(path.join(stagedDir, "manifest.json"), "utf8"));
assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(fs.existsSync(path.join(stagedDir, manifest.background.service_worker)), "background service worker missing");

fs.rmSync(zipPath, { force: true });
const result = spawnSync("powershell", [
  "-NoProfile",
  "-Command",
  `$items = Join-Path -Path '${escapePowerShellPath(stagedDir)}' -ChildPath '*'; Compress-Archive -Path $items -DestinationPath '${escapePowerShellPath(zipPath)}' -Force`
], { encoding: "utf8" });

if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status || 1);
}

const zipCheck = spawnSync("powershell", [
  "-NoProfile",
  "-Command",
  `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::OpenRead('${escapePowerShellPath(zipPath)}').Entries.FullName -join [Environment]::NewLine`
], { encoding: "utf8" });
const zipEntries = zipCheck.stdout.split(/\r?\n/).filter(Boolean).map((entry) => entry.replaceAll("\\", "/"));
["manifest.json", "background.js", "content.js", "viewer.js", "shared/artifacts.js"].forEach((entry) => {
  assert(zipEntries.includes(entry), `zip missing ${entry}`);
});

console.log(`Packaged extension directory: ${stagedDir}`);
console.log(`Packaged extension zip: ${zipPath}`);

function copyDirectory(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      copyDirectory(source, target);
    } else if (entry.isFile()) {
      fs.copyFileSync(source, target);
    }
  }
}

function escapePowerShellPath(value) {
  return value.replaceAll("'", "''");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
