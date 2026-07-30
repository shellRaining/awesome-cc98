import { describe, expect, it } from 'vitest'
import { findNearestInteraction, resolvePortalDestination } from './geometry'
import type { MuseumSceneDefinition } from '../types'

function scene(overrides: Partial<MuseumSceneDefinition> = {}): MuseumSceneDefinition {
  return {
    id: 'a',
    title: 'A',
    theme: 'A',
    width: 320,
    height: 240,
    tileSize: 32,
    spawn: { x: 32, y: 32 },
    boundaries: [],
    portals: [],
    exhibits: [],
    collectibles: [],
    decorations: [],
    ...overrides,
  }
}

describe('world geometry', () => {
  it('selects the nearest uncollected interaction', () => {
    const current = scene({
      exhibits: [
        {
          id: 'stand',
          exhibitId: 'work',
          x: 80,
          y: 80,
          width: 32,
          height: 32,
          display: 'pedestal',
          facing: 'down',
        },
      ],
      collectibles: [{ id: 'near', x: 55, y: 55, width: 10, height: 10 }],
    })
    expect(findNearestInteraction({ x: 50, y: 50 }, current, new Set(), 60)?.type).toBe(
      'collectible',
    )
    expect(findNearestInteraction({ x: 50, y: 50 }, current, new Set(['near']), 60)?.type).toBe(
      'exhibit',
    )
  })

  it('resolves a paired portal to a safe inward spawn', () => {
    const destination = scene({
      id: 'b',
      portals: [
        {
          id: 'return',
          x: 0,
          y: 80,
          width: 16,
          height: 64,
          targetSceneId: 'a',
          hidden: false,
        },
      ],
    })
    const resolved = resolvePortalDestination(
      [destination],
      {
        id: 'go',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        targetSceneId: 'b',
        targetPortalId: 'return',
        hidden: false,
      },
    )
    expect(resolved).toEqual({ sceneId: 'b', spawn: { x: 48, y: 112 } })
  })
})
