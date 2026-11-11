variable "aws_region" {
  type        = string
  description = "Region for the Terraform state bucket."
  default     = "ap-south-1"
}

variable "state_bucket_name" {
  type        = string
  description = "Globally unique name for the dedicated Terraform state bucket."
}

variable "state_key" {
  type        = string
  description = "Isolated state object path used by the main configuration."
  default     = "grievance-insights/pilot/terraform.tfstate"
}

variable "github_repository" {
  type        = string
  description = "GitHub organization/repository allowed to assume deployment roles."
  default     = "Reagvis/grievance-insights"
}

variable "github_oidc_provider_arn" {
  type        = string
  description = "ARN of the existing account-wide token.actions.githubusercontent.com OIDC provider."
}

variable "route53_zone_id" {
  type        = string
  description = "ID of the existing reagvis.com public hosted zone."
}

variable "infrastructure_github_environment" {
  type        = string
  description = "Protected GitHub environment trusted by the Terraform role."
  default     = "pilot-infrastructure"
}

variable "frontend_github_environment" {
  type        = string
  description = "Protected GitHub environment trusted by the frontend deployment role."
  default     = "pilot-frontend"
}

variable "frontend_distribution_id" {
  type        = string
  description = "CloudFront distribution ID. Leave null until the hosting foundation exists."
  default     = null
  nullable    = true
}

variable "permissions_boundary_arn" {
  type        = string
  description = "Optional organization-required IAM permissions boundary."
  default     = null
  nullable    = true
}
