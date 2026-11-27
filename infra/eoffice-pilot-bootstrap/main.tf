resource "aws_kms_key" "data" {
  description             = "Isolated eOffice pilot image and data encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}
resource "aws_kms_alias" "data" {
  name          = "alias/grievance-insights-eoffice-pilot"
  target_key_id = aws_kms_key.data.key_id
}
resource "aws_ecr_repository" "service" {
  name                 = "grievance-insights-eoffice-pilot"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.data.arn

  }
}
