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
variable "clamav_image" {
  description = "Independently approved ClamAV image pinned by registry digest."
  type        = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.clamav_image))
    error_message = "ClamAV must be pinned by digest."
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
  description = "Documentation/preflight allowlist; runtime registry still binds each exact host and URL."
  type        = set(string)
  default     = []
}
variable "audit_retention_days" {
  type    = number
  default = 30
  validation {
    condition     = var.audit_retention_days >= 1 && var.audit_retention_days <= 90
    error_message = "Audit retention must be 1-90 days."
  }
}
variable "monthly_budget_usd" {
  type    = number
  default = 100
}
