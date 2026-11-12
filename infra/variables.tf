variable "aws_region" {
  description = "Primary AWS region for regional resources."
  type        = string
  default     = "ap-south-1"
}

variable "project_name" {
  description = "Stable project identifier used in resource names and tags."
  type        = string
  default     = "grievance-insights"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.project_name))
    error_message = "project_name must contain only lowercase letters, numbers, and hyphens."
  }
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "pilot"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.environment))
    error_message = "environment must contain only lowercase letters, numbers, and hyphens."
  }
}

variable "hostname" {
  description = "Public hostname for the pilot frontend."
  type        = string
  default     = "telangana-gov-pilot.reagvis.com"
}

variable "hosted_zone_name" {
  description = "Existing public Route 53 hosted zone containing the hostname."
  type        = string
  default     = "reagvis.com"
}

variable "cloudfront_price_class" {
  description = "CloudFront edge-location price class."
  type        = string
  default     = "PriceClass_200"

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.cloudfront_price_class)
    error_message = "cloudfront_price_class must be a supported CloudFront price class."
  }
}

variable "noncurrent_asset_retention_days" {
  description = "Days to retain noncurrent versions of static frontend assets."
  type        = number
  default     = 30

  validation {
    condition     = var.noncurrent_asset_retention_days >= 7
    error_message = "Retain noncurrent frontend assets for at least seven days."
  }
}

variable "additional_tags" {
  description = "Additional tags; project ownership tags cannot be overridden."
  type        = map(string)
  default     = {}
}

variable "auth_lambda_zip_path" {
  description = "Path, relative to infra/, to the reproducibly built authentication Lambda archive."
  type        = string
  default     = "../artifacts/auth-lambda.zip"
}

variable "auth_session_ttl_seconds" {
  description = "Absolute server-side authentication session lifetime in seconds."
  type        = number
  default     = 28800

  validation {
    condition     = var.auth_session_ttl_seconds >= 900 && var.auth_session_ttl_seconds <= 86400
    error_message = "Authentication sessions must last between 15 minutes and 24 hours."
  }
}

variable "auth_log_retention_days" {
  description = "CloudWatch retention for authentication Lambda operational logs."
  type        = number
  default     = 30

  validation {
    condition     = contains([7, 14, 30, 60, 90, 120, 150, 180, 365], var.auth_log_retention_days)
    error_message = "auth_log_retention_days must be a supported bounded CloudWatch retention value."
  }
}

variable "analysis_worker_concurrency" {
  description = "Analysis worker reserved concurrency. Default 2 to permit source and DLQ mappings; raise to 4 only after AWS/Bedrock quota verification."
  type        = number
  default     = 2
  validation {
    condition     = var.analysis_worker_concurrency >= 2 && var.analysis_worker_concurrency <= 4 && floor(var.analysis_worker_concurrency) == var.analysis_worker_concurrency
    error_message = "Analysis concurrency must be an integer from 2 through 4."
  }
}
