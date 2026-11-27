terraform {
  required_version = "~> 1.14.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "= 6.72.0" }
  }
  backend "s3" {
    key          = "grievance-insights/eoffice-pilot/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region
  default_tags { tags = local.tags }
}
