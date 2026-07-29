# 展品数据

每个项目使用一个 `exhibits/<id>/exhibit.yaml`。ID 一旦发布便不再复用；项目改名通过 `aliases` 保留旧称。

`record` 保存目录记录的状态、修订号和核验日期。`classification` 描述项目形态、官方关系和年代。`platforms.claimed` 与 `platforms.released` 分别记录目标平台和已有公开产物的平台。`lifecycle` 记录完成度、维护和分发状态。

`sources` 是展品内的来源表。作者、功能、平台、链接、许可证、素材和项目关系通过 `source_refs` 引用来源 ID。没有找到公开仓库或许可证时使用 `unknown` 或 `not_publicly_listed`，不要用推测填补。

`ASSETS.yml` 分为两层。`candidates` 只保存远程素材线索、原位置、作者、权利状态和隐私复核，必须设置 `publish: false`，也不对应仓库中的文件。`assets` 只保存已经取得再分发依据并通过隐私复核的博物馆共享文件。展品专属的已批准素材写入各自 `exhibit.yaml` 的 `assets`。

`collections/*.yaml` 只决定展品的选择、分组和顺序，不复制项目资料。README 由 `collections/readme.yaml` 和展品事实共同生成。二期的 `scenes/*.yaml` 也只保存展品 ID、房间、坐标和交互方式。

YAML 使用严格的 Core Schema。仓库禁止 anchor、alias、自定义 tag 和重复键。运行时消费者不直接读取 YAML，构建过程会生成经过校验的 JSON。画廊和博物馆只能读取已批准的本地素材，不能把 `candidates` 当作可发布资源。

Schema 使用整数版本。增加可选字段时更新次版本文档；删除字段或改变含义时提升主版本并提供迁移脚本。展品自身的 `record.revision` 与客户端版本号无关。
