/**
 * promote-image.mjs
 *
 * Safely updates `image.repository` and `image.tag` inside a Kustomize
 * environment values.yaml without clobbering comments or other YAML structure.
 * Pure Node.js — no new runtime dependencies.
 *
 * Usage:
 *   node libs/infrastructure/scripts/promote-image.mjs \
 *     --file        libs/infrastructure/environments/testing/values.yaml \
 *     --repository  ghcr.io/owner/ethio-connect/app \
 *     --tag         abc1234def5678
 */

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--") && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

const { file, repository, tag } = parseArgs(process.argv.slice(2));

if (!file || !repository || !tag) {
  console.error("Usage: node promote-image.mjs --file <path> --repository <repo> --tag <sha>");
  process.exit(1);
}

// Basic validation
if (!/^[\w\-.\/]+$/.test(repository)) {
  console.error(`Repository appears invalid: ${repository}`);
  process.exit(1);
}

if (!/^[0-9A-Za-z_][0-9A-Za-z._-]{0,127}$/.test(tag)) {
  console.error(`Tag appears invalid: ${tag}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Safe line-by-line YAML rewriter
// ---------------------------------------------------------------------------

const absFile = path.resolve(file);

if (!fs.existsSync(absFile)) {
  console.error(`Values file not found: ${absFile}`);
  process.exit(1);
}

const original = fs.readFileSync(absFile, "utf8");
const lines = original.split("\n");

let repositoryUpdated = false;
let tagUpdated = false;

const updated = lines.map((line) => {
  // Match the first `  repository: <value>` line (any indentation, any existing value)
  if (!repositoryUpdated && /^\s*repository:\s*/.test(line)) {
    repositoryUpdated = true;
    return line.replace(/^(\s*repository:\s*).*$/, `$1${repository}`);
  }

  // Match the first `  tag: <value>` line — always quote the SHA tag
  if (!tagUpdated && /^\s*tag:\s*/.test(line)) {
    tagUpdated = true;
    return line.replace(/^(\s*tag:\s*).*$/, `$1"${tag}"`);
  }

  return line;
});

// ---------------------------------------------------------------------------
// Safety checks before writing
// ---------------------------------------------------------------------------

if (!repositoryUpdated) {
  console.error(`Could not find "repository:" key in ${file}. Refusing to write.`);
  process.exit(1);
}

if (!tagUpdated) {
  console.error(`Could not find "tag:" key in ${file}. Refusing to write.`);
  process.exit(1);
}

fs.writeFileSync(absFile, updated.join("\n"), "utf8");

console.log(`Promoted ${file}`);
console.log(`  repository: ${repository}`);
console.log(`  tag:        "${tag}"`);
