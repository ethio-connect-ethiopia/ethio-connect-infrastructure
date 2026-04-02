# Required Secrets

This document lists all the GitHub Actions secrets required for CI/CD operations.

## Repository Secrets

### Cluster Access

| Secret Name | Description | Required For |
|------------|-------------|--------------|
| `KUBECONFIG_TESTING` | Base64-encoded kubeconfig for testing cluster | Testing deployment, bootstrap |
| `KUBECONFIG_STAGING` | Base64-encoded kubeconfig for staging cluster | Staging deployment, bootstrap |
| `KUBECONFIG_PROD` | Base64-encoded kubeconfig for production cluster | Production deployment, bootstrap |

### ArgoCD Access

| Secret Name | Description | Required For |
|------------|-------------|--------------|
| `ARGOCD_URL` | ArgoCD server URL (e.g., `argocd.ethioconnect.et`) | All sync operations |
| `ARGOCD_TOKEN_TESTING` | ArgoCD service account token for testing | Testing ArgoCD sync |
| `ARGOCD_TOKEN_STAGING` | ArgoCD service account token for staging | Staging ArgoCD sync |
| `ARGOCD_TOKEN_PROD` | ArgoCD service account token for production | Production ArgoCD sync |

### Repository Access

| Secret Name | Description | Required For |
|------------|-------------|--------------|
| `INFRA_REPO_TOKEN` | GitHub PAT with repo scope for infrastructure repo | GitOps promotion |

## How to Create ArgoCD Tokens

### 1. Create ArgoCD Service Account

```bash
# Login to ArgoCD CLI as admin
argocd login argocd.ethioconnect.et --username admin --password <password>

# Create service account for CI
argocd account generate-token --account ci-deployer --id ci-deployer

# Or via kubectl
kubectl -n argocd create serviceaccount ci-deployer
kubectl -n argocd create rolebinding ci-deployer-binding \
  --clusterrole=admin \
  --serviceaccount=argocd:ci-deployer
argocd account generate-token --account ci-deployer
```

### 2. Get existing admin password

```bash
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d
```

## How to Encode Kubeconfig

```bash
# Encode kubeconfig
cat ~/.kube/config | base64 -w 0

# Add to GitHub Secrets via CLI
gh secret set KUBECONFIG_TESTING --body "$(cat ~/.kube/config | base64 -w 0)"
```

## Environment Protection

Configure environment protection rules in GitHub:

1. Go to **Settings** > **Environments**
2. Create/select environment (testing, staging, prod)
3. Configure:
   - **Required reviewers**: For production, require approval from specific users
   - **Deployment branches**: Restrict which branches can deploy
   - **Wait timers**: Add delay before production deployments
   - **Environment secrets**: Add environment-specific secrets

## Service Account Permissions

The CI/CD service accounts need these RBAC permissions:

```yaml
# Service account for deployments
apiVersion: v1
kind: ServiceAccount
metadata:
  name: github-actions-deploy
  namespace: argocd
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: github-actions-deploy
rules:
- apiGroups: ["*"]
  resources: ["*"]
  verbs: ["*"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: github-actions-deploy
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: github-actions-deploy
subjects:
- kind: ServiceAccount
  name: github-actions-deploy
  namespace: argocd
```
