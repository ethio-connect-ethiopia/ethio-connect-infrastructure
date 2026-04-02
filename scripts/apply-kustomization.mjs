import { spawnSync } from "node:child_process";
import { runKubectlKustomize } from "./kustomize-helm-compat.mjs";

const KUBECTL = process.platform === "win32" ? "kubectl.exe" : "kubectl";
const targetPath = process.argv[2];

if (!targetPath) {
  console.error("Usage: node libs/infrastructure/scripts/apply-kustomization.mjs <kustomization-dir>");
  process.exit(1);
}

const { result, shimApplied } = runKubectlKustomize(targetPath, {
  encoding: "utf8",
});

if (shimApplied) {
  console.warn("Detected Helm 4 locally; using a compatibility shim for kubectl kustomize --enable-helm.");
}

if (result.status !== 0) {
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

  if (
    output.includes("this plugin requires helm V3 but got v4.") ||
    output.includes("unknown shorthand flag: 'c' in -c")
  ) {
    console.error(
      `kubectl kustomize --enable-helm for ${targetPath} requires a Helm 3 binary on this machine. CI pins Helm 3 automatically, but local apply/bootstrap commands need Helm 3 installed until kubectl's embedded kustomize supports Helm 4.`,
    );
    process.exit(1);
  }

  console.error(output || `Failed to render ${targetPath}`);
  process.exit(result.status ?? 1);
}

const applyResult = spawnSync(KUBECTL, ["apply", "-f", "-"], {
  encoding: "utf8",
  input: result.stdout,
});

if (applyResult.stdout) {
  process.stdout.write(applyResult.stdout);
}

if (applyResult.stderr) {
  process.stderr.write(applyResult.stderr);
}

if (applyResult.status !== 0) {
  process.exit(applyResult.status ?? 1);
}
