variable "aws_region" {
  type    = string
  default = "ap-south-1"
}
variable "hostname" {
  type    = string
  default = "api.eoffice-pilot.reagvis.com"
}
variable "hosted_zone_name" {
  type    = string
  default = "reagvis.com"
}
variable "service_image_digest" {
  description = "Immutable sha256 digest already pushed to the dedicated service ECR repository."
  type        = string
  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.service_image_digest))
    error_message = "Use an immutable service image digest."
  }
}
variable "jwt_issuer" {
  type    = string
  default = "eoffice-pilot"
  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$", var.jwt_issuer))
    error_message = "Invalid issuer."
  }
}
variable "allowed_document_hosts" {
  description = "Mandatory runtime host allowlist; each registry row also binds the exact URL hash."
  type        = set(string)
  validation {
    condition = length(var.allowed_document_hosts) > 0 && alltrue([
      for host in var.allowed_document_hosts : can(regex("^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", host))
    ])
    error_message = "Provide at least one valid trusted document hostname."
  }
}
variable "audit_retention_days" {
  type    = number
  default = 30
  validation {
    condition     = var.audit_retention_days >= 1 && var.audit_retention_days <= 90
    error_message = "Audit retention must be 1-90 days."
  }
}
variable "enable_public_endpoint" {
  description = "Create certificate/custom-domain/DNS only after restricted synthetic Lambda acceptance."
  type        = bool
  default     = false
}
variable "document_acceptance_mode" {
  description = "Explicit operator selection. Disabled is fail-closed; restricted mode accepts only registry-pinned synthetic fixture bytes."
  type        = string
  default     = "disabled"
  validation {
    condition     = contains(["disabled", "restricted-synthetic-pinned-v1"], var.document_acceptance_mode)
    error_message = "Use disabled or restricted-synthetic-pinned-v1."
  }
}
