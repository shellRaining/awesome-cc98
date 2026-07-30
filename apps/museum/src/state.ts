export const MUSEUM_STATE_VERSION = 2 as const
export const STORAGE_KEY = 'awesome-cc98:museum:v2'
export const LEGACY_STORAGE_KEY = 'awesome-cc98:museum:v1'
export const DEFAULT_VOLUME = 0.65

export interface MuseumSettings {
  muted: boolean
  reducedMotion: boolean
  highContrast: boolean
  performanceMode: boolean
  volume: number
}

export interface MuseumState {
  version: typeof MUSEUM_STATE_VERSION
  collected: string[]
  flags: Record<string, true>
  visitedScenes: string[]
  discoveredExhibits: string[]
  favorites: string[]
  settings: MuseumSettings
  /** @deprecated Use settings.muted and updateSettings for new code. */
  muted: boolean
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

type UnknownRecord = Record<string, unknown>

const booleanSettingKeys = [
  'muted',
  'reducedMotion',
  'highContrast',
  'performanceMode',
] as const satisfies readonly Exclude<keyof MuseumSettings, 'volume'>[]

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0)),
  ].sort(compareText)
}

function trueFlags(value: unknown): Record<string, true> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, true] => entry[0].length > 0 && entry[1] === true)
      .sort(([left], [right]) => compareText(left, right)),
  )
}

function clampVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_VOLUME
  return Math.min(1, Math.max(0, value))
}

function parseSettings(value: unknown, legacyMuted: unknown): MuseumSettings {
  const source = isRecord(value) ? value : {}
  return {
    muted: typeof source.muted === 'boolean' ? source.muted : legacyMuted === true,
    reducedMotion: source.reducedMotion === true,
    highContrast: source.highContrast === true,
    performanceMode: source.performanceMode === true,
    volume: clampVolume(source.volume),
  }
}

function stateFromRecord(record: UnknownRecord): MuseumState {
  const settings = parseSettings(record.settings, record.muted)
  const collectedSource =
    record.version === 0
      ? record.collectibles ?? record.collected
      : record.collected ?? record.collectibles
  return {
    version: MUSEUM_STATE_VERSION,
    collected: uniqueStrings(collectedSource),
    flags: trueFlags(record.flags),
    visitedScenes: uniqueStrings(record.visitedScenes),
    discoveredExhibits: uniqueStrings(record.discoveredExhibits),
    favorites: uniqueStrings(record.favorites),
    settings,
    muted: settings.muted,
  }
}

function decodeMuseumState(raw: string): MuseumState | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return null
    if (
      parsed.version !== undefined &&
      parsed.version !== 0 &&
      parsed.version !== 1 &&
      parsed.version !== MUSEUM_STATE_VERSION
    ) {
      return null
    }
    return stateFromRecord(parsed)
  } catch {
    return null
  }
}

function runtimeSettings(state: MuseumState): MuseumSettings {
  const source: unknown = state.settings
  const settings = parseSettings(source, state.muted)
  return {
    ...settings,
    muted: typeof state.muted === 'boolean' ? state.muted : settings.muted,
  }
}

function canonicalMuseumState(state: MuseumState): MuseumState {
  const settings = runtimeSettings(state)
  return {
    version: MUSEUM_STATE_VERSION,
    collected: uniqueStrings(state.collected),
    flags: trueFlags(state.flags),
    visitedScenes: uniqueStrings(state.visitedScenes),
    discoveredExhibits: uniqueStrings(state.discoveredExhibits),
    favorites: uniqueStrings(state.favorites),
    settings,
    muted: settings.muted,
  }
}

export function defaultMuseumState(): MuseumState {
  const settings: MuseumSettings = {
    muted: false,
    reducedMotion: false,
    highContrast: false,
    performanceMode: false,
    volume: DEFAULT_VOLUME,
  }
  return {
    version: MUSEUM_STATE_VERSION,
    collected: [],
    flags: {},
    visitedScenes: [],
    discoveredExhibits: [],
    favorites: [],
    settings,
    muted: settings.muted,
  }
}

export function parseMuseumState(raw: string | null): MuseumState {
  if (!raw) return defaultMuseumState()
  return decodeMuseumState(raw) ?? defaultMuseumState()
}

export function serializeMuseumState(state: MuseumState): string {
  const canonical = canonicalMuseumState(state)
  return JSON.stringify({
    version: canonical.version,
    collected: canonical.collected,
    flags: canonical.flags,
    visitedScenes: canonical.visitedScenes,
    discoveredExhibits: canonical.discoveredExhibits,
    favorites: canonical.favorites,
    settings: canonical.settings,
  })
}

export function loadMuseumState(storage: StorageLike | undefined): MuseumState {
  if (!storage) return defaultMuseumState()
  try {
    const current = storage.getItem(STORAGE_KEY)
    if (current !== null) return decodeMuseumState(current) ?? defaultMuseumState()

    const legacy = storage.getItem(LEGACY_STORAGE_KEY)
    if (legacy === null) return defaultMuseumState()
    const migrated = decodeMuseumState(legacy)
    if (!migrated) return defaultMuseumState()
    try {
      storage.setItem(STORAGE_KEY, serializeMuseumState(migrated))
      storage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      // Keep the migrated in-memory state if persistence is unavailable.
    }
    return migrated
  } catch {
    return defaultMuseumState()
  }
}

export function saveMuseumState(storage: StorageLike | undefined, state: MuseumState): void {
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, serializeMuseumState(state))
  } catch {
    // Private browsing and quota errors must not stop the museum.
  }
}

export function resetMuseumState(storage: StorageLike | undefined): MuseumState {
  for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    try {
      storage?.removeItem(key)
    } catch {
      // Keep clearing other known versions when one removal fails.
    }
  }
  return defaultMuseumState()
}

function addUniqueString(values: string[], id: string): string[] | null {
  if (id.length === 0 || values.includes(id)) return null
  return [...values, id].sort(compareText)
}

export function collectItem(state: MuseumState, id: string): MuseumState {
  const collected = addUniqueString(state.collected, id)
  return collected ? { ...state, collected } : state
}

export function setFlag(state: MuseumState, flag: string): MuseumState {
  if (flag.length === 0 || state.flags[flag] === true) return state
  return { ...state, flags: trueFlags({ ...state.flags, [flag]: true }) }
}

export function visitScene(state: MuseumState, sceneId: string): MuseumState {
  const visitedScenes = addUniqueString(state.visitedScenes, sceneId)
  return visitedScenes ? { ...state, visitedScenes } : state
}

export function discoverExhibit(state: MuseumState, exhibitId: string): MuseumState {
  const discoveredExhibits = addUniqueString(state.discoveredExhibits, exhibitId)
  return discoveredExhibits ? { ...state, discoveredExhibits } : state
}

export function setFavorite(state: MuseumState, exhibitId: string, favorite = true): MuseumState {
  if (exhibitId.length === 0) return state
  if (favorite) {
    const favorites = addUniqueString(state.favorites, exhibitId)
    return favorites ? { ...state, favorites } : state
  }
  if (!state.favorites.includes(exhibitId)) return state
  return { ...state, favorites: state.favorites.filter((id) => id !== exhibitId) }
}

export function toggleFavorite(state: MuseumState, exhibitId: string): MuseumState {
  return setFavorite(state, exhibitId, !state.favorites.includes(exhibitId))
}

export function updateSettings(
  state: MuseumState,
  patch: Partial<MuseumSettings>,
): MuseumState {
  const current = runtimeSettings(state)
  const settings = { ...current }
  for (const key of booleanSettingKeys) {
    const value = patch[key]
    if (typeof value === 'boolean') settings[key] = value
  }
  if (typeof patch.volume === 'number' && Number.isFinite(patch.volume)) {
    settings.volume = clampVolume(patch.volume)
  }
  if (
    booleanSettingKeys.every((key) => settings[key] === current[key]) &&
    settings.volume === current.volume &&
    state.muted === settings.muted
  ) {
    return state
  }
  return { ...state, settings, muted: settings.muted }
}
