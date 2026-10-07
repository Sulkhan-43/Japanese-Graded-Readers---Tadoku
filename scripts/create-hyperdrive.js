import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wranglerConfigPath = path.join(root, 'wrangler.toml');
const wranglerPath = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const connectionString = process.env.DATABASE_URL;

if (!connectionString) throw new Error('DATABASE_URL is missing from the root .env file.');
if ((await readFile(wranglerConfigPath, 'utf8')).includes('[[hyperdrive]]')) {
  throw new Error('wrangler.toml already has a Hyperdrive binding. Inspect it before creating another.');
}

const directConnection = new URL(connectionString);
directConnection.hostname = directConnection.hostname.replace(/-pooler(?=\.)/, '');
directConnection.searchParams.delete('channel_binding');
directConnection.searchParams.set('sslmode', 'require');

const result = spawnSync(process.execPath, [
  wranglerPath,
  'hyperdrive',
  'create',
  'todaku-study-data',
  '--connection-string',
  directConnection.toString(),
  '--sslmode',
  'require',
  '--binding',
  'HYPERDRIVE',
  '--update-config',
  '--caching-disabled',
  '--origin-connection-limit',
  '5',
], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

const output = `${result.stdout || ''}${result.stderr || ''}`
  .replace(/postgres(?:ql)?:\/\/\S+/gi, '[connection string redacted]');
if (output) process.stdout.write(output);
if (result.error) throw new Error('Wrangler could not create the Hyperdrive binding.');
if (result.status !== 0) process.exitCode = result.status ?? 1;
