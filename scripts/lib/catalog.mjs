import { createHash } from 'node:crypto'
import { access, lstat, readdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { isAlias, isMap, isPair, isSeq, parseDocument } from 'yaml'

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const publishableRights = new Set(['licensed', 'permission_granted', 'self_created', 'generated'])
const committablePrivacy = new Set(['clear', 'public_promotion', 'public_identity'])
const ignoredAssetEntryNames = new Set([
  '.ds_store',
  '.spotlight-v100',
  '.trashes',
  'desktop.ini',
  'thumbs.db',
])

function pathIsWithin(directory, candidate) {
  const relative = path.relative(directory, candidate)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

function displayPath(root, file) {
  const relative = path.relative(root, file)
  return pathIsWithin(root, file) ? relative.split(path.sep).join('/') : file
}

function resolveAssetFile(baseDirectory, file) {
  const assetsDirectory = path.resolve(baseDirectory, 'assets')
  const absoluteFile = path.resolve(baseDirectory, file)
  return {
    assetsDirectory,
    absoluteFile,
    safe: pathIsWithin(assetsDirectory, absoluteFile),
  }
}

function ignoredAssetEntry(name) {
  return ignoredAssetEntryNames.has(name.toLowerCase()) || name.startsWith('._')
}

function walkYamlNode(node, file) {
  if (!node) return
  if (isAlias(node)) throw new Error(`${file}: 禁止使用 YAML alias`)
  if (node.anchor) throw new Error(`${file}: 禁止使用 YAML anchor`)
  if (node.tag) throw new Error(`${file}: 禁止使用自定义 YAML tag`)
  if (isPair(node)) {
    walkYamlNode(node.key, file)
    walkYamlNode(node.value, file)
    return
  }
  if (isMap(node) || isSeq(node)) {
    for (const item of node.items) walkYamlNode(item, file)
  }
}

export async function readYaml(file) {
  const source = await readFile(file, 'utf8')
  const document = parseDocument(source, {
    schema: 'core',
    uniqueKeys: true,
    merge: false,
    prettyErrors: true,
  })
  if (document.errors.length > 0) {
    throw new Error(document.errors.map((error) => `${file}: ${error.message}`).join('\n'))
  }
  walkYamlNode(document.contents, file)
  return document.toJS({ maxAliasCount: 0 })
}

async function listExhibitFiles(root) {
  const exhibitsRoot = path.join(root, 'exhibits')
  const entries = await readdir(exhibitsRoot, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      directoryName: entry.name,
      file: path.join(exhibitsRoot, entry.name, 'exhibit.yaml'),
      directory: path.join(exhibitsRoot, entry.name),
    }))
    .sort((a, b) => a.directoryName.localeCompare(b.directoryName))
}

async function listCollectionFiles(root) {
  const collectionsRoot = path.join(root, 'collections')
  const entries = await readdir(collectionsRoot, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
    .map((entry) => path.join(collectionsRoot, entry.name))
    .sort()
}

async function buildValidators(root) {
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  const [exhibitSchema, collectionSchema, assetsSchema] = await Promise.all([
    readFile(path.join(root, 'schemas/exhibit.schema.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'schemas/collection.schema.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'schemas/assets.schema.json'), 'utf8').then(JSON.parse),
  ])
  return {
    exhibit: ajv.compile(exhibitSchema),
    collection: ajv.compile(collectionSchema),
    assets: ajv.compile(assetsSchema),
  }
}

function formatAjvErrors(file, errors = []) {
  return errors.map((error) => {
    const location = error.instancePath || '/'
    return `${file}${location}: ${error.message}`
  })
}

function findDuplicates(values) {
  const seen = new Set()
  const duplicates = new Set()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}

function checkSourceRefs(exhibit, errors) {
  const sourceIds = new Set(exhibit.sources.map((source) => source.id))
  const check = (sourceRefs, location) => {
    for (const sourceRef of sourceRefs ?? []) {
      if (!sourceIds.has(sourceRef)) {
        errors.push(`${exhibit.__file}${location}: 找不到来源 ${sourceRef}`)
      }
    }
  }

  exhibit.authors.forEach((author, index) => check(author.source_refs, `/authors/${index}/source_refs`))
  exhibit.features.forEach((feature, index) => check(feature.source_refs, `/features/${index}/source_refs`))
  for (const group of ['claimed', 'released']) {
    exhibit.platforms[group].forEach((platform, index) =>
      check(platform.source_refs, `/platforms/${group}/${index}/source_refs`),
    )
  }
  exhibit.links.forEach((link, index) => check(link.source_refs, `/links/${index}/source_refs`))
  exhibit.relationships.forEach((relationship, index) =>
    check(relationship.source_refs, `/relationships/${index}/source_refs`),
  )
  exhibit.assets.forEach((asset, index) => check([asset.source_ref], `/assets/${index}/source_ref`))
  if (exhibit.license.source_ref) check([exhibit.license.source_ref], '/license/source_ref')
}

async function sha256(file) {
  const contents = await readFile(file)
  return createHash('sha256').update(contents).digest('hex')
}

async function checkRightsBasis({ root, rights, location, errors }) {
  if (rights.status === 'licensed' && !rights.license) {
    errors.push(`${location}/rights: licensed 素材必须填写许可证`)
  }
  if (rights.status === 'permission_granted' && !rights.permission_record) {
    errors.push(`${location}/rights: permission_granted 素材必须填写许可记录`)
  }
  if (
    rights.status === 'permission_granted' &&
    rights.permission_record &&
    !rights.permission_record.startsWith('https://')
  ) {
    const permissionsRoot = path.join(root, 'docs', 'permissions')
    const permissionFile = path.resolve(root, rights.permission_record)
    const relative = path.relative(permissionsRoot, permissionFile)
    if (relative.startsWith('..') || path.isAbsolute(relative) || path.extname(permissionFile) !== '.md') {
      errors.push(`${location}/rights/permission_record: 许可记录必须位于 docs/permissions/`)
    } else {
      try {
        await access(permissionFile)
      } catch {
        errors.push(`${location}/rights/permission_record: 找不到许可记录 ${rights.permission_record}`)
      }
    }
  }
}

async function checkAssetFile({ root, baseDirectory, asset, location, errors }) {
  const { assetsDirectory, absoluteFile, safe } = resolveAssetFile(baseDirectory, asset.file)
  if (!safe) {
    errors.push(`${location}/file: 素材路径必须位于 assets/ 目录且不能越界`)
    return
  }

  let stats
  try {
    stats = await lstat(absoluteFile)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      errors.push(`${location}: 找不到素材文件 ${displayPath(root, absoluteFile)}`)
    } else {
      errors.push(`${location}: 无法检查素材文件 ${displayPath(root, absoluteFile)}`)
    }
    return
  }
  if (stats.isSymbolicLink()) {
    errors.push(`${location}/file: 素材文件不能是符号链接`)
    return
  }
  if (!stats.isFile()) {
    errors.push(`${location}/file: 素材路径必须指向普通文件`)
    return
  }

  try {
    const [realBaseDirectory, realAssetsDirectory, realFile] = await Promise.all([
      realpath(baseDirectory),
      realpath(assetsDirectory),
      realpath(absoluteFile),
    ])
    if (
      !pathIsWithin(realBaseDirectory, realAssetsDirectory) ||
      !pathIsWithin(realAssetsDirectory, realFile)
    ) {
      errors.push(`${location}/file: 素材路径通过符号链接越出了 assets/ 目录`)
      return
    }
  } catch {
    errors.push(`${location}: 无法解析素材文件 ${displayPath(root, absoluteFile)}`)
    return
  }

  const digest = await sha256(absoluteFile)
  if (digest !== asset.sha256) errors.push(`${location}: SHA-256 与文件内容不符`)
  await checkRightsBasis({ root, rights: asset.rights, location, errors })
  if (!publishableRights.has(asset.rights.status)) {
    errors.push(`${location}: 素材文件进入仓库前需确认许可证或取得授权`)
  }
  if (!committablePrivacy.has(asset.privacy.status)) {
    errors.push(`${location}: 素材文件进入仓库前需完成隐私复核和必要脱敏`)
  }
}

async function scanAssetDirectory({ root, baseDirectory, location, errors }) {
  const assetsDirectory = path.resolve(baseDirectory, 'assets')
  let stats
  try {
    stats = await lstat(assetsDirectory)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    errors.push(`${location}: 无法读取素材目录 ${displayPath(root, assetsDirectory)}`)
    return []
  }
  if (stats.isSymbolicLink()) {
    errors.push(`${location}: 素材目录不能是符号链接 ${displayPath(root, assetsDirectory)}`)
    return []
  }
  if (!stats.isDirectory()) {
    errors.push(`${location}: assets/ 必须是目录`)
    return []
  }

  try {
    const [realBaseDirectory, realAssetsDirectory] = await Promise.all([
      realpath(baseDirectory),
      realpath(assetsDirectory),
    ])
    if (!pathIsWithin(realBaseDirectory, realAssetsDirectory)) {
      errors.push(`${location}: 素材目录通过符号链接越出了所在目录`)
      return []
    }
  } catch {
    errors.push(`${location}: 无法解析素材目录 ${displayPath(root, assetsDirectory)}`)
    return []
  }

  const files = []
  const walk = async (directory) => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      errors.push(`${location}: 无法读取素材目录 ${displayPath(root, directory)}`)
      return
    }
    for (const entry of entries) {
      if (ignoredAssetEntry(entry.name)) continue
      const absoluteEntry = path.resolve(directory, entry.name)
      if (!pathIsWithin(assetsDirectory, absoluteEntry)) {
        errors.push(`${location}: 素材目录项越界 ${displayPath(root, absoluteEntry)}`)
        continue
      }
      if (entry.isSymbolicLink()) {
        errors.push(`${location}: 素材目录中禁止符号链接 ${displayPath(root, absoluteEntry)}`)
      } else if (entry.isDirectory()) {
        await walk(absoluteEntry)
      } else if (entry.isFile()) {
        files.push(absoluteEntry)
      } else {
        errors.push(`${location}: 素材目录中存在不支持的文件类型 ${displayPath(root, absoluteEntry)}`)
      }
    }
  }
  await walk(assetsDirectory)
  return files
}

async function checkAssetInventory({ root, baseDirectory, assets, location, errors }) {
  const registeredFiles = new Set()
  for (const asset of assets) {
    const resolved = resolveAssetFile(baseDirectory, asset.file)
    if (resolved.safe) registeredFiles.add(path.normalize(resolved.absoluteFile))
  }

  const files = await scanAssetDirectory({ root, baseDirectory, location, errors })
  for (const file of files) {
    if (!registeredFiles.has(path.normalize(file))) {
      errors.push(`${location}: 未登记素材文件 ${displayPath(root, file)}`)
    }
  }
}

export async function loadCatalog(root = projectRoot) {
  const [validators, exhibitFiles, collectionFiles, sharedAssets] = await Promise.all([
    buildValidators(root),
    listExhibitFiles(root),
    listCollectionFiles(root),
    readYaml(path.join(root, 'ASSETS.yml')),
  ])

  const exhibits = await Promise.all(
    exhibitFiles.map(async (entry) => ({
      ...(await readYaml(entry.file)),
      __file: entry.file,
      __directory: entry.directory,
      __directoryName: entry.directoryName,
    })),
  )
  const collections = await Promise.all(
    collectionFiles.map(async (file) => ({ ...(await readYaml(file)), __file: file })),
  )

  return { root, validators, exhibits, collections, sharedAssets }
}

export async function validateCatalog(catalog) {
  const { root, validators, exhibits, collections, sharedAssets } = catalog
  const errors = []

  if (!validators.assets(sharedAssets)) {
    errors.push(...formatAjvErrors(path.join(root, 'ASSETS.yml'), validators.assets.errors))
  }

  for (const exhibit of exhibits) {
    if (!validators.exhibit(publicExhibit(exhibit))) {
      errors.push(...formatAjvErrors(exhibit.__file, validators.exhibit.errors))
      continue
    }
    if (exhibit.id !== exhibit.__directoryName) {
      errors.push(`${exhibit.__file}/id: 必须与目录名 ${exhibit.__directoryName} 一致`)
    }
    if (exhibit.record.created_at > exhibit.record.updated_at) {
      errors.push(`${exhibit.__file}/record: updated_at 不能早于 created_at`)
    }

    for (const [label, values] of [
      ['来源', exhibit.sources.map((source) => source.id)],
      ['链接', exhibit.links.map((link) => link.id)],
      ['素材', exhibit.assets.map((asset) => asset.id)],
      ['宣称平台', exhibit.platforms.claimed.map((platform) => platform.id)],
      ['已发布平台', exhibit.platforms.released.map((platform) => platform.id)],
    ]) {
      for (const duplicate of findDuplicates(values)) {
        errors.push(`${exhibit.__file}: ${label} ID 重复: ${duplicate}`)
      }
    }

    checkSourceRefs(exhibit, errors)
    const links = new Map(exhibit.links.map((link) => [link.id, link]))
    if (exhibit.source_code.repository_link_id) {
      const repositoryLink = links.get(exhibit.source_code.repository_link_id)
      if (!repositoryLink || repositoryLink.kind !== 'repository') {
        errors.push(`${exhibit.__file}/source_code/repository_link_id: 必须引用 repository 链接`)
      }
    }
    if (exhibit.source_code.availability === 'open' && !exhibit.source_code.repository_link_id) {
      errors.push(`${exhibit.__file}/source_code: 开源项目必须提供仓库链接`)
    }
    if (exhibit.license.status === 'declared' && (!exhibit.license.spdx || !exhibit.license.source_ref)) {
      errors.push(`${exhibit.__file}/license: 已声明许可证必须填写 SPDX 和来源`)
    }
    if (exhibit.license.status !== 'declared' && exhibit.license.spdx !== null) {
      errors.push(`${exhibit.__file}/license/spdx: 未确认许可证时必须为 null`)
    }

    for (const [index, asset] of exhibit.assets.entries()) {
      await checkAssetFile({
        root,
        baseDirectory: exhibit.__directory,
        asset,
        location: `${exhibit.__file}/assets/${index}`,
        errors,
      })
    }
    await checkAssetInventory({
      root,
      baseDirectory: exhibit.__directory,
      assets: exhibit.assets,
      location: exhibit.__file,
      errors,
    })
  }

  for (const duplicate of findDuplicates(exhibits.map((exhibit) => exhibit.id))) {
    errors.push(`展品 ID 重复: ${duplicate}`)
  }
  const exhibitById = new Map(exhibits.map((exhibit) => [exhibit.id, exhibit]))

  const checkSharedAssetRelationships = (asset, location) => {
    for (const exhibitId of asset.related_exhibits ?? []) {
      const exhibit = exhibitById.get(exhibitId)
      if (!exhibit) {
        errors.push(`${location}/related_exhibits: 找不到展品 ${exhibitId}`)
        continue
      }
      if (
        asset.role === 'author_avatar' &&
        !exhibit.authors.some((author) => author.name === asset.subject?.name)
      ) {
        errors.push(`${location}/subject: ${asset.subject?.name ?? '未知身份'} 不是展品 ${exhibitId} 的作者`)
      }
    }
  }

  for (const exhibit of exhibits) {
    if (!validators.exhibit(publicExhibit(exhibit))) continue
    for (const relationship of exhibit.relationships) {
      if (!exhibitById.has(relationship.target)) {
        errors.push(`${exhibit.__file}/relationships: 找不到展品 ${relationship.target}`)
      }
    }
  }

  for (const collection of collections) {
    if (!validators.collection(publicCollection(collection))) {
      errors.push(...formatAjvErrors(collection.__file, validators.collection.errors))
      continue
    }
    const listed = []
    for (const section of collection.sections) {
      listed.push(...section.exhibits)
      for (const id of section.exhibits) {
        const exhibit = exhibitById.get(id)
        if (!exhibit) errors.push(`${collection.__file}: 找不到展品 ${id}`)
        else if (exhibit.record.state !== 'published') {
          errors.push(`${collection.__file}: 展品 ${id} 尚未发布`)
        }
      }
    }
    for (const duplicate of findDuplicates(listed)) {
      errors.push(`${collection.__file}: 展品重复出现: ${duplicate}`)
    }
  }
  for (const duplicate of findDuplicates(collections.map((collection) => collection.id))) {
    errors.push(`集合 ID 重复: ${duplicate}`)
  }

  const readme = collections.find((collection) => collection.id === 'readme')
  if (!readme) {
    errors.push('缺少 collections/readme.yaml')
  } else if (validators.collection(publicCollection(readme))) {
    const listed = new Set(readme.sections.flatMap((section) => section.exhibits))
    for (const exhibit of exhibits.filter((item) => item.record.state === 'published')) {
      if (!listed.has(exhibit.id)) errors.push(`${exhibit.__file}: 已发布展品未收入 README 集合`)
    }
  }

  if (validators.assets(sharedAssets)) {
    for (const duplicate of findDuplicates([
      ...sharedAssets.assets.map((asset) => asset.id),
      ...sharedAssets.candidates.map((candidate) => candidate.id),
    ])) {
      errors.push(`${path.join(root, 'ASSETS.yml')}: 共享素材或候选 ID 重复: ${duplicate}`)
    }
    for (const [index, asset] of sharedAssets.assets.entries()) {
      checkSharedAssetRelationships(asset, `${path.join(root, 'ASSETS.yml')}/assets/${index}`)
      await checkAssetFile({
        root,
        baseDirectory: root,
        asset,
        location: `${path.join(root, 'ASSETS.yml')}/assets/${index}`,
        errors,
      })
    }
    await checkAssetInventory({
      root,
      baseDirectory: root,
      assets: sharedAssets.assets,
      location: path.join(root, 'ASSETS.yml'),
      errors,
    })
    for (const [index, candidate] of sharedAssets.candidates.entries()) {
      const location = `${path.join(root, 'ASSETS.yml')}/candidates/${index}`
      const exhibit = exhibitById.get(candidate.exhibit_id)
      if (!exhibit) {
        errors.push(`${location}/exhibit_id: 找不到展品 ${candidate.exhibit_id}`)
      } else if (exhibit.assets.some((asset) => asset.id === candidate.id)) {
        errors.push(`${location}/id: 候选与展品本地素材不能同时使用 ID ${candidate.id}`)
      }
      if (candidate.publish !== false) {
        errors.push(`${location}/publish: 候选素材不得直接发布`)
      }
      if (candidate.related_exhibits && !candidate.related_exhibits.includes(candidate.exhibit_id)) {
        errors.push(`${location}/related_exhibits: 必须包含主展品 ${candidate.exhibit_id}`)
      }
      checkSharedAssetRelationships(candidate, location)
      await checkRightsBasis({ root, rights: candidate.rights, location, errors })
    }
  } else {
    for (const [index, candidate] of (sharedAssets.candidates ?? []).entries()) {
      if (candidate.publish !== false) {
        errors.push(`${path.join(root, 'ASSETS.yml')}/candidates/${index}/publish: 候选素材不得直接发布`)
      }
    }
  }

  return errors.sort()
}

export async function loadAndValidate(root = projectRoot) {
  const catalog = await loadCatalog(root)
  const errors = await validateCatalog(catalog)
  return { catalog, errors }
}

export function publicExhibit(exhibit) {
  const { __file, __directory, __directoryName, ...data } = exhibit
  return data
}

export function publicCollection(collection) {
  const { __file, ...data } = collection
  return data
}
