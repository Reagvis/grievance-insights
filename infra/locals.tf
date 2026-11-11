data "aws_caller_identity" "current" {}

data "aws_route53_zone" "reagvis" {
  name         = "${trimsuffix(var.hosted_zone_name, ".")}."
  private_zone = false
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

locals {
  name_prefix        = "${var.project_name}-${var.environment}"
  frontend_origin_id = "${local.name_prefix}-frontend"
  frontend_bucket    = "${local.name_prefix}-${data.aws_caller_identity.current.account_id}-frontend"

  tags = merge(var.additional_tags, {
    Application = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Repository  = "Reagvis/grievance-insights"
    Production  = "false"
  })
}
