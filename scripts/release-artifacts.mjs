#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const root = path.resolve(import.meta.dirname, '..')
const dist = path.resolve(process.argv[3] ?? path.join(root, 'web/dist'))
const action = process.argv[2]
const sha = data => crypto.createHash('sha256').update(data).digest('hex')
const fail = message => { throw new Error(message) }
if (!['package', 'check', 'image'].includes(action)) fail('Usage: release-artifacts.mjs package|check|image [dist]')
if (action === 'image') {
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'web-third-party.md', 'rust/inventory.json', 'rust/THIRD_PARTY_NOTICES.txt']) {
    if (!fs.existsSync(path.join('/usr/share/doc/cshell', name))) fail(`Missing image notice ${name}`)
  }
  for (const file of ['/app/frontend', '/app/web/node_modules', '/app/web/dist-preview', '/app/scripts', '/app/artifacts']) if (fs.existsSync(file)) fail(`Forbidden image content ${file}`)
}
if (action === 'package') {
  fs.mkdirSync(path.join(dist, 'legal'), { recursive: true })
  for (const [source, name] of [['LICENSE', 'LICENSE'], ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'], ['web/docs/web-third-party.md', 'web-third-party.md']]) fs.copyFileSync(path.join(root, source), path.join(dist, 'legal', name))
}
if (fs.existsSync(path.join(root, 'frontend'))) fail('Removed frontend directory must not be present')
const inventory = JSON.parse(fs.readFileSync(path.join(dist, 'legal/npm/inventory.json')))
if (inventory.unresolved.length) fail('Unresolved npm provenance: ' + inventory.unresolved.join('; '))
if (action !== 'image' && inventory.lockfileSha256 !== sha(fs.readFileSync(path.join(root, 'web/pnpm-lock.yaml')))) fail('Stale npm inventory')
for (const pkg of inventory.packages) {
  if (!pkg.license || !pkg.notices.length) fail(`Missing license ${pkg.name}`)
  for (const notice of pkg.notices) if (sha(fs.readFileSync(path.join(dist, 'legal/npm', notice.text))) !== notice.sha256) fail(`Corrupt notice ${pkg.name}`)
}
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'web-third-party.md', 'npm/THIRD_PARTY_NOTICES.txt']) if (!fs.existsSync(path.join(dist, 'legal', name))) fail(`Missing notice ${name}`)
const files = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    const relative = path.relative(dist, file).split(path.sep).join('/')
    if (entry.isSymbolicLink()) fail('Symlink in release artifact: ' + relative)
    if (entry.isDirectory()) { if (!['assets', 'legal'].includes(relative.split('/')[0])) fail('Unexpected artifact directory: ' + relative); walk(file); continue }
    if (!['index.html', '2shell.jpeg', 'release-manifest.json'].includes(relative) && !relative.startsWith('assets/') && !relative.startsWith('legal/')) fail('Unexpected artifact file: ' + relative)
    if (/\.map$|fixture|mock-sub2api|dist-preview|node_modules|(^|\/)\.env/i.test(relative)) fail('Development/stale artifact: ' + relative)
    if (relative.startsWith('assets/') || relative === 'index.html') {
      const content = fs.readFileSync(file, 'utf8')
      if (/\/frontend\/|mock_result|captcha_provider.{0,10}mock|\/__fixture|fixture-only/.test(content)) fail('Forbidden fixture/upstream reference in ' + relative)
    }
    if (relative !== 'release-manifest.json') files.push({ path: relative, sha256: sha(fs.readFileSync(file)) })
  }
}
walk(dist)
files.sort((a,b) => a.path.localeCompare(b.path))
const manifest = { schemaVersion: 1, files }
if (action === 'package') fs.writeFileSync(path.join(dist, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
else if (JSON.stringify(JSON.parse(fs.readFileSync(path.join(dist, 'release-manifest.json')))) !== JSON.stringify(manifest)) fail('Stale or tampered artifact manifest')
console.log(`Release artifact verified: ${files.length} files; ${inventory.packages.length} npm dependencies; no unresolved notices`)
