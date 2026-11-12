data "aws_iam_policy" "runtime_boundary" {
  arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/${local.name_prefix}-runtime-boundary"
}

resource "aws_cognito_user_pool" "pilot" {
  name                = "${local.name_prefix}-users"
  deletion_protection = "ACTIVE"
  mfa_configuration   = "OFF"

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  username_configuration {
    case_sensitive = false
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "admin_only"
      priority = 1
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_cognito_user_pool_client" "pilot" {
  name         = "${local.name_prefix}-backend"
  user_pool_id = aws_cognito_user_pool.pilot.id

  explicit_auth_flows           = ["ALLOW_ADMIN_USER_PASSWORD_AUTH"]
  generate_secret               = false
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 1

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

resource "aws_dynamodb_table" "sessions" {
  name         = "${local.name_prefix}-sessions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "tokenHash"

  deletion_protection_enabled = true

  attribute {
    name = "tokenHash"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api_execution" {
  name                 = "${local.name_prefix}-api-execution"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role.json
  permissions_boundary = data.aws_iam_policy.runtime_boundary.arn
}

data "aws_iam_policy_document" "api_runtime" {
  statement {
    sid = "WriteAuthenticationLogs"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.auth_lambda.arn}:*"]
  }

  statement {
    sid = "ManageSessions"
    actions = [
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
    ]
    resources = [aws_dynamodb_table.sessions.arn]
  }

  statement {
    sid       = "AuthenticatePilotUsers"
    actions   = ["cognito-idp:AdminInitiateAuth"]
    resources = [aws_cognito_user_pool.pilot.arn]
  }
}

resource "aws_iam_policy" "api_runtime" {
  name        = "${local.name_prefix}-api-runtime"
  description = "Least-privilege runtime access for the Grievance Insights authentication API"
  policy      = data.aws_iam_policy_document.api_runtime.json
}

resource "aws_iam_role_policy_attachment" "api_runtime" {
  role       = aws_iam_role.api_execution.name
  policy_arn = aws_iam_policy.api_runtime.arn
}

resource "aws_cloudwatch_log_group" "auth_lambda" {
  name              = "/aws/lambda/${local.name_prefix}-auth-api"
  retention_in_days = var.auth_log_retention_days
}

resource "aws_lambda_function" "auth_api" {
  function_name = "${local.name_prefix}-auth-api"
  description   = "Same-origin Cognito authentication and opaque session API"
  role          = aws_iam_role.api_execution.arn
  runtime       = "nodejs22.x"
  handler       = "index.handler"
  filename      = local.auth_lambda_zip

  source_code_hash = fileexists(local.auth_lambda_zip) ? filebase64sha256(local.auth_lambda_zip) : null

  architectures                  = ["x86_64"]
  memory_size                    = 256
  timeout                        = 10
  reserved_concurrent_executions = 5

  environment {
    variables = {
      ALLOWED_ORIGIN       = "https://${var.hostname}"
      COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.pilot.id
      COGNITO_USER_POOL_ID = aws_cognito_user_pool.pilot.id
      SESSIONS_TABLE_NAME  = aws_dynamodb_table.sessions.name
      SESSION_TTL_SECONDS  = tostring(var.auth_session_ttl_seconds)
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.auth_lambda,
    aws_iam_role_policy_attachment.api_runtime,
  ]
}

resource "aws_apigatewayv2_api" "auth" {
  name          = "${local.name_prefix}-auth"
  protocol_type = "HTTP"
  description   = "Grievance Insights authenticated application API"
}

resource "aws_apigatewayv2_integration" "auth_lambda" {
  api_id                 = aws_apigatewayv2_api.auth.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.auth_api.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 10000
}

resource "aws_apigatewayv2_route" "auth" {
  for_each = toset([
    "GET /api/auth/session",
    "GET /api/health",
    "POST /api/auth/login",
    "POST /api/auth/logout",
  ])

  api_id             = aws_apigatewayv2_api.auth.id
  route_key          = each.value
  authorization_type = "NONE"
  target             = "integrations/${aws_apigatewayv2_integration.auth_lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.auth.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    detailed_metrics_enabled = true
    throttling_burst_limit   = 20
    throttling_rate_limit    = 10
  }
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.auth.execution_arn}/*/*"
}
