import { readFile, mkdir, copyFile } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'

const museumRoot = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(museumRoot, '../..')
const generatedRoot = path.join(repositoryRoot, 'generated')
const runtimeFiles = ['catalog.json', 'assets.json', 'scenes.json'] as const

function isInside(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

function resolveApprovedAsset(relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/')
  const allowed =
    /^assets\/[A-Za-z0-9._/-]+$/.test(normalized) ||
    /^exhibits\/[a-z0-9]+(?:-[a-z0-9]+)*\/assets\/[A-Za-z0-9._/-]+$/.test(normalized)
  if (!allowed || path.isAbsolute(relativePath)) {
    throw new Error(`无效素材路径：${relativePath}`)
  }
  const resolved = path.resolve(repositoryRoot, relativePath)
  if (!isInside(resolved, repositoryRoot)) throw new Error(`素材路径越出仓库：${relativePath}`)
  return resolved
}

function contentType(filename: string): string {
  const extension = path.extname(filename).toLowerCase()
  return (
    {
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml; charset=utf-8',
    }[extension] ?? 'application/octet-stream'
  )
}

async function sendFile(
  server: ViteDevServer,
  filename: string,
  requestMethod: string | undefined,
  response: ServerResponse,
): Promise<void> {
  try {
    const content = await readFile(filename)
    response.statusCode = 200
    response.setHeader('Content-Type', contentType(filename))
    response.setHeader('Cache-Control', 'no-cache')
    if (requestMethod === 'HEAD') response.end()
    else response.end(content)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      server.config.logger.error(`无法读取博物馆数据：${filename}`)
    }
    response.statusCode = 404
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ error: 'not_found' }))
  }
}

function runtimeDataPlugin(): Plugin {
  return {
    name: 'awesome-cc98-runtime-data',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url || !['GET', 'HEAD'].includes(request.method ?? 'GET')) return next()
        let pathname: string
        try {
          pathname = decodeURIComponent(new URL(request.url, 'http://museum.local').pathname)
        } catch {
          return next()
        }

        const configuredBase = server.config.base === './' ? '/' : server.config.base
        const requestPath =
          configuredBase !== '/' && pathname.startsWith(configuredBase)
            ? `/${pathname.slice(configuredBase.length)}`
            : pathname
        const runtimeName = runtimeFiles.find((name) => requestPath === `/data/${name}`)
        if (runtimeName) {
          void sendFile(server, path.join(generatedRoot, runtimeName), request.method, response)
          return
        }

        if (!requestPath.startsWith('/assets/') && !requestPath.startsWith('/exhibits/')) return next()
        let filename: string
        try {
          filename = resolveApprovedAsset(requestPath.slice(1))
        } catch {
          response.statusCode = 403
          response.end('Forbidden')
          return
        }
        void sendFile(server, filename, request.method, response)
      })
    },
    async closeBundle() {
      const dataTarget = path.join(museumRoot, 'dist', 'data')
      await mkdir(dataTarget, { recursive: true })
      for (const name of runtimeFiles) {
        try {
          await copyFile(path.join(generatedRoot, name), path.join(dataTarget, name))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || name !== 'scenes.json') throw error
        }
      }

      const rawManifest = JSON.parse(await readFile(path.join(generatedRoot, 'assets.json'), 'utf8')) as {
        assets?: Array<{ file?: string; publish?: boolean }>
      }
      for (const asset of rawManifest.assets ?? []) {
        if (asset.publish !== true || typeof asset.file !== 'string') continue
        const source = resolveApprovedAsset(asset.file)
        const target = path.resolve(museumRoot, 'dist', asset.file)
        if (!isInside(target, path.join(museumRoot, 'dist'))) {
          throw new Error(`无效素材路径：${asset.file}`)
        }
        await mkdir(path.dirname(target), { recursive: true })
        await copyFile(source, target)
      }
    },
  }
}

export default defineConfig({
  base: process.env.MUSEUM_BASE_URL ?? '/',
  plugins: [runtimeDataPlugin()],
  server: {
    host: '127.0.0.1',
    port: 4173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4174,
  },
  build: {
    target: 'es2022',
  },
})
