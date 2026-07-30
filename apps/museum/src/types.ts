export interface Point {
  x: number
  y: number
}

export interface Rect extends Point {
  width: number
  height: number
}

export interface ExhibitAuthor {
  name: string
  role?: string
  url?: string
  avatar_asset_keys?: string[]
  primary_avatar_asset_key?: string | null
}

export interface ExhibitLink {
  id?: string
  kind?: string
  label?: string
  url: string
  access?: string
}

export interface ExhibitLicense {
  status?: string
  spdx?: string | null
  source_ref?: string | null
}

export interface Exhibit {
  id: string
  name: string
  aliases?: string[]
  tagline?: string
  summary?: string
  classification?: {
    kind?: string
    era?: string
    tags?: string[]
  }
  platforms?: {
    claimed?: Array<{ id: string }>
    released?: Array<{ id: string }>
  }
  lifecycle?: {
    stage?: string
    maintenance?: string
    availability?: string
  }
  authors?: ExhibitAuthor[]
  features?: Array<{ title: string; confidence?: string }>
  links?: ExhibitLink[]
  license?: ExhibitLicense
}

export interface Catalog {
  schema_version: number
  catalog_updated_at?: string
  exhibits: Exhibit[]
}

export interface AssetRecord {
  key: string
  id?: string
  role?: string
  file: string
  media_type?: string
  alt?: string
  publish?: boolean
  subject?: {
    name?: string
    profile_url?: string
    platform?: string
    account_name?: string
  }
  rights?: {
    status?: string
    license?: string | null
    attribution?: string
    creator?: string
  }
}

export type ExhibitInteractionType =
  | 'device'
  | 'interface'
  | 'compare'
  | 'terminal'
  | 'code'
  | 'timeline'
  | 'filter'

export interface ExhibitInteraction {
  type: ExhibitInteractionType
  title?: string
}

export interface AssetManifest {
  schema_version: number
  assets: AssetRecord[]
}

export interface ExhibitPlacement extends Rect {
  id: string
  exhibitId: string
  label?: string
  display: 'wall' | 'pedestal' | 'kiosk'
  facing: 'up' | 'down' | 'left' | 'right'
  interaction?: ExhibitInteraction
}

export interface PortalPlacement extends Rect {
  id: string
  label?: string
  targetSceneId: string
  targetPortalId?: string
  targetSpawn?: Point
  hidden: boolean
  requiresFlag?: string
}

export interface CollectiblePlacement extends Rect {
  id: string
  assetId?: string
  label?: string
  kind?: string
}

export interface DecorationPlacement extends Rect {
  id: string
  assetId?: string
  label?: string
  kind: string
  interactive: boolean
  blocking: boolean
}

export interface MuseumSceneDefinition {
  id: string
  title: string
  theme: string
  width: number
  height: number
  tileSize: number
  spawn: Point
  boundaries: Rect[]
  portals: PortalPlacement[]
  exhibits: ExhibitPlacement[]
  collectibles: CollectiblePlacement[]
  decorations: DecorationPlacement[]
}

export interface MuseumWorld {
  schemaVersion: number
  startScene: string
  scenes: MuseumSceneDefinition[]
  isFallback: boolean
}

export type InteractionTarget =
  | { type: 'exhibit'; distance: number; value: ExhibitPlacement }
  | { type: 'portal'; distance: number; value: PortalPlacement }
  | { type: 'collectible'; distance: number; value: CollectiblePlacement }
  | { type: 'decoration'; distance: number; value: DecorationPlacement }

export interface PortalDestination {
  sceneId: string
  spawn: Point
}
