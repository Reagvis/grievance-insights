data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}
data "aws_route53_zone" "reagvis" {
  name         = "${trimsuffix(var.hosted_zone_name, ".")}."
  private_zone = false
}

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
  service_image = "${aws_ecr_repository.service.repository_url}@${var.service_image_digest}"
}

resource "aws_kms_key" "data" {
  description             = "Isolated eOffice pilot registry, audit and secret encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}
resource "aws_kms_alias" "data" {
  name          = "alias/${local.name}"
  target_key_id = aws_kms_key.data.key_id
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
    kms_key_arn = aws_kms_key.data.arn
  }
  lifecycle {
    prevent_destroy = true
  }
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
  point_in_time_recovery {
    enabled = true
  }
  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.data.arn
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
    kms_key_arn = aws_kms_key.data.arn
  }
  lifecycle {
    prevent_destroy = true
  }
}

# Values are populated only through a separately approved operator procedure.
resource "aws_secretsmanager_secret" "public_keys" {
  name                    = "${local.name}/jwt-public-keys"
  kms_key_id              = aws_kms_key.data.arn
  recovery_window_in_days = 30
}
resource "aws_secretsmanager_secret" "audit_hmac" {
  name                    = "${local.name}/audit-hmac"
  kms_key_id              = aws_kms_key.data.arn
  recovery_window_in_days = 30
}
resource "aws_ecr_repository" "service" {
  name                 = local.name
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.data.arn
  }
  force_delete = false
}

resource "aws_vpc" "this" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
}
resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
}
resource "aws_subnet" "service" {
  count                   = 2
  vpc_id                  = aws_vpc.this.id
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  cidr_block              = cidrsubnet(aws_vpc.this.cidr_block, 8, count.index + 1)
  map_public_ip_on_launch = true
}
resource "aws_route_table" "service" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
}
resource "aws_route_table_association" "service" {
  count          = 2
  subnet_id      = aws_subnet.service[count.index].id
  route_table_id = aws_route_table.service.id
}

resource "aws_security_group" "alb" {
  name   = "${local.name}-alb"
  vpc_id = aws_vpc.this.id
}
resource "aws_vpc_security_group_ingress_rule" "alb_vpc" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = aws_vpc.this.cidr_block
  from_port         = 8080
  to_port           = 8080
  ip_protocol       = "tcp"
}
resource "aws_vpc_security_group_egress_rule" "alb" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
resource "aws_security_group" "service" {
  name   = "${local.name}-service"
  vpc_id = aws_vpc.this.id
}
resource "aws_vpc_security_group_ingress_rule" "service_alb" {
  security_group_id            = aws_security_group.service.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 8080
  to_port                      = 8080
  ip_protocol                  = "tcp"
}
resource "aws_vpc_security_group_egress_rule" "service_https" {
  security_group_id = aws_security_group.service.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}
resource "aws_vpc_security_group_egress_rule" "service_dns_udp" {
  security_group_id = aws_security_group.service.id
  cidr_ipv4         = aws_vpc.this.cidr_block
  from_port         = 53
  to_port           = 53
  ip_protocol       = "udp"
}
resource "aws_vpc_security_group_egress_rule" "service_dns_tcp" {
  security_group_id = aws_security_group.service.id
  cidr_ipv4         = aws_vpc.this.cidr_block
  from_port         = 53
  to_port           = 53
  ip_protocol       = "tcp"
}

resource "aws_lb" "internal" {
  name                       = "eoffice-pilot-internal"
  internal                   = true
  load_balancer_type         = "application"
  subnets                    = aws_subnet.service[*].id
  security_groups            = [aws_security_group.alb.id]
  enable_deletion_protection = true
  drop_invalid_header_fields = true
}
resource "aws_lb_target_group" "service" {
  name        = "eoffice-pilot"
  port        = 8080
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.this.id
  health_check {
    path     = "/health"
    matcher  = "200"
    interval = 30
    timeout  = 5
  }
}
resource "aws_lb_listener" "service" {
  load_balancer_arn = aws_lb.internal.arn
  port              = 8080
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service.arn
  }
}

resource "aws_ecs_cluster" "this" {
  name = local.name
}
resource "aws_cloudwatch_log_group" "service" {
  name              = "/ecs/${local.name}"
  retention_in_days = 30
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}
resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}
resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}
data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue", "kms:Decrypt"]
    resources = [aws_secretsmanager_secret.public_keys.arn, aws_secretsmanager_secret.audit_hmac.arn, aws_kms_key.data.arn]
  }
}
resource "aws_iam_role_policy" "execution_secrets" {
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}
data "aws_iam_policy_document" "task" {
  statement {
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.credentials.arn, aws_dynamodb_table.registry.arn]
  }
  statement {
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.audit.arn]
  }
  statement {
    actions   = ["bedrock:InvokeModel"]
    resources = ["arn:aws:bedrock:${var.aws_region}::foundation-model/qwen.qwen3-32b-v1:0"]
  }
  statement {
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.data.arn]
  }
}
resource "aws_iam_role_policy" "task" {
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

# Deliberately unattached. A separately approved MFA/operator trust boundary
# may attach this policy; the public API task never receives these writes.
data "aws_iam_policy_document" "operator" {
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem"]
    resources = [aws_dynamodb_table.credentials.arn, aws_dynamodb_table.registry.arn, aws_dynamodb_table.audit.arn]
  }
  statement {
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.data.arn]
  }
}
resource "aws_iam_policy" "operator" {
  name   = "${local.name}-operator"
  policy = data.aws_iam_policy_document.operator.json
}

resource "aws_ecs_task_definition" "service" {
  family                   = local.name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 2048
  memory                   = 4096
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  volume {
    name = "clamd-socket"
  }
  container_definitions = jsonencode([
    {
      name = "clamav", image = var.clamav_image, essential = true, cpu = 1536, memory = 3072,
      mountPoints = [{
        sourceVolume = "clamd-socket", containerPath = "/run/clamav", readOnly = false
      }],
      healthCheck = {
        command = ["CMD-SHELL", "test -S /run/clamav/clamd.sock"], interval = 30, timeout = 5, retries = 5, startPeriod = 120
      },
      logConfiguration = {
        logDriver = "awslogs", options = {
          "awslogs-group" = aws_cloudwatch_log_group.service.name, "awslogs-region" = var.aws_region, "awslogs-stream-prefix" = "clamav"
        }
      }
    },
    {
      name = "api", image = local.service_image, essential = true, cpu = 512, memory = 1024,
      dependsOn = [{
        containerName = "clamav", condition = "HEALTHY"
      }],
      portMappings = [{
        containerPort = 8080, protocol = "tcp"
      }],
      mountPoints = [{
        sourceVolume = "clamd-socket", containerPath = "/run/clamav", readOnly = false
      }],
      environment = [
        {
          name = "EOFFICE_JWT_ISSUER", value = var.jwt_issuer
        },
        {
          name = "EOFFICE_CREDENTIALS_TABLE", value = aws_dynamodb_table.credentials.name
        },
        {
          name = "EOFFICE_REGISTRY_TABLE", value = aws_dynamodb_table.registry.name
        },
        {
          name = "EOFFICE_AUDIT_TABLE", value = aws_dynamodb_table.audit.name
        },
        {
          name = "EOFFICE_AUDIT_RETENTION_SECONDS", value = tostring(var.audit_retention_days * 86400)
        }
      ],
      secrets = [
        {
          name = "EOFFICE_PUBLIC_KEYS_JSON", valueFrom = aws_secretsmanager_secret.public_keys.arn
        },
        {
          name = "EOFFICE_AUDIT_HMAC_KEY", valueFrom = aws_secretsmanager_secret.audit_hmac.arn
        }
      ],
      readonlyRootFilesystem = true,
      healthCheck = {
        command = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""], interval = 30, timeout = 5, retries = 3, startPeriod = 10
      },
      logConfiguration = {
        logDriver = "awslogs", options = {
          "awslogs-group" = aws_cloudwatch_log_group.service.name, "awslogs-region" = var.aws_region, "awslogs-stream-prefix" = "api"
        }
      }
    }
  ])
}
resource "aws_ecs_service" "service" {
  name                               = local.name
  cluster                            = aws_ecs_cluster.this.id
  task_definition                    = aws_ecs_task_definition.service.arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  enable_execute_command             = false
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  network_configuration {
    subnets          = aws_subnet.service[*].id
    security_groups  = [aws_security_group.service.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.service.arn
    container_name   = "api"
    container_port   = 8080
  }
  depends_on = [aws_lb_listener.service]
}

resource "aws_apigatewayv2_vpc_link" "service" {
  name               = local.name
  security_group_ids = [aws_security_group.alb.id]
  subnet_ids         = aws_subnet.service[*].id
}
resource "aws_apigatewayv2_api" "service" {
  name                         = local.name
  protocol_type                = "HTTP"
  disable_execute_api_endpoint = true
}
resource "aws_apigatewayv2_integration" "service" {
  api_id                 = aws_apigatewayv2_api.service.id
  integration_type       = "HTTP_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lb_listener.service.arn
  connection_type        = "VPC_LINK"
  connection_id          = aws_apigatewayv2_vpc_link.service.id
  payload_format_version = "1.0"
  timeout_milliseconds   = 30000
}
resource "aws_apigatewayv2_route" "service" {
  for_each           = toset(["POST /api/v1/ai/chat", "POST /api/v1/ai/summarize", "POST /api/v1/ai/extract", "POST /api/v1/ai/draft-reply"])
  api_id             = aws_apigatewayv2_api.service.id
  route_key          = each.value
  authorization_type = "NONE"
  target             = "integrations/${aws_apigatewayv2_integration.service.id}"
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
resource "aws_acm_certificate" "service" {
  domain_name       = var.hostname
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}
resource "aws_route53_record" "validation" {
  for_each = {
    for option in aws_acm_certificate.service.domain_validation_options : option.domain_name => option
  }
  zone_id = data.aws_route53_zone.reagvis.zone_id
  name    = each.value.resource_record_name
  type    = each.value.resource_record_type
  records = [each.value.resource_record_value]
  ttl     = 300
}
resource "aws_acm_certificate_validation" "service" {
  certificate_arn         = aws_acm_certificate.service.arn
  validation_record_fqdns = [for record in aws_route53_record.validation : record.fqdn]
}
resource "aws_apigatewayv2_domain_name" "service" {
  domain_name = var.hostname
  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.service.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}
resource "aws_apigatewayv2_api_mapping" "service" {
  api_id      = aws_apigatewayv2_api.service.id
  domain_name = aws_apigatewayv2_domain_name.service.id
  stage       = aws_apigatewayv2_stage.service.id
}
resource "aws_route53_record" "service" {
  zone_id = data.aws_route53_zone.reagvis.zone_id
  name    = var.hostname
  type    = "A"
  alias {
    name                   = aws_apigatewayv2_domain_name.service.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.service.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_budgets_budget" "monthly" {
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  cost_filter {
    name   = "TagKeyValue"
    values = ["user:Application$grievance-insights-eoffice"]
  }
}
