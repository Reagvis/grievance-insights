terraform {
  required_version = "~> 1.14.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.72.0"
    }
  }
}

provider "aws" {
  region = "ap-south-1"

  default_tags {
    tags = local.tags
  }
}
