import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VOLUME,
  LEGACY_STORAGE_KEY,
  MUSEUM_STATE_VERSION,
  STORAGE_KEY,
  collectItem,
  defaultMuseumState,
  discoverExhibit,
  loadMuseumState,
  parseMuseumState,
  resetMuseumState,
  saveMuseumState,
  serializeMuseumState,
  setFavorite,
  setFlag,
  toggleFavorite,
  updateSettings,
  visitScene,
  type StorageLike,
} from './state'

class MemoryStorage implements StorageLike {
  values = new Map<string, string>()
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
}

describe('persistent museum state', () => {
  it('migrates the current v1 save into v2 storage', () => {
    const storage = new MemoryStorage()
    storage.values.set(
      LEGACY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        collected: ['two', 'one', 'one'],
        flags: { found: true, ignored: false },
        muted: true,
      }),
    )

    expect(loadMuseumState(storage)).toEqual({
      version: MUSEUM_STATE_VERSION,
      collected: ['one', 'two'],
      flags: { found: true },
      visitedScenes: [],
      discoveredExhibits: [],
      favorites: [],
      settings: {
        muted: true,
        reducedMotion: false,
        highContrast: false,
        performanceMode: false,
        volume: DEFAULT_VOLUME,
      },
      muted: true,
    })
    expect(storage.values.has(LEGACY_STORAGE_KEY)).toBe(false)
    expect(JSON.parse(storage.values.get(STORAGE_KEY) ?? '{}')).toEqual({
      version: MUSEUM_STATE_VERSION,
      collected: ['one', 'two'],
      flags: { found: true },
      visitedScenes: [],
      discoveredExhibits: [],
      favorites: [],
      settings: {
        muted: true,
        reducedMotion: false,
        highContrast: false,
        performanceMode: false,
        volume: DEFAULT_VOLUME,
      },
    })
  })

  it('keeps the pre-v1 collectibles migration compatible', () => {
    expect(
      parseMuseumState(
        JSON.stringify({ version: 0, collectibles: ['one', 'one', 'two'], flags: { found: true } }),
      ),
    ).toEqual({
      ...defaultMuseumState(),
      collected: ['one', 'two'],
      flags: { found: true },
    })
  })

  it('round-trips progress, favorites, settings, and the legacy mutation APIs', () => {
    const storage = new MemoryStorage()
    let state = loadMuseumState(storage)
    state = collectItem(state, 'fragment')
    state = collectItem(state, 'fragment')
    state = setFlag(state, 'terminal:spark')
    state = setFlag(state, 'terminal:spark')
    state = visitScene(state, 'hall-b')
    state = visitScene(state, 'hall-a')
    state = discoverExhibit(state, 'exhibit-b')
    state = discoverExhibit(state, 'exhibit-a')
    state = setFavorite(state, 'exhibit-b')
    state = setFavorite(state, 'exhibit-a')
    state = setFavorite(state, 'exhibit-b', false)
    state = toggleFavorite(state, 'exhibit-b')
    state = updateSettings(state, {
      muted: true,
      reducedMotion: true,
      highContrast: true,
      performanceMode: true,
      volume: 0.4,
    })

    saveMuseumState(storage, state)
    expect(loadMuseumState(storage)).toEqual(state)
    expect(state.visitedScenes).toEqual(['hall-a', 'hall-b'])
    expect(state.discoveredExhibits).toEqual(['exhibit-a', 'exhibit-b'])
    expect(state.favorites).toEqual(['exhibit-a', 'exhibit-b'])
    expect(state.muted).toBe(true)
    expect(state.settings.volume).toBe(0.4)
    expect(storage.values.has(STORAGE_KEY)).toBe(true)
  })

  it('keeps direct top-level muted updates compatible when saving', () => {
    const storage = new MemoryStorage()
    const state = { ...defaultMuseumState(), muted: true }
    saveMuseumState(storage, state)

    const loaded = loadMuseumState(storage)
    expect(loaded.muted).toBe(true)
    expect(loaded.settings.muted).toBe(true)
  })

  it('deduplicates and stably serializes semantically equal state', () => {
    const first = {
      ...defaultMuseumState(),
      collected: ['z', 'a', 'z'],
      flags: { z: true as const, a: true as const },
      visitedScenes: ['scene-b', 'scene-a', 'scene-b'],
      discoveredExhibits: ['work-b', 'work-a', 'work-b'],
      favorites: ['work-b', 'work-a', 'work-a'],
      settings: {
        muted: false,
        reducedMotion: true,
        highContrast: false,
        performanceMode: true,
        volume: 2,
      },
      muted: true,
    }
    const second = {
      ...defaultMuseumState(),
      collected: ['a', 'z'],
      flags: { a: true as const, z: true as const },
      visitedScenes: ['scene-a', 'scene-b'],
      discoveredExhibits: ['work-a', 'work-b'],
      favorites: ['work-a', 'work-b'],
      settings: {
        muted: true,
        reducedMotion: true,
        highContrast: false,
        performanceMode: true,
        volume: 1,
      },
      muted: true,
    }

    expect(serializeMuseumState(first)).toBe(serializeMuseumState(second))
    expect(parseMuseumState(serializeMuseumState(first))).toEqual({
      ...second,
      settings: { ...second.settings, muted: true },
    })
  })

  it('falls back safely for unknown versions and malformed JSON', () => {
    expect(parseMuseumState('{not-json')).toEqual(defaultMuseumState())
    expect(parseMuseumState(JSON.stringify(['not', 'a', 'state']))).toEqual(defaultMuseumState())
    expect(parseMuseumState(JSON.stringify({ version: 999, collected: ['stale'] }))).toEqual(
      defaultMuseumState(),
    )
  })

  it('sanitizes damaged fields without discarding valid progress', () => {
    expect(
      parseMuseumState(
        JSON.stringify({
          version: MUSEUM_STATE_VERSION,
          collected: ['valid', 1, '', 'valid'],
          flags: { valid: true, falseFlag: false, invalid: 'true' },
          visitedScenes: 'not-an-array',
          discoveredExhibits: ['known', null, 'known'],
          favorites: [false, 'favorite'],
          settings: {
            muted: 'yes',
            reducedMotion: true,
            highContrast: 1,
            performanceMode: false,
            volume: -0.5,
          },
        }),
      ),
    ).toEqual({
      ...defaultMuseumState(),
      collected: ['valid'],
      flags: { valid: true },
      discoveredExhibits: ['known'],
      favorites: ['favorite'],
      settings: {
        muted: false,
        reducedMotion: true,
        highContrast: false,
        performanceMode: false,
        volume: 0,
      },
    })
  })

  it('resets both storage versions and tolerates unavailable storage', () => {
    const storage = new MemoryStorage()
    storage.values.set(STORAGE_KEY, '{}')
    storage.values.set(LEGACY_STORAGE_KEY, '{}')
    expect(resetMuseumState(storage)).toEqual(defaultMuseumState())
    expect(storage.values.has(STORAGE_KEY)).toBe(false)
    expect(storage.values.has(LEGACY_STORAGE_KEY)).toBe(false)

    const unavailable: StorageLike = {
      getItem() {
        throw new Error('unavailable')
      },
      setItem() {
        throw new Error('unavailable')
      },
      removeItem() {
        throw new Error('unavailable')
      },
    }
    expect(loadMuseumState(unavailable)).toEqual(defaultMuseumState())
    expect(() => saveMuseumState(unavailable, defaultMuseumState())).not.toThrow()
    expect(() => resetMuseumState(unavailable)).not.toThrow()
  })
})
