output "bootstrap_role_arn" {
  value       = aws_iam_role.bootstrap.arn
  description = "GitHub OIDC role for the protected pilot-bootstrap environment."
}

output "bootstrap_boundary_arn" {
  value       = aws_iam_policy.bootstrap_boundary.arn
  description = "Permissions boundary preventing the bootstrap role from exceeding its seed policy."
}
