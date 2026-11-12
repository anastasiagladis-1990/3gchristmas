// "npm run build": a static site + serverless functions, so there's nothing to bundle.
// This checks every server file and the page's inline script for syntax errors so a broken
// deploy fails on Vercel instead of in front of the family.
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const files = [...readdirSync("api").map(f => join("api", f)), ...readdirSync("lib").map(f => join("lib", f))].filter(f => f.endsWith(".js"));
for (const f of files) execFileSync(process.execPath, ["--check", f], { stdio: "inherit" });

const html = readFileSync("public/index.html", "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!scripts.length) throw new Error("public/index.html has no inline script");
const tmp = join(mkdtempSync(join(tmpdir(), "3g-")), "page.js");
writeFileSync(tmp, scripts.join("\n;\n"));
execFileSync(process.execPath, ["--check", tmp], { stdio: "inherit" });

// Make sure the store module loads (catches import mistakes).
await import("../lib/store.js");
console.log(`✓ Build check passed (${files.length} server files + page script).`);
