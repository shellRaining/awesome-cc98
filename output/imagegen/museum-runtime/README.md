# Museum runtime image generation

Generated on 2026-07-30 with the bundled `imagegen` CLI fallback and
`gpt-image-2` at medium quality. The API credential was read from the local
Codex configuration and was not copied into this directory.

## Memory shard collectible

- Chroma-key source: `memory-shard-source.png`
- Alpha master: `memory-shard.png`
- Requested size: `1024x1024`
- Returned size: `1254x1254`
- Source SHA-256: `23b70ef1651219e1d344845351d2fd1da55b1deffc4317bedf14283f6f64335a`
- Alpha master SHA-256: `949195c01a7b802283d49538c052121ab4d685ba6923b280bdb80f48cd703e00`
- Runtime derivative: `assets/museum/memory-shard.webp`
- Runtime derivative SHA-256: `2818df2d41a6dcebbda1705e7ad62c6d73347fdcff983cda5bdc2486a1705c43`

Prompt:

> Use case: stylized-concept. Asset type: collectible icon for a browser 2D museum exploration game. Primary request: one single magical memory shard shaped like a small faceted museum admission token, combining a warm amber core with muted teal enamel and one tiny coral accent. Style/medium: polished modern pixel art, crisp chunky pixels, readable at 32 by 32 pixels, friendly indie-game quality. Composition: centered single object, front three-quarter view, generous empty padding, strong simple silhouette. Scene/backdrop: a perfectly flat solid #ff00ff chroma-key background for later removal. Constraints: exactly one object; no cast shadow; no contact shadow; no reflection; no floor plane; background must be one uniform color with no gradient, texture, lighting variation, or noise; do not use #ff00ff anywhere in the object; no text, letters, numbers, logo, trademark, watermark, character, hands, or extra props.

Post-processing:

- Removed the sampled chroma-key border with the installed `imagegen`
  `remove_chroma_key.py` helper using soft matte and despill.
- Trimmed, resized and centered the result on a transparent 256×256 canvas.
- Encoded the runtime derivative as WebP while retaining alpha.
