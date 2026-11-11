data "aws_caller_identity" "current" {}

data "aws_route53_zone" "reagvis" {
  name         = "${trimsuffix(var.hosted_zone_name, ".")}."
  private_zone = false
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

locals {
  name_prefix        = "${var.project_name}-${var.environment}"
  frontend_origin_id = "${local.name_prefix}-frontend"
  frontend_bucket    = "${local.name_prefix}-${data.aws_caller_identity.current.account_id}-frontend"
  auth_lambda_zip    = abspath("${path.module}/${var.auth_lambda_zip_path}")
  api_origin_id      = "${local.name_prefix}-api"

  tags = merge(var.additional_tags, {
    Application = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Repository  = "Reagvis/grievance-insights"
    Production  = "false"
  })
}
