# Bootstrap access seed

This one-time local Terraform root owns only the GitHub OIDC bootstrap role and its permissions boundary. It is deliberately separate from `infra/bootstrap/`, so the bootstrap role cannot change its own trust, permissions, or boundary.

The role trusts only `Reagvis/grievance-insights` through the `pilot-bootstrap` environment. It can manage the existing bootstrap stack's two deployment roles, their exact inline and managed policies, the project runtime boundary, the dedicated state-bucket configuration, and only the new bootstrap state and lock objects. It has no `iam:PassRole`, unrestricted `iam:*`, application-service provisioning, or access to the main infrastructure state object.

This root intentionally retains local state because changing the access identity is an exceptional operator action, not a routine deployment. Keep its state outside Git with restrictive permissions and a separate encrypted, versioned backup. Its current backup key is `access-seed/terraform.tfstate`; do not overwrite the bootstrap stack's historical backup or either remote Terraform state key. Never run it from the bootstrap GitHub workflow and never import it into `infra/bootstrap/`.
