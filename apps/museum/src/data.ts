import type {
  AssetManifest,
  AssetRecord,
  Catalog,
  CollectiblePlacement,
  DecorationPlacement,
  Exhibit,
  ExhibitAuthor,
  ExhibitInteractionType,
  ExhibitPlacement,
  MuseumSceneDefinition,
  MuseumWorld,
  Point,
  PortalPlacement,
  Rect,
} from './types'

function fromBase(relativePath: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`
  return `${base}${relativePath.replace(/^\/+/, '')}`
}

export const DATA_URLS = {
  catalog: fromBase('data/catalog.json'),
  assets: fromBase('data/assets.json'),
  scenes: fromBase('data/scenes.json'),
} as const

export class MuseumDataError extends Error {
  readonly resource: keyof typeof DATA_URLS

  constructor(resource: keyof typeof DATA_URLS, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MuseumDataError'
    this.resource = resource
  }
}

export interface DataLoadResult {
  catalog?: Catalog
  assets?: AssetManifest
  world?: MuseumWorld
  errors: MuseumDataError[]
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = numberValue(value, fallback)
  return parsed > 0 ? parsed : fallback
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

const INTERACTION_TYPES = new Set<ExhibitInteractionType>([
  'device',
  'interface',
  'compare',
  'terminal',
  'code',
  'timeline',
  'filter',
])

function interactionType(value: unknown): ExhibitInteractionType | undefined {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return INTERACTION_TYPES.has(normalized as ExhibitInteractionType)
    ? (normalized as ExhibitInteractionType)
    : undefined
}

function readPoint(value: unknown, fallback: Point = { x: 0, y: 0 }): Point {
  if (Array.isArray(value)) {
    return {
      x: numberValue(value[0], fallback.x),
      y: numberValue(value[1], fallback.y),
    }
  }
  if (isRecord(value)) {
    return {
      x: numberValue(value.x ?? value.col ?? value.left, fallback.x),
      y: numberValue(value.y ?? value.row ?? value.top, fallback.y),
    }
  }
  return { ...fallback }
}

function readRect(value: unknown, defaults: Rect): Rect {
  if (Array.isArray(value)) {
    return {
      x: numberValue(value[0], defaults.x),
      y: numberValue(value[1], defaults.y),
      width: positiveNumber(value[2], defaults.width),
      height: positiveNumber(value[3], defaults.height),
    }
  }
  if (isRecord(value)) {
    const position = readPoint(value.position ?? value.at ?? value, defaults)
    const size = Array.isArray(value.size) ? value.size : undefined
    return {
      ...position,
      width: positiveNumber(value.width ?? value.w ?? size?.[0], defaults.width),
      height: positiveNumber(value.height ?? value.h ?? size?.[1], defaults.height),
    }
  }
  return { ...defaults }
}

function scalePoint(point: Point, scale: number): Point {
  return { x: point.x * scale, y: point.y * scale }
}

function scaleRect(rect: Rect, scale: number): Rect {
  return {
    x: rect.x * scale,
    y: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  }
}

function normalizeCatalog(input: unknown): Catalog {
  if (!isRecord(input) || !Array.isArray(input.exhibits)) {
    throw new Error('catalog.json 缺少 exhibits 数组')
  }
  const exhibits = input.exhibits.filter(
    (item): item is Exhibit =>
      isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string',
  )
  if (input.exhibits.length > 0 && exhibits.length === 0) {
    throw new Error('catalog.json 没有可识别的展品')
  }
  return {
    ...(input as unknown as Catalog),
    schema_version: positiveNumber(input.schema_version, 1),
    exhibits,
  }
}

function normalizeAssets(input: unknown): AssetManifest {
  if (!isRecord(input) || !Array.isArray(input.assets)) {
    throw new Error('assets.json 缺少 assets 数组')
  }
  const assets = input.assets.filter(
    (item): item is AssetRecord =>
      isRecord(item) &&
      typeof item.key === 'string' &&
      typeof item.file === 'string' &&
      item.publish !== false,
  )
  return {
    schema_version: positiveNumber(input.schema_version, 1),
    assets,
  }
}

function normalizeScene(input: unknown, index: number): MuseumSceneDefinition {
  if (!isRecord(input)) throw new Error(`scenes[${index}] 不是对象`)

  const id = stringValue(input.id, `scene-${index + 1}`)
  const tileSize = positiveNumber(input.tile_size ?? input.tileSize, 32)
  const coordinateUnit = stringValue(input.coordinate_unit ?? input.coordinateUnit, 'tiles')
  const explicitPixels = coordinateUnit.toLowerCase().startsWith('pixel')
  const rawWidth = positiveNumber(input.width, 24)
  const rawHeight = positiveNumber(input.height, 18)
  const scale = explicitPixels || rawWidth > 256 || rawHeight > 256 ? 1 : tileSize
  const width = rawWidth * scale
  const height = rawHeight * scale
  const defaultRect = { x: 0, y: 0, width: 1, height: 1 }

  const records = (key: string): Record<string, unknown>[] => {
    const value = input[key]
    return Array.isArray(value) ? value.filter(isRecord) : []
  }

  const boundaries = records('boundaries').map((item) => scaleRect(readRect(item, defaultRect), scale))
  const exhibits: ExhibitPlacement[] = records('exhibits').map((item, itemIndex) => {
    const exhibitId = stringValue(
      item.exhibit_id ?? item.exhibitId ?? item.catalog_id ?? item.catalogId ?? item.id,
      `missing-exhibit-${itemIndex + 1}`,
    )
    const rawInteraction = isRecord(item.interaction) ? item.interaction : undefined
    const kind = interactionType(rawInteraction?.type ?? item.interaction)
    const displayValue = stringValue(item.display, 'pedestal').toLowerCase()
    const facingValue = stringValue(item.facing, 'down').toLowerCase()
    return {
      ...scaleRect(readRect(item, defaultRect), scale),
      id: stringValue(item.placement_id ?? item.placementId ?? item.id, `${id}:exhibit:${itemIndex}`),
      exhibitId,
      label: typeof item.label === 'string' ? item.label : undefined,
      display: ['wall', 'pedestal', 'kiosk'].includes(displayValue)
        ? (displayValue as ExhibitPlacement['display'])
        : 'pedestal',
      facing: ['up', 'down', 'left', 'right'].includes(facingValue)
        ? (facingValue as ExhibitPlacement['facing'])
        : 'down',
      interaction: kind
        ? {
            type: kind,
            title: typeof rawInteraction?.title === 'string' ? rawInteraction.title : undefined,
          }
        : undefined,
    }
  })
  const portals: PortalPlacement[] = records('portals').map((item, itemIndex) => {
    const nestedTarget = isRecord(item.target) ? item.target : undefined
    const targetSceneId = stringValue(
      item.target_scene ??
        item.targetScene ??
        item.target_scene_id ??
        item.targetSceneId ??
        item.to ??
        nestedTarget?.scene ??
        nestedTarget?.scene_id,
      id,
    )
    const rawTargetSpawn = item.target_spawn ?? item.targetSpawn ?? nestedTarget?.spawn
    return {
      ...scaleRect(readRect(item, defaultRect), scale),
      id: stringValue(item.id, `${id}:portal:${itemIndex}`),
      label: typeof item.label === 'string' ? item.label : undefined,
      targetSceneId,
      targetPortalId:
        typeof (item.target_portal ?? item.targetPortal ?? nestedTarget?.portal) === 'string'
          ? String(item.target_portal ?? item.targetPortal ?? nestedTarget?.portal)
          : undefined,
      targetSpawn: rawTargetSpawn === undefined ? undefined : scalePoint(readPoint(rawTargetSpawn), scale),
      hidden: item.hidden === true,
      requiresFlag:
        typeof (item.requires_flag ?? item.requiresFlag) === 'string'
          ? String(item.requires_flag ?? item.requiresFlag)
          : undefined,
    }
  })
  const collectibles: CollectiblePlacement[] = records('collectibles').map((item, itemIndex) => ({
    ...scaleRect(readRect(item, { ...defaultRect, width: 0.75, height: 0.75 }), scale),
    id: stringValue(item.id, `${id}:collectible:${itemIndex}`),
    assetId:
      typeof (item.asset_id ?? item.assetId) === 'string'
        ? String(item.asset_id ?? item.assetId)
        : undefined,
    label: typeof item.label === 'string' ? item.label : undefined,
    kind: typeof item.kind === 'string' ? item.kind : undefined,
  }))
  const decorations: DecorationPlacement[] = records('decorations').map((item, itemIndex) => {
    const kind = stringValue(item.kind ?? item.type, 'decoration')
    return {
      ...scaleRect(readRect(item, defaultRect), scale),
      id: stringValue(item.id, `${id}:decoration:${itemIndex}`),
      assetId:
        typeof (item.asset_id ?? item.assetId) === 'string'
          ? String(item.asset_id ?? item.assetId)
          : undefined,
      label: typeof item.label === 'string' ? item.label : undefined,
      kind,
      interactive: item.interactive === true || kind.toLowerCase() === 'terminal',
      blocking: item.blocking === true,
    }
  })

  return {
    id,
    title: stringValue(input.title, id),
    theme: stringValue(input.theme, 'A'),
    width,
    height,
    tileSize,
    spawn: scalePoint(readPoint(input.spawn, { x: 2, y: 2 }), scale),
    boundaries,
    portals,
    exhibits,
    collectibles,
    decorations,
  }
}

export function normalizeWorld(input: unknown): MuseumWorld {
  if (!isRecord(input)) throw new Error('scenes.json 不是对象')
  const rawScenes = Array.isArray(input.scenes)
    ? input.scenes
    : isRecord(input.scenes)
      ? Object.entries(input.scenes).map(([id, scene]) =>
          isRecord(scene) && typeof scene.id !== 'string' ? { ...scene, id } : scene,
        )
      : []
  const scenes = rawScenes.map(normalizeScene)
  if (scenes.length === 0) throw new Error('scenes.json 没有场景')
  const requestedStart = stringValue(input.start_scene ?? input.startScene, scenes[0]?.id ?? '')
  return {
    schemaVersion: positiveNumber(input.schema_version, 1),
    startScene: scenes.some((scene) => scene.id === requestedStart) ? requestedStart : scenes[0]!.id,
    scenes,
    isFallback: false,
  }
}

async function fetchJson(
  resource: keyof typeof DATA_URLS,
  fetcher: FetchLike,
): Promise<unknown> {
  const url = DATA_URLS[resource]
  let response: Response
  try {
    response = await fetcher(url, { headers: { Accept: 'application/json' } })
  } catch (error) {
    throw new MuseumDataError(resource, `无法读取 ${url}`, { cause: error })
  }
  if (!response.ok) {
    throw new MuseumDataError(resource, `${url} 返回 HTTP ${response.status}`)
  }
  try {
    return await response.json()
  } catch (error) {
    throw new MuseumDataError(resource, `${url} 不是有效 JSON`, { cause: error })
  }
}

export async function loadMuseumData(fetcher: FetchLike = fetch): Promise<DataLoadResult> {
  const resources = (Object.keys(DATA_URLS) as Array<keyof typeof DATA_URLS>).map(async (resource) => {
    const raw = await fetchJson(resource, fetcher)
    try {
      if (resource === 'catalog') return [resource, normalizeCatalog(raw)] as const
      if (resource === 'assets') return [resource, normalizeAssets(raw)] as const
      return [resource, normalizeWorld(raw)] as const
    } catch (error) {
      throw new MuseumDataError(resource, `${DATA_URLS[resource]} 结构无法识别`, { cause: error })
    }
  })

  const settled = await Promise.allSettled(resources)
  const result: DataLoadResult = { errors: [] }
  for (const item of settled) {
    if (item.status === 'rejected') {
      result.errors.push(
        item.reason instanceof MuseumDataError
          ? item.reason
          : new MuseumDataError('scenes', '读取博物馆数据失败', { cause: item.reason }),
      )
      continue
    }
    const [resource, value] = item.value
    if (resource === 'catalog') result.catalog = value as Catalog
    if (resource === 'assets') result.assets = value as AssetManifest
    if (resource === 'scenes') result.world = value as MuseumWorld
  }
  return result
}

export function resolveAuthorAsset(
  author: ExhibitAuthor,
  manifest: AssetManifest | undefined,
): AssetRecord | undefined {
  if (!manifest) return undefined
  const candidates = [author.primary_avatar_asset_key, ...(author.avatar_asset_keys ?? [])].filter(
    (key): key is string => typeof key === 'string' && key.length > 0,
  )
  return candidates.map((key) => manifest.assets.find((asset) => asset.key === key)).find(Boolean)
}

export function assetPublicUrl(asset: AssetRecord): string {
  const clean = asset.file.replace(/^\/+/, '')
  const encoded = clean.split('/').map(encodeURIComponent).join('/')
  return fromBase(encoded)
}

export function assetAttribution(asset: AssetRecord): string {
  return asset.rights?.attribution ?? asset.rights?.creator ?? asset.alt ?? '来源见素材清单'
}

export function formatLicense(exhibit: Exhibit): string {
  if (exhibit.license?.spdx) return exhibit.license.spdx
  return exhibit.license?.status === 'declared' ? '已声明（未提供 SPDX）' : '未发现明确许可证'
}
