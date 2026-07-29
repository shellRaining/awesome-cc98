import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { buildReadme, formatPlatforms } from '../scripts/generate-readme.mjs'
import { loadAndValidate, readYaml, validateCatalog } from '../scripts/lib/catalog.mjs'

test('当前目录通过语义校验', async () => {
  const { catalog, errors } = await loadAndValidate()
  assert.deepEqual(errors, [])
  assert.ok(catalog.exhibits.length >= 20)
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
  assert.equal(readme.includes(String.fromCodePoint(0x2014)), false)
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

test('没有发布权利的素材不能公开', async () => {
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
          publish: true,
          sha256: digest,
          rights: {
            status: 'permission_required',
            license: null,
            attribution: null,
          },
        },
      ],
    }
    const errors = await validateCatalog({
      ...catalog,
      exhibits: [changed, ...catalog.exhibits.slice(1)],
    })
    assert.ok(errors.some((error) => error.includes('发布素材前需确认许可证或取得授权')))
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
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
