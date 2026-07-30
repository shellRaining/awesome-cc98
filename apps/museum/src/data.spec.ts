import { describe, expect, it, vi } from 'vitest'
import {
  assetAttribution,
  assetPublicUrl,
  loadMuseumData,
  normalizeWorld,
  resolveAuthorAsset,
} from './data'
import type { AssetManifest, ExhibitAuthor } from './types'

describe('museum data', () => {
  it('normalizes object-based scenes and tile coordinates', () => {
    const world = normalizeWorld({
      schema_version: 1,
      start_scene: 'hall',
      scenes: {
        hall: {
          title: 'Hall',
          theme: 'C',
          width: 10,
          height: 8,
          tile_size: 16,
          spawn: [2, 3],
          boundaries: [[0, 0, 10, 1]],
          exhibits: [
            {
              id: 'demo',
              x: 4,
              y: 2,
              width: 2,
              height: 1,
              display: 'kiosk',
              facing: 'up',
              interaction: 'terminal',
            },
          ],
          portals: [
            {
              id: 'door',
              x: 9,
              y: 3,
              target_scene: 'hall',
              hidden: true,
              requires_flag: 'collection:complete',
            },
          ],
          collectibles: [
            {
              id: 'memory',
              asset_id: 'museum-memory-shard',
              label: '记忆碎片',
              kind: 'memory-fragment',
              x: 2,
              y: 5,
            },
          ],
          decorations: [
            {
              id: 'term',
              asset_id: 'museum-concept-c',
              kind: 'terminal',
              position: [1, 5],
              blocking: false,
            },
          ],
        },
      },
    })

    expect(world.startScene).toBe('hall')
    expect(world.scenes[0]).toMatchObject({ width: 160, height: 128, spawn: { x: 32, y: 48 } })
    expect(world.scenes[0]?.exhibits[0]).toMatchObject({
      exhibitId: 'demo',
      x: 64,
      width: 32,
      display: 'kiosk',
      facing: 'up',
      interaction: { type: 'terminal' },
    })
    expect(world.scenes[0]?.portals[0]).toMatchObject({
      hidden: true,
      requiresFlag: 'collection:complete',
    })
    expect(world.scenes[0]?.collectibles[0]).toMatchObject({
      assetId: 'museum-memory-shard',
      label: '记忆碎片',
    })
    expect(world.scenes[0]?.decorations[0]).toMatchObject({
      assetId: 'museum-concept-c',
      interactive: true,
      blocking: false,
    })
  })

  it('resolves an approved author avatar and attribution', () => {
    const author: ExhibitAuthor = {
      name: 'Example',
      primary_avatar_asset_key: 'shared:example',
    }
    const manifest: AssetManifest = {
      schema_version: 1,
      assets: [
        {
          key: 'shared:example',
          file: 'assets/authors/example name.png',
          rights: { attribution: '头像：Example' },
        },
      ],
    }
    const asset = resolveAuthorAsset(author, manifest)
    expect(asset).toBeDefined()
    expect(assetPublicUrl(asset!)).toBe('/assets/authors/example%20name.png')
    expect(assetAttribution(asset!)).toBe('头像：Example')
  })

  it('requests all three runtime endpoints and preserves partial failure', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('scenes.json')) return new Response('', { status: 404 })
      if (url.endsWith('catalog.json')) {
        return Response.json({ schema_version: 1, exhibits: [] })
      }
      return Response.json({ schema_version: 1, assets: [] })
    })
    const result = await loadMuseumData(fetcher)
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      '/data/catalog.json',
      '/data/assets.json',
      '/data/scenes.json',
    ])
    expect(result.catalog).toBeDefined()
    expect(result.assets).toBeDefined()
    expect(result.world).toBeUndefined()
    expect(result.errors[0]?.resource).toBe('scenes')
  })
})
