# Ethio-Connect Infrastructure

This library contains the declarative Infrastructure as Code (IaC) and GitOps configuration for deploying the Ethio-Connect monorepo to bare-metal Kubernetes clusters.

## Architecture & Directory Structure

The structure follows GitOps patterns and keeps runtime configuration per environment.

- **`charts/`**: Local Helm chart (`ethio-connect-app`) used by Argo CD to deploy the promoted central-hub API workload.
- **`cluster-services/`**: Bare-metal prerequisites (MetalLB, ingress-nginx, cert-manager, Argo CD).
- **`environments/base/platform-core/`**: Baseline namespace-scoped YAML for PostgreSQL, MongoDB, Redis, and the central API runtime config/secrets.
- **`environments/base/argocd/`**: Argo CD `ApplicationSet` manifests that materialize branch-aware `platform-core` and `central-hub-api` applications.
- **`environments/`**: Environment-specific overlays and values used for branch-to-environment promotion (`development`, `testing`, `staging`, `prod`).
- **`tenants/`**: Multi-tenant configuration.

## Branch to Environment Mapping

GitHub workflow branch promotion is aligned to Kubernetes environments:

- `development` -> `development`
- `testing` -> `testing`
- `staging` -> `staging`
- `main` -> `prod`

Only these tracked branches participate in the promotion flow; all other branches are ignored.

The GitHub workflow split now mirrors the promotion flow directly:

- `.github/workflows/development.yml`
- `.github/workflows/testing.yml`
- `.github/workflows/staging.yml`
- `.github/workflows/main.yml`

Pushes to `testing`, `staging`, and `main` publish immutable images to GHCR and then write the promoted tag into `libs/infrastructure/environments/<env>/values.yaml`. Argo CD watches the matching branch and syncs the environment-specific applications after that commit lands.

## Deployment model

Infrastructure deployment is driven by GitHub-built images plus Argo CD environment overlays:

```bash
pnpm exec nx run @ethio-connect/infrastructure:deploy --env=testing
```

That command applies the `testing` GitOps overlay, which creates or updates the branch-aware Argo CD application sets for:

- `platform-core-<env>`
- `central-hub-api-<env>`

Argo CD then syncs the chart and baseline manifests from the branch head into the environment namespace. The promoted image tag still comes from:

- `libs/infrastructure/environments/<env>/values.yaml` for the promoted image tag, runtime wiring, and resource sizing.
- environment-specific namespaces (`ethio-connect-development`, `ethio-connect-testing`, `ethio-connect-staging`, `ethio-connect-system`).

Bootstrap the cluster services first:

```bash
pnpm exec nx run @ethio-connect/infrastructure:bootstrap-cluster-services
```

That installs:

- MetalLB
- ingress-nginx exposed as a MetalLB `LoadBalancer`
- cert-manager
- Argo CD

Kubernetes Dashboard is intentionally handled outside the checked-in `cluster-services` bundle for now. The current working install path is documented under `docs/server/` and `docs/documentation/res/`.

The default ingress domain model in this repository is now:

- wildcard DNS and TLS for `*.ethioconnect.et`
- `argocd.ethioconnect.et` for Argo CD
- `dashboard.ethioconnect.et` for Kubernetes Dashboard
- `dev-hub-api.ethioconnect.et` for the development branch application
- `testing-hub-api.ethioconnect.et` for the testing branch application
- `staging-hub-api.ethioconnect.et` for the staging branch application
- `hub-api.ethioconnect.et` for production

The GitOps-managed baseline platform core still creates:

- PostgreSQL for `ethioconnect` and `analytics`
- MongoDB for the central API document store
- Redis for cache/runtime state
- the `ethio-connect-runtime-config` ConfigMap and `ethio-connect-runtime-secrets` ExternalSecret (materialized as a Kubernetes Secret by External Secrets Operator) consumed by the chart deployment

GitOps bootstrap is now split into:

```bash
pnpm exec nx run @ethio-connect/infrastructure:bootstrap-cluster-services
pnpm exec nx run @ethio-connect/infrastructure:bootstrap-gitops
```

## Resource policy

Testing is intentionally configured with minimum resource allocation for low-cost validation:

- requests: `50m CPU`, `64Mi memory`
- limits: `200m CPU`, `256Mi memory`


## Runtime secret provisioning workflow

Runtime application secrets are no longer committed as plaintext Kubernetes `Secret` manifests.

1. `libs/infrastructure/environments/base/platform-core/central-hub-api-secret.yaml` defines an `ExternalSecret` named `ethio-connect-runtime-secrets`.
2. The `ExternalSecret` targets the `platform-secrets` `ClusterSecretStore` and reads keys from `ethio-connect/runtime` (one property per runtime secret key).
3. External Secrets Operator reconciles that manifest and creates/updates the in-cluster Kubernetes `Secret` named `ethio-connect-runtime-secrets`.
4. The central-hub Helm chart continues to consume only the generated Kubernetes `Secret` name, so workload wiring is unchanged.

### Environment requirements

- `staging` and `prod` must have a working `ClusterSecretStore` (`platform-secrets`) configured against the chosen backend (for example Vault).
- The backend secret at `ethio-connect/runtime` must contain all required properties used by the `ExternalSecret` manifest (`DB_EC_USER`, `DB_EC_PASS`, `DB_MOR_USER`, `DB_MOR_PASS`, `SESSION_SECRET`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SERVICE_AUTH_JWT_SECRET`, `VENDOR_API_SERVICE_CLIENT_SECRET`, `CLIENT_API_SERVICE_CLIENT_SECRET`).
- CI validation now fails if staging/prod overlays render deployable Kubernetes `Secret` manifests containing placeholder values (for example `replace-me-*`).

### Optional integration patterns

- **External Secrets Operator + Vault (recommended):** configure `platform-secrets` to point at Vault and store the runtime key-value pairs at `ethio-connect/runtime`.
- **Sealed Secrets bootstrap path:** if a cluster cannot use ESO immediately, bootstrap backend credentials for ESO using Sealed Secrets, then keep application runtime secrets in the external backend and referenced via `ExternalSecret`.
