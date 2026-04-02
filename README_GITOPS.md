# EthioConnect Infrastructure - Multi-Cluster GitOps

This document describes the production-grade GitOps infrastructure for EthioConnect, supporting multi-cluster, multi-tenant, and multi-project deployments.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              GITHUB                                          │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌────────────────────┐ │
│  │   ethio-connect     │  │ ethio-connect-      │  │   ethio-connect-   │ │
│  │   (monorepo)        │  │ infrastructure       │  │   apps-repo         │ │
│  │                     │  │                     │  │                     │ │
│  │  - Apps             │  │  - Environments      │  │  - Application      │ │
│  │  - Libraries        │  │  - Cluster Services │  │    definitions      │ │
│  │  - CI/CD           │  │  - ArgoCD Config     │  │                     │ │
│  └─────────────────────┘  └─────────────────────┘  └────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ GitOps
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ARGO CD GITOPS                                     │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │                         ApplicationSets                               │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │    │
│  │  │  Central     │  │   Tenant     │  │  Provider    │  │  Public   │ │    │
│  │  │  Services    │  │   Services   │  │  Services    │  │  Website  │ │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └───────────┘ │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
        ▼                            ▼                            ▼
┌───────────────────┐      ┌───────────────────┐      ┌───────────────────┐
│     TESTING       │      │      STAGING      │      │       PROD        │
│     CLUSTER       │      │      CLUSTER      │      │      CLUSTER      │
├───────────────────┤      ├───────────────────┤      ├───────────────────┤
│ ethio-connect-*   │      │ ethio-connect-*   │      │ ethio-connect-*   │
│ namespaces        │      │ namespaces        │      │ namespaces        │
│                   │      │                   │      │                   │
│ - central         │      │ - central         │      │ - central         │
│ - tenant          │      │ - tenant          │      │ - tenant          │
│ - provider        │      │ - provider        │      │ - provider        │
│ - public          │      │ - public          │      │ - public          │
└───────────────────┘      └───────────────────┘      └───────────────────┘
```

## Directory Structure

```
ethio-connect-infrastructure/
├── .github/
│   └── workflows/           # CI/CD workflows
│       ├── 01-validate.yml     # PR/Push validation
│       ├── 02-deploy.yml      # Manual deployment
│       ├── 03-sync-argocd.yml # ArgoCD sync
│       ├── 04-promote.yml     # Environment promotion
│       ├── 05-bootstrap.yml   # Cluster bootstrap
│       ├── 06-rollback.yml    # Rollback
│       ├── 07-status.yml      # Status check
│       ├── 08-disaster-recovery.yml # Backup/Restore
│       ├── 09-canary-analysis.yml   # Canary deployments
│       ├── 10-testing.yml      # Testing CI/CD
│       ├── 11-staging.yml      # Staging CI/CD
│       └── 12-production.yml   # Production CI/CD
│
├── argocd/
│   ├── clusters/           # Cluster definitions
│   │   ├── testing.yaml
│   │   ├── staging.yaml
│   │   └── prod.yaml
│   │
│   ├── projects/           # ArgoCD Projects
│   │   ├── central.yaml     # Central platform
│   │   ├── tenant.yaml      # Tenant services
│   │   ├── provider.yaml    # Provider services
│   │   └── public.yaml      # Public services
│   │
│   └── appsets/            # ApplicationSets
│       ├── central-hub-api.yaml
│       ├── central-hub-dashboard.yaml
│       ├── tenant-services.yaml
│       ├── provider-services.yaml
│       └── public-services.yaml
│
├── clusters/               # Cluster configurations
│   ├── testing/
│   ├── staging/
│   └── prod/
│
├── cluster-services/       # Cluster-wide services
│   ├── metallb/
│   ├── ingress-nginx/
│   ├── cert-manager/
│   ├── external-secrets/    # Secrets management
│   ├── velero/              # Backup
│   └── keda/                # Autoscaling
│
├── tenants/                # Tenant isolation
│   ├── central/
│   │   ├── namespace.yaml
│   │   ├── rbac.yaml
│   │   ├── quota.yaml
│   │   └── network-policy.yaml
│   ├── tenant/
│   ├── provider/
│   └── public/
│
├── environments/           # Environment configs
│   ├── base/              # Shared base
│   ├── testing/           # Testing
│   ├── staging/           # Staging
│   └── prod/              # Production
│
├── monitoring/            # Observability
│   ├── prometheus/
│   │   ├── prometheus.yaml
│   │   └── rules/
│   ├── grafana/
│   │   └── dashboards/
│   └── alerting/
│
├── policies/              # Security policies
│   ├── network/
│   │   ├── default-deny.yaml
│   │   ├── allow-ingress.yaml
│   │   └── allow-system-traffic.yaml
│   └── security/
│       └── pod-security-baseline.yaml
│
└── charts/                # Helm charts
    └── ethio-connect-app/
```

## Multi-Tenant Architecture

### Tenant Namespaces

Each tenant gets isolated namespaces with dedicated resources:

| Tenant | Namespace | Description | Resources |
|--------|-----------|-------------|-----------|
| Central | `ethio-connect-central` | Core platform services | 4 CPU, 16Gi |
| Central System | `ethio-connect-central-system` | System services | 2 CPU, 8Gi |
| Tenant | `ethio-connect-tenant` | Client services | 2 CPU, 8Gi |
| Provider | `ethio-connect-provider` | Vendor services | 4 CPU, 16Gi |
| Public | `ethio-connect-public` | Public website | 1 CPU, 4Gi |

### Tenant Isolation

- **RBAC**: Each tenant has dedicated ServiceAccount and RoleBindings
- **Network Policies**: Default-deny with explicit allow rules
- **Resource Quotas**: Per-tenant CPU/memory limits
- **LimitRanges**: Per-container default and max limits
- **Secrets**: ESO integration with Vault for secret management

## ArgoCD Projects

### Project Structure

```yaml
# ArgoCD Projects provide:
# - Source repository restrictions
# - Destination namespace constraints
# - Resource blacklists/whitelists
# - Role-based access control
```

| Project | Description | Managed Namespaces |
|---------|-------------|-------------------|
| `central` | Central Hub platform | ethio-connect-central |
| `tenant` | Client services | ethio-connect-tenant |
| `provider` | Vendor services | ethio-connect-provider |
| `public` | Public website | ethio-connect-public |

### ApplicationSets

ApplicationSets automatically generate Applications across environments:

```yaml
# Example: Central Hub API ApplicationSet
spec:
  generators:
    - matrix:
        - clusters: {}  # All managed clusters
        - git:          # Apps from all environments
            directories:
              - path: environments/*/apps/central-hub-api.yaml
```

## CI/CD Workflows

### Environment Promotion Flow

```
development → testing → staging → prod
    │           │          │         │
    │           │          │         │
    └───────────┴──────────┴─────────┘
              Image Promotion via GitOps
```

### Workflow Triggers

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `01-validate.yml` | PR/Push | Validate configs |
| `04-promote.yml` | Manual | Environment promotion |
| `05-bootstrap.yml` | Manual | Initial cluster setup |
| `08-disaster-recovery.yml` | Manual | Backup/Restore |
| `09-canary-analysis.yml` | Manual | Progressive delivery |

## Observability Stack

### Prometheus Metrics

- **Node metrics**: CPU, memory, disk, network
- **Pod metrics**: Resource usage, restarts
- **Application metrics**: Custom via /metrics endpoint
- **ArgoCD metrics**: Sync status, health

### Alerting Rules

| Alert | Severity | Description |
|-------|----------|-------------|
| `HighCPUUsage` | warning | CPU > 80% for 5m |
| `HighMemoryUsage` | warning | Memory > 85% |
| `PodNotReady` | critical | Pod not ready for 10m |
| `PodRestartingTooMuch` | warning | > 6 restarts/15m |
| `ArgoCDSyncError` | critical | Sync failure |
| `ArgoCDHealthDegraded` | critical | Health degraded |

## Disaster Recovery

### Backup Strategy

| Schedule | Scope | Retention |
|----------|-------|----------|
| Hourly | central namespace | 24h |
| Daily | all ethio-connect namespaces | 30 days |
| Weekly | full cluster | 90 days |

### Restore Process

1. Run `08-disaster-recovery.yml` with `restore` action
2. Select backup name from available backups
3. Velero restores all resources
4. Verify application health
5. Trigger ArgoCD sync if needed

## Security Policies

### Network Policies

All namespaces have default-deny policies with explicit allows:

```yaml
# Default deny all ingress/egress
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress

# Allow ingress from ingress-nginx
spec:
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: ingress-nginx
```

### Pod Security

PodSecurity standards applied per namespace:

- `ethio-connect-baseline`: Medium security
- Restricted volume types
- Non-root execution
- No privilege escalation

## Quick Reference

### Environment URLs

| Environment | API | Dashboard |
|-------------|-----|-----------|
| Testing | https://testing-hub-api.ethioconnect.et | https://testing-hub.ethioconnect.et |
| Staging | https://staging-hub-api.ethioconnect.et | https://staging-hub.ethioconnect.et |
| Prod | https://hub-api.ethioconnect.et | https://hub.ethioconnect.et |

### GitOps Commands

```bash
# Sync ArgoCD applications
gh workflow run 03-sync-argocd.yml --field environment=testing

# Promote testing → staging
gh workflow run 04-promote.yml \
  --field source_environment=testing \
  --field target_environment=staging

# Create backup
gh workflow run 08-disaster-recovery.yml \
  --field action=backup \
  --field environment=staging

# Canary analysis
gh workflow run 09-canary-analysis.yml \
  --field application=central-hub-api \
  --field environment=staging \
  --field baseline_version=staging-abc123 \
  --field canary_version=staging-def456
```

### ArgoCD CLI

```bash
# Login
argocd login argocd.ethioconnect.et --grpc-web

# List apps
argocd app list

# Sync app
argocd app sync central-hub-api-prod

# Rollback
argocd app rollback central-hub-api-prod

# Watch sync
argocd app wait central-hub-api-prod --timeout 600
```
