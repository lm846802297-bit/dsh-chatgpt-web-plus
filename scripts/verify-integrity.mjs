/**
 * @lm846802297-bit/dsh-chatgpt-web-plus 文件完整性核对。
 *
 * 背景：这个包最初是靠手动列举文件从官方 tarball 复制过来的，结果漏了
 * `client.js`（整个设置界面）、`assets/`、`screenshots.json` —— 而漏掉的
 * 恰恰是 UI，运行时不会报错，只会在设置页里看不到插件页面。
 * 所以每次升级/迁移后都必须对照官方 tarball 做一次清单核对。
 *
 * 用法：
 *   node verify-package-integrity.mjs            # 只用本地缓存的基线
 *   node verify-package-integrity.mjs --refresh  # 重新从 npm 下载基线
 *
 * 退出码：0 = 完整；1 = 有缺失或异常。
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import os from 'node:os'

const PKG = 'C:/Users/84680/.dsh/profiles/desktop/vendor/dsh-chatgpt-web'
const PKG_NAME = '@wlv-zedd/dsh-chatgpt-web'
const PKG_VERSION = '1.0.4'
const CACHE = path.join(os.tmpdir(), 'dsh-chatgpt-web-baseline')
const REFRESH = process.argv.includes('--refresh')

// 本地新增的文件：不属于上游，核对时排除
const LOCAL_ADDITIONS = new Set([
  'MAINTAINING.md',
  'src/ui-text.ts',
  'package-lock.json',
])
// 本地新增的目录前缀（构建产物、依赖、备份）
const LOCAL_DIR_PREFIXES = [
  'node_modules/',
  '.git/',
  // 本仓库自带的维护脚本，不属于上游
  'scripts/',
]

const say = (...a) => console.log(...a)
let failures = 0
const fail = (msg) => { failures++; say(`  ✗ ${msg}`) }
const ok = (msg) => say(`  ✓ ${msg}`)

// ---------- 1. 准备官方基线 ----------
say('=== @lm846802297-bit/dsh-chatgpt-web-plus 完整性核对 ===')
say(`本地包: ${PKG}`)
say(`基线  : ${PKG_NAME}@${PKG_VERSION}`)
say('')

function downloadBaseline() {
  fs.rmSync(CACHE, { recursive: true, force: true })
  fs.mkdirSync(CACHE, { recursive: true })
  say('[1] 下载官方基线')
  execFileSync('npm', ['pack', `${PKG_NAME}@${PKG_VERSION}`], {
    cwd: CACHE, stdio: 'pipe', shell: process.platform === 'win32',
  })
  const tgz = fs.readdirSync(CACHE).find(f => f.endsWith('.tgz'))
  if (!tgz) throw new Error('npm pack 未产出 tarball')
  execFileSync('tar', ['-xzf', tgz], { cwd: CACHE, stdio: 'pipe' })
  ok(`已解压 ${tgz}`)
}

const baselineDir = path.join(CACHE, 'package')
if (REFRESH || !fs.existsSync(baselineDir)) downloadBaseline()
else say('[1] 复用缓存基线（--refresh 可重新下载）')

const baselineFiles = listFiles(baselineDir)
say(`    基线文件数: ${baselineFiles.length}`)
say('')

function listFiles(root) {
  const out = []
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel)
      else out.push(rel)
    }
  }
  walk(root, '')
  return out.sort()
}

// ---------- 2. 列举本地文件 ----------
say('[2] 列举本地文件')
const localFiles = listFiles(PKG).filter((rel) => {
  if (LOCAL_ADDITIONS.has(rel)) return false
  if (LOCAL_DIR_PREFIXES.some(p => rel.startsWith(p))) return false
  return true
})
say(`    本地文件数: ${localFiles.length}（已排除本地新增）`)
say('')

// ---------- 3. 缺失文件 ----------
say('[3] 官方有、本地缺的文件')
const localSet = new Set(localFiles)
const baselineSet = new Set(baselineFiles)
const missing = baselineFiles.filter(rel => !localSet.has(rel))
if (missing.length === 0) ok('无缺失')
else for (const rel of missing) {
  // client.js / assets 缺失属于严重问题（UI 直接不见）
  const critical = rel === 'client.js' || rel.startsWith('assets/') || rel === 'screenshots.json'
  fail(`${rel}${critical ? '  ← 严重：UI 资源' : ''}`)
}
say('')

// ---------- 4. 本地独有文件 ----------
say('[4] 本地有、官方没有的文件')
const extra = localFiles.filter(rel => !baselineSet.has(rel))
if (extra.length === 0) ok('无额外文件')
else say(`    ${extra.length} 个（应全部是本地修复，逐条确认）\n` +
  extra.map(rel => `      · ${rel}`).join('\n'))
say('')

// ---------- 5. 关键文件非空校验 ----------
say('[5] 关键文件存在且非空')
const CRITICAL = [
  ['client.js', '设置界面（缺失则设置页无此插件）'],
  ['lib/plugin.js', '插件入口'],
  ['lib/cli.js', 'CLI / sidecar'],
  ['cordis.patch.yml', 'bundle 声明'],
  ['package.json', '包清单'],
]
for (const [rel, why] of CRITICAL) {
  const full = path.join(PKG, rel)
  if (!fs.existsSync(full)) { fail(`${rel} 不存在 — ${why}`); continue }
  const size = fs.statSync(full).size
  if (size === 0) fail(`${rel} 是空文件 — ${why}`)
  else ok(`${rel.padEnd(20)} ${size.toLocaleString()} bytes`)
}
say('')

// ---------- 6. 包名一致性 ----------
say('[6] 包名与版本一致性')
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'))
  const expectName = '@lm846802297-bit/dsh-chatgpt-web-plus'
  if (pkg.name === expectName) ok(`package.json name = ${pkg.name}`)
  else fail(`package.json name = ${pkg.name}，应为 ${expectName}`)
  if (String(pkg.version).includes('plus')) ok(`version = ${pkg.version}（fork 标记）`)
  else fail(`version = ${pkg.version}，建议带 plus 标记`)

  // cordis.patch.yml 里的插件名必须与包名一致
  const patch = fs.readFileSync(path.join(PKG, 'cordis.patch.yml'), 'utf8')
  if (patch.includes(`name: '${expectName}'`) || patch.includes(`name: "${expectName}"`)) {
    ok(`cordis.patch.yml 引用 ${expectName}`)
  } else {
    fail('cordis.patch.yml 未引用新的包名（会加载失败）')
  }
  // 不能残留旧名。只检查 YAML 的有效内容——注释里说明改名来源是允许的，
  // 否则任何解释性文档都会触发误报。
  const staleRefs = []
  const effectivePatchLines = patch
    .split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith('#') && line.trim() !== '')
  if (effectivePatchLines.some(line => line.includes('wlv-zedd'))) staleRefs.push('cordis.patch.yml')
  const lock = path.join(PKG, 'package-lock.json')
  if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8').includes('"@wlv-zedd/dsh-chatgpt-web"')) {
    staleRefs.push('package-lock.json')
  }
  if (staleRefs.length === 0) ok('无旧包名残留（有效内容）')
  else fail(`旧包名残留在: ${staleRefs.join(', ')}（npm install 会按旧名重装）`)
} catch (error) {
  fail(`读取包清单失败: ${error?.message ?? error}`)
}
say('')

// ---------- 7. profile 侧链接 ----------
say('[7] profile 依赖链接')
const PROFILE_PKG = 'C:/Users/84680/.dsh/profiles/desktop/package.json'
try {
  const profile = JSON.parse(fs.readFileSync(PROFILE_PKG, 'utf8'))
  const declared = profile.dependencies?.['@lm846802297-bit/dsh-chatgpt-web-plus']
  if (declared === 'link:vendor/dsh-chatgpt-web') ok(`profile 依赖 = ${declared}`)
  else if (declared === undefined) fail('profile 未声明 @lm846802297-bit/dsh-chatgpt-web-plus')
  else fail(`profile 依赖 = ${declared}，应为 link:vendor/dsh-chatgpt-web`)

  const inBundles = (profile.dsh?.profile?.bundles ?? []).includes('@lm846802297-bit/dsh-chatgpt-web-plus')
  if (inBundles) ok('已列入 dsh.profile.bundles')
  else fail('未列入 dsh.profile.bundles（不会加载）')

  if (JSON.stringify(profile).includes('wlv-zedd')) {
    fail('profile 仍含 @wlv-zedd 引用（市场会显示已安装）')
  } else ok('profile 无 @wlv-zedd 残留')

  const linkPath = 'C:/Users/84680/.dsh/profiles/desktop/node_modules/@lm846802297-bit/dsh-chatgpt-web-plus'
  if (fs.existsSync(linkPath)) ok('node_modules 链接存在')
  else fail('node_modules 链接缺失，需 pnpm install')
} catch (error) {
  fail(`读取 profile 失败: ${error?.message ?? error}`)
}
say('')

// ---------- 结论 ----------
if (failures === 0) {
  say('结果：完整。所有官方文件在位，包名一致，链接正常。')
  process.exit(0)
} else {
  say(`结果：发现 ${failures} 个问题。`)
  say('修复后重新运行本脚本核对。')
  process.exit(1)
}
