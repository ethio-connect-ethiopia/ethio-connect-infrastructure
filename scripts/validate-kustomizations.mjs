import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runKubectlKustomize } from "./kustomize-helm-compat.mjs";

const REFERENCE_KEYS = new Set(["bases", "components", "crds", "generators", "resources", "transformers"]);
const DEFAULT_KUSTOMIZATION_FILES = ["kustomization.yaml", "kustomization.yml", "Kustomization"];

function stripQuotes(value) {
  return value.replace(/^['"]|['"]$/g, "");
}

function isRemoteReference(reference) {
  return /^[a-z]+:\/\//i.test(reference) || reference.startsWith("git::") || reference.startsWith("github.com/");
}

function getKustomizationFile(targetPath) {
  const stats = fs.statSync(targetPath);

  if (stats.isFile()) {
    return targetPath;
  }

  for (const candidate of DEFAULT_KUSTOMIZATION_FILES) {
    const candidatePath = path.join(targetPath, candidate);

    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error(`No kustomization file found in ${targetPath}`);
}

function parseReferences(kustomizationFile) {
  const content = fs.readFileSync(kustomizationFile, "utf8");
  const references = [];
  let activeKey = null;
  let activeIndent = -1;

  for (const rawLine of content.split(/\r?\n/)) {
    const lineWithoutComments = rawLine.replace(/\s+#.*$/, "");

    if (!lineWithoutComments.trim()) {
      continue;
    }

    const indent = lineWithoutComments.search(/\S/);
    const trimmed = lineWithoutComments.trim();

    if (activeKey && indent <= activeIndent && !trimmed.startsWith("- ")) {
      activeKey = null;
      activeIndent = -1;
    }

    const keyMatch = /^([A-Za-z][A-Za-z0-9_-]*):\s*$/.exec(trimmed);

    if (keyMatch) {
      const [, key] = keyMatch;
      activeKey = REFERENCE_KEYS.has(key) ? key : null;
      activeIndent = indent;
      continue;
    }

    if (!activeKey) {
      continue;
    }

    const listItemMatch = /^-\s+(.+)$/.exec(trimmed);

    if (!listItemMatch) {
      continue;
    }

    references.push(stripQuotes(listItemMatch[1].trim()));
  }

  return references;
}

function collectKustomizationReferences(targetPath, visited = new Set()) {
  const kustomizationFile = getKustomizationFile(targetPath);
  const resolvedFile = path.resolve(kustomizationFile);

  if (visited.has(resolvedFile)) {
    return { errors: [], remoteReferences: [] };
  }

  visited.add(resolvedFile);

  const baseDir = path.dirname(resolvedFile);
  const errors = [];
  const remoteReferences = [];

  for (const reference of parseReferences(resolvedFile)) {
    if (isRemoteReference(reference)) {
      remoteReferences.push(reference);
      continue;
    }

    const resolvedReference = path.resolve(baseDir, reference);

    if (!fs.existsSync(resolvedReference)) {
      errors.push(`Missing kustomize reference "${reference}" from ${path.relative(process.cwd(), resolvedFile)}`);
      continue;
    }

    if (fs.statSync(resolvedReference).isDirectory()) {
      const nested = collectKustomizationReferences(resolvedReference, visited);
      errors.push(...nested.errors);
      remoteReferences.push(...nested.remoteReferences);
    }
  }

  return { errors, remoteReferences };
}

function isKubectlAvailable() {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", ["kubectl"], {
    stdio: "ignore",
  });

  return result.status === 0;
}

function isHelmAvailable() {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", ["helm"], {
    stdio: "ignore",
  });

  return result.status === 0;
}

function renderKustomization(targetPath) {
  const { result, shimApplied } = runKubectlKustomize(targetPath, {
    encoding: "utf8",
  });

  if (result.status === 0) {
    return { error: null, shimApplied };
  }

  if (result.error) {
    return {
      error: `Failed to render ${targetPath} with kubectl kustomize --enable-helm: ${result.error.message}`,
      shimApplied,
    };
  }

  const output = [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();

  return {
    error: `Failed to render ${targetPath} with kubectl kustomize --enable-helm: ${output || `exit code ${result.status}`}`,
    shimApplied,
  };
}

function isHelm4CompatibilityError(errorMessage) {
  return (
    errorMessage.includes("this plugin requires helm V3 but got v4.") ||
    errorMessage.includes("unknown shorthand flag: 'c' in -c")
  );
}

function isRemoteReferenceRenderError(errorMessage) {
  return (
    errorMessage.includes("connection reset by peer") ||
    errorMessage.includes("no such host") ||
    errorMessage.includes("i/o timeout") ||
    errorMessage.includes("TLS handshake timeout") ||
    errorMessage.includes("context deadline exceeded") ||
    errorMessage.includes("temporary failure in name resolution") ||
    errorMessage.includes("Could not resolve host") ||
    errorMessage.includes("failed to run '/usr/bin/git fetch") ||
    errorMessage.includes("fatal: repository") ||
    errorMessage.includes("raw.githubusercontent.com")
  );
}

const targets = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

if (targets.length === 0) {
  console.error("Usage: node libs/infrastructure/scripts/validate-kustomizations.mjs <kustomization-dir> [...]");
  process.exit(1);
}

const errors = [];
const targetMetadata = new Map();

for (const target of targets) {
  const metadata = collectKustomizationReferences(target);
  errors.push(...metadata.errors);
  targetMetadata.set(target, metadata);
}

const kubectlAvailable = isKubectlAvailable();
const helmAvailable = isHelmAvailable();

if (!kubectlAvailable) {
  console.warn("kubectl binary not found; rendered kustomization validation skipped.");
}

if (kubectlAvailable && !helmAvailable) {
  console.warn("helm binary not found; rendered kustomization validation skipped.");
}

if (kubectlAvailable && helmAvailable && errors.length === 0) {
  let shimNoticePrinted = false;

  for (const target of targets) {
    const metadata = targetMetadata.get(target) ?? { remoteReferences: [] };
    const { error: renderError, shimApplied } = renderKustomization(target);

    if (shimApplied && !shimNoticePrinted) {
      console.warn("Detected Helm 4 locally; using a compatibility shim for kubectl kustomize --enable-helm.");
      shimNoticePrinted = true;
    }

    if (renderError) {
      if (isHelm4CompatibilityError(renderError)) {
        console.warn(
          `Skipping rendered validation for ${target} because kubectl kustomize --enable-helm requires Helm 3. CI still performs full rendered validation with a pinned Helm 3 binary.`,
        );
        continue;
      }

      if (metadata.remoteReferences.length > 0 && isRemoteReferenceRenderError(renderError)) {
        console.warn(
          `Skipping rendered validation for ${target} because remote kustomize resources could not be fetched: ${metadata.remoteReferences.join(", ")}`,
        );
        continue;
      }

      errors.push(renderError);
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }

  process.exit(1);
}

for (const target of targets) {
  console.log(`Validated ${target}`);
}
