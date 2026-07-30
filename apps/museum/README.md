# Awesome CC98 数字博物馆

这是 `awesome-cc98` 的 Phaser 3 像素博物馆 Alpha。游戏世界由 Phaser 绘制，加载、错误、HUD、展品详情、终端和触屏控制使用可聚焦的 DOM 元素。

## 本地运行

在仓库根目录安装依赖后运行：

```bash
pnpm --filter @awesome-cc98/museum dev
pnpm --filter @awesome-cc98/museum test
pnpm --filter @awesome-cc98/museum build
```

也可以进入本目录运行相同的 `pnpm dev`、`pnpm test` 和 `pnpm build`。默认开发地址为 `http://127.0.0.1:4173`。

部署到子路径时通过 Vite base 指定前缀：

```bash
MUSEUM_BASE_URL=/awesome-cc98/ pnpm build
```

运行时代码与素材 URL 都基于 `import.meta.env.BASE_URL`，可用于 GitHub Pages 等子路径部署。

## 运行时数据

正常路径会并发请求以下三份数据，不会把展品名称、作者或简介写死在应用里：

- `BASE_URL + data/catalog.json`：展品事实、作者、许可证与公开链接；
- `BASE_URL + data/assets.json`：素材 key、发布状态与署名；
- `BASE_URL + data/scenes.json`：入口与场景布局。

开发服务器会把这些 URL 映射到仓库根的 `generated/`，并把 `BASE_URL + assets/**` 映射到已批准的根 `assets/`。构建结束后，Vite 插件会把存在的三份 JSON 与 `publish: true` 的素材复制到 `dist/`。根目录的 `scripts/prepare-museum.mjs` 也可把相同数据准备到 Vite `public/`。

场景解析兼容数组或以 ID 为 key 的对象，并接受对象坐标、数组坐标以及 `snake_case` / `camelCase` 的常用字段。默认将 `width`、`height` 和摆放坐标理解为瓦片；显式 `coordinate_unit: pixels` 或大于 256 的场景尺寸会按像素处理。主题支持 `A`、`C` 与 `AC`。

如果只有 `scenes.json` 缺失或损坏，应用会根据已加载 catalog 的 ID 动态生成演示馆，并在 HUD 标明“演示场景”。如果 catalog 或 assets 缺失，会先展示带错误原因的界面，访客可重试或主动进入不含硬编码展品事实的空/部分演示馆。

## 操作与功能

- WASD 或方向键移动，镜头跟随角色；墙体、展台和装饰参与碰撞。
- 靠近展台、传送门、收藏物或场景终端后按 E / Enter 互动。
- 触屏设备显示方向键和互动键。
- 展品详情展示 catalog 中的简介、功能、作者、公开链接和许可证；头像通过 asset key 查找，并显示 `rights.attribution`。
- 工具栏中的“终端”始终可用；fallback 场景也会摆放终端。输入 `help` 查看指令，`spark` 用于验证持久化彩蛋框架。
- 收藏、终端 flag 与静音状态保存在 `awesome-cc98:museum:v1`；“重置进度”会二次确认并清除该 key。
- 对话框可用 Tab 导航、Escape 关闭，关闭后恢复到先前焦点；动画遵守 `prefers-reduced-motion`。

## 测试范围

Vitest 覆盖场景归一化、三数据源读取、asset key 到公开 URL/署名的解析、动态 fallback、localStorage 解析与迁移、最近互动目标选择，以及传送门目标解析。测试采用 `*.spec.ts`，避免被仓库根的 Node test runner 误收集。
