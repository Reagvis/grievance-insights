data "aws_caller_identity" "current" {}
data "aws_route53_zone" "reagvis" {
  name         = "${trimsuffix(var.hosted_zone_name, ".")}."
  private_zone = false
}
data "aws_kms_alias" "data" { name = "alias/grievance-insights-eoffice-pilot" }
data "aws_kms_key" "data" { key_id = data.aws_kms_alias.data.target_key_id }
data "aws_ecr_repository" "service" { name = "grievance-insights-eoffice-pilot" }

locals {
  name = "grievance-insights-eoffice-pilot"
  tags = {
    Application       = "grievance-insights-eoffice"
    Environment       = "pilot"
    ManagedBy         = "terraform"
    Repository        = "Reagvis/grievance-insights"
    Production        = "false"
    IsolationBoundary = "eoffice-pilot"

  }
  service_image = "${data.aws_ecr_repository.service.repository_url}@${var.service_image_digest}"
  api_scopes = {
    chat          = "Allow document-grounded chat"
    summarize     = "Allow document summarization"
    extract       = "Allow structured extraction"
    "draft-reply" = "Allow draft-reply generation"
  }
  # Preserve the existing route instance keys so adding JWT authorization is
  # an in-place update rather than endpoint replacement.
  api_routes = { for name in keys(local.api_scopes) : "POST /api/v1/ai/${name}" => name }
}

resource "aws_cognito_user_pool" "eoffice" {
  name                     = "${local.name}-m2m"
  user_pool_tier           = "LITE"
  deletion_protection      = "ACTIVE"
  username_attributes      = ["email"]
  auto_verified_attributes = []
  admin_create_user_config { allow_admin_create_user_only = true }
  lifecycle { prevent_destroy = true }
}
resource "aws_cognito_resource_server" "eoffice" {
  identifier   = var.cognito_resource_server_identifier
  name         = "${local.name}-api"
  user_pool_id = aws_cognito_user_pool.eoffice.id
  dynamic "scope" {
    for_each = local.api_scopes
    content {
      scope_name        = scope.key
      scope_description = scope.value
    }
  }
}
resource "aws_cognito_user_pool_client" "eoffice" {
  name                                 = "${local.name}-initial-client"
  user_pool_id                         = aws_cognito_user_pool.eoffice.id
  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["client_credentials"]
  allowed_oauth_scopes = [for name in keys(local.api_scopes) :
    "${aws_cognito_resource_server.eoffice.identifier}/${name}"
  ]
  access_token_validity = 5
  token_validity_units { access_token = "minutes" }
  enable_token_revocation       = true
  prevent_user_existence_errors = "ENABLED"
  lifecycle { prevent_destroy = true }
}
resource "aws_cognito_user_pool_domain" "eoffice" {
  domain       = var.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.eoffice.id
}

resource "aws_dynamodb_table" "credentials" {
  name                        = "${local.name}-credentials"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "id"
  deletion_protection_enabled = true
  attribute {
    name = "id"
    type = "S"
  }
  point_in_time_recovery {
    enabled = true
  }
  server_side_encryption {
    enabled     = true
    kms_key_arn = data.aws_kms_key.data.arn
  }
  lifecycle {
    prevent_destroy = true
  }
}
resource "aws_dynamodb_table" "clients" {
  name                        = "${local.name}-clients"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "id"
  deletion_protection_enabled = true
  attribute {
    name = "id"
    type = "S"
  }
  point_in_time_recovery { enabled = true }
  server_side_encryption {
    enabled     = true
    kms_key_arn = data.aws_kms_key.data.arn
  }
  lifecycle { prevent_destroy = true }
}
resource "aws_dynamodb_table" "registry" {
  name                        = "${local.name}-registry"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "id"
  deletion_protection_enabled = true
  attribute {
    name = "id"
    type = "S"
  }
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
  # Temporary delegated credentials must not enter point-in-time backups.
  point_in_time_recovery {
    enabled = false
  }
  server_side_encryption {
    enabled     = true
    kms_key_arn = data.aws_kms_key.data.arn
  }
  lifecycle {
    prevent_destroy = true
  }
}
resource "aws_dynamodb_table" "audit" {
  name                        = "${local.name}-audit"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "eventId"
  deletion_protection_enabled = true
  attribute {
    name = "eventId"
    type = "S"
  }
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
  point_in_time_recovery {
    enabled = true
  }
  server_side_encryption {
    enabled     = true
    kms_key_arn = data.aws_kms_key.data.arn
  }
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_secretsmanager_secret" "public_keys" {
  name                    = "${local.name}/jwt-public-keys"
  kms_key_id              = data.aws_kms_key.data.arn
  recovery_window_in_days = 30
}
resource "aws_secretsmanager_secret" "audit_hmac" {
  name                    = "${local.name}/audit-hmac"
  kms_key_id              = data.aws_kms_key.data.arn
  recovery_window_in_days = 30
}
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

  }
}
resource "aws_iam_role" "runtime" {
  name               = "${local.name}-runtime"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}
resource "aws_cloudwatch_log_group" "service" {
  name              = "/aws/lambda/${local.name}"
  retention_in_days = 30
}
data "aws_iam_policy_document" "runtime" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.service.arn}:*"]

  }
  statement {
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.credentials.arn, aws_dynamodb_table.clients.arn, aws_dynamodb_table.registry.arn]

  }
  statement {
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.audit.arn]

  }
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.public_keys.arn, aws_secretsmanager_secret.audit_hmac.arn]

  }
  statement {
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [data.aws_kms_key.data.arn]

  }
  statement {
    actions   = ["bedrock:InvokeModel"]
    resources = ["arn:aws:bedrock:${var.aws_region}::foundation-model/qwen.qwen3-32b-v1:0"]

  }
}
resource "aws_iam_role_policy" "runtime" {
  role   = aws_iam_role.runtime.id
  policy = data.aws_iam_policy_document.runtime.json
}

# Deliberately unattached pending a separately approved MFA operator trust.
data "aws_iam_policy_document" "operator" {
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem"]
    resources = [aws_dynamodb_table.credentials.arn, aws_dynamodb_table.clients.arn, aws_dynamodb_table.registry.arn, aws_dynamodb_table.audit.arn]

  }
  statement {
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [data.aws_kms_key.data.arn]

  }
}
resource "aws_iam_policy" "operator" {
  name   = "${local.name}-operator"
  policy = data.aws_iam_policy_document.operator.json
}

resource "aws_lambda_function" "service" {
  function_name                  = local.name
  description                    = "Restricted synthetic-only eOffice acceptance pilot"
  role                           = aws_iam_role.runtime.arn
  package_type                   = "Image"
  image_uri                      = local.service_image
  architectures                  = ["x86_64"]
  memory_size                    = 1024
  timeout                        = 29
  reserved_concurrent_executions = 1
  image_config {
    command = ["handler.handler"]
  }
  ephemeral_storage {
    size = 512
  }
  environment {
    variables = {
      EOFFICE_JWT_ISSUER               = var.jwt_issuer
      EOFFICE_PUBLIC_KEYS_SECRET_ARN   = aws_secretsmanager_secret.public_keys.arn
      EOFFICE_AUDIT_HMAC_SECRET_ARN    = aws_secretsmanager_secret.audit_hmac.arn
      EOFFICE_CREDENTIALS_TABLE        = aws_dynamodb_table.credentials.name
      EOFFICE_CLIENTS_TABLE            = aws_dynamodb_table.clients.name
      EOFFICE_REGISTRY_TABLE           = aws_dynamodb_table.registry.name
      EOFFICE_AUDIT_TABLE              = aws_dynamodb_table.audit.name
      EOFFICE_AUDIT_RETENTION_SECONDS  = tostring(var.audit_retention_days * 86400)
      EOFFICE_ALLOWED_DOCUMENT_HOSTS   = join(",", var.allowed_document_hosts)
      EOFFICE_DOCUMENT_ACCEPTANCE_MODE = var.document_acceptance_mode
      EOFFICE_COGNITO_ISSUER           = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.eoffice.id}"
      EOFFICE_COGNITO_SCOPE_PREFIX     = aws_cognito_resource_server.eoffice.identifier

    }

  }
  depends_on = [aws_cloudwatch_log_group.service, aws_iam_role_policy.runtime]
}

resource "aws_apigatewayv2_api" "service" {
  name                         = local.name
  protocol_type                = "HTTP"
  disable_execute_api_endpoint = true
}
resource "aws_apigatewayv2_integration" "service" {
  api_id                 = aws_apigatewayv2_api.service.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.service.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.service.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "eoffice-cognito-m2m"
  jwt_configuration {
    audience = [aws_cognito_user_pool_client.eoffice.id]
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.eoffice.id}"
  }
}
resource "aws_apigatewayv2_route" "service" {
  for_each             = local.api_routes
  api_id               = aws_apigatewayv2_api.service.id
  route_key            = each.key
  authorization_type   = "JWT"
  authorizer_id        = aws_apigatewayv2_authorizer.cognito.id
  authorization_scopes = ["${aws_cognito_resource_server.eoffice.identifier}/${each.value}"]
  target               = "integrations/${aws_apigatewayv2_integration.service.id}"
}
resource "aws_apigatewayv2_stage" "service" {
  api_id      = aws_apigatewayv2_api.service.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 2
    throttling_rate_limit  = 1
  }
}
resource "aws_lambda_permission" "gateway" {
  statement_id  = "AllowEofficeGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.service.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.service.execution_arn}/*/*"
}

resource "aws_acm_certificate" "service" {
  count             = var.enable_public_endpoint ? 1 : 0
  domain_name       = var.hostname
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}
resource "aws_route53_record" "validation" {
  for_each = var.enable_public_endpoint ? {
    for option in aws_acm_certificate.service[0].domain_validation_options : option.domain_name => option
  } : {}
  zone_id = data.aws_route53_zone.reagvis.zone_id
  name    = each.value.resource_record_name
  type    = each.value.resource_record_type
  records = [each.value.resource_record_value]
  ttl     = 300
}
resource "aws_acm_certificate_validation" "service" {
  count                   = var.enable_public_endpoint ? 1 : 0
  certificate_arn         = aws_acm_certificate.service[0].arn
  validation_record_fqdns = [for record in aws_route53_record.validation : record.fqdn]
}
resource "aws_apigatewayv2_domain_name" "service" {
  count       = var.enable_public_endpoint ? 1 : 0
  domain_name = var.hostname
  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.service[0].certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"

  }
}
resource "aws_apigatewayv2_api_mapping" "service" {
  count       = var.enable_public_endpoint ? 1 : 0
  api_id      = aws_apigatewayv2_api.service.id
  domain_name = aws_apigatewayv2_domain_name.service[0].id
  stage       = aws_apigatewayv2_stage.service.id
}
resource "aws_route53_record" "service" {
  count   = var.enable_public_endpoint ? 1 : 0
  zone_id = data.aws_route53_zone.reagvis.zone_id
  name    = var.hostname
  type    = "A"
  alias {
    name                   = aws_apigatewayv2_domain_name.service[0].domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.service[0].domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false

  }
}
