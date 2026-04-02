import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const HELM = process.platform === "win32" ? "helm.exe" : "helm";
const KUBECTL = process.platform === "win32" ? "kubectl.exe" : "kubectl";
const WHICH = process.platform === "win32" ? "where" : "which";
const DEFAULT_MAX_BUFFER = 50 * 1024 * 1024;

function resolveBinary(binary) {
  const result = spawnSync(WHICH, [binary], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return null;
  }

  const candidate = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return candidate ?? null;
}

function getHelmMajorVersion(helmPath) {
  const result = spawnSync(helmPath, ["version", "--short"], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return null;
  }

  const match = result.stdout.match(/v(\d+)\./);
  return match ? Number(match[1]) : null;
}

function createHelmCompatShim(tempDir) {
  const shimPath = path.join(tempDir, process.platform === "win32" ? "helm.cmd" : "helm");

  if (process.platform === "win32") {
    fs.writeFileSync(
      shimPath,
      [
        "@echo off",
        "setlocal",
        "if \"%~1\"==\"version\" if \"%~2\"==\"-c\" if \"%~3\"==\"--short\" (",
        "  \"%REAL_HELM_PATH%\" version --short",
        "  exit /b %ERRORLEVEL%",
        ")",
        "\"%REAL_HELM_PATH%\" %*",
        "exit /b %ERRORLEVEL%",
        "",
      ].join("\r\n"),
      "utf8",
    );
    return shimPath;
  }

  fs.writeFileSync(
    shimPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "if [[ \"$#\" -eq 3 && \"$1\" == \"version\" && \"$2\" == \"-c\" && \"$3\" == \"--short\" ]]; then",
      "  exec \"$REAL_HELM_PATH\" version --short",
      "fi",
      "exec \"$REAL_HELM_PATH\" \"$@\"",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.chmodSync(shimPath, 0o755);
  return shimPath;
}

export function runKubectlKustomize(targetPath, options = {}) {
  const env = { ...process.env, ...(options.env ?? {}) };
  const helmPath = resolveBinary(HELM);
  let cleanup = null;
  let shimApplied = false;
  let helmCommand = helmPath ?? "helm";

  if (helmPath) {
    const helmMajorVersion = getHelmMajorVersion(helmPath);

    if (helmMajorVersion !== null && helmMajorVersion >= 4) {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "helm-compat-"));
      helmCommand = createHelmCompatShim(tempDir);
      env.REAL_HELM_PATH = helmPath;
      shimApplied = true;
      cleanup = () => {
        fs.rmSync(tempDir, { force: true, recursive: true });
      };
    }
  }

  try {
    const result = spawnSync(KUBECTL, ["kustomize", "--enable-helm", "--helm-command", helmCommand, targetPath], {
      ...options,
      env,
      maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
    });

    return { result, shimApplied };
  } finally {
    cleanup?.();
  }
}
