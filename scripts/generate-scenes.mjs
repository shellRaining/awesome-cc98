import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import { loadAndValidate, projectRoot, readYaml } from './lib/catalog.mjs'

const knownPortalFlags = new Set(['collection:complete'])

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function formatAjvErrors(file, errors = []) {
  return errors.map((error) => `${file}${error.instancePath || '/'}: ${error.message}`)
}

function findDuplicates(values) {
  const seen = new Set()
  const duplicates = new Set()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates].sort(compareText)
}

function publicSceneSource(scene) {
  const { __file, __fileName, ...data } = scene
  return data
}

function pointInBounds(scene, point) {
  return point.x >= 0 && point.x < scene.width && point.y >= 0 && point.y < scene.height
}

function rectangleInBounds(scene, rectangle) {
  return (
    rectangle.x >= 0 &&
    rectangle.y >= 0 &&
    rectangle.x + rectangle.width <= scene.width &&
    rectangle.y + rectangle.height <= scene.height
  )
}

function pointInRectangle(point, rectangle) {
  return (
    point.x >= rectangle.x &&
    point.x < rectangle.x + rectangle.width &&
    point.y >= rectangle.y &&
    point.y < rectangle.y + rectangle.height
  )
}

function rectanglesOverlap(left, right) {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  )
}

function checkPoint(scene, point, location, errors) {
  if (!pointInBounds(scene, point)) {
    errors.push(`${location}: 坐标 (${point.x}, ${point.y}) 超出场景 ${scene.id} 边界`)
    return
  }
  const boundary = scene.boundaries.find((item) => pointInRectangle(point, item))
  if (boundary) errors.push(`${location}: 坐标落在碰撞边界 ${boundary.id} 内`)
}

function checkRectangle(scene, rectangle, location, errors) {
  if (!rectangleInBounds(scene, rectangle)) {
    errors.push(`${location}: 矩形超出场景 ${scene.id} 边界`)
  }
}

function canonicalPoint(point) {
  return { x: point.x, y: point.y }
}

function canonicalRectangle(rectangle) {
  return {
    id: rectangle.id,
    x: rectangle.x,
    y: rectangle.y,
    width: rectangle.width,
    height: rectangle.height,
  }
}

function canonicalPortal(portal) {
  const data = {
    ...canonicalRectangle(portal),
    target_scene: portal.target_scene,
    target_portal: portal.target_portal,
    target_spawn: canonicalPoint(portal.target_spawn),
  }
  if (portal.label !== undefined) data.label = portal.label
  if (portal.hidden !== undefined) data.hidden = portal.hidden
  if (portal.requires_flag !== undefined) data.requires_flag = portal.requires_flag
  return data
}

function canonicalExhibit(placement) {
  const data = {
    exhibit_id: placement.exhibit_id,
    x: placement.x,
    y: placement.y,
    facing: placement.facing,
    display: placement.display,
  }
  if (placement.interaction !== undefined) data.interaction = placement.interaction
  return data
}

function canonicalCollectible(collectible) {
  return {
    id: collectible.id,
    asset_id: collectible.asset_id,
    label: collectible.label,
    kind: collectible.kind,
    x: collectible.x,
    y: collectible.y,
  }
}

function canonicalDecoration(decoration) {
  return {
    id: decoration.id,
    asset_id: decoration.asset_id,
    kind: decoration.kind,
    label: decoration.label,
    interactive: decoration.interactive,
    x: decoration.x,
    y: decoration.y,
    width: decoration.width,
    height: decoration.height,
    blocking: decoration.blocking,
  }
}

function canonicalScene(scene) {
  return {
    id: scene.id,
    title: scene.title,
    theme: scene.theme,
    width: scene.width,
    height: scene.height,
    tile_size: scene.tile_size,
    spawn: canonicalPoint(scene.spawn),
    boundaries: scene.boundaries.map(canonicalRectangle).toSorted((left, right) =>
      compareText(left.id, right.id),
    ),
    portals: scene.portals.map(canonicalPortal).toSorted((left, right) =>
      compareText(left.id, right.id),
    ),
    exhibits: scene.exhibits.map(canonicalExhibit).toSorted((left, right) =>
      compareText(left.exhibit_id, right.exhibit_id),
    ),
    collectibles: scene.collectibles.map(canonicalCollectible).toSorted((left, right) =>
      compareText(left.id, right.id),
    ),
    decorations: scene.decorations.map(canonicalDecoration).toSorted((left, right) =>
      compareText(left.id, right.id),
    ),
  }
}

export async function loadSceneSources(root = projectRoot) {
  const scenesRoot = path.join(root, 'scenes')
  const [entries, schema] = await Promise.all([
    readdir(scenesRoot, { withFileTypes: true }),
    readFile(path.join(root, 'schemas', 'scene.schema.json'), 'utf8').then(JSON.parse),
  ])
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
    .map((entry) => path.join(scenesRoot, entry.name))
    .sort(compareText)
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  const validateSchema = ajv.compile(schema)
  const scenes = await Promise.all(
    files.map(async (file) => ({
      ...(await readYaml(file)),
      __file: file,
      __fileName: path.basename(file, '.yaml'),
    })),
  )
  return { root, scenes, validateSchema }
}

export function validateSceneSources(sceneSources, catalog) {
  const { root, scenes, validateSchema } = sceneSources
  const errors = []
  const validScenes = []

  for (const scene of scenes) {
    if (!validateSchema(publicSceneSource(scene))) {
      errors.push(...formatAjvErrors(scene.__file, validateSchema.errors))
      continue
    }
    validScenes.push(scene)
    if (scene.id !== scene.__fileName) {
      errors.push(`${scene.__file}/id: 必须与文件名 ${scene.__fileName} 一致`)
    }
  }

  if (scenes.length === 0) errors.push(`${path.join(root, 'scenes')}: 至少需要一个场景`)
  for (const duplicate of findDuplicates(validScenes.map((scene) => scene.id))) {
    errors.push(`场景 ID 重复: ${duplicate}`)
  }

  const startScenes = validScenes.filter((scene) => scene.start)
  if (startScenes.length !== 1) {
    errors.push(`必须且只能有一个起始场景，当前为 ${startScenes.length} 个`)
  }
  const sceneById = new Map(validScenes.map((scene) => [scene.id, scene]))
  const exhibitById = new Map(catalog.exhibits.map((exhibit) => [exhibit.id, exhibit]))
  const gallery = catalog.collections.find((collection) => collection.id === 'gallery')
  const galleryExhibitIds = gallery?.sections.flatMap((section) => section.exhibits) ?? []
  const galleryExhibitSet = new Set(galleryExhibitIds)
  const publishableAssetIds = new Set([
    ...catalog.sharedAssets.assets.filter((asset) => asset.publish === true).map((asset) => asset.id),
    ...catalog.exhibits
      .filter((exhibit) => exhibit.record.state === 'published')
      .flatMap((exhibit) => exhibit.assets.filter((asset) => asset.publish === true).map((asset) => asset.id)),
  ])
  const placedExhibits = []
  const configuredInteractions = new Set()

  if (!gallery) errors.push('缺少 collections/gallery.yaml')

  for (const scene of validScenes) {
    for (const [label, values] of [
      ['碰撞边界', scene.boundaries.map((item) => item.id)],
      ['传送门', scene.portals.map((item) => item.id)],
      ['收藏品', scene.collectibles.map((item) => item.id)],
      ['装饰', scene.decorations.map((item) => item.id)],
    ]) {
      for (const duplicate of findDuplicates(values)) {
        errors.push(`${scene.__file}: ${label} ID 重复: ${duplicate}`)
      }
    }

    scene.boundaries.forEach((boundary, index) =>
      checkRectangle(scene, boundary, `${scene.__file}/boundaries/${index}`, errors),
    )
    checkPoint(scene, scene.spawn, `${scene.__file}/spawn`, errors)

    scene.portals.forEach((portal, index) => {
      const location = `${scene.__file}/portals/${index}`
      checkRectangle(scene, portal, location, errors)
      if (portal.requires_flag && !knownPortalFlags.has(portal.requires_flag)) {
        errors.push(`${location}/requires_flag: 未知条件旗标 ${portal.requires_flag}`)
      }
      const blockingBoundary = scene.boundaries.find((boundary) => rectanglesOverlap(portal, boundary))
      if (blockingBoundary) {
        errors.push(`${location}: 与碰撞边界 ${blockingBoundary.id} 重叠`)
      }
    })

    scene.exhibits.forEach((placement, index) => {
      const location = `${scene.__file}/exhibits/${index}`
      placedExhibits.push({ id: placement.exhibit_id, location })
      if (placement.interaction) configuredInteractions.add(placement.interaction)
      checkPoint(scene, placement, location, errors)
      const exhibit = exhibitById.get(placement.exhibit_id)
      if (!exhibit) {
        errors.push(`${location}/exhibit_id: 找不到展品 ${placement.exhibit_id}`)
      } else if (exhibit.record.state !== 'published') {
        errors.push(`${location}/exhibit_id: 展品 ${placement.exhibit_id} 尚未发布`)
      } else if (!galleryExhibitSet.has(placement.exhibit_id)) {
        errors.push(`${location}/exhibit_id: 展品 ${placement.exhibit_id} 不属于 gallery 集合`)
      }
    })

    scene.collectibles.forEach((collectible, index) => {
      const location = `${scene.__file}/collectibles/${index}`
      checkPoint(scene, collectible, location, errors)
      if (!publishableAssetIds.has(collectible.asset_id)) {
        errors.push(`${location}/asset_id: 找不到可发布素材 ${collectible.asset_id}`)
      }
    })

    scene.decorations.forEach((decoration, index) => {
      const location = `${scene.__file}/decorations/${index}`
      checkRectangle(scene, decoration, location, errors)
      const boundary = scene.boundaries.find((item) => rectanglesOverlap(decoration, item))
      if (boundary) errors.push(`${location}: 与碰撞边界 ${boundary.id} 重叠`)
      const portal = scene.portals.find((item) => rectanglesOverlap(decoration, item))
      if (portal) errors.push(`${location}: 与传送门 ${portal.id} 重叠`)
      if (!publishableAssetIds.has(decoration.asset_id)) {
        errors.push(`${location}/asset_id: 找不到可发布素材 ${decoration.asset_id}`)
      }
    })

    if (scene.decorations.length === 0) {
      errors.push(`${scene.__file}: 每个场景至少需要一个美术展板或终端`)
    }

    const occupiedPoints = new Map()
    const pointEntries = [
      { point: scene.spawn, label: '出生点' },
      ...scene.exhibits.map((item) => ({ point: item, label: `展品 ${item.exhibit_id}` })),
      ...scene.collectibles.map((item) => ({ point: item, label: `收藏品 ${item.id}` })),
    ]
    for (const entry of pointEntries) {
      const key = `${entry.point.x},${entry.point.y}`
      const previous = occupiedPoints.get(key)
      if (previous) {
        errors.push(`${scene.__file}: ${entry.label} 与 ${previous} 共用坐标 (${key})`)
      } else {
        occupiedPoints.set(key, entry.label)
      }
      const decoration = scene.decorations.find((item) => pointInRectangle(entry.point, item))
      if (decoration) {
        errors.push(`${scene.__file}: ${entry.label} 与装饰 ${decoration.id} 重叠`)
      }
    }
  }

  for (const duplicate of findDuplicates(
    validScenes.flatMap((scene) => scene.collectibles.map((item) => item.id)),
  )) {
    errors.push(`收藏品 ID 全局重复: ${duplicate}`)
  }

  if (configuredInteractions.size < 7) {
    errors.push(`重点展品需要覆盖 7 种不同交互模板，当前为 ${configuredInteractions.size} 种`)
  }

  for (const scene of validScenes) {
    scene.portals.forEach((portal, index) => {
      const location = `${scene.__file}/portals/${index}`
      const targetScene = sceneById.get(portal.target_scene)
      if (!targetScene) {
        errors.push(`${location}/target_scene: 找不到场景 ${portal.target_scene}`)
        return
      }
      const targetPortal = targetScene.portals.find((item) => item.id === portal.target_portal)
      if (!targetPortal) {
        errors.push(
          `${location}/target_portal: 场景 ${targetScene.id} 中找不到传送门 ${portal.target_portal}`,
        )
      } else if (targetPortal.target_scene !== scene.id || targetPortal.target_portal !== portal.id) {
        errors.push(`${location}: 目标传送门 ${targetScene.id}/${targetPortal.id} 没有反向指回`)
      }
      checkPoint(targetScene, portal.target_spawn, `${location}/target_spawn`, errors)
    })
  }

  if (startScenes.length === 1) {
    const visited = new Set()
    const pending = [startScenes[0].id]
    while (pending.length > 0) {
      const sceneId = pending.shift()
      if (visited.has(sceneId)) continue
      visited.add(sceneId)
      for (const portal of sceneById.get(sceneId)?.portals ?? []) {
        if (sceneById.has(portal.target_scene) && !visited.has(portal.target_scene)) {
          pending.push(portal.target_scene)
        }
      }
    }
    for (const scene of validScenes) {
      if (!visited.has(scene.id)) errors.push(`${scene.__file}: 无法从起始场景到达`)
    }
  }

  const placementCounts = new Map()
  for (const placement of placedExhibits) {
    if (!galleryExhibitSet.has(placement.id)) continue
    placementCounts.set(placement.id, (placementCounts.get(placement.id) ?? 0) + 1)
  }
  for (const exhibitId of galleryExhibitIds) {
    const count = placementCounts.get(exhibitId) ?? 0
    if (count === 0) errors.push(`gallery 展品未放入任何场景: ${exhibitId}`)
    if (count > 1) errors.push(`gallery 展品重复放置 ${count} 次: ${exhibitId}`)
  }

  return errors.sort(compareText)
}

export function buildScenesManifest(sceneSources) {
  const startScene = sceneSources.scenes.find((scene) => scene.start)
  return {
    schema_version: 1,
    start_scene: startScene?.id ?? null,
    scenes: sceneSources.scenes.map(canonicalScene).toSorted((left, right) =>
      compareText(left.id, right.id),
    ),
  }
}

export async function loadAndValidateScenes(root = projectRoot) {
  const [{ catalog, errors: catalogErrors }, sceneSources] = await Promise.all([
    loadAndValidate(root),
    loadSceneSources(root),
  ])
  const sceneErrors = validateSceneSources(sceneSources, catalog)
  return {
    catalog,
    sceneSources,
    errors: [...catalogErrors, ...sceneErrors].sort(compareText),
  }
}

export async function generateScenes(root = projectRoot) {
  const { sceneSources, errors } = await loadAndValidateScenes(root)
  if (errors.length > 0) {
    throw new Error(`场景生成前校验失败：\n${errors.map((error) => `- ${error}`).join('\n')}`)
  }
  const manifest = buildScenesManifest(sceneSources)
  const generatedDirectory = path.join(root, 'generated')
  await mkdir(generatedDirectory, { recursive: true })
  await writeFile(path.join(generatedDirectory, 'scenes.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  const manifest = checkOnly
    ? await (async () => {
        const { sceneSources, errors } = await loadAndValidateScenes()
        if (errors.length > 0) {
          throw new Error(`场景校验失败：\n${errors.map((error) => `- ${error}`).join('\n')}`)
        }
        return buildScenesManifest(sceneSources)
      })()
    : await generateScenes()
  const exhibitCount = manifest.scenes.reduce((total, scene) => total + scene.exhibits.length, 0)
  const action = checkOnly ? '场景数据校验通过' : '已生成 generated/scenes.json'
  console.log(`${action}：${manifest.scenes.length} 个场景、${exhibitCount} 个展品位置`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
