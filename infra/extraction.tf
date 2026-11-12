# Asynchronous PDF extraction (text layer + Tesseract OCR) for Task 21.
#
# Additive only. It mirrors the analysis pipeline's pattern (FIFO queue + dead-letter queue + SQS-triggered worker on the
# existing preapproved worker-execution role). It creates no IAM role, no bucket and no table, and it does not change
# Cognito, the datasets bucket policy or the analysis resources. The only change to an existing resource is one new
# environment variable (EXTRACTION_QUEUE_URL) on the datasets API Lambda (see datasets.tf).

locals {
  extractor_zip = abspath("${path.module}/../artifacts/extractor-lambda.zip")
}

resource "aws_sqs_queue" "extraction_dlq" {
  name                       = "${local.name_prefix}-extraction-dlq.fifo"
  fifo_queue                 = true
  sqs_managed_sse_enabled    = true
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 1800
}

resource "aws_sqs_queue" "extraction" {
  name                       = "${local.name_prefix}-extraction.fifo"
  fifo_queue                 = true
  sqs_managed_sse_enabled    = true
  message_retention_seconds  = 345600
  visibility_timeout_seconds = 1800 # six times the worker timeout, as recommended for SQS event sources
  receive_wait_time_seconds  = 20
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.extraction_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "extraction" {
  queue_url = aws_sqs_queue.extraction_dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.extraction.arn]
  })
}

resource "aws_cloudwatch_log_group" "extractor" {
  name              = "/aws/lambda/${local.name_prefix}-extractor"
  retention_in_days = var.auth_log_retention_days
}

data "aws_iam_policy_document" "extraction_runtime" {
  statement {
    sid       = "ExtractorLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.extractor.arn}:*"]
  }
  statement {
    sid       = "ExtractorConsume"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]
    resources = [aws_sqs_queue.extraction.arn, aws_sqs_queue.extraction_dlq.arn]
  }
  statement {
    sid       = "DatasetsApiEnqueue"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.extraction.arn]
  }
}

# Added beside the existing inline policies on the worker-execution role. Dataset bucket/table access for the worker
# is already granted by the existing datasets runtime policy (raw/* objects, datasets table).
resource "aws_iam_role_policy" "extraction_runtime" {
  name   = "${local.name_prefix}-extraction-runtime"
  role   = aws_iam_role.worker_execution.id
  policy = data.aws_iam_policy_document.extraction_runtime.json
}

resource "aws_lambda_function" "extractor" {
  function_name                  = "${local.name_prefix}-extractor"
  description                    = "PDF text-layer extraction and Telugu/English Tesseract OCR; writes the private dataset index"
  role                           = aws_iam_role.worker_execution.arn
  runtime                        = "nodejs22.x"
  handler                        = "index.handler"
  filename                       = local.extractor_zip
  source_code_hash               = fileexists(local.extractor_zip) ? filebase64sha256(local.extractor_zip) : null
  architectures                  = ["x86_64"]
  memory_size                    = 3008 # Tesseract's WASM heap plus a decoded page image; measured, not guessed, before raising
  timeout                        = 300
  reserved_concurrent_executions = var.extraction_worker_concurrency

  environment {
    variables = {
      ALLOWED_ORIGIN       = "https://${var.hostname}"
      DATASETS_BUCKET_NAME = aws_s3_bucket.datasets.id
      DATASETS_TABLE_NAME  = aws_dynamodb_table.datasets.name
      SESSIONS_TABLE_NAME  = aws_dynamodb_table.sessions.name
      EXTRACTION_DLQ_ARN   = aws_sqs_queue.extraction_dlq.arn
      TESSDATA_DIR         = "/var/task/tessdata"
    }
  }

  depends_on = [aws_cloudwatch_log_group.extractor, aws_iam_role_policy.extraction_runtime]
}

resource "aws_lambda_event_source_mapping" "extraction_queue" {
  event_source_arn = aws_sqs_queue.extraction.arn
  function_name    = aws_lambda_function.extractor.arn
  batch_size       = 1
  enabled          = true
  dynamic "scaling_config" {
    for_each = var.extraction_worker_concurrency >= 2 ? [1] : []
    content {
      maximum_concurrency = var.extraction_worker_concurrency
    }
  }
}

# The dead-letter queue is consumed by the same worker, which marks the dataset failed (never left `extracting`).
resource "aws_lambda_event_source_mapping" "extraction_dlq" {
  event_source_arn = aws_sqs_queue.extraction_dlq.arn
  function_name    = aws_lambda_function.extractor.arn
  batch_size       = 1
  enabled          = true
}
