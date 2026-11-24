import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_LOG_LINES,
  DEFAULT_PORTS,
  DEFAULT_TEST_EMAIL,
  DEFAULT_TEST_PASSWORD,
  NAME_PREFIX,
  PROFILE_NAME,
  STATE_SCHEMA_VERSION,
  assertDistinctPorts,
  emptyState,
  evaluatePortGuard,
  formatState,
  isBuildStale,
  isProcessAlive,
  localPorts,
  parseState,
  renderStatus,
  secretValuesFor,
  stalePidDetection,
  pidOwnsCshell,
  readPidArgv,
} from './cshell-local-real.mjs';
import { containerNames, fixedContainerNames, validateHostPort, validateNamePrefix } from './sub2api-ci-upstream.mjs';

/* --------------------------------------------------- port collision guard */

test('local ports default to the documented loopback pair', () => {
  assert.deepEqual(localPorts({}), DEFAULT_PORTS);
  assert.equal(DEFAULT_PORTS.cshell, 18080);
  assert.equal(DEFAULT_PORTS.upstream, 18081);
});

test('local ports refuse non-integer, privileged and out-of-range values', () => {
  for (const bad of ['80', '18080abc', '-1', '70000', '0']) {
    assert.throws(() => localPorts({ CSHELL_LOCAL_CSHELL_PORT: bad }), /1024 to 65535/);
  }
  assert.deepEqual(localPorts({ CSHELL_LOCAL_UPSTREAM_PORT: '19081' }), { cshell: 18080, upstream: 19081 });
});

test('local ports refuse to give Cshell and upstream the same port', () => {
  assert.throws(
    () => localPorts({ CSHELL_LOCAL_CSHELL_PORT: '18090', CSHELL_LOCAL_UPSTREAM_PORT: '18090' }),
    /must differ/,
  );
  assert.deepEqual(assertDistinctPorts({ cshell: 1, upstream: 2 }), { cshell: 1, upstream: 2 });
});



test('a free port is accepted and reports why', () => {
  const verdict = evaluatePortGuard({ role: 'cshell', port: 18080, listening: false });
  assert.equal(verdict.ok, true);
  assert.match(verdict.reason, /free/);
});

test('a busy Cshell port needs a live recorded owner pid', () => {
  const state = emptyState();
  state.ports.cshell = 18080;
  state.cshell.pid = 4242;

  const owned = evaluatePortGuard({
    role: 'cshell',
    port: 18080,
    state,
    listening: true,
    pidAlive: pid => pid === 4242,
  });
  assert.equal(owned.ok, true);
  assert.match(owned.reason, /recorded Cshell pid 4242/);

  const orphaned = evaluatePortGuard({
    role: 'cshell',
    port: 18080,
    state,
    listening: true,
    pidAlive: () => false,
  });
  assert.equal(orphaned.ok, false);
  assert.match(orphaned.reason, /no live recorded Cshell pid/);

  const notRecorded = evaluatePortGuard({ role: 'cshell', port: 18080, state: emptyState(), listening: true });
  assert.equal(notRecorded.ok, false);
});

test('a busy upstream port is only acceptable for the recorded container', () => {
  const state = emptyState();
  state.upstream.container = 'cshell-local-sub2api';
  state.upstream.hostPort = 18081;

  const owned = evaluatePortGuard({ role: 'upstream', port: 18081, state, listening: true });
  assert.equal(owned.ok, true);
  assert.match(owned.reason, /cshell-local-sub2api/);

  const foreign = evaluatePortGuard({ role: 'upstream', port: 18081, state: emptyState(), listening: true });
  assert.equal(foreign.ok, false);
  assert.match(foreign.reason, /no recorded cshell-local container/);

  const wrongPort = evaluatePortGuard({
    role: 'upstream',
    port: 18082,
    state,
    listening: true,
  });
  assert.equal(wrongPort.ok, false);
});

test('the guard rejects invalid ports and unknown roles', () => {
  assert.equal(evaluatePortGuard({ role: 'cshell', port: 0, listening: false }).ok, false);
  assert.equal(evaluatePortGuard({ role: 'cshell', port: '18080', listening: false }).ok, false);
  assert.equal(evaluatePortGuard({ role: 'database', port: 18080, listening: false }).ok, false);
});

/* ------------------------------------------------- state file round-trip */

test('a fresh state carries the stable profile, prefix and non-production accounts', () => {
  const state = emptyState();
  assert.equal(state.schemaVersion, STATE_SCHEMA_VERSION);
  assert.equal(state.profile, PROFILE_NAME);
  assert.equal(state.prefix, NAME_PREFIX);
  assert.equal(state.test.email, DEFAULT_TEST_EMAIL);
  assert.equal(state.test.password, DEFAULT_TEST_PASSWORD);
  assert.equal(state.admin.email, null);
  assert.equal(state.admin.password, null);
  assert.equal(state.cshell.pid, null);
  assert.deepEqual(state.ports, DEFAULT_PORTS);
});

test('state survives a serialize/parse round trip', () => {
  const state = emptyState({ cshell: 18080, upstream: 18081 });
  state.admin = { email: DEFAULT_ADMIN_EMAIL, password: 'generated-admin-secret' };
  state.upstream = {
    ...state.upstream,
    container: 'cshell-local-sub2api',
    hostPort: 18081,
    upstreamUrl: 'http://127.0.0.1:18081',
    mode: 'latest-image',
    imageReference: 'docker.io/weishaw/sub2api@sha256:abc',
    configuredAt: '2026-11-24T00:00:00.000Z',
  };
  state.cshell = { pid: 1234, startedAt: '2026-11-24T00:00:01.000Z', log: '/tmp/cshell.log', url: 'http://127.0.0.1:18080' };

  const parsed = parseState(formatState(state));
  assert.deepEqual(parsed.admin, state.admin);
  assert.deepEqual(parsed.upstream, state.upstream);
  assert.deepEqual(parsed.cshell, state.cshell);
});

test('partial state files are normalized instead of crashing status', () => {
  const parsed = parseState(
    JSON.stringify({ schemaVersion: STATE_SCHEMA_VERSION, profile: PROFILE_NAME, admin: { email: DEFAULT_ADMIN_EMAIL } }),
  );
  assert.equal(parsed.admin.email, DEFAULT_ADMIN_EMAIL);
  assert.equal(parsed.admin.password, null);
  assert.equal(parsed.upstream.container, null);
  assert.deepEqual(parsed.ports, DEFAULT_PORTS);
});

test('empty state text yields the default document', () => {
  assert.deepEqual(parseState(''), emptyState());
});

test('a foreign profile or an unknown schema is rejected loudly', () => {
  assert.throws(
    () => parseState(JSON.stringify({ schemaVersion: STATE_SCHEMA_VERSION, profile: 'somebody-else' })),
    /profile/,
  );
  assert.throws(
    () => parseState(JSON.stringify({ schemaVersion: 99, profile: PROFILE_NAME })),
    /unsupported state schema/,
  );
  assert.throws(() => parseState('{not json'), /not valid JSON/);
});

/* --------------------------------------------- sanitized status rendering */

test('status rendering never exposes stored passwords', () => {
  const state = emptyState();
  state.admin = { email: DEFAULT_ADMIN_EMAIL, password: 'super-secret-admin-pass' };
  state.test.password = 'super-secret-test-pass';
  const rendered = renderStatus({
    running: true,
    url: 'http://127.0.0.1:18080',
    ports: DEFAULT_PORTS,
    state,
    upstream: { container: 'cshell-local-sub2api', state: 'running', healthy: true, upstreamUrl: 'http://127.0.0.1:18081' },
    cshell: { pid: 99, alive: true, healthy: true },
    details: [],
  });
  assert.ok(!rendered.includes('super-secret-admin-pass'));
  assert.ok(!rendered.includes('super-secret-test-pass'));
  assert.ok(rendered.includes(DEFAULT_ADMIN_EMAIL));
  assert.ok(rendered.includes(DEFAULT_TEST_EMAIL));
  assert.ok(rendered.includes('[REDACTED]'));
  assert.equal(JSON.parse(rendered).cshell.pid, 99);
});

test('status rendering sanitizes credential-shaped text in details', () => {
  const rendered = renderStatus({
    running: false,
    ports: DEFAULT_PORTS,
    state: emptyState(),
    upstream: {},
    cshell: {},
    details: ['Authorization: Bearer abc.def.ghi', 'DATABASE_PASSWORD=hunter2'],
  });
  assert.ok(!rendered.includes('abc.def.ghi'));
  assert.ok(!rendered.includes('hunter2'));
});

test('status rendering reports the pieces and the exportable URL', () => {
  const model = {
    running: false,
    url: 'http://127.0.0.1:18080',
    ports: DEFAULT_PORTS,
    state: emptyState(),
    upstream: { container: 'cshell-local-sub2api', state: 'exited', healthy: false },
    cshell: { pid: null, alive: false, healthy: false },
    details: ['Cshell /_cshell/health is not answering on 18080'],
  };
  const rendered = JSON.parse(renderStatus(model));
  assert.equal(rendered.running, false);
  assert.equal(rendered.upstream.state, 'exited');
  assert.equal(rendered.cshell.alive, false);
  assert.equal(rendered.ports.upstream, 18081);
  assert.equal(rendered.accounts.testEmail, DEFAULT_TEST_EMAIL);
  assert.match(rendered.accounts.passwords, /REDACTED/);
  assert.equal(rendered.details.length, 1);
});

test('secret values are gathered from the state and the environment', () => {
  const state = emptyState();
  state.admin.password = 'admin-secret-value';
  state.test.password = 'test-secret-value';
  const secrets = secretValuesFor(state, { SUB2API_ADMIN_PASSWORD: 'env-secret-value' });
  assert.ok(secrets.includes('admin-secret-value'));
  assert.ok(secrets.includes('test-secret-value'));
  assert.ok(secrets.includes('env-secret-value'));
  assert.ok(secretValuesFor(emptyState(), {}).includes(DEFAULT_TEST_PASSWORD));
});

/* --------------------------------------------------- stale pid detection */

test('a missing or non-numeric pid is stale', () => {
  assert.equal(stalePidDetection({ pid: null }).stale, true);
  assert.equal(stalePidDetection({ pid: 0 }).stale, true);
  assert.equal(stalePidDetection({ pid: 'abc' }).stale, true);
});

test('a pid that no longer exists is stale', () => {
  const verdict = stalePidDetection({ pid: 424242, alive: () => false });
  assert.equal(verdict.stale, true);
  assert.match(verdict.reason, /not running/);
});

test('a live pid running something else is treated as reused', () => {
  const verdict = stalePidDetection({ pid: 7, alive: () => true, argv: ['/usr/bin/sleep', '100'] });
  assert.equal(verdict.stale, true);
  assert.match(verdict.reason, /reused/);
});

test('a live pid running the Cshell binary is not stale', () => {
  const verdict = stalePidDetection({
    pid: 7,
    alive: () => true,
    argv: ['/home/donz/Cshell/target/debug/cshell'],
  });
  assert.equal(verdict.stale, false);
});

test('pid ownership is decided by the exact executable, not a substring', () => {
  const binary = '/home/donz/Cshell/target/debug/cshell';
  assert.equal(pidOwnsCshell({ argv: [binary], binaryPath: binary }).owned, true);
  // The bug this guards: a second CLI run has "cshell" in its argv but must never be
  // mistaken for the proxy process, or `stop` would kill an unrelated invocation.
  assert.equal(
    pidOwnsCshell({ argv: ['/usr/bin/node', '/home/donz/Cshell/scripts/cshell-local-real.mjs', 'start'], binaryPath: binary })
      .owned,
    false,
  );
  assert.equal(pidOwnsCshell({ argv: [`${binary} (deleted)`], binaryPath: binary }).owned, true);
  assert.equal(pidOwnsCshell({ argv: [], binaryPath: binary }).owned, false);
  assert.equal(pidOwnsCshell({ argv: null, binaryPath: binary }).owned, false);
});

test('readPidArgv tolerates a missing or unreadable process', () => {
  assert.equal(readPidArgv(1, () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); }), null);
  assert.deepEqual(readPidArgv(1, () => '/a/b\u0000--flag\u0000'), ['/a/b', '--flag']);
});

test('isProcessAlive treats EPERM as alive and other errors as dead', () => {
  assert.equal(isProcessAlive(5, () => {}), true);
  const eperm = () => {
    const error = new Error('nope');
    error.code = 'EPERM';
    throw error;
  };
  const esrch = () => {
    const error = new Error('gone');
    error.code = 'ESRCH';
    throw error;
  };
  assert.equal(isProcessAlive(5, eperm), true);
  assert.equal(isProcessAlive(5, esrch), false);
  assert.equal(isProcessAlive(0, () => {}), false);
});

/* -------------------------------------------- stable names and build reuse */

test('fixed container names are stable and share the cshell-local- prefix', () => {
  const names = fixedContainerNames(NAME_PREFIX);
  assert.deepEqual(names, {
    network: 'cshell-local-net',
    db: 'cshell-local-db',
    redis: 'cshell-local-redis',
    upstream: 'cshell-local-sub2api',
    dataVolume: 'cshell-local-data',
    dbDataVolume: 'cshell-local-dbdata',
  });
  assert.deepEqual(fixedContainerNames(NAME_PREFIX), names);
  for (const value of Object.values(names)) {
    assert.ok(value.startsWith('cshell-local-'));
    assert.ok(value.length <= 63);
  }
});

test('the persisted database volume is a distinct volume from the upstream data volume', () => {
  const names = fixedContainerNames(NAME_PREFIX);
  assert.notEqual(names.dbDataVolume, names.dataVolume);
  assert.ok(!Object.values(containerNames('x')).includes(names.dbDataVolume));
});

test('fixed names differ from the per-run harness names', () => {
  const perRun = containerNames('local-abcd1234');
  const fixed = fixedContainerNames(NAME_PREFIX);
  assert.notEqual(perRun.upstream, fixed.upstream);
  assert.ok(!JSON.stringify(fixed).includes('abcd1234'));
});

test('name prefixes are validated instead of trusted', () => {
  for (const bad of ['', 'UPPER-', 'no-trailing-dash', 'has space-']) {
    assert.throws(() => validateNamePrefix(bad), /invalid container name prefix/);
  }
  assert.equal(validateNamePrefix('cshell-local-'), 'cshell-local-');
  assert.throws(() => fixedContainerNames('x'), /invalid container name prefix/);
});

test('host port validation bounds the published upstream port', () => {
  assert.equal(validateHostPort(18081), 18081);
  assert.throws(() => validateHostPort(80), /invalid host port/);
  assert.throws(() => validateHostPort('abc'), /invalid host port/);
});

test('build staleness is judged by output vs. newest input mtime', () => {
  assert.equal(isBuildStale({ outputMtime: 0, inputMtimes: [10] }), true);
  assert.equal(isBuildStale({ outputMtime: 20, inputMtimes: [10, 15] }), false);
  assert.equal(isBuildStale({ outputMtime: 10, inputMtimes: [15] }), true);
  assert.equal(isBuildStale({ outputMtime: 10, inputMtimes: [] }), false);
});

test('the default log tail is a positive line count', () => {
  assert.ok(Number.isInteger(DEFAULT_LOG_LINES) && DEFAULT_LOG_LINES > 0);
});
