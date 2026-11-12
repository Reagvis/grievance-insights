data "aws_caller_identity" "current" {}

locals {
  project_name                  = "grievance-insights"
  github_oidc_subject_prefix    = "repo:Reagvis@212125805/grievance-insights@1446187135"
  environment                   = "pilot"
  hostname                      = "telangana-gov-pilot.reagvis.com"
  frontend_bucket_name          = "${local.project_name}-${local.environment}-${data.aws_caller_identity.current.account_id}-frontend"
  state_bucket_arn              = "arn:aws:s3:::${var.state_bucket_name}"
  state_object_arn              = "${local.state_bucket_arn}/${var.state_key}"
  state_lockfile_arn            = "${local.state_bucket_arn}/${var.state_key}.tflock"
  cloudfront_distribution_arn   = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/*"
  cloudfront_function_arn       = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:function/grievance-insights-pilot-spa-rewrite"
  cloudfront_oac_arn            = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:origin-access-control/*"
  cloudfront_headers_policy_arn = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:response-headers-policy/*"
  certificate_arn               = "arn:aws:acm:us-east-1:${data.aws_caller_identity.current.account_id}:certificate/*"
  certificate_validation_record = "_*.${local.hostname}"
  tags = {
    Application = local.project_name
    Environment = local.environment
    ManagedBy   = "terraform-bootstrap"
    Repository  = var.github_repository
    Production  = "false"
  }
}

resource "aws_s3_bucket" "state" {
  bucket        = var.state_bucket_name
  force_destroy = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

data "aws_iam_policy_document" "state_bucket" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.state.arn,
      "${aws_s3_bucket.state.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.state_bucket.json
}

data "aws_iam_policy_document" "terraform_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${local.github_oidc_subject_prefix}:environment:${var.infrastructure_github_environment}"]
    }
  }
}

resource "aws_iam_role" "terraform" {
  name                 = "grievance-insights-pilot-terraform"
  assume_role_policy   = data.aws_iam_policy_document.terraform_trust.json
  permissions_boundary = var.permissions_boundary_arn
  max_session_duration = 3600
}

data "aws_iam_policy_document" "terraform" {
  statement {
    sid       = "StateBucketList"
    actions   = ["s3:ListBucket"]
    resources = [local.state_bucket_arn]

    condition {
      test     = "StringEquals"
      variable = "s3:prefix"
      values   = [var.state_key]
    }
  }

  statement {
    sid       = "StateObjectReadWrite"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = [local.state_object_arn]
  }

  statement {
    sid       = "StateLockfileReadWriteDelete"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = [local.state_lockfile_arn]
  }

  statement {
    sid = "FrontendBucketManagement"
    actions = [
      "s3:CreateBucket",
      "s3:DeleteBucket",
      "s3:GetBucket*",
      "s3:GetAccelerateConfiguration",
      "s3:GetEncryptionConfiguration",
      "s3:GetLifecycleConfiguration",
      "s3:ListBucket",
      "s3:PutBucket*",
      "s3:PutEncryptionConfiguration",
      "s3:PutLifecycleConfiguration",
      "s3:DeleteBucket*",
    ]
    resources = ["arn:aws:s3:::${local.frontend_bucket_name}"]
  }

  statement {
    sid       = "CloudFrontTaggedCreation"
    actions   = ["cloudfront:CreateDistribution", "cloudfront:CreateFunction"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/Repository"
      values   = [var.github_repository]
    }
  }

  statement {
    sid       = "CloudFrontUntaggedCreation"
    actions   = ["cloudfront:CreateOriginAccessControl", "cloudfront:CreateResponseHeadersPolicy"]
    resources = ["*"]
  }

  statement {
    sid = "CloudFrontDistributionManagement"
    actions = [
      "cloudfront:GetDistribution",
      "cloudfront:GetDistributionConfig",
      "cloudfront:UpdateDistribution",
      "cloudfront:DeleteDistribution",
    ]
    resources = [local.cloudfront_distribution_arn]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Repository"
      values   = [var.github_repository]
    }
  }

  statement {
    sid = "CloudFrontFunctionManagement"
    actions = [
      "cloudfront:DescribeFunction",
      "cloudfront:GetFunction",
      "cloudfront:UpdateFunction",
      "cloudfront:PublishFunction",
      "cloudfront:DeleteFunction",
    ]
    resources = [local.cloudfront_function_arn]
  }

  statement {
    sid = "CloudFrontOacManagement"
    actions = [
      "cloudfront:GetOriginAccessControl",
      "cloudfront:UpdateOriginAccessControl",
      "cloudfront:DeleteOriginAccessControl",
    ]
    resources = [local.cloudfront_oac_arn]
  }

  statement {
    sid = "CloudFrontHeadersPolicyManagement"
    actions = [
      "cloudfront:GetResponseHeadersPolicy",
      "cloudfront:UpdateResponseHeadersPolicy",
      "cloudfront:DeleteResponseHeadersPolicy",
    ]
    resources = [local.cloudfront_headers_policy_arn]
  }

  statement {
    sid       = "CloudFrontInitialTagging"
    actions   = ["cloudfront:TagResource"]
    resources = [local.cloudfront_distribution_arn, local.cloudfront_function_arn]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/Repository"
      values   = [var.github_repository]
    }
  }

  statement {
    sid = "CloudFrontManagedResourceTags"
    actions = [
      "cloudfront:ListTagsForResource",
      "cloudfront:TagResource",
      "cloudfront:UntagResource",
    ]
    resources = [local.cloudfront_distribution_arn, local.cloudfront_function_arn]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Repository"
      values   = [var.github_repository]
    }
  }

  statement {
    sid       = "CloudFrontManagedPolicyLookup"
    actions = [
      "cloudfront:GetCachePolicy",
      "cloudfront:ListCachePolicies",
      "cloudfront:ListOriginRequestPolicies",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "CertificateRequest"
    actions   = ["acm:RequestCertificate"]
    resources = ["*"]

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "acm:DomainNames"
      values   = [local.hostname]
    }

    condition {
      test     = "StringEquals"
      variable = "acm:ValidationMethod"
      values   = ["DNS"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/Repository"
      values   = [var.github_repository]
    }
  }

  statement {
    sid       = "CertificateInitialTagging"
    actions   = ["acm:AddTagsToCertificate"]
    resources = [local.certificate_arn]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/Repository"
      values   = [var.github_repository]
    }
  }

  statement {
    sid = "CertificateManagement"
    actions = [
      "acm:DescribeCertificate",
      "acm:DeleteCertificate",
      "acm:AddTagsToCertificate",
      "acm:RemoveTagsFromCertificate",
      "acm:ListTagsForCertificate",
    ]
    resources = [local.certificate_arn]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Repository"
      values   = [var.github_repository]
    }
  }

  statement {
    sid       = "Route53ZoneDiscovery"
    actions   = ["route53:ListHostedZones", "route53:ListHostedZonesByName"]
    resources = ["*"]
  }

  statement {
    sid = "PilotDnsRead"
    actions = [
      "route53:GetHostedZone",
      "route53:ListResourceRecordSets",
      "route53:ListTagsForResource",
    ]
    resources = ["arn:aws:route53:::hostedzone/${var.route53_zone_id}"]
  }

  statement {
    sid       = "PilotAliasDnsWrite"
    actions   = ["route53:ChangeResourceRecordSets"]
    resources = ["arn:aws:route53:::hostedzone/${var.route53_zone_id}"]

    condition {
      test     = "ForAllValues:StringLike"
      variable = "route53:ChangeResourceRecordSetsNormalizedRecordNames"
      values   = [local.hostname]
    }

    condition {
      test     = "ForAllValues:StringLike"
      variable = "route53:ChangeResourceRecordSetsRecordTypes"
      values   = ["A", "AAAA"]
    }

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "route53:ChangeResourceRecordSetsActions"
      values   = ["CREATE", "UPSERT", "DELETE"]
    }
  }

  statement {
    sid       = "CertificateValidationDnsWrite"
    actions   = ["route53:ChangeResourceRecordSets"]
    resources = ["arn:aws:route53:::hostedzone/${var.route53_zone_id}"]

    condition {
      test     = "ForAllValues:StringLike"
      variable = "route53:ChangeResourceRecordSetsNormalizedRecordNames"
      values   = [local.certificate_validation_record]
    }

    condition {
      test     = "ForAllValues:StringLike"
      variable = "route53:ChangeResourceRecordSetsRecordTypes"
      values   = ["CNAME"]
    }

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "route53:ChangeResourceRecordSetsActions"
      values   = ["CREATE", "UPSERT", "DELETE"]
    }
  }

  statement {
    sid       = "Route53ChangeStatus"
    actions   = ["route53:GetChange"]
    resources = ["arn:aws:route53:::change/*"]
  }
}

resource "aws_iam_role_policy" "terraform" {
  name   = "grievance-insights-pilot-foundation"
  role   = aws_iam_role.terraform.id
  policy = data.aws_iam_policy_document.terraform.json
}

data "aws_iam_policy_document" "frontend_trust" {
  count = var.frontend_distribution_id == null ? 0 : 1

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${local.github_oidc_subject_prefix}:environment:${var.frontend_github_environment}"]
    }
  }
}

resource "aws_iam_role" "frontend" {
  count = var.frontend_distribution_id == null ? 0 : 1

  name                 = "grievance-insights-pilot-frontend"
  assume_role_policy   = data.aws_iam_policy_document.frontend_trust[0].json
  permissions_boundary = var.permissions_boundary_arn
  max_session_duration = 3600
}

data "aws_iam_policy_document" "frontend" {
  count = var.frontend_distribution_id == null ? 0 : 1

  statement {
    sid       = "ListFrontendBucket"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${local.frontend_bucket_name}"]
  }

  statement {
    sid       = "PublishFrontendAssets"
    actions   = ["s3:DeleteObject", "s3:PutObject"]
    resources = ["arn:aws:s3:::${local.frontend_bucket_name}/*"]
  }

  statement {
    sid       = "InvalidateFrontendCache"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = ["arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/${var.frontend_distribution_id}"]
  }
}

resource "aws_iam_role_policy" "frontend" {
  count = var.frontend_distribution_id == null ? 0 : 1

  name   = "grievance-insights-pilot-frontend"
  role   = aws_iam_role.frontend[0].id
  policy = data.aws_iam_policy_document.frontend[0].json
}
