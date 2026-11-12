terraform {
  backend "s3" {
    key          = "grievance-insights/pilot/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}
