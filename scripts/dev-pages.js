import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set DATABASE_URL in the root .env to run Pages locally against Neon.');
const localConnection = new URL(databaseUrl);
localConnection.searchParams.set('sslmode', 'verify-full');

const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const result = spawnSync(process.execPath, [wrangler, 'pages', 'dev', 'dist'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: localConnection.toString(),
  },
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
