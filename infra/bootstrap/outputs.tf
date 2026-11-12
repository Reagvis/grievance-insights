output "state_bucket_name" {
  value       = aws_s3_bucket.state.id
  description = "Bucket to provide as the main configuration's backend bucket."
}

output "terraform_role_arn" {
  value       = aws_iam_role.terraform.arn
  description = "OIDC role for reviewed Terraform runs from the protected infrastructure environment."
}

output "frontend_role_arn" {
  value       = try(aws_iam_role.frontend[0].arn, null)
  description = "OIDC role for frontend publishing; null until a distribution ID is supplied."
}

output "runtime_permissions_boundary_arn" {
  value       = aws_iam_policy.runtime_boundary.arn
  description = "Mandatory permissions boundary for project Lambda execution roles."
}
