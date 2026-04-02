import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runKubectlKustomize } from "./kustomize-helm-compat.mjs";

const HELM = process.platform === "win32" ? "helm.exe" : "helm";
const KUBECTL = process.platform === "win32" ? "kubectl.exe" : "kubectl";
const PLACEHOLDER_PATTERN = /(replace-me|changeme|example-secret|dummy-secret|your-secret)/i;
let shimNoticePrinted = false;

function isCommandAvailable(binary) {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [binary], {
    stdio: "ignore",
  });

  return result.status === 0;
}

function runCommand(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? 50 * 1024 * 1024,
  });

  if (result.error) {
    const commandString = [binary, ...args].join(" ");
    throw new Error(`"${commandString}" failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const commandString = [binary, ...args].join(" ");
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`"${commandString}" failed with exit code ${result.status}${output ? `\n${output}` : ""}`);
  }

  if (!options.quiet && result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (!options.quiet && result.stderr) {
    process.stderr.write(result.stderr);
  }
}

function renderKustomization(targetPath) {
  const { result, shimApplied } = runKubectlKustomize(targetPath, {
    encoding: "utf8",
  });

  if (result.error) {
    throw new Error(`Failed to render ${targetPath} with ${KUBECTL} kustomize --enable-helm: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

    if (
      output.includes("this plugin requires helm V3 but got v4.") ||
      output.includes("unknown shorthand flag: 'c' in -c")
    ) {
      console.warn(
        `Skipping rendered placeholder-secret validation for ${targetPath} because kubectl kustomize --enable-helm requires Helm 3. CI still performs this validation with a pinned Helm 3 binary.`,
      );
      return "";
    }

    throw new Error(
      `Failed to render ${targetPath} with ${KUBECTL} kustomize --enable-helm: ${output || `exit code ${result.status}`}`,
    );
  }

  if (shimApplied && !shimNoticePrinted) {
    console.warn("Detected Helm 4 locally; using a compatibility shim for kubectl kustomize --enable-helm.");
    shimNoticePrinted = true;
  }

  return result.stdout;
}

function validateNoPlaceholderSecretsInOverlay(targetPath) {
  const rendered = renderKustomization(targetPath);
  const documents = rendered.split(/^---\s*$/m);

  const violations = [];

  for (const document of documents) {
    if (!/\bkind:\s*Secret\b/.test(document)) {
      continue;
    }

    const nameMatch = document.match(/\nmetadata:\s*[\s\S]*?\n\s*name:\s*([^\n]+)/m);
    const secretName = nameMatch ? nameMatch[1].trim() : "<unknown-secret>";

    if (PLACEHOLDER_PATTERN.test(document)) {
      violations.push(
        `Overlay ${targetPath} renders Secret ${secretName} containing placeholder-looking secret values.`,
      );
    }
  }

  if (violations.length > 0) {
    throw new Error(violations.join("\n"));
  }
}

const chartPath = path.resolve("libs/infrastructure/charts/ethio-connect-app");
const environments = ["development", "testing", "staging", "prod"];
const projectsFile = path.resolve("libs/infrastructure/projects.json");
const projectsConfig = JSON.parse(fs.readFileSync(projectsFile, "utf8"));
const projectEntries = Object.values(projectsConfig.projects ?? {});

if (!isCommandAvailable(HELM)) {
  console.warn("helm binary not found; chart validation skipped.");
  process.exit(0);
}

runCommand(HELM, ["lint", chartPath]);

for (const environment of environments) {
  const envValuesFile = `libs/infrastructure/environments/${environment}/values.yaml`;

  for (const entry of projectEntries) {
    if (!entry?.valuesFile) {
      continue;
    }

    const projectValuesFile = entry.valuesFile.replaceAll("{environment}", environment);
    const releaseName = entry.releaseName || "ethio-connect-app";

    runCommand(
      HELM,
      [
        "template",
        releaseName,
        chartPath,
        "--namespace",
        environment === "prod" ? "ethio-connect-system" : `ethio-connect-${environment}`,
        "-f",
        envValuesFile,
        "-f",
        projectValuesFile,
      ],
      { quiet: true },
    );
  }
}

const protectedOverlays = [
  "libs/infrastructure/environments/staging/platform-core",
  "libs/infrastructure/environments/prod/platform-core",
];

if (!isCommandAvailable(KUBECTL)) {
  console.warn("kubectl binary not found; placeholder secret validation skipped for staging/prod overlays.");
  process.exit(0);
}

for (const overlay of protectedOverlays) {
  validateNoPlaceholderSecretsInOverlay(overlay);
}
