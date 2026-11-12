import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bootstrap = readFileSync(new URL('../../infra/bootstrap/backend_iam.tf', import.meta.url), 'utf8');
const results = readFileSync(new URL('../../infra/analysis.tf', import.meta.url), 'utf8');
const datasets = readFileSync(new URL('../../infra/datasets.tf', import.meta.url), 'utf8');

function allowlistedSuffixes(heading: string): string[] {
  const section = bootstrap.match(new RegExp(heading + '\\s*=\\s*(?:toset\\(\\[|\\[)([\\s\\S]*?)\\]'))?.[1];
  if (!section) throw new Error('Bootstrap IAM contract not found: ' + heading);
  return [...section.matchAll(/\$\{local\.backend_name_prefix\}-\$\{data\.aws_caller_identity\.current\.account_id\}-([a-z-]+)"/g)]
    .map(match => match[1]);
}
function bucketSuffix(terraform: string, resource: string): string {
  const source = terraform.match(new RegExp('resource "aws_s3_bucket" "' + resource + '" \\{([\\s\\S]*?)\\n\\}'))?.[1];
  const suffix = source?.match(/bucket\s*=\s*"\$\{local\.name_prefix\}-\$\{data\.aws_caller_identity\.current\.account_id\}-([a-z-]+)"/)?.[1];
  if (!suffix) throw new Error('Unexpected physical S3 bucket name for ' + resource);
  return suffix;
}
describe('application bucket names agree with approved bootstrap IAM and runtime boundary', () => {
  it('uses preapproved -results and -datasets physical names, without renaming Terraform addresses', () => {
    const allowed = allowlistedSuffixes('application_bucket_names');
    const runtime = allowlistedSuffixes('runtime_data_bucket_arns');
    const suffixes = [bucketSuffix(results, 'analyses'), bucketSuffix(datasets, 'datasets')];
    expect(suffixes).toEqual(['results', 'datasets']);
    for (const suffix of suffixes) {
      expect(allowed).toContain(suffix);
      expect(runtime).toContain(suffix);
    }
    expect(results).toContain('ANALYSES_BUCKET_NAME = aws_s3_bucket.analyses.id');
    expect(results).toContain('s3:ListBucket');
  });
  it('keeps result storage private, encrypted and lifecycle-managed', () => {
    for (const resource of ['aws_s3_bucket_public_access_block', 'aws_s3_bucket_server_side_encryption_configuration',
      'aws_s3_bucket_policy', 'aws_s3_bucket_lifecycle_configuration']) {
      expect(results).toContain('resource "' + resource + '" "analyses"');
    }
    expect(results).toContain('days = 90');
    expect(results).toContain('force_destroy = false');
  });
});