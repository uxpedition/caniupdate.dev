const userAgent = process.env.npm_config_user_agent ?? '';

if (!userAgent.startsWith('nub/')) {
  console.error('This repository uses Nub. Install dependencies with `nub ci`.');
  process.exitCode = 1;
}
