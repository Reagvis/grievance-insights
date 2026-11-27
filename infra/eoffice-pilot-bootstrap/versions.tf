terraform {
  required_version = "~> 1.14.0"
  required_providers {
    aws = {
      source = "hashicorp/aws", version = "= 6.72.0"
    }

  }
  backend "s3" {
    key          = "grievance-insights/eoffice-pilot-bootstrap/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true

  }
}
provider "aws" {
  region = "ap-south-1"
  default_tags {
    tags = {
      Application       = "grievance-insights-eoffice"
      Environment       = "pilot"
      ManagedBy         = "terraform"
      Repository        = "Reagvis/grievance-insights"
      Production        = "false"
      IsolationBoundary = "eoffice-pilot-bootstrap"

    }

  }
}
