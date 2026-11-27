#!/usr/bin/env node
// Resolve installed production graphs, not a flat node_modules scan or direct-only report.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
const root = path.resolve(import.meta.dirname, '..')
const mode = process.argv[2]
if (!['npm', 'rust'].includes(mode)) throw new Error('Usage: release-licenses.mjs npm|rust [output-directory]')
const out = path.resolve(process.argv[3] ?? (mode === 'npm' ? path.join(root, 'web/dist/legal/npm') : path.join(root, 'artifacts/legal/rust')))
const sha = value => crypto.createHash('sha256').update(value).digest('hex')
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const knownLicenseIds = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'Unicode-3.0', 'Unlicense', 'CDLA-Permissive-2.0'])
const failures = []
const records = []
const texts = new Map()
function notices(dir, explicit) {
  const found = []
  function walk(current, depth) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) continue
      const file = path.join(current, entry.name)
      if (entry.isDirectory() && depth < 8 && !['node_modules', '.git', 'target'].includes(entry.name)) walk(file, depth + 1)
      else if (entry.isFile() && (/^(licen[cs]e|copying|notice|copyright|authors)([._-]|$)/i.test(entry.name) || file === explicit)) {
        const data = fs.readFileSync(file)
        const digest = sha(data)
        texts.set(digest, data)
        found.push({ path: path.relative(dir, file), sha256: digest, text: `texts/${digest}.txt` })
      }
    }
  }
  walk(dir, 0)
  return found
}
function add(record, dir, explicit) {
  record.notices = notices(dir, explicit)
  const sourcesFile = path.join(root, 'docs/licenses/sources.json')
  const source = fs.existsSync(sourcesFile) && read(sourcesFile)[`${record.name}@${record.version}`]
  if (source) {
    const data = fs.readFileSync(path.join(root, source.file))
    if (sha(data) !== source.sha256) throw new Error('Supplemental license hash mismatch: ' + source.file)
    texts.set(source.sha256, data)
    record.notices.push({ path: source.file, sha256: source.sha256, text: `texts/${source.sha256}.txt`, source: source.url, gitBlobSha: source.gitBlobSha })
  }
  if (!record.license || record.license.replace(/[()]/g, '').split(/\s+(?:OR|AND)\s+|\s*\/\s*/).some(id => !knownLicenseIds.has(id)) || !record.notices.length) failures.push(`${record.name}@${record.version}: unresolved license expression or missing published text`)
  records.push(record)
}
let lock
let target = null
if (mode === 'npm') {
  const web = path.join(root, 'web')
  lock = path.join(web, 'pnpm-lock.yaml')
  const manifest = read(path.join(web, 'package.json'))
  const seen = new Set()
  function resolve(name, from) {
    let dir = from
    for (;;) {
      const candidate = path.join(dir, 'node_modules', name, 'package.json')
      if (fs.existsSync(candidate)) return fs.realpathSync(candidate)
      const parent = path.dirname(dir)
      if (parent === dir) throw new Error(`Unresolved required dependency ${name} from ${from}`)
      dir = parent
    }
  }
  function visit(name, from, direct = false, optional = false) {
    let file
    try { file = resolve(name, from) } catch (error) { if (optional) return null; throw error }
    const pkg = read(file)
    const id = `${pkg.name}@${pkg.version}`
    const lockText = fs.readFileSync(lock, 'utf8')
    if (!lockText.includes(`  ${id}:`) && !lockText.includes(`  '${id}':`) && !lockText.includes(`  ${id}(`) && !lockText.includes(`  '${id}(`)) throw new Error(`Installed package not present in locked resolution: ${id}`)
    if (seen.has(file)) return id
    seen.add(file)
    const dir = path.dirname(file)
    const record = { name: pkg.name, version: pkg.version, direct, license: typeof pkg.license === 'string' ? pkg.license : pkg.license?.type, repository: pkg.repository ?? null, metadataSha256: sha(fs.readFileSync(file)), dependencies: [], absentOptionalDependencies: [] }
    add(record, dir)
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }).sort()) {
      const child = visit(dep, dir, false, Object.hasOwn(pkg.optionalDependencies ?? {}, dep))
      if (child) record.dependencies.push(child)
      else record.absentOptionalDependencies.push(dep)
    }
    // Installed non-optional peers are part of the runtime closure too.
    for (const dep of Object.keys(pkg.peerDependencies ?? {}).sort()) {
      if (pkg.peerDependenciesMeta?.[dep]?.optional === true) continue
      if (record.dependencies.some(id => id.startsWith(`${dep}@`))) continue
      const child = visit(dep, dir, false, pkg.peerDependenciesMeta?.[dep]?.optional === true)
      if (child) record.dependencies.push(child)
    }
    return id
  }
  for (const name of Object.keys(manifest.dependencies).sort()) visit(name, web, true)
} else {
  lock = path.join(root, 'Cargo.lock')
  target = process.env.RELEASE_TARGET ?? execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)[1]
  const cargo = args => execFileSync('cargo', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const metadata = JSON.parse(cargo(['metadata', '--locked', '--offline', '--format-version', '1', '--filter-platform', target]))
  // Cargo's normal/build tree excludes dev-only roots and preserves feature/target resolution.
  const tree = cargo(['tree', '--locked', '--offline', '--target', target, '--edges', 'normal,build', '--prefix', 'none', '--format', '{p}'])
  const selected = new Set(tree.split('\n').map(line => line.match(/^(\S+) v(\S+)/)).filter(Boolean).map(m => `${m[1]}@${m[2]}`))
  const own = metadata.packages.find(p => metadata.workspace_members.includes(p.id))
  const direct = new Set(own.dependencies.filter(d => d.kind !== 'dev').map(d => d.name))
  for (const pkg of metadata.packages) {
    if (metadata.workspace_members.includes(pkg.id) || !selected.has(`${pkg.name}@${pkg.version}`)) continue
    const file = pkg.manifest_path
    const dir = path.dirname(file)
    const checksumFile = path.join(dir, '.cargo-checksum.json')
    add({ name: pkg.name, version: pkg.version, direct: direct.has(pkg.name), license: pkg.license, source: pkg.source, repository: pkg.repository, packageChecksum: fs.existsSync(checksumFile) ? read(checksumFile).package : null, metadataSha256: sha(fs.readFileSync(file)) }, dir, pkg.license_file && path.resolve(dir, pkg.license_file))
  }
}
records.sort((a,b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))
// Replace only this generator's output: no stale package notices survive a rebuild.
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(path.join(out, 'texts'), { recursive: true })
for (const [digest, text] of texts) fs.writeFileSync(path.join(out, 'texts', `${digest}.txt`), text)
const inventory = { schemaVersion: 1, ecosystem: mode, scope: mode === 'npm' ? 'installed production dependency and peer closure; excludes dev-only roots' : 'cargo normal+build closure; excludes dev-only roots; target-specific; may conservatively include feature-unified dependencies', target, lockfileSha256: sha(fs.readFileSync(lock)), unresolved: failures, packages: records }
fs.writeFileSync(path.join(out, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n')
fs.writeFileSync(path.join(out, 'THIRD_PARTY_NOTICES.txt'), records.map(p => `${p.name}@${p.version}\nDeclared license: ${p.license ?? 'UNKNOWN'}\n` + p.notices.map(n => `\n--- ${n.path} (sha256 ${n.sha256}) ---\n${texts.get(n.sha256).toString('utf8')}`).join('\n')).join('\n\n====================\n\n'))
console.log(`${mode}: ${records.length} resolved packages, ${texts.size} distinct notice texts; ${failures.length} unresolved; ${out}`)
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1 }
