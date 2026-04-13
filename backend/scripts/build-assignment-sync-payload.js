import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadAssignmentsFromRepo } from "../assignment-sync.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..", "..");

const args = process.argv.slice(2);
let outPath = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out" && args[i + 1]) {
    outPath = path.resolve(process.cwd(), args[i + 1]);
    i++;
  }
}

const payload = {
  source: "github-pages",
  commitSha: process.env.GITHUB_SHA || null,
  generatedAt: new Date().toISOString(),
  assignments: loadAssignmentsFromRepo(repoRoot),
};

const json = JSON.stringify(payload);
if (outPath) {
  fs.writeFileSync(outPath, json);
} else {
  process.stdout.write(json);
}
