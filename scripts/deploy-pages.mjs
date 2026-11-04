import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function run(command, args, cwd = process.cwd()) {
  const gitArgs = command === 'git' ? ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', ...args] : args;
  const result = spawnSync(command, gitArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Could not run ${command}`);
  return result.stdout.trim();
}

const remote = run('git', ['remote', 'get-url', 'origin']);
const name = run('git', ['config', 'user.name']);
const email = run('git', ['config', 'user.email']);
const build = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-b'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);
const bundle = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'pages', '--base=./'], { stdio: 'inherit' });
if (bundle.status !== 0) process.exit(bundle.status ?? 1);

const directory = mkdtempSync(join(tmpdir(), 'grievance-pages-'));
const branch = run('git', ['ls-remote', '--heads', remote, 'refs/heads/gh-pages']);
if (branch) run('git', ['clone', '--single-branch', '--branch', 'gh-pages', remote, directory]);
else {
  run('git', ['init', '-b', 'gh-pages'], directory);
  run('git', ['remote', 'add', 'origin', remote], directory);
}
run('git', ['config', 'user.name', name], directory);
run('git', ['config', 'user.email', email], directory);
cpSync(join(process.cwd(), 'dist'), directory, { recursive: true });
writeFileSync(join(directory, '.nojekyll'), '');
run('git', ['add', '-A'], directory);
if (run('git', ['status', '--porcelain'], directory)) {
  run('git', ['commit', '-m', 'Deploy Grievance Insights to GitHub Pages'], directory);
  run('git', ['push', '-u', 'origin', 'gh-pages'], directory);
  console.log('Published the static build to gh-pages. GitHub Pages will deploy this commit.');
} else console.log('The published static build is already up to date.');
