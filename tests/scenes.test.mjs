import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildScenesManifest,
  loadSceneSources,
  validateSceneSources,
} from '../scripts/generate-scenes.mjs'
import { loadAndValidate } from '../scripts/lib/catalog.mjs'

const fixtures = Promise.all([loadAndValidate(), loadSceneSources()]).then(
  ([{ catalog, errors }, sceneSources]) => {
    assert.deepEqual(errors, [])
    return { catalog, sceneSources }
  },
)

function changeScenes(sceneSources, change) {
  const scenes = structuredClone(sceneSources.scenes)
  change(scenes)
  return { ...sceneSources, scenes }
}

test('正式 M3 场景通过校验并恰好覆盖 gallery 的 24 个展品', async () => {
  const { catalog, sceneSources } = await fixtures
  assert.deepEqual(validateSceneSources(sceneSources, catalog), [])

  const manifest = buildScenesManifest(sceneSources)
  const galleryIds = catalog.collections
    .find((collection) => collection.id === 'gallery')
    .sections.flatMap((section) => section.exhibits)
    .toSorted()
  const placedIds = manifest.scenes
    .flatMap((scene) => scene.exhibits.map((placement) => placement.exhibit_id))
    .toSorted()

  assert.equal(manifest.schema_version, 1)
  assert.equal(manifest.start_scene, 'entrance')
  assert.equal(manifest.scenes.length, 6)
  assert.equal(placedIds.length, 24)
  assert.deepEqual(placedIds, galleryIds)
  assert.deepEqual(
    Object.fromEntries(manifest.scenes.map((scene) => [scene.id, scene.theme])),
    {
      archive: 'A',
      contemporary: 'C',
      entrance: 'AC',
      'memory-vault': 'A',
      official: 'AC',
      'tools-lab': 'C',
    },
  )
  assert.ok(manifest.scenes.every((scene) => !('start' in scene) && !('schema_version' in scene)))

  const formalSceneIds = ['entrance', 'contemporary', 'tools-lab', 'official', 'archive']
  const formalScenes = formalSceneIds.map((id) => manifest.scenes.find((scene) => scene.id === id))
  assert.ok(formalScenes.every((scene) => scene.collectibles.length === 1))
  assert.ok(
    formalScenes.every((scene) => scene.collectibles[0].asset_id === 'museum-memory-shard'),
  )
  assert.ok(formalScenes.every((scene) => scene.collectibles[0].kind === 'memory-fragment'))
  assert.ok(formalScenes.every((scene) => scene.collectibles[0].label.length > 0))
  const collectibleIds = formalScenes.map((scene) => scene.collectibles[0].id)
  assert.equal(new Set(collectibleIds).size, collectibleIds.length)
  assert.equal(manifest.scenes.find((scene) => scene.id === 'memory-vault').collectibles.length, 0)

  const interactions = new Set(
    manifest.scenes.flatMap((scene) =>
      scene.exhibits.map((placement) => placement.interaction).filter(Boolean),
    ),
  )
  assert.deepEqual(
    [...interactions].toSorted(),
    ['code', 'compare', 'device', 'filter', 'interface', 'terminal', 'timeline'],
  )
  assert.ok(manifest.scenes.every((scene) => scene.decorations.length >= 1))
  assert.ok(
    manifest.scenes
      .flatMap((scene) => scene.decorations)
      .every(
        (decoration) =>
          decoration.label.length > 0 &&
          ['poster', 'terminal'].includes(decoration.kind) &&
          typeof decoration.interactive === 'boolean' &&
          typeof decoration.blocking === 'boolean',
      ),
  )
  assert.ok(
    manifest.scenes.flatMap((scene) => scene.decorations).every((decoration) =>
      ['museum-concept-a', 'museum-concept-c', 'museum-concept-ac', 'museum-memory-shard'].includes(
        decoration.asset_id,
      ),
    ),
  )

  const archive = manifest.scenes.find((scene) => scene.id === 'archive')
  const vaultDoor = archive.portals.find((portal) => portal.id === 'to-memory-vault')
  assert.equal(vaultDoor.label, '开启记忆密库')
  assert.equal(vaultDoor.hidden, true)
  assert.equal(vaultDoor.requires_flag, 'collection:complete')
  assert.equal(vaultDoor.target_scene, 'memory-vault')
  assert.ok(manifest.scenes.find((scene) => scene.id === 'memory-vault').decorations[0].interactive)
})

test('场景清单不受 YAML 文件和无序实体排列影响', async () => {
  const { sceneSources } = await fixtures
  const reversed = changeScenes(sceneSources, (scenes) => {
    scenes.reverse()
    for (const scene of scenes) {
      scene.boundaries.reverse()
      scene.portals.reverse()
      scene.exhibits.reverse()
      scene.collectibles.reverse()
      scene.decorations.reverse()
    }
  })
  assert.deepEqual(buildScenesManifest(reversed), buildScenesManifest(sceneSources))
})

test('拒绝同一 gallery 展品重复放置', async () => {
  const { catalog, sceneSources } = await fixtures
  const changed = changeScenes(sceneSources, (scenes) => {
    const duplicate = structuredClone(scenes[0].exhibits[0])
    duplicate.x += 1
    scenes[1].exhibits.push(duplicate)
  })
  const errors = validateSceneSources(changed, catalog)
  assert.ok(errors.some((error) => error.includes('gallery 展品重复放置')))
})

test('拒绝跨场景重复的收藏品 ID', async () => {
  const { catalog, sceneSources } = await fixtures
  const changed = changeScenes(sceneSources, (scenes) => {
    const withCollectibles = scenes.filter((scene) => scene.collectibles.length > 0)
    withCollectibles[1].collectibles[0].id = withCollectibles[0].collectibles[0].id
  })
  const errors = validateSceneSources(changed, catalog)
  assert.ok(errors.some((error) => error.includes('收藏品 ID 全局重复')))
})

test('拒绝未知展品引用', async () => {
  const { catalog, sceneSources } = await fixtures
  const changed = changeScenes(sceneSources, (scenes) => {
    scenes[0].exhibits[0].exhibit_id = 'missing-exhibit'
  })
  const errors = validateSceneSources(changed, catalog)
  assert.ok(errors.some((error) => error.includes('找不到展品 missing-exhibit')))
})

test('拒绝越界坐标和落入碰撞边界的出生点', async () => {
  const { catalog, sceneSources } = await fixtures
  const outOfBounds = changeScenes(sceneSources, (scenes) => {
    scenes[0].spawn.x = scenes[0].width
  })
  assert.ok(
    validateSceneSources(outOfBounds, catalog).some((error) => error.includes('超出场景')),
  )

  const colliding = changeScenes(sceneSources, (scenes) => {
    scenes[0].spawn = { x: 0, y: 0 }
  })
  assert.ok(
    validateSceneSources(colliding, catalog).some((error) => error.includes('落在碰撞边界')),
  )
})

test('拒绝展品、收藏品和装饰共用坐标', async () => {
  const { catalog, sceneSources } = await fixtures
  const changed = changeScenes(sceneSources, (scenes) => {
    const scene = scenes.find((item) => item.exhibits.length > 0 && item.collectibles.length > 0)
    scene.collectibles[0].x = scene.exhibits[0].x
    scene.collectibles[0].y = scene.exhibits[0].y
  })
  const errors = validateSceneSources(changed, catalog)
  assert.ok(errors.some((error) => error.includes('共用坐标')))
})

test('拒绝不存在或没有双向互指的传送门', async () => {
  const { catalog, sceneSources } = await fixtures
  const missingScene = changeScenes(sceneSources, (scenes) => {
    scenes[0].portals[0].target_scene = 'missing-scene'
  })
  assert.ok(
    validateSceneSources(missingScene, catalog).some((error) =>
      error.includes('找不到场景 missing-scene'),
    ),
  )

  const notReciprocal = changeScenes(sceneSources, (scenes) => {
    scenes[0].portals[0].target_portal = scenes[1].portals[0].id
  })
  const errors = validateSceneSources(notReciprocal, catalog)
  assert.ok(
    errors.some(
      (error) => error.includes('找不到传送门') || error.includes('没有反向指回'),
    ),
  )
})

test('拒绝未登记的传送门条件旗标', async () => {
  const { catalog, sceneSources } = await fixtures
  const changed = changeScenes(sceneSources, (scenes) => {
    const archive = scenes.find((scene) => scene.id === 'archive')
    archive.portals.find((portal) => portal.id === 'to-memory-vault').requires_flag =
      'collection:unknown'
  })
  const errors = validateSceneSources(changed, catalog)
  assert.ok(errors.some((error) => error.includes('未知条件旗标 collection:unknown')))
})

test('场景展位不能复制展品事实字段', async () => {
  const { catalog, sceneSources } = await fixtures
  const changed = changeScenes(sceneSources, (scenes) => {
    scenes[0].exhibits[0].name = '不应写入场景的展品标题'
  })
  const errors = validateSceneSources(changed, catalog)
  assert.ok(errors.some((error) => error.includes('must NOT have additional properties')))
})
