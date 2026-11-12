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

variable "approved_bedrock_regions" {
  type        = set(string)
  description = "AWS regions in which project Bedrock resources and future inference may be used."
  default     = ["ap-south-1"]

  validation {
    condition     = length(var.approved_bedrock_regions) > 0 && alltrue([for region in var.approved_bedrock_regions : can(regex("^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$", region))])
    error_message = "approved_bedrock_regions must contain valid AWS region names."
  }
}

variable "approved_bedrock_inference_arns" {
  type        = set(string)
  description = "Approved Bedrock model or inference-profile ARNs for the runtime boundary. Empty denies all runtime model invocation."
  default = [
    "arn:aws:bedrock:ap-south-1::foundation-model/qwen.qwen3-32b-v1:0",
  ]

  validation {
    condition = alltrue([
      for arn in var.approved_bedrock_inference_arns :
      can(regex("^arn:aws:bedrock:[a-z0-9-]+:(|[0-9]{12}):(foundation-model|inference-profile|application-inference-profile)/[A-Za-z0-9._:/+-]+$", arn)) &&
      contains(var.approved_bedrock_regions, split(":", arn)[3])
    ])
    error_message = "Each approved Bedrock inference resource must be a foundation-model or inference-profile ARN in an approved Bedrock region."
  }
}

variable "enable_bedrock_response_streaming" {
  type        = bool
  description = "Whether the runtime boundary permits Bedrock streaming inference for approved resources."
  default     = false
}
