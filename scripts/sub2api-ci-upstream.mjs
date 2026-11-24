#!/usr/bin/env node
// Provision a real Sub2API backend for CI compatibility checks.
//
// Two modes, one provisioning path:
//   baseline-source : build the pinned commit from source with a bounded Node heap
//   latest-image    : resolve docker.io/weishaw/sub2api:latest for linux/amd64 and
//                     run the immutable image@sha256:<digest> reference
//
// Commands: resolve | up | down | manifest | configure
//
// Everything the harness records lands in a JSON manifest (RUNNER_TEMP by default)
// and a single sanitized JSON document on stdout. Human-readable progress goes to
// stderr so stdout stays machine-readable.

import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

export const BASELINE_COMMIT = '2af3f1e15c98c893a89255a037f551046883b8c0';
export const UPSTREAM_REPOSITORY = 'Wei-Shaw/sub2api';
export const UPSTREAM_GIT_URL = `https://github.com/${UPSTREAM_REPOSITORY}.git`;
export const LATEST_IMAGE_TAG = 'docker.io/weishaw/sub2api:latest';
export const LATEST_IMAGE_REPOSITORY = 'docker.io/weishaw/sub2api';
export const REGISTRY_REPOSITORY = 'weishaw/sub2api';
export const DEFAULT_PLATFORM = { os: 'linux', architecture: 'amd64' };
export const UPSTREAM_INTERNAL_PORT = 18081;
export const DEFAULT_BUILD_NODE_OPTIONS = '--max-old-space-size=4096';
// Fully qualified so podman (which has no default short-name registry configured on
// some hosts) resolves the same images as docker.
export const POSTGRES_IMAGE = 'docker.io/library/postgres:16';
export const REDIS_IMAGE = 'docker.io/library/redis:7';
export const MANIFEST_SCHEMA_VERSION = 1;

const SECRET_ENV_KEYS = [
  'ADMIN_PASSWORD',
  'SUB2API_ADMIN_PASSWORD',
  'SUB2API_TEST_PASSWORD',
  'JWT_SECRET',
  'POSTGRES_PASSWORD',
  'DATABASE_PASSWORD',
  'REDIS_PASSWORD',
  'TURNSTILE_SECRET_KEY',
];

const SECRET_PATTERNS = [
  // Bearer tokens first: the assignment rule below would otherwise consume the
  // "Bearer" keyword and leave the credential text dangling after it.
  [/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]'],
  [/((?:password|passwd|secret|token|api[_-]?key|authorization))(\s*["']?\s*[:=]\s*["']?)([^\s"',}]+)/gi, '$1$2[REDACTED]'],
];

export function defaultSecretValues(env = process.env) {
  const values = [];
  for (const key of SECRET_ENV_KEYS) {
    const value = env[key];
    if (typeof value === 'string' && value.trim().length >= 4) values.push(value);
  }
  return values;
}

// Redact secrets centrally: explicit env values first, then credential-shaped text.
export function sanitize(value, secretValues = defaultSecretValues()) {
  if (typeof value === 'string') {
    let out = value;
    for (const secret of secretValues) {
      if (!secret) continue;
      out = out.split(secret).join('[REDACTED]');
    }
    for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
    return out;
  }
  if (Array.isArray(value)) return value.map(item => sanitize(item, secretValues));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string' && /pass(word)?|secret|token|api[_-]?key|authorization/i.test(key)) {
        out[key] = '[REDACTED]';
        continue;
      }
      out[key] = sanitize(item, secretValues);
    }
    return out;
  }
  return value;
}

export function uniqueSuffix(env = process.env, random = () => randomBytes(4).toString('hex')) {
  const run = String(env.GITHUB_RUN_ID || '').replace(/[^0-9a-zA-Z]/g, '');
  const attempt = String(env.GITHUB_RUN_ATTEMPT || '').replace(/[^0-9a-zA-Z]/g, '');
  const base = run ? `${run}${attempt ? `-${attempt}` : ''}` : 'local';
  const suffix = `${base}-${random()}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return suffix.slice(-40).replace(/^-+/, '') || 'local';
}

export const DEFAULT_NAME_PREFIX = 'cshell-sub2api-';

export function containerNames(suffix, prefix = DEFAULT_NAME_PREFIX) {
  const clean = String(suffix).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'local';
  return {
    network: `${prefix}net-${clean}`,
    db: `${prefix}db-${clean}`,
    redis: `${prefix}redis-${clean}`,
    upstream: `${prefix}${clean}`,
    dataVolume: `${prefix}data-${clean}`,
  };
}

export function validateNamePrefix(prefix) {
  const value = String(prefix ?? '');
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(value) || !value.endsWith('-')) {
    throw new Error(
      `invalid container name prefix: ${JSON.stringify(prefix)}; expected lowercase letters/digits/dashes ending with "-"`,
    );
  }
  return value;
}

// Stable names for a long-lived profile. Unlike containerNames(suffix) these carry
// no per-run suffix, so a fresh `status`, `down` or `reset` process finds exactly
// the same containers, network and data volume as the process that started them.
export function fixedContainerNames(prefix) {
  const base = validateNamePrefix(prefix);
  const names = {
    network: `${base}net`,
    db: `${base}db`,
    redis: `${base}redis`,
    upstream: `${base}sub2api`,
    dataVolume: `${base}data`,
    // Only used when the DB is persisted; CI's tmpfs database has no such volume.
    dbDataVolume: `${base}dbdata`,
  };
  for (const [kind, name] of Object.entries(names)) {
    if (name.length > 63) throw new Error(`fixed ${kind} name ${name} exceeds the 63-character DNS limit`);
  }
  return names;
}

export function validateHostPort(port) {
  const value = Number(port);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error(`invalid host port: ${JSON.stringify(port)}; expected an integer from 1024 to 65535`);
  }
  return value;
}

export function imageRefByDigest(repository, digest) {
  const cleanRepository = String(repository || '').replace(/\/+$/, '');
  if (!cleanRepository || /[@:\s]/.test(cleanRepository)) throw new Error(`invalid image repository: ${repository}`);
  if (!/^sha256:[0-9a-f]{64}$/.test(String(digest || ''))) throw new Error(`invalid image digest: ${digest}`);
  return `${cleanRepository}@${digest}`;
}

export function pickPlatformDigest(index, platform = DEFAULT_PLATFORM) {
  const entries = Array.isArray(index?.manifests) ? index.manifests : null;
  if (!entries) throw new Error('image index did not contain a manifests array');
  const wanted = {
    os: platform.os ?? DEFAULT_PLATFORM.os,
    architecture: platform.architecture ?? platform.arch ?? DEFAULT_PLATFORM.architecture,
  };
  const match = entries.find(entry => {
    const entryPlatform = entry?.platform;
    if (!entryPlatform) return false;
    if (entryPlatform.os !== wanted.os) return false;
    return (entryPlatform.architecture ?? entryPlatform.arch) === wanted.architecture;
  });
  if (!match || !match.digest) {
    const seen = entries
      .filter(entry => entry?.platform)
      .map(entry => `${entry.platform.os}/${entry.platform.architecture ?? entry.platform.arch}`)
      .join(', ');
    throw new Error(`no ${wanted.os}/${wanted.architecture} manifest in image index (saw: ${seen || 'none'})`);
  }
  return match.digest;
}

// The pinned upstream Dockerfile fixes ENV NODE_OPTIONS=--max-old-space-size=1536,
// which OOM-killed `pnpm run build` (exit 134) on a 2026-11 GitHub runner. An ARG
// with the same name as an existing ENV is shadowed by that ENV, so the override
// must replace the ENV line itself using a distinctly named ARG.
export function patchDockerfileForMemory(source, nodeOptions = DEFAULT_BUILD_NODE_OPTIONS) {
  const marker = 'ENV NODE_OPTIONS=--max-old-space-size=1536';
  if (!source.includes(marker)) {
    throw new Error('upstream Dockerfile no longer contains the NODE_OPTIONS marker; review the memory mitigation');
  }
  if (!/^--max-old-space-size=\d+$/.test(nodeOptions)) throw new Error(`invalid node options: ${nodeOptions}`);
  if (source.includes('ARG CSHELL_BUILD_NODE_OPTIONS=')) {
    throw new Error('upstream Dockerfile already defines CSHELL_BUILD_NODE_OPTIONS; review the memory mitigation');
  }
  return source.replace(
    marker,
    `ARG CSHELL_BUILD_NODE_OPTIONS=${nodeOptions}\nENV NODE_OPTIONS=\${CSHELL_BUILD_NODE_OPTIONS}`,
  );
}

export function buildCommand({ engine, dockerfile, context, tag, nodeOptions = DEFAULT_BUILD_NODE_OPTIONS }) {
  return [
    engine,
    'build',
    '--pull=false',
    '--file',
    dockerfile,
    '--tag',
    tag,
    '--build-arg',
    `CSHELL_BUILD_NODE_OPTIONS=${nodeOptions}`,
    context,
  ];
}

export function baselineImageTag(commit) {
  if (!/^[0-9a-f]{40}$/.test(String(commit || ''))) throw new Error(`invalid baseline commit: ${commit}`);
  return `cshell-ci-sub2api-baseline:${commit.slice(0, 12)}`;
}

export function buildSettingsPayload({ registrationEnabled }) {
  if (typeof registrationEnabled !== 'boolean') throw new Error('registrationEnabled must be a boolean');
  // Every field here is a value-typed field in UpdateSettingsRequest, so sending it
  // replaces the stored value while omitted fields keep their current value.
  return {
    registration_enabled: registrationEnabled,
    email_verify_enabled: false,
    registration_email_suffix_whitelist: [],
    registration_email_domain_quota_enabled: false,
    password_reset_enabled: false,
    invitation_code_enabled: false,
    promo_code_enabled: false,
    login_agreement_enabled: false,
    totp_enabled: false,
    smtp_host: '',
    smtp_port: 587,
    smtp_username: '',
    smtp_password: '',
    smtp_from_email: '',
    smtp_from_name: '',
    smtp_use_tls: false,
    turnstile_enabled: false,
    turnstile_site_key: '',
    turnstile_secret_key: '',
    tencent_captcha_enabled: false,
    tencent_captcha_app_id: '',
    tencent_captcha_app_secret_key: '',
    tencent_captcha_cloud_secret_id: '',
    tencent_captcha_cloud_secret_key: '',
    tencent_captcha_region: '',
    aliyun_captcha_enabled: false,
    aliyun_captcha_access_key_id: '',
    aliyun_captcha_access_key_secret: '',
    aliyun_captcha_scene_id: '',
    aliyun_captcha_prefix: '',
    aliyun_captcha_region: '',
  };
}

function log(message) {
  process.stderr.write(`[sub2api-ci] ${message}\n`);
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  return result.status === 0;
}

export function containerEngine(env = process.env) {
  const configured = String(env.CONTAINER_ENGINE || '').trim();
  if (configured) return configured;
  for (const candidate of ['docker', 'podman']) {
    if (commandExists(candidate)) return candidate;
  }
  throw new Error('no container engine available; set CONTAINER_ENGINE=docker or podman');
}

function runEngine(engine, args, { allowFailure = false, timeoutMs = 0, quiet = false } = {}) {
  const result = spawnSync(engine, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs || undefined,
  });
  if (result.error) throw new Error(`${engine} ${args[0]} failed: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(`${engine} ${args[0]} exited ${result.status}: ${sanitize(output).slice(0, 2000)}`);
  }
  if (!quiet) {
    for (const line of String(result.stderr || '').split('\n')) {
      if (line.trim()) log(line.trim());
    }
  }
  return result;
}

function engineVersion(engine) {
  const result = spawnSync(engine, ['--version'], { encoding: 'utf8' });
  return (result.stdout || result.stderr || '').trim() || 'unknown';
}

// Publish the upstream port on a random loopback port and ask the engine which one
// it picked. This avoids a race between a probed port and container startup.
function publishedPort(engine, name, containerPort) {
  const result = spawnSync(engine, ['port', name, `${containerPort}/tcp`], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const line = String(result.stdout || '').split('\n').map(value => value.trim()).filter(Boolean).pop();
  if (!line) return null;
  const match = line.match(/:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function sleep(ms) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}

const ACCEPT_MANIFEST = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(',');

async function resolveDigestViaRegistry() {
  const tokenResponse = await fetch(
    `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${REGISTRY_REPOSITORY}:pull`,
    { signal: AbortSignal.timeout(20_000) },
  );
  if (!tokenResponse.ok) throw new Error(`docker auth token request failed: HTTP ${tokenResponse.status}`);
  const { token } = await tokenResponse.json();
  if (!token) throw new Error('docker auth token response did not contain a token');

  const response = await fetch(`https://registry-1.docker.io/v2/${REGISTRY_REPOSITORY}/manifests/latest`, {
    headers: { authorization: `Bearer ${token}`, accept: ACCEPT_MANIFEST },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`registry manifest request failed: HTTP ${response.status}`);
  const indexDigest = response.headers.get('docker-content-digest');
  const body = await response.json();
  return {
    digest: pickPlatformDigest(body),
    indexDigest: indexDigest || undefined,
    platform: DEFAULT_PLATFORM,
    method: 'registry-api',
  };
}

function resolveDigestViaEngine(engine) {
  if (engine === 'docker') {
    const result = spawnSync(engine, ['buildx', 'imagetools', 'inspect', '--raw', LATEST_IMAGE_TAG], {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (result.status === 0 && result.stdout) {
      const body = JSON.parse(result.stdout);
      return { digest: pickPlatformDigest(body), indexDigest: undefined, platform: DEFAULT_PLATFORM, method: 'docker-buildx-imagetools' };
    }
  }
  const result = spawnSync(engine, ['manifest', 'inspect', LATEST_IMAGE_TAG], {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${engine} manifest inspect failed: ${sanitize(result.stderr || '').slice(0, 500)}`);
  }
  const body = JSON.parse(result.stdout);
  return { digest: pickPlatformDigest(body), indexDigest: undefined, platform: DEFAULT_PLATFORM, method: `${engine}-manifest-inspect` };
}

export async function resolveLatestDigest(engine) {
  const attempts = [];
  const strategies = [
    ['registry-api', () => resolveDigestViaRegistry()],
    ['engine', () => Promise.resolve(resolveDigestViaEngine(engine))],
  ];
  for (const [name, strategy] of strategies) {
    const started = Date.now();
    try {
      const result = await strategy();
      attempts.push({ strategy: name, ok: true, ms: Date.now() - started });
      return { ...result, tag: LATEST_IMAGE_TAG, attempts };
    } catch (error) {
      attempts.push({ strategy: name, ok: false, ms: Date.now() - started, error: sanitize(error.message) });
    }
  }
  throw new Error(`could not resolve ${LATEST_IMAGE_TAG}: ${attempts.map(a => `${a.strategy}: ${a.error}`).join('; ')}`);
}

async function cloneBaseline(commit, sourceDir) {
  const attempts = [];
  const fetchAttempts = 3;
  if (existsSync(join(sourceDir, '.git'))) {
    log(`reusing existing Sub2API checkout at ${sourceDir}`);
  } else {
    await mkdir(sourceDir, { recursive: true });
    let cloned = false;
    for (let attempt = 1; attempt <= fetchAttempts && !cloned; attempt += 1) {
      const started = Date.now();
      const result = spawnSync('git', ['clone', '--filter=blob:none', '--no-checkout', UPSTREAM_GIT_URL, sourceDir], {
        encoding: 'utf8',
        timeout: 300_000,
      });
      attempts.push({ step: 'clone', attempt, ok: result.status === 0, ms: Date.now() - started });
      cloned = result.status === 0;
      if (!cloned) log(`clone attempt ${attempt} failed: ${sanitize(result.stderr || '').slice(0, 300)}`);
    }
    if (!cloned) throw new Error(`git clone of ${UPSTREAM_GIT_URL} failed after ${fetchAttempts} attempts`);
  }

  let fetched = false;
  for (let attempt = 1; attempt <= fetchAttempts && !fetched; attempt += 1) {
    const started = Date.now();
    const result = spawnSync('git', ['-C', sourceDir, 'fetch', '--depth', '1', 'origin', commit], {
      encoding: 'utf8',
      timeout: 300_000,
    });
    attempts.push({ step: 'fetch', attempt, ok: result.status === 0, ms: Date.now() - started });
    fetched = result.status === 0;
    if (!fetched) log(`fetch attempt ${attempt} failed: ${sanitize(result.stderr || '').slice(0, 300)}`);
    else break;
  }
  if (!fetched) throw new Error(`git fetch of ${commit} failed after ${fetchAttempts} attempts`);

  const checkout = spawnSync('git', ['-C', sourceDir, 'checkout', '--detach', '--force', commit], { encoding: 'utf8' });
  if (checkout.status !== 0) throw new Error(`git checkout ${commit} failed: ${sanitize(checkout.stderr || '').slice(0, 500)}`);
  const head = spawnSync('git', ['-C', sourceDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const resolvedCommit = String(head.stdout || '').trim();
  if (resolvedCommit !== commit) throw new Error(`resolved commit ${resolvedCommit || '(empty)'} does not match pinned ${commit}`);
  return { commit: resolvedCommit, sourceDir, attempts };
}

async function buildBaselineImage({ engine, sourceDir, commit, nodeOptions, timings }) {
  const dockerfilePath = join(sourceDir, 'deploy', 'Dockerfile');
  const patchedPath = join(sourceDir, 'deploy', 'Dockerfile.cshell-ci');
  const original = await readFile(dockerfilePath, 'utf8');
  await writeFile(patchedPath, patchDockerfileForMemory(original, nodeOptions));
  const tag = baselineImageTag(commit);
  const started = Date.now();
  const [binary, ...args] = buildCommand({ engine, dockerfile: patchedPath, context: sourceDir, tag, nodeOptions });
  runEngine(binary, args, { timeoutMs: 30 * 60 * 1000 });
  timings.buildMs = Date.now() - started;
  return { tag, imageReference: tag, dockerfile: patchedPath, nodeOptions, buildMs: timings.buildMs };
}

async function waitForHealth(url, { timeoutMs = 180_000, intervalMs = 2_000 } = {}) {
  const started = Date.now();
  let attempts = 0;
  let lastStatus = 'unreachable';
  while (Date.now() - started < timeoutMs) {
    attempts += 1;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      lastStatus = `HTTP ${response.status}`;
      if (response.ok) return { ok: true, attempts, status: response.status, waitMs: Date.now() - started };
    } catch (error) {
      lastStatus = sanitize(error.message);
    }
    await sleep(intervalMs);
  }
  return { ok: false, attempts, status: lastStatus, waitMs: Date.now() - started };
}

function containerHealthy(engine, name) {
  const result = spawnSync(engine, ['inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', name], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return 'missing';
  return String(result.stdout || '').trim();
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// `rm --force` can return while the engine is still releasing the name, which then
// makes `run --name` fail with "name is already in use". Removing and then polling for
// absence keeps a fixed-name profile recreatable from any state.
export function removeContainer(engine, name) {
  runEngine(engine, ['rm', '--force', '--volumes', name], { allowFailure: true, quiet: true });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (containerHealthy(engine, name) === 'missing') return true;
    sleepSync(250);
  }
  return containerHealthy(engine, name) === 'missing';
}

async function waitForContainer(engine, name, { timeoutMs = 120_000, intervalMs = 2_000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = containerHealthy(engine, name);
    if (state === 'healthy') return { ok: true, state, waitMs: Date.now() - started };
    if (state === 'exited' || state === 'dead') return { ok: false, state, waitMs: Date.now() - started };
    await sleep(intervalMs);
  }
  return { ok: false, state: containerHealthy(engine, name), waitMs: Date.now() - started };
}

async function readManifestFile(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function defaultManifestPath(env = process.env) {
  if (env.RUNNER_TEMP) return join(env.RUNNER_TEMP, 'sub2api-manifest.json');
  return resolve('.sub2api-manifest.json');
}

async function writeManifest(path, manifest) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        options[key] = next;
        index += 1;
      } else {
        options[key] = true;
      }
    } else {
      options._.push(token);
    }
  }
  return options;
}

async function provision({
  engine,
  mode,
  names,
  dbPassword,
  adminEmail,
  adminPassword,
  jwtSecret,
  imageReference,
  timings,
  hostPort: requestedHostPort = null,
  persistDbData = false,
}) {
  const created = [];
  // A randomized suffix never collides, so a pre-existing network there means a stale
  // resource is in the way. A fixed local profile reuses the same names every run, so
  // any surviving containers from an earlier (possibly partial) start must go first or
  // `run --name` fails on the name conflict.
  for (const container of [names.upstream, names.redis, names.db]) {
    if (container && !removeContainer(engine, container)) {
      throw new Error(`could not free container name ${container}; remove it manually and retry`);
    }
  }
  // The DB password is supplied by the caller for a persisted local profile, so the
  // volume must survive restarts; an empty database is produced by `wipe-data`/`reset`.
  runEngine(engine, ['network', 'rm', '--force', names.network], { allowFailure: true, quiet: true });
  runEngine(engine, ['network', 'create', '--driver', 'bridge', names.network]);

  runEngine(engine, [
    'run', '--detach',
    '--name', names.db,
    '--network', names.network,
    '--network-alias', 'postgres',
    '--health-cmd', 'pg_isready -U sub2api -d sub2api',
    '--health-interval', '5s',
    '--health-timeout', '5s',
    '--health-retries', '30',
    '-e', 'POSTGRES_USER=sub2api',
    '-e', `POSTGRES_PASSWORD=${dbPassword}`,
    '-e', 'POSTGRES_DB=sub2api',
    ...(persistDbData && names.dbDataVolume
      ? ['--volume', `${names.dbDataVolume}:/var/lib/postgresql/data`]
      : ['--tmpfs', '/var/lib/postgresql/data:rw']),
    POSTGRES_IMAGE,
  ]);
  created.push(names.db);

  runEngine(engine, [
    'run', '--detach',
    '--name', names.redis,
    '--network', names.network,
    '--network-alias', 'redis',
    '--health-cmd', 'redis-cli ping',
    '--health-interval', '5s',
    '--health-timeout', '5s',
    '--health-retries', '30',
    REDIS_IMAGE,
  ]);
  created.push(names.redis);

  const dbHealth = await waitForContainer(engine, names.db);
  if (!dbHealth.ok) throw new Error(`postgres container did not become healthy (state: ${dbHealth.state})`);
  const redisHealth = await waitForContainer(engine, names.redis);
  if (!redisHealth.ok) throw new Error(`redis container did not become healthy (state: ${redisHealth.state})`);

  const publish = requestedHostPort
    ? `127.0.0.1:${validateHostPort(requestedHostPort)}:${UPSTREAM_INTERNAL_PORT}`
    : `127.0.0.1::${UPSTREAM_INTERNAL_PORT}`;
  runEngine(engine, [
    'run', '--detach',
    '--name', names.upstream,
    '--network', names.network,
    '--network-alias', 'sub2api',
    '--publish', publish,
    '--tmpfs', '/tmp',
    '--tmpfs', '/run',
    '--volume', `${names.dataVolume}:/app/data`,
    '-e', 'AUTO_SETUP=true',
    '-e', `SERVER_HOST=0.0.0.0`,
    '-e', `SERVER_PORT=${UPSTREAM_INTERNAL_PORT}`,
    '-e', 'SERVER_MODE=release',
    '-e', 'TZ=UTC',
    '-e', 'DATABASE_HOST=postgres',
    '-e', 'DATABASE_PORT=5432',
    '-e', 'DATABASE_USER=sub2api',
    '-e', `DATABASE_PASSWORD=${dbPassword}`,
    '-e', 'DATABASE_DBNAME=sub2api',
    '-e', 'DATABASE_SSLMODE=disable',
    '-e', 'REDIS_HOST=redis',
    '-e', 'REDIS_PORT=6379',
    '-e', 'REDIS_PASSWORD=',
    '-e', `ADMIN_EMAIL=${adminEmail}`,
    '-e', `ADMIN_PASSWORD=${adminPassword}`,
    '-e', `JWT_SECRET=${jwtSecret}`,
    imageReference,
  ]);
  created.push(names.upstream);

  const hostPort = publishedPort(engine, names.upstream, UPSTREAM_INTERNAL_PORT);
  if (!hostPort) throw new Error(`could not determine the published loopback port for ${names.upstream}`);
  const upstreamUrl = `http://127.0.0.1:${hostPort}`;
  const healthStarted = Date.now();
  const health = await waitForHealth(`${upstreamUrl}/health`);
  timings.healthMs = Date.now() - healthStarted;
  if (!health.ok) {
    const logs = spawnSync(engine, ['logs', '--tail', '200', names.upstream], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const tail = sanitize(`${logs.stdout || ''}\n${logs.stderr || ''}`).slice(-4000);
    throw new Error(`upstream did not become healthy at ${upstreamUrl}/health (last: ${health.status}, attempts: ${health.attempts})\n${tail}`);
  }
  return { created, health, upstreamUrl, hostPort };
}

async function commandResolve(options, env) {
  const mode = options.mode || env.SUB2API_MODE || 'baseline-source';
  const started = Date.now();
  if (mode === 'latest-image') {
    const engine = containerEngine(env);
    const resolved = await resolveLatestDigest(engine);
    return {
      mode,
      engine,
      platform: 'linux/amd64',
      tag: resolved.tag,
      digest: resolved.digest,
      indexDigest: resolved.indexDigest,
      imageReference: imageRefByDigest(LATEST_IMAGE_REPOSITORY, resolved.digest),
      method: resolved.method,
      attempts: resolved.attempts,
      timings: { resolveMs: Date.now() - started },
    };
  }
  if (mode !== 'baseline-source') throw new Error(`unknown mode: ${mode}`);
  const sourceDir = resolve(options['source-dir'] || env.SUB2API_SOURCE_DIR || join(env.RUNNER_TEMP || tmpdir(), 'sub2api-upstream'));
  const resolved = await cloneBaseline(BASELINE_COMMIT, sourceDir);
  return {
    mode,
    commit: resolved.commit,
    sourceDir: resolved.sourceDir,
    attempts: resolved.attempts,
    timings: { resolveMs: Date.now() - started },
  };
}

async function commandUp(options, env) {
  const totalStarted = Date.now();
  const mode = options.mode || env.SUB2API_MODE || 'baseline-source';
  if (mode !== 'baseline-source' && mode !== 'latest-image') throw new Error(`unknown mode: ${mode}`);
  const engine = containerEngine(env);
  const namesPrefix = options['names-prefix'] || env.SUB2API_NAMES_PREFIX;
  const suffix = namesPrefix ? 'fixed' : options.suffix || env.SUB2API_SUFFIX || uniqueSuffix(env);
  const names = namesPrefix ? fixedContainerNames(namesPrefix) : containerNames(suffix);
  const requestedHostPort = options['host-port'] || env.SUB2API_HOST_PORT;
  const persistDbData = options['persist-db'] === true || String(env.SUB2API_PERSIST_DB || '') === '1';
  const manifestPath = resolve(options.manifest || defaultManifestPath(env));
  const nodeOptions = options['node-options'] || env.SUB2API_BUILD_NODE_OPTIONS || DEFAULT_BUILD_NODE_OPTIONS;
  const adminEmail = options['admin-email'] || env.SUB2API_ADMIN_EMAIL || env.ADMIN_EMAIL;
  const adminPassword = options['admin-password'] || env.SUB2API_ADMIN_PASSWORD || env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) throw new Error('SUB2API_ADMIN_EMAIL and SUB2API_ADMIN_PASSWORD are required for up');

  const dbPassword = options['db-password'] || env.SUB2API_DB_PASSWORD || randomBytes(18).toString('base64url');
  const jwtSecret = options['jwt-secret'] || env.SUB2API_JWT_SECRET || randomBytes(32).toString('hex');
  const timings = { resolveMs: 0, buildMs: 0, provisionMs: 0, healthMs: 0 };

  // Written up-front so a failed run still leaves a manifest naming the containers
  // and image it was using; `down` and diagnostics can then work off it.
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    mode,
    platform: 'linux/amd64',
    engine,
    engineVersion: engineVersion(engine),
    suffix,
    namesPrefix: namesPrefix || null,
    persistDbData,
    names,
    network: names.network,
    dataVolume: names.dataVolume,
    hostPort: null,
    upstreamUrl: null,
    imageReference: null,
    resolved: null,
    health: null,
    attempts: {},
    timings,
    status: 'provisioning',
    createdAt: new Date().toISOString(),
  };
  await writeManifest(manifestPath, manifest);

  let resolved;
  let imageReference;
  let attempts = {};
  const resolveStarted = Date.now();
  if (mode === 'baseline-source') {
    const sourceDir = resolve(options['source-dir'] || env.SUB2API_SOURCE_DIR || join(env.RUNNER_TEMP || tmpdir(), 'sub2api-upstream'));
    const baseline = await cloneBaseline(BASELINE_COMMIT, sourceDir);
    attempts.clone = baseline.attempts;
    const build = await buildBaselineImage({ engine, sourceDir: baseline.sourceDir, commit: baseline.commit, nodeOptions, timings });
    imageReference = build.imageReference;
    resolved = {
      commit: baseline.commit,
      dockerfile: build.dockerfile,
      nodeOptions: build.nodeOptions,
    };
  } else {
    const latest = await resolveLatestDigest(engine);
    imageReference = imageRefByDigest(LATEST_IMAGE_REPOSITORY, latest.digest);
    resolved = {
      tag: latest.tag,
      digest: latest.digest,
      indexDigest: latest.indexDigest,
      method: latest.method,
      attempts: latest.attempts,
    };
  }
  timings.resolveMs = Date.now() - resolveStarted - timings.buildMs;
  Object.assign(manifest, { imageReference, resolved, attempts, status: 'provisioning' });
  await writeManifest(manifestPath, manifest);

  const provisionStarted = Date.now();
  let provisioned;
  try {
    provisioned = await provision({
      engine,
      mode,
      names,
      dbPassword,
      adminEmail,
      adminPassword,
      jwtSecret,
      imageReference,
      timings,
      hostPort: requestedHostPort,
      persistDbData,
    });
  } catch (error) {
    timings.provisionMs = Date.now() - provisionStarted;
    // Do not leak a half-built network or warm containers when provisioning fails;
    // the manifest is still on disk with status=failed for post-mortem inspection.
    Object.assign(manifest, {
      timings: { ...timings, totalMs: Date.now() - totalStarted },
      status: 'failed',
      error: sanitize(error?.message || String(error)),
    });
    await writeManifest(manifestPath, manifest);
    await cleanupResources(engine, names);
    throw error;
  }
  timings.provisionMs = Date.now() - provisionStarted;

  Object.assign(manifest, {
    hostPort: provisioned.hostPort,
    upstreamUrl: provisioned.upstreamUrl,
    health: provisioned.health,
    timings: { ...timings, totalMs: Date.now() - totalStarted },
    status: 'ready',
  });
  await writeManifest(manifestPath, manifest);
  return { ...manifest, manifestPath };
}

async function cleanupResources(engine, names, { keepData = false } = {}) {
  const removed = [];
  for (const container of [names.upstream, names.redis, names.db]) {
    if (!container) continue;
    const result = runEngine(engine, ['rm', '--force', '--volumes', container], { allowFailure: true, quiet: true });
    removed.push({ container, removed: result.status === 0 });
  }
  let dataVolumeRemoved = false;
  if (names.dataVolume && !keepData) {
    const result = runEngine(engine, ['volume', 'rm', '--force', names.dataVolume], { allowFailure: true, quiet: true });
    dataVolumeRemoved = result.status === 0;
  }
  // Both volumes are only dropped when the caller asks for a real wipe; a `down
  // --keep-data` restart must preserve the database or the next `up` cannot log in.
  const dbDataVolumeRemoved =
    names.dbDataVolume && !keepData
      ? runEngine(engine, ['volume', 'rm', '--force', names.dbDataVolume], { allowFailure: true, quiet: true }).status === 0
      : false;
  if (names.network) runEngine(engine, ['network', 'rm', '--force', names.network], { allowFailure: true, quiet: true });
  return { removed, dataVolumeRemoved, dbDataVolumeRemoved, dataVolumeKept: Boolean(names.dataVolume) && keepData };
}

async function commandDown(options, env) {
  const manifestPath = resolve(options.manifest || defaultManifestPath(env));
  const manifest = await readManifestFile(manifestPath);
  const engine = containerEngine(env);
  const namesPrefix = options['names-prefix'] || env.SUB2API_NAMES_PREFIX || manifest?.namesPrefix;
  const names = namesPrefix
    ? fixedContainerNames(namesPrefix)
    : manifest?.names || containerNames(options.suffix || uniqueSuffix(env));
  const keepData = options['keep-data'] === true || String(env.SUB2API_KEEP_DATA || '') === '1';
  const cleanup = await cleanupResources(engine, names, { keepData });
  return { engine, ...cleanup, network: names.network, dataVolume: names.dataVolume, keepData, manifestPath, mode: manifest?.mode || null };
}

// Remove the upstream data volume so a later `up` starts with an empty database.
// The containers and network are expected to be gone already; running this after a
// `down --keep-data` is the reset path.
async function commandWipeData(options, env) {
  const manifestPath = resolve(options.manifest || defaultManifestPath(env));
  const manifest = await readManifestFile(manifestPath);
  const engine = containerEngine(env);
  const namesPrefix = options['names-prefix'] || env.SUB2API_NAMES_PREFIX || manifest?.namesPrefix;
  const names = namesPrefix
    ? fixedContainerNames(namesPrefix)
    : manifest?.names || containerNames(options.suffix || uniqueSuffix(env));
  if (!names.dataVolume) throw new Error('no data volume name could be resolved for wipe-data');
  const volumeResult = runEngine(engine, ['volume', 'rm', '--force', names.dataVolume], { allowFailure: true, quiet: true });
  // A persisted local profile also has a database volume; wiping only the upstream
  // data volume would leave a stale schema/credentials behind.
  const dbVolumeResult = names.dbDataVolume
    ? runEngine(engine, ['volume', 'rm', '--force', names.dbDataVolume], { allowFailure: true, quiet: true })
    : null;
  return {
    engine,
    dataVolume: names.dataVolume,
    removed: volumeResult.status === 0,
    dbDataVolume: names.dbDataVolume ?? null,
    dbDataVolumeRemoved: dbVolumeResult ? dbVolumeResult.status === 0 : false,
    manifestPath,
  };
}

async function commandManifest(options, env) {
  const manifestPath = resolve(options.manifest || defaultManifestPath(env));
  const manifest = await readManifestFile(manifestPath);
  if (!manifest) throw new Error(`manifest not found at ${manifestPath}`);
  return { ...manifest, manifestPath };
}

async function adminRequest(baseUrl, path, { method = 'GET', token, body } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

function envelopeData(result) {
  return result.body?.data ?? null;
}

async function commandConfigure(options, env) {
  const started = Date.now();
  const manifestPath = resolve(options.manifest || defaultManifestPath(env));
  const manifest = await readManifestFile(manifestPath);
  const baseUrl = String(options['upstream-url'] || env.SUB2API_UPSTREAM || manifest?.upstreamUrl || '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('upstream URL unknown; pass --upstream-url or run up first');
  const adminEmail = options['admin-email'] || env.SUB2API_ADMIN_EMAIL || env.ADMIN_EMAIL;
  const adminPassword = options['admin-password'] || env.SUB2API_ADMIN_PASSWORD || env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) throw new Error('SUB2API_ADMIN_EMAIL and SUB2API_ADMIN_PASSWORD are required for configure');
  const registrationEnabled = String(options['registration-enabled'] ?? env.CI_REGISTRATION_ENABLED ?? 'true') === 'true';

  const checks = [];
  const fail = message => {
    throw new Error(`${message} (upstream: ${sanitize(baseUrl)})`);
  };

  const login = await adminRequest(baseUrl, '/api/v1/auth/login', {
    method: 'POST',
    body: { email: adminEmail, password: adminPassword },
  });
  if (login.status >= 400 || login.body?.code !== 0) {
    fail(`admin login failed: HTTP ${login.status} code ${login.body?.code} message ${sanitize(login.body?.message || '')}`);
  }
  const adminToken = envelopeData(login)?.access_token;
  if (typeof adminToken !== 'string' || adminToken.length < 20) fail('admin login did not return an access_token');
  checks.push({ check: 'admin-login', ok: true });

  const compliance = await adminRequest(baseUrl, '/api/v1/admin/compliance', { token: adminToken });
  if (compliance.status >= 400) fail(`admin compliance status failed: HTTP ${compliance.status}`);
  const complianceData = envelopeData(compliance);
  if (complianceData?.required === true) {    const phrase = complianceData.ack_phrase_en || complianceData.ack_phrase_zh;
    if (!phrase) fail('admin compliance required but no acknowledgement phrase was returned');
    const accepted = await adminRequest(baseUrl, '/api/v1/admin/compliance/accept', {
      method: 'POST',
      token: adminToken,
      body: { phrase, language: complianceData.ack_phrase_en ? 'en' : 'zh' },
    });
    if (accepted.status >= 400 || accepted.body?.code !== 0) {
      fail(`admin compliance acknowledgement failed: HTTP ${accepted.status} message ${sanitize(accepted.body?.message || '')}`);
    }
    const reread = await adminRequest(baseUrl, '/api/v1/admin/compliance', { token: adminToken });
    if (reread.status >= 400 || envelopeData(reread)?.required !== false) fail('admin compliance acknowledgement did not persist');
    checks.push({ check: 'admin-compliance', ok: true });
  } else {
    checks.push({ check: 'admin-compliance', ok: true, alreadyAcknowledged: true });
  }

  const before = await adminRequest(baseUrl, '/api/v1/admin/settings', { token: adminToken });
  if (before.status >= 400 || before.body?.code !== 0) fail(`reading admin settings failed: HTTP ${before.status}`);
  const beforeData = envelopeData(before) || {};
  checks.push({
    check: 'settings-read',
    ok: true,
    registrationEnabled: beforeData.registration_enabled === true,
    emailVerifyEnabled: beforeData.email_verify_enabled === true,
  });

  const payload = buildSettingsPayload({ registrationEnabled });
  const update = await adminRequest(baseUrl, '/api/v1/admin/settings', { method: 'PUT', token: adminToken, body: payload });
  if (update.status >= 400 || update.body?.code !== 0) {
    fail(`updating admin settings failed: HTTP ${update.status} message ${sanitize(update.body?.message || '')}`);
  }

  const after = await adminRequest(baseUrl, '/api/v1/admin/settings', { token: adminToken });
  if (after.status >= 400 || after.body?.code !== 0) fail(`re-reading admin settings failed: HTTP ${after.status}`);
  const afterData = envelopeData(after) || {};
  const expectations = {
    registration_enabled: registrationEnabled,
    email_verify_enabled: false,
    turnstile_enabled: false,
    tencent_captcha_enabled: false,
    aliyun_captcha_enabled: false,
    smtp_host: '',
    invitation_code_enabled: false,
    login_agreement_enabled: false,
  };
  for (const [field, expected] of Object.entries(expectations)) {
    if (!(field in afterData)) fail(`admin settings read-back did not expose required field ${field}; cannot prove CI configuration`);
    if (afterData[field] !== expected) {
      fail(`admin settings field ${field} is ${JSON.stringify(afterData[field])} after update, expected ${JSON.stringify(expected)}`);
    }
  }
  checks.push({ check: 'settings-update-verified', ok: true, registrationEnabled });

  const publicSettings = await adminRequest(baseUrl, '/api/v1/settings/public');
  if (publicSettings.status >= 400 || publicSettings.body?.code !== 0) fail(`public settings failed: HTTP ${publicSettings.status}`);
  const publicData = envelopeData(publicSettings) || {};
  if (publicData.registration_enabled !== registrationEnabled) {
    fail(`public registration_enabled is ${JSON.stringify(publicData.registration_enabled)}, expected ${registrationEnabled}`);
  }
  if (publicData.email_verify_enabled !== false) fail('public email_verify_enabled is still enabled');
  if (publicData.turnstile_enabled === true || publicData.tencent_captcha_enabled === true || publicData.aliyun_captcha_enabled === true) {
    fail('public settings report an enabled captcha provider');
  }
  checks.push({ check: 'public-settings-verified', ok: true, paymentEnabled: publicData.payment_enabled === true });

  const paymentConfig = await adminRequest(baseUrl, '/api/v1/admin/payment/config', { token: adminToken });
  if (paymentConfig.status >= 400 || paymentConfig.body?.code !== 0) {
    fail(`reading admin payment config failed: HTTP ${paymentConfig.status}; the real admin API is required to prove payment is disabled`);
  }
  let paymentData = envelopeData(paymentConfig) || {};
  if (paymentData.enabled === true) {
    const disabled = await adminRequest(baseUrl, '/api/v1/admin/payment/config', {
      method: 'PUT',
      token: adminToken,
      body: { enabled: false },
    });
    if (disabled.status >= 400 || disabled.body?.code !== 0) {
      fail(`disabling payment failed: HTTP ${disabled.status} message ${sanitize(disabled.body?.message || '')}`);
    }
    const rereadPayment = await adminRequest(baseUrl, '/api/v1/admin/payment/config', { token: adminToken });
    paymentData = envelopeData(rereadPayment) || {};
    if (paymentData.enabled === true) fail('payment is still enabled after the update');
    checks.push({ check: 'payment-disabled', ok: true, changed: true });
  } else {
    checks.push({ check: 'payment-disabled', ok: true, changed: false });
  }

  const providers = await adminRequest(baseUrl, '/api/v1/admin/payment/providers', { token: adminToken });
  if (providers.status >= 400 || providers.body?.code !== 0) {
    fail(`listing admin payment providers failed: HTTP ${providers.status}; cannot prove no provider is configured`);
  }
  const providerList = envelopeData(providers);
  if (!Array.isArray(providerList)) fail('admin payment providers response was not an array');
  if (providerList.length > 0) {
    const ids = providerList.map(item => item?.id ?? item?.provider_key ?? 'unknown').map(String).join(',');
    fail(`unexpected pre-configured payment providers present (ids: ${ids}); refusing to run payment checks against them`);
  }
  checks.push({ check: 'payment-providers-empty', ok: true });

  return {
    upstreamUrl: baseUrl,
    registrationEnabled,
    checks,
    timings: { configureMs: Date.now() - started },
    manifestPath,
  };
}

const COMMANDS = {
  resolve: commandResolve,
  up: commandUp,
  down: commandDown,
  manifest: commandManifest,
  configure: commandConfigure,
  'wipe-data': commandWipeData,
};

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  const command = options._[0];
  const handler = COMMANDS[command];
  if (!handler) throw new Error(`unknown command ${command || '(none)'}; expected one of ${Object.keys(COMMANDS).join(', ')}`);
  const result = await handler(options, env);
  process.stdout.write(`${JSON.stringify(sanitize(result))}\n`);
  return result;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch(error => {
    process.stderr.write(`[sub2api-ci] error: ${sanitize(error?.message || String(error))}\n`);
    process.exitCode = 1;
  });
}
