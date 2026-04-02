# CI/Infra reusable workflow mapping

This document summarizes how branch wrappers pass inputs into reusable workflows under `.github/workflows/workflow-templates/`.

| Branch workflow | Wrapper file | Reusable workflow(s) used | `branch_name` | `enable_push` | `base_ref_for_affected` | Notes |
|---|---|---|---|---|---|---|
| development | `.github/workflows/development.yml` | `quality-and-infra.yml` | n/a | `false` (no publish call) | `""` | PR-only checks, no publish/gitops. |
| testing | `.github/workflows/testing.yml` | `quality-and-infra.yml`, `publish-and-gitops.yml` | `testing` | `true` | `development` | Push flow compares affected scope against `origin/development`. |
| staging | `.github/workflows/staging.yml` | `quality-and-infra.yml`, `publish-and-gitops.yml` | `staging` | `true` | `""` | PR and push checks reuse default nx-set-shas behavior. |
| main | `.github/workflows/main.yml` | `quality-and-infra.yml`, `publish-and-gitops.yml` | `main` | `true` | `""` | Production promotion path with publish + gitops on push. |

## Shared extracted jobs

The reusable workflows centralize these steps so wrappers remain thin:

- checkout + pnpm + node setup
- `nrwl/nx-set-shas` or explicit base branch override
- `pnpm nx format:check`
- `node scripts/ci/validate-e2e-scenarios.mjs`
- `pnpm nx affected -t lint test build ...`
- infrastructure diff detection + `@ethio-connect/infrastructure:validate`
- docker publish + gitops promotion logic controlled by wrapper inputs


## Docker target contract for app projects

All deployable app projects must expose a `docker:build` target and preserve these configuration names:

- `verify`: local/CI verification build with `--load` and branch tagging semantics (no registry push).
- `push-main`: publish build used for protected release branches (`main`, `master`, `production`, `stable`, `release`) and empty branch labels.
- `push-branch`: publish build used for non-protected branches.

Workflow orchestration must not re-implement branch branching inline. Use `node scripts/ci/select-docker-config.mjs --branch-label <label> --mode publish` to choose between `push-main` and `push-branch`.

Deployable app selection in the publish workflow is the full Nx deployable set, and GitOps promotion targets are resolved from `libs/infrastructure/projects.json`:

- `pnpm nx show projects --withTarget docker:build --json`
