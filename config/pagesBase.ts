import { execFileSync } from 'node:child_process';

// CI supplies the actual owner/repository. Local builds may explicitly supply it,
// or use the configured origin. No repository name is inferred from the folder.
export function pagesBase(): string {
  let repository = process.env.GITHUB_REPOSITORY ?? '';
  if (!repository && process.env.PAGES_BUILD === 'true') {
    let remote = '';
    try { remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim(); } catch { /* checked below */ }
    repository = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? '';
    if (!repository) throw new Error('Pages build needs GITHUB_REPOSITORY=owner/repository or a GitHub origin.');
  }
  if (!repository) return '/';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Invalid GITHUB_REPOSITORY');
  const [owner, repo] = repository.split('/');
  return repo.toLowerCase() === `${owner.toLowerCase()}.github.io` ? '/' : `/${repo}/`;
}
