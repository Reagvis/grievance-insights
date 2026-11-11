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
