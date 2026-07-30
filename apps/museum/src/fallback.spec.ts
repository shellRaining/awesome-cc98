import { describe, expect, it } from 'vitest'
import { createFallbackWorld } from './fallback'

describe('fallback world', () => {
  it('derives placements from catalog ids without embedded exhibit facts', () => {
    const exhibits = Array.from({ length: 13 }, (_, index) => ({
      id: `item-${index}`,
      name: `Display ${index}`,
    }))
    const world = createFallbackWorld({ exhibits })
    expect(world.isFallback).toBe(true)
    expect(world.scenes).toHaveLength(2)
    expect(world.scenes.flatMap((scene) => scene.exhibits).map((item) => item.exhibitId)).toEqual(
      exhibits.map((item) => item.id),
    )
    expect(world.scenes[0]?.portals[0]?.targetSceneId).toBe('demo-b')
  })

  it('still creates an explorable terminal room for an empty catalog', () => {
    const world = createFallbackWorld({ exhibits: [] })
    expect(world.scenes).toHaveLength(1)
    expect(world.scenes[0]?.decorations.some((item) => item.kind === 'terminal')).toBe(true)
  })
})
