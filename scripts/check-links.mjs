import { loadAndValidate } from './lib/catalog.mjs'

const timeoutMs = 15_000
const concurrency = 6

async function checkUrl(url) {
  const request = async (method) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(url, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': 'awesome-cc98-link-checker/0.1' },
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  let response
  try {
    response = await request('HEAD')
  } catch {
    try {
      response = await request('GET')
    } catch (error) {
      return {
        level: 'warning',
        message: `${url} 暂时无法确认：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
  if (response.status === 403 || response.status === 405) {
    try {
      response = await request('GET')
    } catch {
      // 403、405 和网络访问限制只能说明自动检查受限，不能据此判定链接失效。
    }
  }
  if (response.ok) return { level: 'ok', message: url }
  if (response.status === 404 || response.status === 410) {
    return { level: 'failure', message: `${url} 返回 HTTP ${response.status}` }
  }
  return {
    level: 'warning',
    message: `${url} 返回 HTTP ${response.status}，自动检查无法确认是否失效`,
  }
}

const { catalog, errors } = await loadAndValidate()
if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}

const urls = [
  ...new Set([
    ...catalog.exhibits.flatMap((exhibit) => [
      ...exhibit.links.map((link) => link.url),
      ...exhibit.sources.map((source) => source.url),
    ]),
    ...catalog.sharedAssets.assets.flatMap((asset) => asset.source_url ?? []),
    ...catalog.sharedAssets.candidates.flatMap((candidate) => [
      candidate.source_page_url,
      ...(candidate.asset_url ? [candidate.asset_url] : []),
    ]),
  ]),
]
const failures = []
const warnings = []
let cursor = 0

async function worker() {
  while (cursor < urls.length) {
    const url = urls[cursor++]
    const result = await checkUrl(url)
    if (result.level === 'failure') failures.push(result.message)
    if (result.level === 'warning') warnings.push(result.message)
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()))
if (warnings.length > 0) {
  console.warn(`链接检查有 ${warnings.length} 个无法自动确认的 URL：`)
  for (const warning of warnings.sort()) console.warn(`- ${warning}`)
}
if (failures.length > 0) {
  console.error(`链接检查发现 ${failures.length} 个问题：`)
  for (const failure of failures.sort()) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`链接检查完成：${urls.length} 个 URL，没有确认失效的链接`)
}
