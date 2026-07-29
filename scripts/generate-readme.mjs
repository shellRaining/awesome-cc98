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
const authorAvatarPlatformRank = new Map([
  ['github', 0],
  ['cc98', 1],
])
const creatorWallColumns = 6

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function encodeRelativeAssetPath(file) {
  return file.split('/').map(encodeURIComponent).join('/')
}

function authorAvatarIndexKey(exhibitId, authorName) {
  return `${exhibitId}\u0000${authorName}`
}

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

function renderAuthors(exhibit) {
  return exhibit.authors
    .map((author) =>
      author.url
        ? `<a href="${escapeHtml(author.url)}">${escapeHtml(author.name)}</a>`
        : escapeHtml(author.name),
    )
    .join('、')
}

export function buildAuthorAvatarIndex(catalog) {
  const index = new Map()
  for (const asset of catalog.sharedAssets.assets) {
    if (asset.publish !== true || asset.role !== 'author_avatar') continue
    for (const exhibitId of asset.related_exhibits) {
      const key = authorAvatarIndexKey(exhibitId, asset.subject.name)
      if (!index.has(key)) index.set(key, [])
      index.get(key).push(asset)
    }
  }
  for (const avatars of index.values()) {
    avatars.sort((left, right) => {
      const platformDifference =
        (authorAvatarPlatformRank.get(left.subject.platform) ?? Number.MAX_SAFE_INTEGER) -
        (authorAvatarPlatformRank.get(right.subject.platform) ?? Number.MAX_SAFE_INTEGER)
      return platformDifference || compareText(left.id, right.id)
    })
  }
  return index
}

export function resolveAuthorAvatars(index, exhibitId, authorName) {
  return index.get(authorAvatarIndexKey(exhibitId, authorName)) ?? []
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
    `  作者：${renderAuthors(exhibit)} · ${exhibit.tagline}${availability}${renderLinks(exhibit, primary)} · 许可证：${license} · 核验：${exhibit.record.last_verified_at}`,
  ].join('\n')
}

export function collectCreators(catalog) {
  const readmeCollection = catalog.collections.find((collection) => collection.id === 'readme')
  if (!readmeCollection) return []
  const exhibitById = new Map(catalog.exhibits.map((exhibit) => [exhibit.id, exhibit]))
  const avatarIndex = buildAuthorAvatarIndex(catalog)
  const creatorByIdentity = new Map()
  const creators = []

  for (const exhibitId of readmeCollection.sections.flatMap((section) => section.exhibits)) {
    const exhibit = exhibitById.get(exhibitId)
    if (!exhibit || exhibit.record.state !== 'published') continue
    for (const author of exhibit.authors) {
      const avatar = resolveAuthorAvatars(avatarIndex, exhibit.id, author.name)[0] ?? null
      const identity = avatar ? `avatar:${avatar.id}` : `profile:${author.url ?? author.name}`
      let creator = creatorByIdentity.get(identity)
      if (!creator) {
        creator = {
          name: author.name,
          profile_url: avatar?.subject.profile_url ?? author.url,
          avatar,
          works: [],
        }
        creatorByIdentity.set(identity, creator)
        creators.push(creator)
      }
      if (!creator.works.some((work) => work.id === exhibit.id)) {
        creator.works.push({ id: exhibit.id, name: exhibit.name, url: primaryLink(exhibit).url })
      }
    }
  }
  return creators
}

function renderCreatorCell(creator, columnSpan = 1) {
  const profileUrl = creator.profile_url ? escapeHtml(creator.profile_url) : null
  const avatar = creator.avatar
  const image = avatar
    ? [
        profileUrl ? `        <a href="${profileUrl}">` : '',
        `          <img src="./${escapeHtml(encodeRelativeAssetPath(avatar.file))}" width="64" alt="${escapeHtml(avatar.alt)}" title="${escapeHtml(avatar.rights.attribution ?? avatar.alt)}">`,
        profileUrl ? '        </a><br>' : '        <br>',
      ]
        .filter(Boolean)
        .join('\n')
    : '        <span aria-hidden="true">👤</span><br>'
  const name = profileUrl
    ? `<strong><a href="${profileUrl}">${escapeHtml(creator.name)}</a></strong>`
    : `<strong>${escapeHtml(creator.name)}</strong>`
  const account = avatar
    ? (() => {
        const platform = avatar.subject.platform === 'github' ? 'GitHub' : 'CC98'
        const accountName = avatar.subject.account_name
        const label =
          accountName.toLocaleLowerCase('en-US') === creator.name.toLocaleLowerCase('en-US')
            ? platform
            : `${platform} @${escapeHtml(accountName)}`
        return `<sub>${label}</sub><br>`
      })()
    : ''
  const works = creator.works
    .map((work) => `<a href="${escapeHtml(work.url)}">${escapeHtml(work.name)}</a>`)
    .join(' · ')
  const cellWidth = Math.floor((100 * columnSpan) / creatorWallColumns)
  const columnSpanAttribute = columnSpan > 1 ? ` colspan="${columnSpan}"` : ''

  return [
    `      <td align="center" valign="top" width="${cellWidth}%"${columnSpanAttribute}>`,
    image,
    `        ${name}<br>`,
    account ? `        ${account}` : '',
    `        <sub>${works}</sub>`,
    '      </td>',
  ]
    .filter(Boolean)
    .join('\n')
}

export function renderCreatorWall(catalog) {
  const creators = collectCreators(catalog)
  if (creators.length === 0) return ''
  const rows = []
  for (let index = 0; index < creators.length; index += creatorWallColumns) {
    const rowCreators = creators.slice(index, index + creatorWallColumns)
    const columnSpan =
      creatorWallColumns % rowCreators.length === 0
        ? creatorWallColumns / rowCreators.length
        : 1
    const cells = rowCreators
      .map((creator) => renderCreatorCell(creator, columnSpan))
      .join('\n')
    rows.push(`    <tr>\n${cells}\n    </tr>`)
  }
  return [
    '## 创作者墙',
    '',
    '感谢以下创作者与维护组织同意让作品和公开头像加入 Awesome CC98。这里统一保留账号署名和主页链接；点击作品名可以前往对应项目。具体范围见 [作者头像授权摘要](docs/permissions/author-avatars-2026-07-29.md)。',
    '',
    '<table>',
    '  <tbody>',
    rows.join('\n'),
    '  </tbody>',
    '</table>',
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
  const creatorWall = renderCreatorWall(catalog)
  return `${intro.trim()}\n\n${sections}\n\n${creatorWall}\n\n${footer.trim()}\n`
}

export function buildCatalogManifest(catalog) {
  const avatarIndex = buildAuthorAvatarIndex(catalog)
  const catalogUpdatedAt = catalog.exhibits
    .map((exhibit) => exhibit.record.updated_at)
    .toSorted()
    .at(-1)
  return {
    schema_version: 1,
    catalog_updated_at: catalogUpdatedAt,
    exhibits: catalog.exhibits
      .filter((exhibit) => exhibit.record.state === 'published')
      .map((exhibit) => {
        const data = publicExhibit(exhibit)
        return {
          ...data,
          authors: data.authors.map((author) => {
            const avatars = resolveAuthorAvatars(avatarIndex, exhibit.id, author.name)
            const avatarAssetKeys = avatars.map((avatar) => `shared:${avatar.id}`)
            return {
              ...author,
              avatar_asset_keys: avatarAssetKeys,
              primary_avatar_asset_key: avatarAssetKeys[0] ?? null,
            }
          }),
        }
      }),
  }
}

export function buildAssetsManifest(catalog) {
  const sharedAssets = catalog.sharedAssets.assets
    .filter((asset) => asset.publish === true)
    .map((asset) => ({
      ...asset,
      key: `shared:${asset.id}`,
      scope: { kind: 'shared' },
    }))
  const exhibitAssets = catalog.exhibits
    .filter((exhibit) => exhibit.record.state === 'published')
    .flatMap((exhibit) =>
      exhibit.assets
        .filter((asset) => asset.publish === true)
        .map((asset) => ({
          ...asset,
          key: `exhibit:${exhibit.id}:${asset.id}`,
          scope: { kind: 'exhibit', exhibit_id: exhibit.id },
          file: path.posix.join('exhibits', exhibit.id, asset.file),
        })),
    )

  return {
    schema_version: 1,
    assets: [...sharedAssets, ...exhibitAssets].toSorted((left, right) =>
      left.key.localeCompare(right.key),
    ),
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  const { catalog, errors } = await loadAndValidate()
  if (errors.length > 0) throw new Error(`生成前校验失败：\n${errors.map((error) => `- ${error}`).join('\n')}`)

  const readme = await buildReadme(catalog)
  const readmeFile = path.join(projectRoot, 'README.md')
  const generatedDirectory = path.join(projectRoot, 'generated')
  const catalogJson = JSON.stringify(buildCatalogManifest(catalog), null, 2)
  const assetsJson = JSON.stringify(buildAssetsManifest(catalog), null, 2)

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
    writeFile(path.join(generatedDirectory, 'assets.json'), `${assetsJson}\n`),
  ])
  console.log(
    `已生成 README.md、generated/catalog.json 和 generated/assets.json，共 ${catalog.exhibits.length} 个展品、${catalog.sharedAssets.assets.length} 个共享素材`,
  )
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
