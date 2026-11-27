output "base_url" { value = "https://${var.hostname}" }
output "service_repository_url" { value = aws_ecr_repository.service.repository_url }
output "public_keys_secret_arn" { value = aws_secretsmanager_secret.public_keys.arn }
output "audit_hmac_secret_arn" { value = aws_secretsmanager_secret.audit_hmac.arn }
output "credential_table" { value = aws_dynamodb_table.credentials.name }
output "registry_table" { value = aws_dynamodb_table.registry.name }
output "audit_table" { value = aws_dynamodb_table.audit.name }
