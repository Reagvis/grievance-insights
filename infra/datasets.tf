resource "aws_s3_bucket" "datasets" {
  bucket        = "${local.name_prefix}-${data.aws_caller_identity.current.account_id}-datasets"
  force_destroy = false
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "datasets" {
  bucket                  = aws_s3_bucket.datasets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "datasets" {
  bucket = aws_s3_bucket.datasets.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "datasets" {
  bucket = aws_s3_bucket.datasets.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "datasets" {
  bucket = aws_s3_bucket.datasets.id
  cors_rule {
    allowed_headers = ["content-type", "if-none-match"]
    allowed_methods = ["PUT"]
    allowed_origins = ["https://${var.hostname}"]
    expose_headers  = ["ETag"]
    max_age_seconds = 300
  }
}

data "aws_iam_policy_document" "datasets_bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.datasets.arn, "${aws_s3_bucket.datasets.arn}/*"]
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

resource "aws_s3_bucket_policy" "datasets" {
  bucket     = aws_s3_bucket.datasets.id
  policy     = data.aws_iam_policy_document.datasets_bucket.json
  depends_on = [aws_s3_bucket_public_access_block.datasets]
}

resource "aws_dynamodb_table" "datasets" {
  name                        = "${local.name_prefix}-datasets"
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
    enabled = true
  }
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_cloudwatch_log_group" "datasets_lambda" {
  name              = "/aws/lambda/${local.name_prefix}-datasets-api"
  retention_in_days = var.auth_log_retention_days
}

data "aws_iam_policy_document" "datasets_runtime" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.datasets_lambda.arn}:*"]
  }
  statement {
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.sessions.arn]
  }
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Scan"]
    resources = [aws_dynamodb_table.datasets.arn]
  }
  statement {
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.datasets.arn}/raw/*"]
  }
}

# Use an inline role policy: bootstrap permits iam:PutRolePolicy on the
# approved api-execution role, but not creation of an arbitrary managed policy.
resource "aws_iam_role_policy" "datasets_runtime" {
  name   = "${local.name_prefix}-datasets-runtime"
  role   = aws_iam_role.api_execution.id
  policy = data.aws_iam_policy_document.datasets_runtime.json
}

resource "aws_lambda_function" "datasets_api" {
  function_name                  = "${local.name_prefix}-datasets-api"
  description                    = "Authenticated private dataset ingestion and retrieval API"
  role                           = aws_iam_role.api_execution.arn
  runtime                        = "nodejs22.x"
  handler                        = "index.handler"
  filename                       = abspath("${path.module}/../artifacts/datasets-lambda.zip")
  source_code_hash               = fileexists("${path.module}/../artifacts/datasets-lambda.zip") ? filebase64sha256("${path.module}/../artifacts/datasets-lambda.zip") : null
  architectures                  = ["x86_64"]
  memory_size                    = 512
  timeout                        = 20
  reserved_concurrent_executions = 5
  environment {
    variables = {
      ALLOWED_ORIGIN       = "https://${var.hostname}"
      DATASETS_BUCKET_NAME = aws_s3_bucket.datasets.id
      DATASETS_TABLE_NAME  = aws_dynamodb_table.datasets.name
      SESSIONS_TABLE_NAME  = aws_dynamodb_table.sessions.name
    }
  }
  depends_on = [aws_cloudwatch_log_group.datasets_lambda, aws_iam_role_policy.datasets_runtime]
}

resource "aws_apigatewayv2_integration" "datasets_lambda" {
  api_id                 = aws_apigatewayv2_api.auth.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.datasets_api.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 20000
}

resource "aws_apigatewayv2_route" "datasets" {
  for_each = toset([
    "GET /api/datasets",
    "POST /api/datasets/uploads",
    "GET /api/datasets/{id}",
    "DELETE /api/datasets/{id}",
    "POST /api/datasets/{id}/finalize",
  ])
  api_id             = aws_apigatewayv2_api.auth.id
  route_key          = each.value
  authorization_type = "NONE"
  target             = "integrations/${aws_apigatewayv2_integration.datasets_lambda.id}"
}

resource "aws_lambda_permission" "datasets_gateway" {
  statement_id  = "AllowDatasetsApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.datasets_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.auth.execution_arn}/*/*"
}
