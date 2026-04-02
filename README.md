# Ethio-Connect Infrastructure

Comprehensive platform infrastructure as Code (IaC) and GitOps configuration for deploying the Ethio-Connect monorepo to bare-metal Kubernetes clusters.

## Architecture

The infrastructure follows GitOps patterns with ArgoCD for continuous delivery:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   GitHub Repo   │────▶│    ArgoCD       │────▶│  Baremetal K8s  │
│  (this repo)    │     │                 │     │    Cluster      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                                               │
        │                                               │
        ▼                                               ▼
┌─────────────────┐                           ┌─────────────────┐
│  CI/CD Actions  │                           │   Applications  │
│  (GitHub)      │                           │                 │
└─────────────────┘                           └─────────────────┘
```

## Directory Structure

```
ethio-connect-infrastructure/
├── .github/
│   └── workflows/           # CI/CD workflows
├── argocd/                  # ArgoCD ApplicationSets
├── charts/                  # Helm charts
│   └── ethio-connect-app/   # Main application chart
├── cluster-services/        # Bare-metal prerequisites
│   ├── metallb/            # Load balancer
│   ├── ingress-nginx/       # Ingress controller
│   ├── cert-manager/        # TLS certificates
│   └── argocd/              # ArgoCD install
├── environments/            # Environment-specific configs
│   ├── base/                # Shared base configuration
│   │   ├── platform-core/   # PostgreSQL, MongoDB, Redis
│   │   └── argocd/          # ArgoCD ApplicationSets
│   ├── testing/             # Testing environment
│   ├── staging/             # Staging environment
│   └── prod/                # Production environment
├── scripts/                  # Utility scripts
│   ├── promote-image.mjs   # Image tag promotion
│   ├── validate-kustomizations.mjs
│   └── kustomize-helm-compat.mjs
└── tenants/                 # Multi-tenant configuration
```

## CI/CD Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `01-validate.yml` | PR/Push | Validate Kustomize, Helm, and scripts |
| `02-deploy.yml` | Manual/Call | Deploy to cluster |
| `03-sync-argocd.yml` | Manual/Call | Sync ArgoCD applications |
| `05-bootstrap.yml` | Manual | Bootstrap cluster services |
| `06-rollback.yml` | Manual | Rollback to previous version |
| `07-status.yml` | Manual | Check environment status |
| `10-testing.yml` | Push testing | Full testing CI/CD |
| `11-staging.yml` | Push staging | Full staging CI/CD |
| `12-production.yml` | Push main | Full production CI/CD |

### Workflow Details

#### 01-validate.yml
Validates all infrastructure configurations:
- Kustomize builds for all environments
- Helm chart linting and templating
- Cluster services Kustomize
- Script syntax validation
- Resource sizing checks

#### 02-deploy.yml
Deploys applications to target environment:
1. Validates configuration
2. Deploys platform core (PostgreSQL, MongoDB, Redis)
3. Runs database migrations
4. Deploys applications via Kustomize
5. Waits for rollout and health checks

#### 03-sync-argocd.yml
Syncs ArgoCD applications:
- Supports selective app sync
- Force sync option for emergency situations
- Waits for sync completion
- Reports sync status

#### 05-bootstrap.yml
Initial cluster setup:
- Installs MetalLB
- Installs ingress-nginx
- Installs cert-manager
- Installs ArgoCD
- Deploys platform core services

#### 06-rollback.yml
Emergency rollback:
- Uses ArgoCD rollback
- Targets previous revision
- Verifies rollback completion

#### 07-status.yml
Environment monitoring:
- Pod status
- Deployment status
- ArgoCD application status
- Recent events

## Branch to Environment Mapping

| Branch | Environment | Namespace | Replicas | Resources |
|--------|-------------|-----------|----------|-----------|
| `testing` | testing | ethio-connect-testing | 1 | Minimal |
| `staging` | staging | ethio-connect-staging | 1 | Minimal |
| `main` | prod | ethio-connect-system | 2+ | Full |

## Quick Start

### 1. Configure Secrets

Add these secrets to your GitHub repository (Settings > Secrets):

- `KUBECONFIG_TESTING` - Base64-encoded kubeconfig for testing cluster
- `KUBECONFIG_STAGING` - Base64-encoded kubeconfig for staging cluster
- `KUBECONFIG_PROD` - Base64-encoded kubeconfig for production cluster
- `ARGOCD_URL` - ArgoCD server URL
- `ARGOCD_TOKEN_TESTING` - ArgoCD token for testing
- `ARGOCD_TOKEN_STAGING` - ArgoCD token for staging
- `ARGOCD_TOKEN_PROD` - ArgoCD token for production
- `INFRA_REPO_TOKEN` - GitHub PAT for infrastructure repo

See [Required Secrets](./.github/workflows/SECRETS.md) for detailed setup.

### 2. Bootstrap Cluster

```bash
gh workflow run bootstrap.yml \
  --field cluster=testing \
  --field services=all
```

### 3. Deploy Applications

```bash
gh workflow run deploy.yml \
  --field environment=testing \
  --field skip_migrations=false
```

## Resource Policy

### Testing & Staging (Minimal)

```yaml
resources:
  requests:
    cpu: 50m
    memory: 64Mi
  limits:
    cpu: 200m
    memory: 256Mi
replicaCount: 1
```

### Production (Full)

```yaml
resources:
  requests:
    cpu: 100m
    memory: 256Mi
  limits:
    cpu: 1000m
    memory: 1Gi
replicaCount: 2
```

## Deployment Guide

### Automated Deployment

```bash
# Testing Environment
git checkout testing
git merge development
git push origin testing

# Staging Environment
git checkout staging
git merge testing
git push origin staging

# Production Environment
git checkout main
git merge staging
git push origin main
```

### Manual Deployment

```bash
# Deploy specific environment
gh workflow run deploy.yml --field environment=testing

# Sync ArgoCD applications
gh workflow run sync-argocd.yml --field environment=staging

# Check status
gh workflow run status.yml --field environment=prod
```

### Rollback

```bash
# Rollback to previous version
gh workflow run rollback.yml --field environment=staging

# Rollback to specific revision
gh workflow run rollback.yml \
  --field environment=prod \
  --field revision=abc1234
```

## Runtime Secret Provisioning

Runtime application secrets are managed via External Secrets Operator:

1. `environments/base/platform-core/central-hub-api-secret.yaml` defines an `ExternalSecret`
2. The `ExternalSecret` targets `ClusterSecretStore` and reads from `ethio-connect/runtime`
3. External Secrets Operator reconciles and creates in-cluster Kubernetes `Secret`
4. The central-hub Helm chart consumes the generated Kubernetes `Secret`

### Requirements

- `staging` and `prod` must have a working `ClusterSecretStore` configured
- Backend secret at `ethio-connect/runtime` must contain all required keys
- CI validation fails if staging/prod overlays render deployable `Secret` manifests with placeholder values

## Endpoints

### Testing Environment
- API: https://testing-hub-api.ethioconnect.et
- Dashboard: https://testing-hub.ethioconnect.et

### Staging Environment
- API: https://staging-hub-api.ethioconnect.et
- Dashboard: https://staging-hub.ethioconnect.et

### Production Environment
- API: https://hub-api.ethioconnect.et
- Dashboard: https://hub.ethioconnect.et

### Shared
- ArgoCD: https://argocd.ethioconnect.et
- Kubernetes Dashboard: https://dashboard.ethioconnect.et

## Troubleshooting

### Common Issues

#### ArgoCD Sync Failing

```bash
argocd app get central-hub-api-prod
argocd app logs central-hub-api-prod
argocd app sync central-hub-api-prod --force
```

#### Pods Not Starting

```bash
kubectl get pods -n ethio-connect-testing
kubectl describe pod <pod-name> -n ethio-connect-testing
kubectl logs <pod-name> -n ethio-connect-testing
```

#### Database Migration Issues

```bash
kubectl exec -it deployment/central-hub-api -n ethio-connect-testing -- \
  sh -c "npm run typeorm:migrate"
```

## Contributing

1. Create feature branch from `development`
2. Make infrastructure changes
3. Validate with `01-validate.yml`
4. Create PR to `testing`
5. After testing, PR to `staging`
6. After staging approval, PR to `main`
