resource "aws_acm_certificate" "frontend" {
  provider          = aws.us_east_1
  domain_name       = var.hostname
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true

    precondition {
      condition = (
        trimsuffix(var.hostname, ".") == trimsuffix(var.hosted_zone_name, ".") ||
        endswith(trimsuffix(var.hostname, "."), ".${trimsuffix(var.hosted_zone_name, ".")}")
      )
      error_message = "hostname must be the hosted zone name or one of its subdomains."
    }
  }
}

resource "aws_route53_record" "certificate_validation" {
  for_each = {
    for option in aws_acm_certificate.frontend.domain_validation_options : option.domain_name => {
      name  = option.resource_record_name
      type  = option.resource_record_type
      value = option.resource_record_value
    }
  }

  zone_id         = data.aws_route53_zone.reagvis.zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 300
  records         = [each.value.value]
  allow_overwrite = false
}

resource "aws_acm_certificate_validation" "frontend" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.frontend.arn
  validation_record_fqdns = [for record in aws_route53_record.certificate_validation : record.fqdn]
}

resource "aws_route53_record" "frontend_ipv4" {
  zone_id = data.aws_route53_zone.reagvis.zone_id
  name    = var.hostname
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "frontend_ipv6" {
  zone_id = data.aws_route53_zone.reagvis.zone_id
  name    = var.hostname
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}
