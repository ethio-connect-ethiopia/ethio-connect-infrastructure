# Multi-Tenant Configurations

This directory isolates configuration per tenant where apps/central dynamically injects or manages applications into respective tenant namespace overlays.

ArgoCD handles synchronization using an App-of-Apps pattern or by individual App provisions generated per tenant.
