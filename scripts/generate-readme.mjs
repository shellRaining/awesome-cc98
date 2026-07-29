import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { loadAndValidate, projectRoot, publicExhibit } from './lib/catalog.mjs'

const stageLabels = {
  stable: '稳定',
  public_beta: '公开测试',
  experimental: '实验性',
  legacy: '历史项目',
  unknown: '状态待确认',
}

const relationLabels = {
  official: '官方参考',
  third_party: '第三方',
  derivative: '派生项目',
}

const platformLabels = {
  web: 'Web',
  pwa: 'PWA',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  android: 'Android',
  ios: 'iOS',
  harmonyos: 'HarmonyOS',
  wechat: '微信',
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
  vscode: 'VS Code',
  terminal: '终端',
}

const linkPriority = ['homepage', 'store', 'beta_download', 'package', 'repository', 'download', 'forum', 'demo', 'docs']

function primaryLink(exhibit) {
  return [...exhibit.links].sort(
    (a, b) => linkPriority.indexOf(a.kind) - linkPriority.indexOf(b.kind),
  )[0]
}

function renderLinks(exhibit, primary) {
  const links = exhibit.links
    .filter((link) => link.id !== primary.id && link.access !== 'unavailable')
    .slice(0, 4)
    .map((link) => `[${link.label}](${link.url})`)
  return links.length > 0 ? ` · ${links.join(' · ')}` : ''
}

export function formatPlatforms(exhibit) {
  const released = exhibit.platforms.released.map((platform) => platform.id)
  const claimed = exhibit.platforms.claimed.map((platform) => platform.id)
  const platforms = released.length > 0 ? released : claimed
  return platforms.map((platform) => platformLabels[platform] ?? platform).join(' / ')
}

export function renderExhibit(exhibit) {
  const primary = primaryLink(exhibit)
  const license = exhibit.license.status === 'declared' ? exhibit.license.spdx : '未发现声明'
  const labels = [
    relationLabels[exhibit.classification.relation],
    stageLabels[exhibit.lifecycle.stage],
    formatPlatforms(exhibit),
  ].filter(Boolean)
  const availability = exhibit.lifecycle.availability_until
    ? ` · 测试至 ${exhibit.lifecycle.availability_until}`
    : ''
  return [
    `- **[${exhibit.name}](${primary.url})** · ${labels.join(' · ')}`,
    `  ${exhibit.tagline}${availability}${renderLinks(exhibit, primary)} · 许可证：${license} · 核验：${exhibit.record.last_verified_at}`,
  ].join('\n')
}

export async function buildReadme(catalog) {
  const [intro, footer] = await Promise.all([
    readFile(path.join(projectRoot, 'templates/README.intro.md'), 'utf8'),
    readFile(path.join(projectRoot, 'templates/README.footer.md'), 'utf8'),
  ])
  const readmeCollection = catalog.collections.find((collection) => collection.id === 'readme')
  const exhibitById = new Map(catalog.exhibits.map((exhibit) => [exhibit.id, exhibit]))
  const sections = readmeCollection.sections
    .map((section) => {
      const entries = section.exhibits.map((id) => renderExhibit(exhibitById.get(id))).join('\n')
      return `## ${section.title}\n\n${section.description}\n\n${entries}`
    })
    .join('\n\n')
  return `${intro.trim()}\n\n${sections}\n\n${footer.trim()}\n`
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  const { catalog, errors } = await loadAndValidate()
  if (errors.length > 0) throw new Error(`生成前校验失败：\n${errors.map((error) => `- ${error}`).join('\n')}`)

  const readme = await buildReadme(catalog)
  const readmeFile = path.join(projectRoot, 'README.md')
  const generatedDirectory = path.join(projectRoot, 'generated')
  const catalogUpdatedAt = catalog.exhibits
    .map((exhibit) => exhibit.record.updated_at)
    .toSorted()
    .at(-1)
  const catalogJson = JSON.stringify(
    {
      schema_version: 1,
      catalog_updated_at: catalogUpdatedAt,
      exhibits: catalog.exhibits
        .filter((exhibit) => exhibit.record.state === 'published')
        .map(publicExhibit),
    },
    null,
    2,
  )

  if (checkOnly) {
    const current = await readFile(readmeFile, 'utf8').catch(() => '')
    if (current !== readme) {
      throw new Error('README.md 不是最新生成结果，请运行 pnpm generate')
    }
    console.log('README.md 与展品数据一致')
    return
  }

  await mkdir(generatedDirectory, { recursive: true })
  await Promise.all([
    writeFile(readmeFile, readme),
    writeFile(path.join(generatedDirectory, 'catalog.json'), `${catalogJson}\n`),
  ])
  console.log(`已生成 README.md 和 generated/catalog.json，共 ${catalog.exhibits.length} 个展品`)
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
