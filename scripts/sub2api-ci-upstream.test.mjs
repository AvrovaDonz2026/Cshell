import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BASELINE_COMMIT,
  DEFAULT_BUILD_NODE_OPTIONS,
  LATEST_IMAGE_TAG,
  baselineImageTag,
  buildCommand,
  buildSettingsPayload,
  containerNames,
  imageRefByDigest,
  patchDockerfileForMemory,
  pickPlatformDigest,
  sanitize,
  uniqueSuffix,
} from './sub2api-ci-upstream.mjs';

const AMD64_DIGEST = `sha256:${'a'.repeat(64)}`;
const ARM64_DIGEST = `sha256:${'b'.repeat(64)}`;
const ATTESTATION_DIGEST = `sha256:${'c'.repeat(64)}`;

function multiArchIndex() {
  return {
    schemaVersion: 2,
    manifests: [
      { digest: AMD64_DIGEST, platform: { os: 'linux', architecture: 'amd64' }, mediaType: 'application/vnd.oci.image.manifest.v1+json' },
      { digest: ATTESTATION_DIGEST, platform: { os: 'unknown', architecture: 'unknown' } },
      { digest: ARM64_DIGEST, platform: { os: 'linux', architecture: 'arm64' } },
    ],
  };
}

test('pickPlatformDigest selects linux/amd64 and ignores attestations', () => {
  assert.equal(pickPlatformDigest(multiArchIndex()), AMD64_DIGEST);
});

test('pickPlatformDigest honours an explicit platform and accepts the arch alias', () => {
  assert.equal(pickPlatformDigest(multiArchIndex(), { os: 'linux', architecture: 'arm64' }), ARM64_DIGEST);
  assert.equal(pickPlatformDigest(multiArchIndex(), { os: 'linux', arch: 'amd64' }), AMD64_DIGEST);
});

test('pickPlatformDigest fails loudly when the platform is absent', () => {
  assert.throws(() => pickPlatformDigest(multiArchIndex(), { os: 'linux', architecture: 'riscv64' }), /no linux\/riscv64 manifest/);
  assert.throws(() => pickPlatformDigest({}), /manifests array/);
});

test('pickPlatformDigest rejects entries without digests instead of guessing', () => {
  assert.throws(
    () => pickPlatformDigest({ manifests: [{ platform: { os: 'linux', architecture: 'amd64' } }] }),
    /no linux\/amd64 manifest/,
  );
});

test('imageRefByDigest always pins the immutable digest', () => {
  const digest = `sha256:${'1'.repeat(64)}`;
  assert.equal(imageRefByDigest('docker.io/weishaw/sub2api', digest), `docker.io/weishaw/sub2api@${digest}`);
  assert.equal(imageRefByDigest('docker.io/weishaw/sub2api/', digest), `docker.io/weishaw/sub2api@${digest}`);
});

test('imageRefByDigest rejects floating tags and malformed digests', () => {
  const digest = `sha256:${'1'.repeat(64)}`;
  assert.throws(() => imageRefByDigest('docker.io/weishaw/sub2api:latest', digest), /invalid image repository/);
  assert.throws(() => imageRefByDigest('docker.io/weishaw/sub2api', 'latest'), /invalid image digest/);
  assert.throws(() => imageRefByDigest('docker.io/weishaw/sub2api', `sha256:${'z'.repeat(64)}`), /invalid image digest/);
});

test('imageRefByDigest keeps the resolved digest visible in the reference', () => {
  const reference = imageRefByDigest('docker.io/weishaw/sub2api', AMD64_DIGEST);
  assert.ok(reference.endsWith(`@${AMD64_DIGEST}`));
  assert.ok(!reference.includes('latest'));
});

test('sanitize redacts known secret values anywhere in the text', () => {
  const output = sanitize('login admin@example.test CshellCI-only-password-123 bearer abc.def', [
    'CshellCI-only-password-123',
  ]);
  assert.ok(!output.includes('CshellCI-only-password-123'));
  assert.ok(output.includes('[REDACTED]'));
});

test('sanitize redacts credential-shaped assignments and bearer headers', () => {
  const output = sanitize(
    'DATABASE_PASSWORD=hunter2 JWT_SECRET=abc123 Authorization: Bearer eyJhbGciOi.eyJzdWIi.sig password: "p@ss"',
  );
  assert.ok(!output.includes('hunter2'));
  assert.ok(!output.includes('abc123'));
  assert.ok(!output.includes('eyJhbGciOi'));
  assert.ok(!output.includes('p@ss'));
});

test('sanitize walks nested objects and redacts secret-named keys', () => {
  const output = sanitize({
    name: 'ok',
    access_token: 'should-not-leak',
    nested: { smtp_password: 'also-secret', list: ['CshellCI-only-password-123'] },
  }, ['CshellCI-only-password-123']);
  assert.equal(output.name, 'ok');
  assert.equal(output.access_token, '[REDACTED]');
  assert.equal(output.nested.smtp_password, '[REDACTED]');
  assert.deepEqual(output.nested.list, ['[REDACTED]']);
});

test('sanitize leaves non-secret data intact and handles nullish input', () => {
  assert.equal(sanitize(42), 42);
  assert.equal(sanitize(null), null);
  assert.equal(sanitize(undefined), undefined);
  assert.equal(sanitize({ health: { ok: true, attempts: 3 } }).health.ok, true);
});

test('sanitize keeps image digests auditable rather than redacting them', () => {
  // Digests are public measurement values; the manifest must remain reviewable so
  // a failing run can be traced back to the exact image that was tested.
  assert.equal(sanitize(`digest sha256:${'a'.repeat(64)}`), `digest sha256:${'a'.repeat(64)}`);
});

test('uniqueSuffix derives a stable run/attempt prefix plus a random tail', () => {
  const suffix = uniqueSuffix({ GITHUB_RUN_ID: '45366350441', GITHUB_RUN_ATTEMPT: '2' }, () => 'abcd1234');
  assert.equal(suffix, '45366350441-2-abcd1234');
});

test('uniqueSuffix falls back to a local prefix and strips unsafe characters', () => {
  assert.equal(uniqueSuffix({}, () => 'ffee0011'), 'local-ffee0011');
  assert.equal(uniqueSuffix({ GITHUB_RUN_ID: '12/34' }, () => 'aa11'), '1234-aa11');
});

test('uniqueSuffix bounds the length and never starts with a dash', () => {
  const suffix = uniqueSuffix({ GITHUB_RUN_ID: 'x'.repeat(80) }, () => 'deadbeef');
  assert.ok(suffix.length <= 40);
  assert.ok(!suffix.startsWith('-'));
});

test('containerNames keep every resource per-attempt and within DNS limits', () => {
  const names = containerNames('45366350441-2-abcd1234');
  const values = Object.values(names);
  for (const value of values) {
    assert.ok(value.length <= 63, `${value} exceeds DNS label length`);
    assert.match(value, /^[a-z0-9-]+$/);
    assert.ok(value.endsWith('45366350441-2-abcd1234'));
  }
  assert.equal(new Set(values).size, values.length);
  assert.equal(names.upstream, 'cshell-sub2api-45366350441-2-abcd1234');
});

test('buildCommand raises the Node heap through a bounded build arg', () => {
  const args = buildCommand({
    engine: 'docker',
    dockerfile: '/tmp/src/deploy/Dockerfile.cshell-ci',
    context: '/tmp/src',
    tag: 'cshell-ci-sub2api-baseline:2af3f1e15c98',
    nodeOptions: '--max-old-space-size=6144',
  });
  assert.equal(args[0], 'docker');
  assert.equal(args[1], 'build');
  assert.ok(args.includes('--build-arg'));
  const index = args.indexOf('--build-arg');
  assert.equal(args[index + 1], 'NODE_OPTIONS=--max-old-space-size=6144');
  assert.equal(args.at(-1), '/tmp/src');
});

test('buildCommand defaults to a 4 GiB heap, above the failing 1.5 GiB default', () => {
  assert.equal(DEFAULT_BUILD_NODE_OPTIONS, '--max-old-space-size=4096');
  const args = buildCommand({ engine: 'podman', dockerfile: 'Dockerfile', context: '.', tag: 'x:1' });
  assert.ok(args.includes(`NODE_OPTIONS=${DEFAULT_BUILD_NODE_OPTIONS}`));
});

test('patchDockerfileForMemory overrides the pinned upstream ENV NODE_OPTIONS', () => {
  const upstream = [
    'FROM node:24-alpine AS frontend-builder',
    'ENV NODE_OPTIONS=--max-old-space-size=1536',
    'RUN pnpm run build',
  ].join('\n');
  const patched = patchDockerfileForMemory(upstream);
  assert.ok(patched.includes('ARG NODE_OPTIONS=--max-old-space-size=4096'));
  assert.ok(patched.includes('ENV NODE_OPTIONS=${NODE_OPTIONS}'));
  // The override must come after the pinned value so it wins, and before the build.
  assert.ok(patched.indexOf('ARG NODE_OPTIONS=') > patched.indexOf('ENV NODE_OPTIONS=--max-old-space-size=1536'));
  assert.ok(patched.indexOf('ARG NODE_OPTIONS=') < patched.indexOf('RUN pnpm run build'));
});

test('patchDockerfileForMemory rejects an invalid size and an unknown Dockerfile', () => {
  assert.throws(() => patchDockerfileForMemory('ENV NODE_OPTIONS=--max-old-space-size=1536', '4096'), /invalid node options/);
  assert.throws(() => patchDockerfileForMemory('FROM alpine'), /no longer contains the NODE_OPTIONS marker/);
});

test('baselineImageTag is derived from the pinned commit', () => {
  assert.equal(BASELINE_COMMIT, '2af3f1e15c98c893a89255a037f551046883b8c0');
  assert.equal(baselineImageTag(BASELINE_COMMIT), 'cshell-ci-sub2api-baseline:2af3f1e15c98');
  assert.throws(() => baselineImageTag('main'), /invalid baseline commit/);
});

test('latest tag constant stays the upstream official deploy reference', () => {
  assert.equal(LATEST_IMAGE_TAG, 'docker.io/weishaw/sub2api:latest');
});

test('buildSettingsPayload enables registration while disabling captcha/email gates', () => {
  const payload = buildSettingsPayload({ registrationEnabled: true });
  assert.equal(payload.registration_enabled, true);
  assert.equal(payload.email_verify_enabled, false);
  assert.equal(payload.turnstile_enabled, false);
  assert.equal(payload.tencent_captcha_enabled, false);
  assert.equal(payload.aliyun_captcha_enabled, false);
  assert.equal(payload.smtp_host, '');
  assert.equal(payload.smtp_password, '');
  assert.equal(payload.invitation_code_enabled, false);
  assert.deepEqual(payload.registration_email_suffix_whitelist, []);
});

test('buildSettingsPayload honours the closed-registration toggle', () => {
  assert.equal(buildSettingsPayload({ registrationEnabled: false }).registration_enabled, false);
  assert.throws(() => buildSettingsPayload({ registrationEnabled: 'true' }), /must be a boolean/);
});
