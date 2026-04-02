{{/*
Return the chart name, truncated at 63 characters (Kubernetes label limit).
*/}}
{{- define "ethio-connect-app.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Return the fully-qualified release name, preventing double-naming when the
chart name is already embedded in the release name.
*/}}
{{- define "ethio-connect-app.fullname" -}}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/*
Common Kubernetes labels applied to every resource managed by this chart.
*/}}
{{- define "ethio-connect-app.labels" -}}
app.kubernetes.io/name: {{ include "ethio-connect-app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels — used in matchLabels and pod template labels.
Must remain stable across upgrades; do not add version here.
*/}}
{{- define "ethio-connect-app.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ethio-connect-app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
