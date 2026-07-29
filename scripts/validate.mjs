import { loadAndValidate } from './lib/catalog.mjs'

try {
  const { catalog, errors } = await loadAndValidate()
  if (errors.length > 0) {
    console.error(`校验失败，共 ${errors.length} 个问题：`)
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
  } else {
    console.log(`校验通过：${catalog.exhibits.length} 个展品，${catalog.collections.length} 个集合`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
