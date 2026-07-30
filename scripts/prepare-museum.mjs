#!/usr/bin/env node

import { access, copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicRoot = path.join(projectRoot, 'apps', 'museum', 'public')
const generatedRoot = path.join(projectRoot, 'generated')

const runtimeFiles = ['catalog.json', 'assets.json', 'scenes.json']

function resolveProjectFile(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error('运行时素材缺少 file 路径')
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error(`运行时素材不能使用绝对路径：${relativePath}`)
  }
  const absolutePath = path.resolve(projectRoot, relativePath)
  const projectPrefix = `${projectRoot}${path.sep}`
  if (!absolutePath.startsWith(projectPrefix)) {
    throw new Error(`运行时素材路径越出仓库：${relativePath}`)
  }
  return absolutePath
}

async function copyRuntimeData() {
  const dataTarget = path.join(publicRoot, 'data')
  await rm(dataTarget, { recursive: true, force: true })
  await mkdir(dataTarget, { recursive: true })
  for (const filename of runtimeFiles) {
    const source = path.join(generatedRoot, filename)
    await access(source)
    await copyFile(source, path.join(dataTarget, filename))
  }
}

async function copyApprovedAssets() {
  const manifestPath = path.join(generatedRoot, 'assets.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (!Array.isArray(manifest.assets)) {
    throw new Error('generated/assets.json 缺少 assets 数组')
  }

  await Promise.all([
    rm(path.join(publicRoot, 'assets'), { recursive: true, force: true }),
    rm(path.join(publicRoot, 'exhibits'), { recursive: true, force: true }),
  ])

  const copied = new Set()
  for (const asset of manifest.assets) {
    if (asset.publish !== true) {
      throw new Error(`运行时素材清单包含未发布素材：${asset.id ?? '<unknown>'}`)
    }
    const relativePath = asset.file
    if (copied.has(relativePath)) continue
    const source = resolveProjectFile(relativePath)
    await access(source)
    const target = path.join(publicRoot, relativePath)
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(source, target)
    copied.add(relativePath)
  }
  return copied.size
}

await mkdir(publicRoot, { recursive: true })
await copyRuntimeData()
const assetCount = await copyApprovedAssets()

console.log(`博物馆运行时数据已准备：${runtimeFiles.length} 份 JSON，${assetCount} 个已批准素材`)
