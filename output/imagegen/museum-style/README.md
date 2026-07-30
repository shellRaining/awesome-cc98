# Museum style explorations

Generated on 2026-07-30 with the bundled `imagegen` CLI fallback and `gpt-image-2` at medium quality. The API credential was read from the local Codex configuration and was not copied into this directory.

These are concept previews, not approved runtime assets. Promote a selected direction through the normal asset review and manifest workflow before shipping it in the museum.

## A — warm nostalgic museum

- File: `style-a-warm-nostalgic.png`
- SHA-256: `2a9510b6d8deadd320ba14f33e316817326459eba09507bac09aa73a7d592788`
- Requested size: `1536x1024`
- Returned size: `1672x941`

Prompt:

> A production-ready visual style exploration for the entrance hall of a browser-based 2D museum exploration game. Show the entire compact room from a fixed three-quarter top-down orthographic game camera. A small anonymous and gender-neutral visitor stands at the center. Three display plinths hold a generic desktop computer, a smartphone, and an old handheld device. A creator portrait wall is visible at the back, with clear doorways leading to galleries on the left, right, and top. Keep broad walkable paths and readable collision boundaries. Warm nostalgic modern pixel art with a coherent 32-pixel tile scale, cream plaster walls, honey-colored wood floor, muted teal and dusty blue accents, soft afternoon lighting, gentle community-history atmosphere, polished indie game quality. This is an environment concept that must look practical to rebuild as tilemaps and sprites.

Composition:

> 16:9 landscape; full-room establishing view; fixed three-quarter top-down orthographic camera; centered visitor; symmetrical readable museum layout.

Constraints:

> No readable text; no letters; no logos; no trademarks; no watermark; no brand-specific imagery; no photorealism; no painterly blur; no extreme isometric perspective; keep floor grid and object silhouettes readable for game production.

## C — bright campus museum

- File: `style-c-bright-campus.png`
- SHA-256: `4b9f943ed4f6c8717c6c901b397dbda68c8d10d281f9180be49b2fea5e43cc62`
- Requested size: `1536x1024`
- Returned size: `1672x941`
- Edit source: `style-a-warm-nostalgic.png`

Prompt:

> Restyle this exact game environment into a bright, cute campus museum while preserving the exact camera angle, room silhouette, wall geometry, doorways, walkable paths, portrait wall, three exhibit plinths, device types, object placement, and anonymous visitor position and pose. Keep coherent modern pixel art and practical game-readable tiles. Use airy ivory walls, pale oak flooring, mint green, sky blue, soft peach and small lemon-yellow accents, rounded friendly furniture details, cheerful campus clubhouse warmth, clean sunny morning light, and a welcoming youthful atmosphere. Make it charming and polished but not childish. Change only the visual art direction; do not add or remove major objects. No readable text, letters, logos, trademarks, watermark, brand-specific imagery, photorealism, painterly blur, or extreme isometric perspective.

## A+C — warm campus museum

- File: `style-ac-warm-campus-v2.png`
- SHA-256: `2616b4f9317eb626bb34dd01c6bae256e5f270e5584fe3dc3aa56362e803d575`
- Requested size: `1536x1024`
- Returned size: `1672x941`
- Edit source: `style-a-warm-nostalgic.png`

Prompt:

> Restyle this exact game environment into a balanced fusion of a warm nostalgic museum and a bright cute campus clubhouse while preserving the exact camera angle, room silhouette, wall geometry, doorways, walkable paths, portrait wall, three exhibit plinths, device types, object placement, and anonymous visitor position and pose. Keep coherent modern pixel art and practical game-readable tiles. Use warm ivory plaster, honey-colored wood, muted teal, sky blue, soft coral and mustard accents, gentle rounded details, indoor plants, soft sunlit ambience, and a friendly community-history feeling. The result should feel cozy, lively and timeless rather than formal or childish. Change only the visual art direction; do not add or remove major objects. No readable text, letters, logos, trademarks, watermark, brand-specific imagery, photorealism, painterly blur, or extreme isometric perspective.

The first fusion request was stopped after the API connection remained open without returning a response for more than six minutes. A later retry completed normally; only the successful retry is retained as an image.
