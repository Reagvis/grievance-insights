output "kms_key_arn" {
  value = aws_kms_key.data.arn
}
output "repository_url" {
  value = aws_ecr_repository.service.repository_url
}
