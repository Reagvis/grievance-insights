resource "aws_dynamodb_table" "analyses" {
  name                        = "${local.name_prefix}-analyses"
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

resource "aws_s3_bucket" "analyses" {
  bucket        = "${local.name_prefix}-${data.aws_caller_identity.current.account_id}-results"
  force_destroy = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "analyses" {
  bucket                  = aws_s3_bucket.analyses.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "analyses" {
  bucket = aws_s3_bucket.analyses.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "analyses" {
  bucket = aws_s3_bucket.analyses.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "analyses" {
  bucket = aws_s3_bucket.analyses.id

  rule {
    id     = "expire-pilot-ai-results"
    status = "Enabled"
    filter {}

    expiration {
      days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "analyses_bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.analyses.arn, "${aws_s3_bucket.analyses.arn}/*"]

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

resource "aws_s3_bucket_policy" "analyses" {
  bucket = aws_s3_bucket.analyses.id
  policy = data.aws_iam_policy_document.analyses_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.analyses]
}

resource "aws_sqs_queue" "analyses_dlq" {
  name                       = "${local.name_prefix}-analyses-dlq.fifo"
  fifo_queue                 = true
  sqs_managed_sse_enabled    = true
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 720
}

resource "aws_sqs_queue" "analyses" {
  name                       = "${local.name_prefix}-analyses.fifo"
  fifo_queue                 = true
  sqs_managed_sse_enabled    = true
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 720
  receive_wait_time_seconds  = 20
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.analyses_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "analyses" {
  queue_url = aws_sqs_queue.analyses_dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.analyses.arn]
  })
}

resource "aws_iam_role" "worker_execution" {
  name                 = "${local.name_prefix}-worker-execution"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role.json
  permissions_boundary = data.aws_iam_policy.runtime_boundary.arn
}

resource "aws_cloudwatch_log_group" "analysis_api" {
  name              = "/aws/lambda/${local.name_prefix}-analyses-api"
  retention_in_days = var.auth_log_retention_days
}

resource "aws_cloudwatch_log_group" "analysis_worker" {
  name              = "/aws/lambda/${local.name_prefix}-analyses-worker"
  retention_in_days = var.auth_log_retention_days
}

data "aws_iam_policy_document" "analysis_runtime" {
  statement {
    sid       = "WriteAnalysisOperationalLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.analysis_api.arn}:*", "${aws_cloudwatch_log_group.analysis_worker.arn}:*"]
  }

  statement {
    sid       = "ReadHashedSessions"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.sessions.arn]
  }

  statement {
    sid       = "ReadDatasetMetadata"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.datasets.arn]
  }

  statement {
    sid       = "ManageAnalysisJobs"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.analyses.arn]
  }

  statement {
    sid       = "ReadSourceDatasets"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.datasets.arn}/raw/*"]
  }

  # A missing S3 GET returns 403 without ListBucket; checkpointed workers
  # must distinguish a not-yet-written result object from access failures.
  statement {
    sid       = "IdentifyMissingPrivateResults"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.analyses.arn]
  }

  statement {
    sid       = "ReadWritePrivateAnalysisResults"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.analyses.arn}/analyses/*"]
  }

  statement {
    sid       = "EnqueueProcessingWork"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.analyses.arn]
  }

  statement {
    sid       = "ReceiveProcessingWork"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.analyses.arn, aws_sqs_queue.analyses_dlq.arn]
  }

  statement {
    sid       = "Qwen3ConverseOnly"
    actions   = ["bedrock:InvokeModel"]
    resources = ["arn:aws:bedrock:ap-south-1::foundation-model/qwen.qwen3-32b-v1:0"]
  }
}

# The two preapproved bounded execution role names are api-execution and worker-execution.
# Keep authentication alone on api-execution. Dataset/API/worker share worker-execution
# pending authorization for a third scoped execution role; do not expand bootstrap IAM here.
resource "aws_iam_role_policy" "analysis_runtime" {
  name   = "${local.name_prefix}-analysis-runtime"
  role   = aws_iam_role.worker_execution.id
  policy = data.aws_iam_policy_document.analysis_runtime.json
}

locals {
  analysis_api_zip    = abspath("${path.module}/../artifacts/analysis-api-lambda.zip")
  analysis_worker_zip = abspath("${path.module}/../artifacts/analysis-worker-lambda.zip")
  analysis_lambda_environment = {
    ALLOWED_ORIGIN       = "https://${var.hostname}"
    DATASETS_BUCKET_NAME = aws_s3_bucket.datasets.id
    DATASETS_TABLE_NAME  = aws_dynamodb_table.datasets.name
    SESSIONS_TABLE_NAME  = aws_dynamodb_table.sessions.name
    ANALYSES_BUCKET_NAME = aws_s3_bucket.analyses.id
    ANALYSES_TABLE_NAME  = aws_dynamodb_table.analyses.name
    ANALYSES_QUEUE_URL   = aws_sqs_queue.analyses.id
    ANALYSES_DLQ_ARN     = aws_sqs_queue.analyses_dlq.arn
  }
}

resource "aws_lambda_function" "analysis_api" {
  function_name                  = "${local.name_prefix}-analyses-api"
  description                    = "Authenticated analysis job coordination and result retrieval"
  role                           = aws_iam_role.worker_execution.arn
  runtime                        = "nodejs22.x"
  handler                        = "index.handler"
  filename                       = local.analysis_api_zip
  source_code_hash               = fileexists(local.analysis_api_zip) ? filebase64sha256(local.analysis_api_zip) : null
  architectures                  = ["x86_64"]
  memory_size                    = 256
  timeout                        = 25
  reserved_concurrent_executions = 3

  environment {
    variables = local.analysis_lambda_environment
  }

  depends_on = [aws_cloudwatch_log_group.analysis_api, aws_iam_role_policy.analysis_runtime]
}

resource "aws_lambda_function" "analysis_worker" {
  function_name                  = "${local.name_prefix}-analyses-worker"
  description                    = "Checkpointed bounded Qwen3 Converse processing"
  role                           = aws_iam_role.worker_execution.arn
  runtime                        = "nodejs22.x"
  handler                        = "index.handler"
  filename                       = local.analysis_worker_zip
  source_code_hash               = fileexists(local.analysis_worker_zip) ? filebase64sha256(local.analysis_worker_zip) : null
  architectures                  = ["x86_64"]
  memory_size                    = 512
  timeout                        = 600
  reserved_concurrent_executions = var.analysis_worker_concurrency

  environment {
    variables = local.analysis_lambda_environment
  }

  depends_on = [aws_cloudwatch_log_group.analysis_worker, aws_iam_role_policy.analysis_runtime]
}

resource "aws_lambda_event_source_mapping" "analysis_queue" {
  event_source_arn = aws_sqs_queue.analyses.arn
  function_name    = aws_lambda_function.analysis_worker.arn
  batch_size       = 1
  enabled          = true
  scaling_config {
    maximum_concurrency = var.analysis_worker_concurrency < 2 ? 2 : var.analysis_worker_concurrency
  }
}

resource "aws_lambda_event_source_mapping" "analysis_dlq" {
  event_source_arn = aws_sqs_queue.analyses_dlq.arn
  function_name    = aws_lambda_function.analysis_worker.arn
  batch_size       = 1
  enabled          = true
}

resource "aws_apigatewayv2_integration" "analysis_api" {
  api_id                 = aws_apigatewayv2_api.auth.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.analysis_api.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}

resource "aws_apigatewayv2_route" "analyses" {
  for_each = toset([
    "POST /api/datasets/{id}/analyze",
    "GET /api/datasets/{id}/analyses",
    "GET /api/analyses/{jobId}",
    "GET /api/analyses/{jobId}/results",
    "POST /api/analyses/{jobId}/retry",
  ])

  api_id             = aws_apigatewayv2_api.auth.id
  route_key          = each.value
  authorization_type = "NONE"
  target             = "integrations/${aws_apigatewayv2_integration.analysis_api.id}"
}

resource "aws_lambda_permission" "analysis_gateway" {
  statement_id  = "AllowAnalysisApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.analysis_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.auth.execution_arn}/*/*"
}
