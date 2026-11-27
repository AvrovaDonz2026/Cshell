#!/usr/bin/env node
// Local functional-testing loop against a REAL Sub2API backend.
//
// This script is the only local functional UI workflow: it provisions a real
// Sub2API backend and drives the shared harness
// (`scripts/sub2api-ci-upstream.mjs`) with a STABLE local profile so `status`, `stop`
// and `reset` work from a fresh process.
//
//   start   provision (or reuse) the real upstream, build, launch Cshell, verify login
//   stop    kill the Cshell process and tear down containers/network (data kept)
//   status  report every piece; exits non-zero when the loop is not running
//   logs    tail the last N lines of both logs, sanitized
//   reset   stop + wipe the upstream data volume for a clean registration state
//
// Ports are loopback-only: Cshell 127.0.0.1:18080, upstream 127.0.0.1:18081.
// State (including the generated admin/test credentials) lives in artifacts/local-real/.

import { spawn, spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { chmod, mkdir, open, readFile, readdir, rename, stat } from 'node:fs/promises';
import { readFileSync as fsReadFileSync, readlinkSync as fsReadlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { containerEngine, sanitize, fixedContainerNames, UPSTREAM_INTERNAL_PORT } from './sub2api-ci-upstream.mjs';

export const STATE_SCHEMA_VERSION = 1;
export const PROFILE_NAME = 'local-real';
export const NAME_PREFIX = 'cshell-local-';
export const DEFAULT_PORTS = { cshell: 18080, upstream: 18081 };
export const LOOPBACK = '127.0.0.1';
export const DEFAULT_LOG_LINES = 80;
/** CI-style, deliberately non-production credentials. Never used outside this host. */
export const DEFAULT_TEST_EMAIL = 'cshell-local-user@example.invalid';
export const DEFAULT_TEST_PASSWORD = 'CshellLocal-only-password-123';
export const DEFAULT_ADMIN_EMAIL = 'cshell-local-admin@example.invalid';
const LOCAL_MODE_DEFAULT = 'latest-image';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(scriptDir, '..');
export const HARNESS_SCRIPT = path.join(scriptDir, 'sub2api-ci-upstream.mjs');
export const STATE_DIR = path.join(REPO_ROOT, 'artifacts/local-real');
export const STATE_PATH = path.join(STATE_DIR, 'state.json');
export const MANIFEST_PATH = path.join(STATE_DIR, 'upstream-manifest.json');
export const CSHELL_LOG = path.join(STATE_DIR, 'cshell.log');
const CSHELL_BINARY = path.join(REPO_ROOT, 'target/debug/cshell');
const WEB_DIST = path.join(REPO_ROOT, 'web/dist');
const WEB_DIST_INDEX = path.join(WEB_DIST, 'index.html');

/* ------------------------------------------------------------ pure helpers */

export function localPorts(env = process.env) {
  const read = (key, fallback) => {
    const raw = env[key];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1024 || value > 65535) {
      throw new Error(`${key} must be an integer from 1024 to 65535, got ${JSON.stringify(raw)}`);
    }
    return value;
  };
  return assertDistinctPorts({
    cshell: read('CSHELL_LOCAL_CSHELL_PORT', DEFAULT_PORTS.cshell),
    upstream: read('CSHELL_LOCAL_UPSTREAM_PORT', DEFAULT_PORTS.upstream),
  });
}

export function assertDistinctPorts(ports) {
  if (ports.cshell === ports.upstream) {
    throw new Error(`the Cshell port and the upstream port must differ (both ${ports.cshell})`);
  }
  return ports;
}

/**
 * Decide whether this loop may bind/publish a port.
 *
 * Non-loopback is never allowed, and a
 * busy port is only acceptable when the recorded state proves this script owns it
 * (Cshell pid still alive, or the recorded upstream container's published port).
 */
export function evaluatePortGuard({
  role,
  port,
  state = null,
  listening = false,
  pidAlive = () => false,
}) {
  if (role !== 'cshell' && role !== 'upstream') {
    return { ok: false, reason: `unknown port role ${role}` };
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return { ok: false, reason: `port ${JSON.stringify(port)} is not a valid loopback host port` };
  }
  if (!listening) return { ok: true, reason: `port ${port} is free` };

  const recorded = state?.[role];
  if (role === 'cshell') {
    const pid = Number(recorded?.pid);
    if (state?.ports?.cshell === port && Number.isInteger(pid) && pid > 0 && pidAlive(pid)) {
      return { ok: true, reason: `port ${port} is owned by the recorded Cshell pid ${pid}` };
    }
    return {
      ok: false,
      reason: `port ${port} is already in use and no live recorded Cshell pid owns it; stop whatever holds it (or remove ${STATE_PATH})`,
    };
  }
  if (role === 'upstream') {
    if (state?.ports?.upstream === port && recorded?.hostPort === port && recorded?.container) {
      return { ok: true, reason: `port ${port} is published by the recorded container ${recorded.container}` };
    }
    return {
      ok: false,
      reason: `port ${port} is already in use and no recorded cshell-local container owns it`,
    };
  }
  return { ok: false, reason: `unknown port role ${role}` };
}

function sleep(ms) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}

/** True only when the pid exists; EPERM means it exists but belongs to another user. */
export function isProcessAlive(pid, kill = process.kill) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    kill(value, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/** A recorded pid that is gone (or was recycled by an unrelated process) is stale. */
export function stalePidDetection({ pid, alive = isProcessAlive, argv = null, executablePath = null, binaryPath = CSHELL_BINARY } = {}) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return { stale: true, reason: 'no pid recorded' };
  if (!alive(Number(pid))) return { stale: true, reason: `pid ${pid} is not running` };
  if (argv !== null) {
    const ownership = pidOwnsCshell({ argv, executablePath, binaryPath });
    if (!ownership.owned) return { stale: true, reason: `pid ${pid} is alive but ${ownership.reason}` };
  }
  return { stale: false, reason: `pid ${pid} is alive and runs the Cshell binary` };
}

/**
 * Prove a live pid is really the Cshell binary we launched.
 *
 * A substring match on "cshell" is not enough: another `node scripts/cshell-local-real.mjs`
 * invocation contains it too, and a recycled pid pointing at one would be killed by
 * `stop`. Only the exact executable path (or its resolved equivalent) counts.
 */
export function pidOwnsCshell({ argv, executablePath = null, binaryPath = CSHELL_BINARY } = {}) {
  const args = Array.isArray(argv) ? argv.filter(value => typeof value === 'string') : [];
  const executable = executablePath || args[0];
  if (typeof executable !== 'string' || executable.length === 0) return { owned: false, reason: 'cannot read the recorded pid executable' };
  const expected = path.resolve(binaryPath);
  const actual = path.resolve(executable);
  if (actual === expected) return { owned: true, reason: `pid runs ${expected}` };
  // A deleted/rebuilt binary can appear as "<path> (deleted)".
  if (actual.replace(/ \(deleted\)$/, '') === expected) {
    return { owned: true, reason: `pid runs ${expected} (rebuilt on disk since launch)` };
  }
  return { owned: false, reason: `pid runs ${executable}, not ${expected} (pid was reused)` };
}

export function readPidExecutable(pid, readlinkSync = fsReadlinkSync) {
  try {
    return readlinkSync(`/proc/${pid}/exe`);
  } catch {
    return null;
  }
}

export function readPidArgv(pid, readFileSync = fsReadFileSync) {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    return String(raw).split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

export function emptyState(ports = DEFAULT_PORTS) {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    profile: PROFILE_NAME,
    prefix: NAME_PREFIX,
    ports: { cshell: ports.cshell, upstream: ports.upstream },
    admin: { email: null, password: null },
    test: { email: DEFAULT_TEST_EMAIL, password: DEFAULT_TEST_PASSWORD },
    // Secrets the harness needs to keep a persistent database and stable sessions
    // across restarts. Persisted in the 0600 state file, never printed.
    secrets: { dbPassword: null, jwtSecret: null },
    cshell: { pid: null, startedAt: null, log: CSHELL_LOG, url: null },
    upstream: { container: null, hostPort: null, upstreamUrl: null, mode: null, imageReference: null, configuredAt: null },
    builtAt: null,
    updatedAt: null,
  };
}

/** Parse + normalize a state document. Unknown/partial files still yield a usable shape. */
export function parseState(text, ports = DEFAULT_PORTS) {
  const base = emptyState(ports);
  if (!text) return base;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`state file is not valid JSON: ${STATE_PATH}`);
  }
  if (raw.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new Error(`unsupported state schema ${JSON.stringify(raw.schemaVersion)} in ${STATE_PATH}`);
  }
  if (raw.profile !== PROFILE_NAME) {
    throw new Error(`state file belongs to profile ${JSON.stringify(raw.profile)}, expected ${PROFILE_NAME}`);
  }
  return {
    ...base,
    ...raw,
    ports: { ...base.ports, ...(raw.ports || {}) },
    admin: { ...base.admin, ...(raw.admin || {}) },
    test: { ...base.test, ...(raw.test || {}) },
    secrets: { ...base.secrets, ...(raw.secrets || {}) },
    cshell: { ...base.cshell, ...(raw.cshell || {}) },
    upstream: { ...base.upstream, ...(raw.upstream || {}) },
  };
}

export function formatState(state) {
  return `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`;
}

export function secretValuesFor(state, env = process.env) {
  return [
    state?.admin?.password,
    state?.test?.password,
    state?.secrets?.dbPassword,
    state?.secrets?.jwtSecret,
    env.SUB2API_ADMIN_PASSWORD,
    env.SUB2API_TEST_PASSWORD,
  ].filter(value => typeof value === 'string' && value.length >= 4);
}

/**
 * Render the `status` document. Credentials are never included: only the test
 * account email and the admin email are exposed, and every string is sanitized.
 */
export function renderStatus(model) {
  const report = {
    profile: PROFILE_NAME,
    running: Boolean(model.running),
    url: model.url ?? null,
    ports: model.ports,
    upstream: {
      container: model.upstream?.container ?? null,
      state: model.upstream?.state ?? 'unknown',
      healthy: Boolean(model.upstream?.healthy),
      url: model.upstream?.upstreamUrl ?? null,
      mode: model.upstream?.mode ?? null,
      registrationEnabled: model.upstream?.registrationEnabled ?? null,
    },
    cshell: {
      pid: model.cshell?.pid ?? null,
      alive: Boolean(model.cshell?.alive),
      healthy: Boolean(model.cshell?.healthy),
      log: CSHELL_LOG,
    },
    accounts: {
      testEmail: model.state?.test?.email ?? null,
      adminEmail: model.state?.admin?.email ?? null,
      passwords: '[REDACTED] — printed only by `start`',
    },
    stateFile: STATE_PATH,
    details: model.details ?? [],
  };
  return JSON.stringify(sanitize(report, secretValuesFor(model.state)), null, 2);
}

export function expiryHint() {
  return 'Local only. Credentials are generated per machine and stored in artifacts/local-real/state.json (mode 0600).';
}

/** True when the built asset is missing or older than any tracked input. */
export function isBuildStale({ outputMtime, inputMtimes }) {
  if (!outputMtime) return true;
  if (!Array.isArray(inputMtimes) || inputMtimes.length === 0) return false;
  return inputMtimes.some(mtime => mtime > outputMtime);
}

/* ------------------------------------------------------------------- io/fs */

async function readStateFile(ports = DEFAULT_PORTS) {
  try {
    return parseState(await readFile(STATE_PATH, 'utf8'), ports);
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyState(ports);
    throw error;
  }
}

async function writeStateFile(state) {
  await mkdir(STATE_DIR, { recursive: true });
  const tmp = `${STATE_PATH}.${process.pid}.tmp`;
  const handle = await open(tmp, 'w', 0o600);
  try {
    await handle.writeFile(formatState(state));
  } finally {
    await handle.close();
  }
  await rename(tmp, STATE_PATH);
  await chmod(STATE_PATH, 0o600).catch(() => {});
}

function sh(command, args, { env = process.env, allowFailure = false, echo = true } = {}) {
  if (echo) process.stderr.write(`[cshell-local] $ ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, { encoding: 'utf8', env, maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw new Error(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) {
    const output = sanitize(`${result.stdout || ''}\n${result.stderr || ''}`.trim()).slice(-3000);
    throw new Error(`${command} ${args[0] || ''} exited ${result.status}\n${output}`);
  }
  return result;
}

/** Run the shared harness. Its stdout stays machine-readable JSON. */
function harness(args, { env = process.env, label = 'harness' } = {}) {
  const result = sh(process.execPath, [HARNESS_SCRIPT, ...args], { env });
  const line = String(result.stdout || '')
    .split('\n')
    .map(value => value.trim())
    .filter(Boolean)
    .pop();
  if (!line) throw new Error(`${label}: harness printed no JSON result`);
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`${label}: harness output was not JSON (${sanitize(line).slice(0, 300)})`);
  }
}

function engineFor(env = process.env) {
  const engine = containerEngine(env);
  return engine;
}

function containerState(engine, name) {
  const result = spawnSync(
    engine,
    ['inspect', '--format', '{{.State.Status}}', name],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) return 'missing';
  return String(result.stdout || '').trim() || 'unknown';
}

function containerPorts(engine, name, containerPort) {
  const result = spawnSync(engine, ['port', name, `${containerPort}/tcp`], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  return String(result.stdout || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function containerLogs(engine, name, lines) {
  const result = spawnSync(engine, ['logs', '--tail', String(lines), name], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) return '';
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function portOpen(port, timeoutMs = 400) {
  return new Promise(resolve => {
    const socket = connect({ host: LOOPBACK, port });
    const done = value => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitForHttp(url, { timeoutMs = 120_000, intervalMs = 1_000 } = {}) {
  const started = Date.now();
  let last = 'unreachable';
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(4_000) });
      if (response.ok) return { ok: true, status: response.status, waitMs: Date.now() - started };
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = sanitize(error?.message || String(error));
    }
    await sleep(intervalMs);
  }
  return { ok: false, status: last, waitMs: Date.now() - started };
}

async function newestMtime(rootPaths) {
  let newest = 0;
  const walk = async target => {
    let info;
    try {
      info = await stat(target);
    } catch {
      return;
    }
    if (info.isDirectory()) {
      for (const entry of await readdir(target)) {
        if (entry === 'node_modules' || entry === 'dist' || entry === 'dist-preview') continue;
        await walk(path.join(target, entry));
      }
      return;
    }
    newest = Math.max(newest, info.mtimeMs);
  };
  for (const target of rootPaths) await walk(target);
  return newest;
}

async function mtimeOrZero(target) {
  try {
    return (await stat(target)).mtimeMs;
  } catch {
    return 0;
  }
}

/* ----------------------------------------------------------- backend steps */

function generatePassword() {
  return `CshellLocal-${randomBytes(12).toString('base64url')}`;
}

async function ensureCredentials(state) {
  let changed = false;
  let adminPasswordGenerated = false;
  if (!state.admin.email) {
    state.admin.email = DEFAULT_ADMIN_EMAIL;
    changed = true;
  }
  if (!state.admin.password) {
    state.admin.password = generatePassword();
    changed = true;
    // A persisted PostgreSQL volume would still hold the *previous* admin record, so a
    // freshly generated password can only work against an empty database.
    adminPasswordGenerated = true;
  }
  if (!state.test.email) {
    state.test.email = DEFAULT_TEST_EMAIL;
    changed = true;
  }
  if (!state.test.password) {
    state.test.password = DEFAULT_TEST_PASSWORD;
    changed = true;
  }
  const names = fixedContainerNames(NAME_PREFIX);
  if (state.upstream.container !== names.upstream) {
    state.upstream.container = names.upstream;
    changed = true;
  }
  if (!state.secrets.dbPassword) {
    state.secrets.dbPassword = randomBytes(18).toString('base64url');
    changed = true;
  }
  if (!state.secrets.jwtSecret) {
    state.secrets.jwtSecret = randomBytes(32).toString('hex');
    changed = true;
  }
  if (changed) await writeStateFile(state);
  return { state, adminPasswordGenerated };
}

function harnessEnv(state, env = process.env) {
  return {
    ...env,
    // The harness sanitizes its own output from these values.
    SUB2API_ADMIN_EMAIL: state.admin.email,
    SUB2API_ADMIN_PASSWORD: state.admin.password,
    SUB2API_TEST_PASSWORD: state.test.password,
    // Stable across restarts so a persisted database and issued sessions stay valid.
    SUB2API_DB_PASSWORD: state.secrets.dbPassword,
    SUB2API_JWT_SECRET: state.secrets.jwtSecret,
    SUB2API_PERSIST_DB: '1',
  };
}

async function ensureUpstream(state, { engine, env, reuseAllowed }) {
  const names = fixedContainerNames(NAME_PREFIX);
  const port = state.ports.upstream;
  const containerStatus = containerState(engine, names.upstream);
  const published = containerPorts(engine, names.upstream, UPSTREAM_INTERNAL_PORT);

  if (reuseAllowed && containerStatus === 'running') {
    const ownsPort = published.some(line => line.endsWith(`:${port}`));
    if (!ownsPort) {
      throw new Error(
        `container ${names.upstream} is running but does not publish 127.0.0.1:${port} (found: ${published.join(', ') || 'none'}); run reset`,
      );
    }
    // A container can survive from an earlier attempt that used different credentials
    // or a throwaway database. Reusing it blindly would hand out a dead login, so prove
    // the persisted admin credentials actually work before accepting it.
    const upstreamUrl = `http://${LOOPBACK}:${port}`;
    if (await adminLoginWorks(upstreamUrl, state)) {
      process.stderr.write(`[cshell-local] reusing running upstream container ${names.upstream}\n`);
      state.upstream = {
        ...state.upstream,
        container: names.upstream,
        hostPort: port,
        upstreamUrl,
      };
      await writeStateFile(state);
      return { reused: true };
    }
    process.stderr.write(
      `[cshell-local] upstream container ${names.upstream} is running but rejected the stored admin credentials; reprovisioning\n`,
    );
    harness(['down', '--names-prefix', NAME_PREFIX, '--manifest', MANIFEST_PATH, '--keep-data'], {
      env: harnessEnv(state, env),
      label: 'down-stale-upstream',
    });
  } else if (containerStatus !== 'missing') {
    process.stderr.write(`[cshell-local] upstream container ${names.upstream} is ${containerStatus}; tearing it down first\n`);
    harness(['down', '--names-prefix', NAME_PREFIX, '--manifest', MANIFEST_PATH, '--keep-data'], {
      env: harnessEnv(state, env),
      label: 'down-before-up',
    });
  }

  const mode = env.CSHELL_LOCAL_SUB2API_MODE || LOCAL_MODE_DEFAULT;
  const result = harness(
    [
      'up',
      '--mode',
      mode,
      '--names-prefix',
      NAME_PREFIX,
      '--host-port',
      String(port),
      '--manifest',
      MANIFEST_PATH,
    ],
    { env: harnessEnv(state, env), label: 'up' },
  );
  if (result.status !== 'ready' || !result.upstreamUrl) {
    throw new Error(`upstream provisioning did not reach a ready state (status: ${result.status ?? 'unknown'})`);
  }
  state.upstream = {
    container: names.upstream,
    hostPort: port,
    upstreamUrl: result.upstreamUrl,
    mode,
    imageReference: result.imageReference ?? null,
    configuredAt: null,
  };
  await writeStateFile(state);
  return { reused: false };
}

async function adminLoginWorks(baseUrl, state) {
  try {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email: state.admin.email, password: state.admin.password }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => null);
    return response.ok && body?.code === 0 && typeof body?.data?.access_token === 'string';
  } catch {
    return false;
  }
}

async function configureUpstream(state, { env }) {
  let result;
  try {
    result = harness(
      [
        'configure',
        '--manifest',
        MANIFEST_PATH,
        '--upstream-url',
        state.upstream.upstreamUrl,
        '--registration-enabled',
        'true',
      ],
      { env: harnessEnv(state, env), label: 'configure' },
    );
  } catch (error) {
    const message = String(error?.message || error);
    if (/admin login failed/i.test(message)) {
      throw new Error(
        `${message}\nThe local profile persists its database, so a mismatch means the volume predates the ` +
          `credentials in ${STATE_PATH}. Run "node scripts/cshell-local-real.mjs reset" to start from a clean database.`,
      );
    }
    throw error;
  }
  const failedChecks = (result.checks || []).filter(check => check.ok !== true);
  if (failedChecks.length > 0) {
    throw new Error(`configure reported failing checks: ${failedChecks.map(check => check.check).join(', ')}`);
  }
  if (result.registrationEnabled !== true) {
    throw new Error('configure did not prove open registration; refusing to continue with a closed signup gate');
  }
  state.upstream.configuredAt = new Date().toISOString();
  await writeStateFile(state);
  return result;
}

async function ensureTestAccount(state) {
  const base = state.upstream.upstreamUrl;
  const email = state.test.email;
  const password = state.test.password;
  const post = (pathname, body) =>
    fetch(`${base}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });

  let registerStatus = 0;
  let registerBody = null;
  try {
    const response = await post('/api/v1/auth/register', { email, password });
    registerStatus = response.status;
    registerBody = await response.json().catch(() => null);
  } catch (error) {
    throw new Error(`registering the local test account failed: ${sanitize(error?.message || String(error))}`);
  }

  if (registerStatus < 400 && registerBody?.code === 0) {
    return { created: true, email };
  }

  // Already registered from a previous local run: prove the stored credentials still
  // work instead of assuming, so `start` never hands out a dead login.
  const login = await post('/api/v1/auth/login', { email, password });
  const loginBody = await login.json().catch(() => null);
  if (login.ok && loginBody?.code === 0 && typeof loginBody?.data?.access_token === 'string') {
    return { created: false, email };
  }
  throw new Error(
    `test account ${email} could not be registered (HTTP ${registerStatus}) or signed in (HTTP ${login.status}); ` +
      `run "node scripts/cshell-local-real.mjs reset" for a clean upstream database`,
  );
}

/* -------------------------------------------------------------- build/run */

async function ensureWebDist({ env }) {
  const inputs = [path.join(REPO_ROOT, 'web/src'), path.join(REPO_ROOT, 'web/index.html'), path.join(REPO_ROOT, 'web/package.json'), path.join(REPO_ROOT, 'web/vite.config.ts')];
  const output = await mtimeOrZero(WEB_DIST_INDEX);
  const newestInput = await newestMtime(inputs);
  if (!isBuildStale({ outputMtime: output, inputMtimes: [newestInput] })) {
    return { built: false };
  }
  process.stderr.write(`[cshell-local] building web/dist (${output ? 'stale' : 'missing'})\n`);
  sh('pnpm', ['--dir', 'web', 'build'], { env, echo: true });
  return { built: true };
}

async function ensureBinary({ env }) {
  const output = await mtimeOrZero(CSHELL_BINARY);
  const inputs = [
    path.join(REPO_ROOT, 'src'),
    path.join(REPO_ROOT, 'Cargo.toml'),
    path.join(REPO_ROOT, 'Cargo.lock'),
    path.join(REPO_ROOT, 'build.rs'),
  ];
  const newestInput = await newestMtime(inputs);
  if (!isBuildStale({ outputMtime: output, inputMtimes: [newestInput] })) {
    return { built: false };
  }
  process.stderr.write(`[cshell-local] building target/debug/cshell (${output ? 'stale' : 'missing'})\n`);
  sh('cargo', ['build', '--bin', 'cshell'], { env, echo: true });
  return { built: true };
}

async function cshellHealthy(url) {
  try {
    const response = await fetch(`${url}/_cshell/health`, { signal: AbortSignal.timeout(2_000) });
    return response.ok && /ok/i.test(await response.text());
  } catch {
    return false;
  }
}

async function upstreamHealthy(url) {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function verifyLogin({ baseUrl, email, password }) {
  const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(20_000),
  });
  const loginBody = await login.json().catch(() => null);
  if (!login.ok || loginBody?.code !== 0) {
    return { ok: false, step: 'login', status: login.status, code: loginBody?.code ?? null };
  }
  const token = loginBody?.data?.access_token;
  if (typeof token !== 'string' || token.length < 20) {
    return { ok: false, step: 'login-token', status: login.status, code: loginBody?.code ?? null };
  }
  const profile = await fetch(`${baseUrl}/api/v1/user/profile`, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const profileBody = await profile.json().catch(() => null);
  if (!profile.ok || profileBody?.code !== 0) {
    return { ok: false, step: 'profile', status: profile.status, code: profileBody?.code ?? null };
  }
  const profileEmail = profileBody?.data?.email ?? null;
  return { ok: profileEmail === email, step: 'profile-identity', status: profile.status, email: profileEmail };
}

async function startCshell(state, { ports }) {
  await mkdir(STATE_DIR, { recursive: true });
  const url = `http://${LOOPBACK}:${ports.cshell}`;
  const log = await open(CSHELL_LOG, 'a', 0o600);
  const child = spawn(CSHELL_BINARY, [], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ['ignore', log.fd, log.fd],
    env: {
      ...process.env,
      CSHELL_LISTEN: `${LOOPBACK}:${ports.cshell}`,
      CSHELL_STATIC_DIR: WEB_DIST,
      SUB2API_UPSTREAM: `http://${LOOPBACK}:${ports.upstream}`,
      CSHELL_PUBLIC_URL: url,
    },
  });
  child.unref();
  await log.close();
  state.cshell = { pid: child.pid, startedAt: new Date().toISOString(), log: CSHELL_LOG, url };
  await writeStateFile(state);
  return { pid: child.pid, url };
}

async function waitForCshell(state, { ports, timeoutMs = 60_000 }) {
  const url = `http://${LOOPBACK}:${ports.cshell}`;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await cshellHealthy(url)) return { ok: true, waitMs: Date.now() - started };
    const pid = state.cshell.pid;
    if (pid && !isProcessAlive(pid)) {
      return { ok: false, reason: `Cshell exited before readiness (pid ${pid}); see ${CSHELL_LOG}` };
    }
    await sleep(500);
  }
  return { ok: false, reason: `Cshell did not answer /_cshell/health within ${timeoutMs}ms; see ${CSHELL_LOG}` };
}

async function stopCshell(state, { ports }) {
  const pid = Number(state.cshell?.pid);
  const result = { pid: pid || null, killed: false, reason: 'no recorded pid' };
  if (!pid) return result;

  const ownership = stalePidDetection({
    pid,
    argv: readPidArgv(pid),
    executablePath: readPidExecutable(pid),
  });
  if (ownership.stale) return { ...result, reason: ownership.reason };

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    return { ...result, reason: `SIGTERM failed: ${error?.code || error}` };
  }
  const url = `http://${LOOPBACK}:${ports.cshell}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!isProcessAlive(pid) && !(await cshellHealthy(url))) return { ...result, killed: true, reason: 'SIGTERM' };
    await sleep(150);
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
  for (let attempt = 0; attempt < 40 && isProcessAlive(pid); attempt += 1) await sleep(150);
  return { ...result, killed: true, reason: 'SIGKILL after grace period' };
}

/* --------------------------------------------------------------- commands */

function fail(message) {
  process.stderr.write(`[cshell-local] error: ${sanitize(message)}\n`);
  process.exitCode = 1;
}

function printStartSummary({ state, ports, login, created }) {
  const url = `http://${LOOPBACK}:${ports.cshell}`;
  const lines = [
    '',
    'REAL Sub2API local loop is ready',
    `  Cshell URL       ${url}`,
    `  upstream (real)  ${state.upstream.upstreamUrl}  (${state.upstream.mode ?? 'unknown'} image)`,
    `  test account     ${state.test.email}`,
    `  test password    ${state.test.password}`,
    `  admin account    ${state.admin.email}`,
    `  admin password   ${state.admin.password}`,
    `  signup           open registration is configured; you can register a new account in the browser`,
    `  login verified   ${login.ok ? `yes (${login.email})` : `NO — ${login.step} HTTP ${login.status}`}`,
    `  test account     ${created ? 'created just now' : 'reused from a previous run'}`,
    `  logs             node scripts/cshell-local-real.mjs logs`,
    `  stop             node scripts/cshell-local-real.mjs stop`,
    `  reset (wipe db)  node scripts/cshell-local-real.mjs reset`,
    '',
    expiryHint(),
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function commandStart(env) {
  const ports = localPorts(env);
  let state = await readStateFile(ports);
  const credentials = await ensureCredentials(state);
  state = credentials.state;
  state.ports = { cshell: ports.cshell, upstream: ports.upstream };

  const engine = engineFor(env);

  // A password was generated for the first time, so any surviving database predates it.
  // Dropping it is the only way the recorded credentials can be authoritative.
  if (credentials.adminPasswordGenerated) {
    const volumeExists =
      spawnSync(engine, ['volume', 'exists', fixedContainerNames(NAME_PREFIX).dbDataVolume], { encoding: 'utf8' })
        .status === 0;
    if (volumeExists) {
      process.stderr.write(
        '[cshell-local] a fresh admin password was generated; dropping the stale upstream database so it matches\n',
      );
      // `down` without --keep-data removes the containers, both volumes and the network,
      // so `up` below starts from an empty database.
      harness(['down', '--names-prefix', NAME_PREFIX, '--manifest', MANIFEST_PATH], {
        env: harnessEnv(state, env),
        label: 'drop-stale-db',
      });
    }
  }

  for (const role of ['cshell', 'upstream']) {
    const listening = await portOpen(ports[role]);
    const verdict = evaluatePortGuard({
      role,
      port: ports[role],
      state,
      listening,
      pidAlive: isProcessAlive,
    });
    if (!verdict.ok) throw new Error(`port guard rejected ${role} port ${ports[role]}: ${verdict.reason}`);
  }

  // Already running and healthy: do not rebuild or reprovision, just report.
  if (await cshellHealthy(`http://${LOOPBACK}:${ports.cshell}`)) {
    const alive = isProcessAlive(state.cshell.pid);
    if (alive) {
      const login = await verifyLogin({
        baseUrl: `http://${LOOPBACK}:${ports.cshell}`,
        email: state.test.email,
        password: state.test.password,
      });
      printStartSummary({ state, ports, login, created: false });
      return { alreadyRunning: true, login };
    }
  }

  const upstream = await ensureUpstream(state, { engine, env, reuseAllowed: true });
  const health = await waitForHttp(`${state.upstream.upstreamUrl}/health`, { timeoutMs: 180_000 });
  if (!health.ok) {
    throw new Error(`upstream /health never became ready at ${state.upstream.upstreamUrl} (${health.status})`);
  }

  // Reconfigure on every start: a reused container could have been edited through the
  // admin UI, and a silently closed registration gate would break browser signup.
  const configureResult = await configureUpstream(state, { env });

  const account = await ensureTestAccount(state);

  const web = await ensureWebDist({ env });
  const binary = await ensureBinary({ env });

  const started = await startCshell(state, { ports });
  const ready = await waitForCshell(state, { ports });
  if (!ready.ok) throw new Error(ready.reason);

  const login = await verifyLogin({ baseUrl: started.url, email: state.test.email, password: state.test.password });
  printStartSummary({ state, ports, login, created: account.created });
  process.stdout.write(
    `${JSON.stringify(
      sanitize(
        {
          url: started.url,
          upstreamUrl: state.upstream.upstreamUrl,
          cshellPid: started.pid,
          loginVerified: login.ok,
          builtWeb: web.built,
          builtBinary: binary.built,
          registrationEnabled: configureResult.registrationEnabled,
          testAccountEmail: state.test.email,
        },
        secretValuesFor(state),
      ),
    )}\n`,
  );
  if (!login.ok) {
    throw new Error(
      `the real login proof failed at ${login.step} (HTTP ${login.status}); the app is up but records cannot be trusted`,
    );
  }
  return { login, started };
}

async function commandStop(env) {
  const ports = localPorts(env);
  const state = await readStateFile(ports);
  const engine = engineFor(env);
  const killed = await stopCshell(state, { ports });

  const names = fixedContainerNames(NAME_PREFIX);
  const before = {
    db: containerState(engine, names.db),
    redis: containerState(engine, names.redis),
    upstream: containerState(engine, names.upstream),
  };
  let down = null;
  try {
    down = harness(['down', '--names-prefix', NAME_PREFIX, '--manifest', MANIFEST_PATH, '--keep-data'], {
      env: harnessEnv(state, env),
      label: 'down',
    });
  } catch (error) {
    // A partial start may leave no manifest; the fixed names are still removed.
    process.stderr.write(`[cshell-local] harness down reported: ${sanitize(error.message)}\n`);
    harness(['down', '--names-prefix', NAME_PREFIX, '--keep-data'], { env: harnessEnv(state, env), label: 'down-fallback' });
  }

  const after = {
    db: containerState(engine, names.db),
    redis: containerState(engine, names.redis),
    upstream: containerState(engine, names.upstream),
  };
  const networkGone = spawnSync(engine, ['network', 'exists', names.network], { encoding: 'utf8' }).status !== 0;
  state.cshell = { ...state.cshell, pid: null, startedAt: null, url: null };
  state.upstream = { ...state.upstream, configuredAt: null };
  await writeStateFile(state);

  process.stdout.write(
    `${JSON.stringify({
      cshell: killed,
      containersBefore: before,
      containersAfter: after,
      dataVolumeKept: down?.dataVolumeKept ?? true,
      networkGone,
      containersGone: Object.values(after).every(value => value === 'missing'),
      note: 'upstream data volume is intentionally kept; use "reset" to wipe it',
    }, null, 2)}\n`,
  );
  if (!Object.values(after).every(value => value === 'missing')) {
    throw new Error('some cshell-local containers are still present after stop');
  }
  return { killed, after, networkGone };
}

async function commandStatus(env) {
  const ports = localPorts(env);
  const state = await readStateFile(ports);
  const engine = engineFor(env);
  const names = fixedContainerNames(NAME_PREFIX);
  const url = `http://${LOOPBACK}:${ports.cshell}`;

  const upstreamContainer = containerState(engine, names.upstream);
  const upstreamOk = await upstreamHealthy(`http://${LOOPBACK}:${ports.upstream}/health`);
  const cshellOk = await cshellHealthy(url);
  const cshellPid = Number(state.cshell?.pid) || null;
  const detection = cshellPid ? stalePidDetection({ pid: cshellPid, argv: readPidArgv(cshellPid), executablePath: readPidExecutable(cshellPid) }) : { stale: true, reason: 'no pid recorded' };

  let registrationEnabled = null;
  if (upstreamOk) {
    try {
      const response = await fetch(`http://${LOOPBACK}:${ports.upstream}/api/v1/settings/public`, {
        signal: AbortSignal.timeout(3_000),
      });
      const body = await response.json().catch(() => null);
      registrationEnabled = body?.data?.registration_enabled ?? null;
    } catch {
      registrationEnabled = null;
    }
  }

  const details = [];
  if (detection.stale) details.push(`cshell pid: ${detection.reason}`);
  if (upstreamContainer !== 'running') details.push(`upstream container ${names.upstream} is ${upstreamContainer}`);
  if (!upstreamOk) details.push(`upstream /health is not answering on ${ports.upstream}`);
  if (!cshellOk) details.push(`Cshell /_cshell/health is not answering on ${ports.cshell}`);

  const model = {
    running: upstreamOk && cshellOk,
    url,
    ports,
    state,
    upstream: {
      container: names.upstream,
      state: upstreamContainer,
      healthy: upstreamOk,
      upstreamUrl: `http://${LOOPBACK}:${ports.upstream}`,
      mode: state.upstream.mode,
      registrationEnabled,
    },
    cshell: { pid: cshellPid, alive: !detection.stale, healthy: cshellOk },
    details,
  };
  process.stdout.write(`${renderStatus(model)}\n`);
  if (!model.running) {
    process.exitCode = 1;
  }
  return model;
}

async function commandLogs(env) {
  const ports = localPorts(env);
  const state = await readStateFile(ports);
  const engine = engineFor(env);
  const lines = Number(env.CSHELL_LOCAL_LOG_LINES || DEFAULT_LOG_LINES);
  const names = fixedContainerNames(NAME_PREFIX);
  const secrets = secretValuesFor(state);

  const cshellTail = await readFile(CSHELL_LOG, 'utf8').catch(() => '');
  const cshellLines = cshellTail.split('\n').slice(-Math.max(1, lines)).join('\n');
  const upstreamTail = containerLogs(engine, names.upstream, lines);

  process.stdout.write(`=== cshell ${CSHELL_LOG} (last ${lines}) ===\n`);
  process.stdout.write(`${sanitize(cshellLines, secrets)}\n`);
  process.stdout.write(`=== upstream ${names.upstream} (last ${lines}) ===\n`);
  process.stdout.write(`${sanitize(upstreamTail, secrets)}\n`);
  return { lines };
}

async function commandReset(env) {
  const ports = localPorts(env);
  let state = await readStateFile(ports);
  const engine = engineFor(env);

  // Stop first so no container holds the data volume, then remove the volume.
  await stopCshell(state, { ports });
  const names = fixedContainerNames(NAME_PREFIX);
  try {
    harness(['down', '--names-prefix', NAME_PREFIX, '--manifest', MANIFEST_PATH], {
      env: harnessEnv(state, env),
      label: 'reset-down',
    });
  } catch {
    harness(['down', '--names-prefix', NAME_PREFIX], { env: harnessEnv(state, env), label: 'reset-down-fallback' });
  }
  const wipe = harness(['wipe-data', '--names-prefix', NAME_PREFIX, '--manifest', MANIFEST_PATH], {
    env: harnessEnv(state, env),
    label: 'wipe-data',
  });

  state = await readStateFile(ports);
  state.cshell = { ...state.cshell, pid: null, startedAt: null, url: null };
  state.upstream = { ...state.upstream, configuredAt: null };
  await writeStateFile(state);

  const leftovers = {
    db: containerState(engine, names.db),
    redis: containerState(engine, names.redis),
    upstream: containerState(engine, names.upstream),
  };
  process.stdout.write(
    `${JSON.stringify({
      wipedDataVolume: wipe?.dataVolume ?? names.dataVolume,
      leftovers,
      note: 'next "start" provisions a fresh database and re-creates the admin account from the persisted credentials',
    }, null, 2)}\n`,
  );
  if (!Object.values(leftovers).every(value => value === 'missing')) {
    throw new Error('reset left cshell-local containers behind');
  }
  return { wipe, leftovers };
}

/* -------------------------------------------------------------------- main */

const USAGE = 'Usage: node scripts/cshell-local-real.mjs start|stop|status|logs|reset';

export async function main(argv = process.argv.slice(2), env = process.env) {
  const command = argv[0];
  const handlers = {
    start: commandStart,
    stop: commandStop,
    status: commandStatus,
    logs: commandLogs,
    reset: commandReset,
  };
  const handler = handlers[command];
  if (!handler) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 1;
    return null;
  }
  await mkdir(STATE_DIR, { recursive: true });
  try {
    return await handler(env);
  } catch (error) {
    fail(error?.message || String(error));
    return null;
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main();
}
