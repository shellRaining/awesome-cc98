import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  buildAssetsManifest,
  buildAuthorAvatarIndex,
  buildCatalogManifest,
  buildReadme,
  collectCreators,
  formatPlatforms,
  renderCreatorWall,
  resolveAuthorAvatars,
} from '../scripts/generate-readme.mjs'
import { loadAndValidate, readYaml, validateCatalog } from '../scripts/lib/catalog.mjs'

function fixtureRights() {
  return {
    status: 'self_created',
    license: null,
    creator: '测试作者',
    attribution: '测试作者',
    permission_record: null,
  }
}

function fixturePrivacy() {
  return {
    status: 'clear',
    notes: '测试素材不包含论坛内容或个人信息',
  }
}

function fixtureSharedAsset({ id, file, contents }) {
  return {
    id,
    role: 'texture',
    file,
    media_type: 'image/png',
    alt: '测试共享素材',
    related_exhibits: [],
    subject: null,
    source_url: null,
    retrieved_at: '2026-07-30',
    publish: true,
    sha256: createHash('sha256').update(contents).digest('hex'),
    rights: fixtureRights(),
    privacy: fixturePrivacy(),
  }
}

function fixtureExhibitAsset({ id, file, contents, sourceRef }) {
  return {
    id,
    role: 'screenshot',
    file,
    media_type: 'image/png',
    alt: '测试展品素材',
    source_ref: sourceRef,
    publish: true,
    sha256: createHash('sha256').update(contents).digest('hex'),
    rights: fixtureRights(),
    privacy: fixturePrivacy(),
  }
}

test('当前目录通过语义校验', async () => {
  const { catalog, errors } = await loadAndValidate()
  assert.deepEqual(errors, [])
  assert.ok(catalog.exhibits.length >= 20)
  assert.equal(catalog.sharedAssets.assets.filter((asset) => asset.role === 'author_avatar').length, 29)
  assert.deepEqual(
    new Set(catalog.sharedAssets.assets.filter((asset) => asset.id.startsWith('museum-')).map((asset) => asset.role)),
    new Set(['poster', 'sprite']),
  )
  assert.equal(collectCreators(catalog).length, 21)
  const avatarIndex = buildAuthorAvatarIndex(catalog)
  for (const exhibit of catalog.exhibits.filter((item) => item.record.state === 'published')) {
    for (const author of exhibit.authors) {
      assert.ok(resolveAuthorAvatars(avatarIndex, exhibit.id, author.name).length > 0)
    }
  }
})

test('已登记素材通过目录清单检查并忽略系统文件', async () => {
  const { catalog } = await loadAndValidate()
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'awesome-cc98-inventory-'))
  try {
    const sharedContents = Buffer.from('registered shared asset')
    const exhibitContents = Buffer.from('registered exhibit asset')
    const rootAssetsDirectory = path.join(temporaryRoot, 'assets')
    const original = catalog.exhibits[0]
    const exhibitDirectory = path.join(temporaryRoot, 'exhibits', original.id)
    const exhibitAssetsDirectory = path.join(exhibitDirectory, 'assets')
    await Promise.all([
      mkdir(rootAssetsDirectory, { recursive: true }),
      mkdir(exhibitAssetsDirectory, { recursive: true }),
    ])
    await Promise.all([
      writeFile(path.join(rootAssetsDirectory, 'registered.png'), sharedContents),
      writeFile(path.join(rootAssetsDirectory, '.DS_Store'), Buffer.from('system metadata')),
      writeFile(path.join(exhibitAssetsDirectory, 'registered.png'), exhibitContents),
      writeFile(path.join(exhibitAssetsDirectory, 'Thumbs.db'), Buffer.from('system metadata')),
    ])

    const changedExhibit = {
      ...original,
      __file: path.join(exhibitDirectory, 'exhibit.yaml'),
      __directory: exhibitDirectory,
      assets: [
        fixtureExhibitAsset({
          id: 'registered-exhibit-asset',
          file: 'assets/registered.png',
          contents: exhibitContents,
          sourceRef: original.sources[0].id,
        }),
      ],
    }
    const errors = await validateCatalog({
      ...catalog,
      root: temporaryRoot,
      exhibits: [changedExhibit, ...catalog.exhibits.slice(1)],
      sharedAssets: {
        schema_version: 1,
        assets: [
          fixtureSharedAsset({
            id: 'registered-shared-asset',
            file: 'assets/registered.png',
            contents: sharedContents,
          }),
        ],
        candidates: [],
      },
    })
    assert.deepEqual(errors, [])
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('孤立的共享与展品素材文件会被拒绝', async () => {
  const { catalog } = await loadAndValidate()
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'awesome-cc98-orphan-'))
  try {
    const rootAssetsDirectory = path.join(temporaryRoot, 'assets')
    const original = catalog.exhibits[0]
    const exhibitDirectory = path.join(temporaryRoot, 'exhibits', original.id)
    const exhibitAssetsDirectory = path.join(exhibitDirectory, 'assets')
    await Promise.all([
      mkdir(rootAssetsDirectory, { recursive: true }),
      mkdir(exhibitAssetsDirectory, { recursive: true }),
    ])
    await Promise.all([
      writeFile(path.join(rootAssetsDirectory, 'orphan-shared.png'), Buffer.from('orphan shared')),
      writeFile(path.join(exhibitAssetsDirectory, 'orphan-exhibit.png'), Buffer.from('orphan exhibit')),
    ])

    const changedExhibit = {
      ...original,
      __file: path.join(exhibitDirectory, 'exhibit.yaml'),
      __directory: exhibitDirectory,
      assets: [],
    }
    const errors = await validateCatalog({
      ...catalog,
      root: temporaryRoot,
      exhibits: [changedExhibit, ...catalog.exhibits.slice(1)],
      sharedAssets: { schema_version: 1, assets: [], candidates: [] },
    })
    assert.ok(errors.some((error) => error.includes('未登记素材文件 assets/orphan-shared.png')))
    assert.ok(
      errors.some((error) =>
        error.includes(`未登记素材文件 exhibits/${original.id}/assets/orphan-exhibit.png`),
      ),
    )
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('登记但不存在的共享与展品素材文件会被拒绝', async () => {
  const { catalog } = await loadAndValidate()
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'awesome-cc98-missing-'))
  try {
    const original = catalog.exhibits[0]
    const exhibitDirectory = path.join(temporaryRoot, 'exhibits', original.id)
    await mkdir(exhibitDirectory, { recursive: true })
    const missingContents = Buffer.from('missing asset')
    const changedExhibit = {
      ...original,
      __file: path.join(exhibitDirectory, 'exhibit.yaml'),
      __directory: exhibitDirectory,
      assets: [
        fixtureExhibitAsset({
          id: 'missing-exhibit-asset',
          file: 'assets/missing-exhibit.png',
          contents: missingContents,
          sourceRef: original.sources[0].id,
        }),
      ],
    }
    const errors = await validateCatalog({
      ...catalog,
      root: temporaryRoot,
      exhibits: [changedExhibit, ...catalog.exhibits.slice(1)],
      sharedAssets: {
        schema_version: 1,
        assets: [
          fixtureSharedAsset({
            id: 'missing-shared-asset',
            file: 'assets/missing-shared.png',
            contents: missingContents,
          }),
        ],
        candidates: [],
      },
    })
    assert.ok(errors.some((error) => error.includes('找不到素材文件 assets/missing-shared.png')))
    assert.ok(
      errors.some((error) =>
        error.includes(`找不到素材文件 exhibits/${original.id}/assets/missing-exhibit.png`),
      ),
    )
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('登记路径不能越出 assets 目录', async () => {
  const { catalog } = await loadAndValidate()
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'awesome-cc98-path-'))
  try {
    const contents = Buffer.from('outside asset')
    await writeFile(path.join(temporaryRoot, 'outside.png'), contents)
    const errors = await validateCatalog({
      ...catalog,
      root: temporaryRoot,
      sharedAssets: {
        schema_version: 1,
        assets: [
          fixtureSharedAsset({
            id: 'outside-shared-asset',
            file: 'assets/../outside.png',
            contents,
          }),
        ],
        candidates: [],
      },
    })
    assert.ok(errors.some((error) => error.includes('素材路径必须位于 assets/ 目录且不能越界')))
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('生成内容覆盖 README 集合中的全部展品', async () => {
  const { catalog, errors } = await loadAndValidate()
  assert.deepEqual(errors, [])
  const readme = await buildReadme(catalog)
  const expected = catalog.collections
    .find((collection) => collection.id === 'readme')
    .sections.flatMap((section) => section.exhibits)
  for (const id of expected) {
    const exhibit = catalog.exhibits.find((item) => item.id === id)
    assert.match(readme, new RegExp(`\\[${exhibit.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\]`))
  }
  assert.match(readme, /^## 创作者墙$/m)
  assert.equal(readme.match(/<img src="\.\/assets\/authors\//g)?.length, 21)
  assert.match(readme, /作者：<a href="https:\/\/github\.com\/shellRaining">shellRaining<\/a>/)
  assert.match(readme, /src="\.\/assets\/authors\/github\/shellraining\.png"/)
  assert.match(readme, /src="\.\/assets\/authors\/cc98\/infvar\.webp"/)
  assert.equal(readme.includes('assets/authors/cc98/yutyrannus-default.png'), false)
  for (const candidate of catalog.sharedAssets.candidates) {
    if (candidate.asset_url) assert.equal(readme.includes(candidate.asset_url), false)
  }
  assert.equal(readme.includes(String.fromCodePoint(0x2014)), false)
})

test('作者头像选择稳定且排除候选和未发布素材', () => {
  const github = {
    id: 'author-test-github-avatar',
    role: 'author_avatar',
    publish: true,
    related_exhibits: ['test-exhibit'],
    subject: { name: 'Test', platform: 'github' },
  }
  const cc98 = {
    id: 'author-test-cc98-avatar',
    role: 'author_avatar',
    publish: true,
    related_exhibits: ['test-exhibit'],
    subject: { name: 'Test', platform: 'cc98' },
  }
  const hidden = {
    id: 'author-test-hidden-avatar',
    role: 'author_avatar',
    publish: false,
    related_exhibits: ['test-exhibit'],
    subject: { name: 'Test', platform: 'github' },
  }
  const makeCatalog = (assets) => ({
    sharedAssets: {
      assets,
      candidates: [
        {
          id: 'author-test-candidate-avatar',
          role: 'author_avatar',
          publish: false,
          related_exhibits: ['test-exhibit'],
          subject: { name: 'Test', platform: 'github' },
        },
      ],
    },
  })
  const first = resolveAuthorAvatars(
    buildAuthorAvatarIndex(makeCatalog([cc98, hidden, github])),
    'test-exhibit',
    'Test',
  ).map((asset) => asset.id)
  const second = resolveAuthorAvatars(
    buildAuthorAvatarIndex(makeCatalog([github, hidden, cc98])),
    'test-exhibit',
    'Test',
  ).map((asset) => asset.id)

  assert.deepEqual(first, ['author-test-github-avatar', 'author-test-cc98-avatar'])
  assert.deepEqual(second, first)
  assert.deepEqual(
    resolveAuthorAvatars(
      buildAuthorAvatarIndex(makeCatalog([github, cc98])),
      'another-exhibit',
      'Test',
    ),
    [],
  )
})

test('创作者墙编码素材路径并转义 HTML', () => {
  const wall = renderCreatorWall({
    collections: [
      {
        id: 'readme',
        sections: [{ exhibits: ['test-exhibit'] }],
      },
    ],
    exhibits: [
      {
        id: 'test-exhibit',
        name: 'Work & <Demo>',
        record: { state: 'published' },
        authors: [
          {
            name: 'A & <script>',
            url: 'https://example.com/profile?a=1&b=2',
          },
        ],
        links: [
          {
            kind: 'homepage',
            url: 'https://example.com/work?a=1&b=2',
          },
        ],
      },
    ],
    sharedAssets: {
      assets: [
        {
          id: 'author-test-avatar',
          role: 'author_avatar',
          publish: true,
          file: 'assets/authors/A B#1.png',
          alt: 'A "B" & <头像>',
          related_exhibits: ['test-exhibit'],
          subject: {
            name: 'A & <script>',
            platform: 'github',
            account_name: 'A&B',
            profile_url: 'https://example.com/profile?a=1&b=2',
          },
          rights: { attribution: 'A "B" & <署名>' },
        },
      ],
      candidates: [],
    },
  })

  assert.match(wall, /src="\.\/assets\/authors\/A%20B%231\.png"/)
  assert.match(wall, /alt="A &quot;B&quot; &amp; &lt;头像&gt;"/)
  assert.match(wall, /href="https:\/\/example\.com\/profile\?a=1&amp;b=2"/)
  assert.match(wall, /A &amp; &lt;script&gt;/)
  assert.equal(wall.includes('Work &amp; &lt;Demo&gt;'), false)
  assert.equal(wall.includes('GitHub @'), false)
  assert.equal(wall.includes('<script>'), false)
})

test('平台展示优先使用实际发布平台', () => {
  const exhibit = {
    platforms: {
      claimed: [{ id: 'windows' }, { id: 'linux' }],
      released: [{ id: 'windows' }],
    },
  }
  assert.equal(formatPlatforms(exhibit), 'Windows')
})

test('找不到来源引用时拒绝目录', async () => {
  const { catalog } = await loadAndValidate()
  const original = catalog.exhibits[0]
  const changed = {
    ...original,
    features: [
      { ...original.features[0], source_refs: ['missing-source'] },
      ...original.features.slice(1),
    ],
  }
  const errors = await validateCatalog({
    ...catalog,
    exhibits: [changed, ...catalog.exhibits.slice(1)],
  })
  assert.ok(errors.some((error) => error.includes('找不到来源 missing-source')))
})

test('素材进入仓库前必须完成权利和隐私审核', async () => {
  const { catalog } = await loadAndValidate()
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'awesome-cc98-assets-'))
  try {
    const assetsDirectory = path.join(temporaryDirectory, 'assets')
    await mkdir(assetsDirectory)
    const assetFile = path.join(assetsDirectory, 'test.png')
    const contents = Buffer.from('test asset')
    await writeFile(assetFile, contents)
    const digest = createHash('sha256').update(contents).digest('hex')
    const original = catalog.exhibits[0]
    const changed = {
      ...original,
      __file: path.join(temporaryDirectory, 'exhibit.yaml'),
      __directory: temporaryDirectory,
      assets: [
        {
          id: 'test-image',
          role: 'screenshot',
          file: 'assets/test.png',
          media_type: 'image/png',
          alt: '测试图片',
          source_ref: original.sources[0].id,
          publish: false,
          sha256: digest,
          rights: {
            status: 'permission_required',
            license: null,
            creator: '测试作者',
            attribution: null,
            permission_record: null,
          },
          privacy: {
            status: 'clear',
            notes: '测试素材不包含论坛内容或个人信息',
          },
        },
      ],
    }
    const errors = await validateCatalog({
      ...catalog,
      exhibits: [changed, ...catalog.exhibits.slice(1)],
    })
    assert.ok(errors.some((error) => error.includes('素材文件进入仓库前需确认许可证或取得授权')))

    const needsRedaction = {
      ...changed,
      assets: [
        {
          ...changed.assets[0],
          rights: {
            status: 'self_created',
            license: null,
            creator: '测试作者',
            attribution: '测试作者',
            permission_record: null,
          },
          privacy: {
            status: 'needs_redaction',
            notes: '测试素材仍包含需要处理的用户信息',
          },
        },
      ],
    }
    const privacyErrors = await validateCatalog({
      ...catalog,
      exhibits: [needsRedaction, ...catalog.exhibits.slice(1)],
    })
    assert.ok(privacyErrors.some((error) => error.includes('素材文件进入仓库前需完成隐私复核和必要脱敏')))
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
})

test('资产候选必须引用已有展品', async () => {
  const { catalog } = await loadAndValidate()
  const candidate = {
    ...catalog.sharedAssets.candidates[0],
    id: 'missing-exhibit-candidate',
    exhibit_id: 'missing-exhibit',
  }
  const errors = await validateCatalog({
    ...catalog,
    sharedAssets: {
      ...catalog.sharedAssets,
      candidates: [...catalog.sharedAssets.candidates, candidate],
    },
  })
  assert.ok(errors.some((error) => error.includes('找不到展品 missing-exhibit')))
})

test('资产候选不得直接发布', async () => {
  const { catalog } = await loadAndValidate()
  const changed = {
    ...catalog.sharedAssets.candidates[0],
    publish: true,
  }
  const errors = await validateCatalog({
    ...catalog,
    sharedAssets: {
      ...catalog.sharedAssets,
      candidates: [changed, ...catalog.sharedAssets.candidates.slice(1)],
    },
  })
  assert.ok(errors.some((error) => error.includes('候选素材不得直接发布')))
})

test('共享素材必须引用已有展品和对应作者', async () => {
  const { catalog } = await loadAndValidate()
  const original = catalog.sharedAssets.assets[0]
  const missingExhibit = {
    ...original,
    related_exhibits: ['missing-exhibit'],
  }
  const missingErrors = await validateCatalog({
    ...catalog,
    sharedAssets: {
      ...catalog.sharedAssets,
      assets: [missingExhibit, ...catalog.sharedAssets.assets.slice(1)],
    },
  })
  assert.ok(missingErrors.some((error) => error.includes('找不到展品 missing-exhibit')))

  const wrongAuthor = {
    ...original,
    subject: { ...original.subject, name: 'missing-author' },
  }
  const authorErrors = await validateCatalog({
    ...catalog,
    sharedAssets: {
      ...catalog.sharedAssets,
      assets: [wrongAuthor, ...catalog.sharedAssets.assets.slice(1)],
    },
  })
  assert.ok(authorErrors.some((error) => error.includes('不是展品') && error.includes('的作者')))
})

test('已授权素材必须引用存在的许可记录', async () => {
  const { catalog } = await loadAndValidate()
  const original = catalog.sharedAssets.assets[0]
  const changed = {
    ...original,
    rights: {
      ...original.rights,
      permission_record: 'docs/permissions/missing-record.md',
    },
  }
  const errors = await validateCatalog({
    ...catalog,
    sharedAssets: {
      ...catalog.sharedAssets,
      assets: [changed, ...catalog.sharedAssets.assets.slice(1)],
    },
  })
  assert.ok(errors.some((error) => error.includes('找不到许可记录 docs/permissions/missing-record.md')))
})

test('运行时素材清单只包含可发布的本地文件', () => {
  const publishable = { id: 'shared-visible', file: 'assets/visible.png', publish: true }
  const hidden = { id: 'shared-hidden', file: 'assets/hidden.png', publish: false }
  const exhibitVisible = { id: 'same-id', file: 'assets/exhibit.png', publish: true }
  const exhibitHidden = { id: 'exhibit-hidden', file: 'assets/hidden.png', publish: false }
  const draftVisible = { id: 'draft-visible', file: 'assets/draft.png', publish: true }
  const manifest = buildAssetsManifest({
    sharedAssets: {
      assets: [hidden, publishable],
      candidates: [{ id: 'candidate-only', publish: false }],
    },
    exhibits: [
      {
        id: 'published-exhibit',
        record: { state: 'published' },
        assets: [exhibitHidden, exhibitVisible],
      },
      {
        id: 'draft-exhibit',
        record: { state: 'draft' },
        assets: [draftVisible],
      },
    ],
  })

  assert.equal(manifest.schema_version, 1)
  assert.equal('candidates' in manifest, false)
  assert.deepEqual(
    manifest.assets.map((asset) => asset.key),
    ['exhibit:published-exhibit:same-id', 'shared:shared-visible'],
  )
  assert.ok(manifest.assets.every((asset) => asset.publish === true))
  assert.equal(
    manifest.assets.find((asset) => asset.key.startsWith('exhibit:')).file,
    'exhibits/published-exhibit/assets/exhibit.png',
  )
  assert.equal(manifest.assets.find((asset) => asset.key.startsWith('shared:')).file, 'assets/visible.png')
  assert.equal(manifest.assets.some((asset) => asset.id === 'candidate-only'), false)
  assert.equal(manifest.assets.some((asset) => asset.id === 'draft-visible'), false)
})

test('运行时目录中的作者头像 key 均可解析到素材清单', async () => {
  const { catalog, errors } = await loadAndValidate()
  assert.deepEqual(errors, [])
  const assets = buildAssetsManifest(catalog)
  const assetKeys = new Set(assets.assets.map((asset) => asset.key))
  const runtimeCatalog = buildCatalogManifest(catalog)

  for (const exhibit of runtimeCatalog.exhibits) {
    for (const author of exhibit.authors) {
      assert.ok(author.avatar_asset_keys.length > 0)
      assert.equal(author.primary_avatar_asset_key, author.avatar_asset_keys[0])
      assert.ok(author.avatar_asset_keys.every((key) => assetKeys.has(key)))
    }
  }

  const shellRaining = runtimeCatalog.exhibits
    .find((exhibit) => exhibit.id === 'shellraining-cc98')
    .authors.find((author) => author.name === 'shellRaining')
  const infvar = runtimeCatalog.exhibits
    .find((exhibit) => exhibit.id === 'weic-jiuba')
    .authors.find((author) => author.name === 'infvar')
  assert.equal(shellRaining.primary_avatar_asset_key, 'shared:author-shellraining-github-avatar')
  assert.equal(infvar.primary_avatar_asset_key, 'shared:author-infvar-cc98-avatar')
  assert.equal(
    runtimeCatalog.exhibits.some((exhibit) =>
      exhibit.authors.some((author) =>
        author.avatar_asset_keys.some((key) => key.includes('candidate')),
      ),
    ),
    false,
  )
})

test('候选提升为本地素材时不能保留重复记录', async () => {
  const { catalog } = await loadAndValidate()
  const candidate = catalog.sharedAssets.candidates[0]
  const exhibitIndex = catalog.exhibits.findIndex((exhibit) => exhibit.id === candidate.exhibit_id)
  const original = catalog.exhibits[exhibitIndex]
  const changed = {
    ...original,
    assets: [
      {
        id: candidate.id,
        role: 'screenshot',
        file: 'assets/not-created.png',
        media_type: 'image/png',
        alt: '测试图片',
        source_ref: original.sources[0].id,
        publish: false,
        sha256: '0'.repeat(64),
        rights: {
          status: 'licensed',
          license: 'MIT',
          creator: '测试作者',
          attribution: '测试作者',
          permission_record: null,
        },
        privacy: {
          status: 'clear',
          notes: '测试素材不包含论坛内容或个人信息',
        },
      },
    ],
  }
  const exhibits = [...catalog.exhibits]
  exhibits[exhibitIndex] = changed
  const errors = await validateCatalog({ ...catalog, exhibits })
  assert.ok(errors.some((error) => error.includes(`不能同时使用 ID ${candidate.id}`)))
})

test('禁止 YAML anchor 和 alias', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'awesome-cc98-yaml-'))
  try {
    const file = path.join(temporaryDirectory, 'unsafe.yaml')
    await writeFile(file, 'base: &base value\ncopy: *base\n')
    await assert.rejects(readYaml(file), /禁止使用 YAML (?:anchor|alias)/)
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
})
