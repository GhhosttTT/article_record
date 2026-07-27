const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const inputPath = process.argv[2] || path.join(root, "dist", "article.html");
const outputPath = process.argv[3] || path.join(root, "dist", "article.pdf");

if (!fs.existsSync(inputPath)) {
  const generated = spawnSync("node", ["tools/generate_artifacts.js"], { cwd: root, encoding: "utf8" });
  if (generated.status !== 0) {
    console.error(generated.stderr || generated.stdout || "Failed to generate article HTML before PDF export.");
    process.exit(generated.status || 1);
  }
}

if (!fs.existsSync(inputPath)) {
  console.error(`Article HTML not found: ${inputPath}`);
  process.exit(1);
}

const chrome = findChromeExecutable();
if (!chrome) {
  console.warn("Chrome not found. Install Chrome or set CHROME_PATH to enable PDF export.");
  process.exitCode = 2;
  process.exit();
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const result = spawnSync(chrome, [
  "--headless",
  "--disable-gpu",
  "--no-sandbox",
  `--print-to-pdf=${outputPath}`,
  pathToFileUrl(inputPath)
], { encoding: "utf8" });

if (result.status !== 0) {
  console.error(result.stderr || result.stdout || "Chrome PDF export failed.");
  process.exit(result.status || 1);
}

const pdf = fs.statSync(outputPath);
if (pdf.size <= 0) {
  console.error(`Generated PDF is empty: ${outputPath}`);
  process.exit(1);
}

console.log(`Generated PDF: ${outputPath}`);

function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_SHIM,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe")
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function pathToFileUrl(filePath) {
  const resolved = path.resolve(filePath).replace(/\\/g, "/");
  return `file:///${encodeURI(resolved)}`;
}
