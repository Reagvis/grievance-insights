output "application_url" {
  description = "HTTPS URL of the pilot frontend."
  value       = "https://${var.hostname}"
}

output "frontend_bucket_name" {
  description = "Private S3 bucket receiving built frontend assets."
  value       = aws_s3_bucket.frontend.id
}

output "cloudfront_distribution_id" {
  description = "Distribution ID used for deployment invalidations."
  value       = aws_cloudfront_distribution.frontend.id
}

output "cloudfront_distribution_arn" {
  description = "Distribution ARN used to scope the frontend deployment role."
  value       = aws_cloudfront_distribution.frontend.arn
}

output "cloudfront_domain_name" {
  description = "CloudFront-generated distribution hostname."
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "certificate_arn" {
  description = "Validated us-east-1 ACM certificate ARN."
  value       = aws_acm_certificate.frontend.arn
}

output "authentication_api_id" {
  description = "HTTP API identifier for the same-origin authentication backend."
  value       = aws_apigatewayv2_api.auth.id
}

output "cognito_user_pool_id" {
  description = "Administrator-managed Cognito user pool identifier."
  value       = aws_cognito_user_pool.pilot.id
}

output "sessions_table_name" {
  description = "DynamoDB table containing only hashed opaque sessions."
  value       = aws_dynamodb_table.sessions.name
}
