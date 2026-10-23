# TagMark V2 设计访谈

日期：2026-10-23（Asia/Shanghai）。状态：Q48 已确认更新版产品设计；用户随后明确采用 grill-with-docs → to-spec → to-tickets → implement → code-review → retro。当前整理正式 Spec 并补齐项目技能配置，尚未开始产品编码。Q41 的旧优先级已由不公开标签一票否决替换。

## 用户目标

- 重写 tagmark-py、tagmark-ui、my-tagmarks，并增加桌面 Chrome 收藏插件，替代 Diigo 的日常录入。
- 收藏时尽量不要求手工输入标签；自动分类、生成标签定义和更新 GitHub 仓库元信息都需要支持周期执行及手动触发。
- 优先考虑 GitHub Actions；如果不适合，也可以在用户 PC 上执行。更新频率应可配置，并能在额度不足时分批继续。
- 插件中提供独立的收藏和标签管理页面，可修订收藏标签及标签定义。
- 调查浏览器本地存储、云端保存和同步的合适方案。
- 重新考虑相关项目的仓库组织方式，以及 UI 技术栈和工程规范。
- 插件和网站的功能界面都支持多语言；标签以英文标准名和英文定义统一语义，显示名称及定义提供译文。首版语言为英文和简体中文。
- 首版无需导入旧数据，可从空收藏库开始；Rust CLI 应能下载对应平台的可执行文件后直接运行，无需用户另装 Rust 工具链。
- 本次先进行设计访谈；记录明确的术语和架构取舍，最终共同确认后再进入实现。

## 已确认的第一轮决策

| 问题 | 用户选择 | 后续影响 |
| --- | --- | --- |
| Q1 服务对象 | 单人收藏库，其他用户各自部署 | 首版不做团队协作或统一账号平台 |
| Q2 公开边界 | 默认私有，主动选择公开 | 完整数据与公开网站的发布内容必须区分 |
| Q3 AI 修改权 | 标签及新定义都可自动生效，事后修订 | 不设置默认逐条审批；人工修订保护已在 Q8 明确 |
| Q4 UI 职责 | 插件编辑，网站浏览分享 | 首版不要求手机或普通网页编辑 |

对应 ADR：[私有收藏库与公开展示](adr/0001-private-collection-public-view.md)、[AI 自动生效](adr/0002-automatic-ai-tagging.md)。

## 已确认的第二轮决策

用户对 Q5–Q10 全部选择推荐方案。

| 问题 | 用户选择 | 后续影响 |
| --- | --- | --- |
| Q5 保存与同步 | 私有 GitHub 数据仓库加插件本地缓存 | 支持离线收藏，联网同步；Actions 读取云端数据 |
| Q6 代码组织 | 核心、Web UI、插件采用代码 monorepo，个人实例独立 | 共享契约和组件可在同一变更中调整 |
| Q7 AI 入口 | 用户配置模型 API 执行定时任务，CLI/agent 可手动触发 | 共用版本化规则并校验输出；Q39 补充明确覆盖全部 AI 生成内容 |
| Q8 人工修订 | 人工修改优先，主动重置后才重新自动处理 | 记住被明确拒绝或删除的标签，不由 AI 补回 |
| Q9 AI 输入范围 | 主动收藏页面的标题、简介、正文摘录及公开 GitHub README | 不采集历史、Cookie、私人备注；正文可关闭，单条可跳过 AI |
| Q10 UI 技术栈 | TypeScript 严格检查 + React，网站 Vite，插件 WXT | 两端尽量复用展示、编辑组件与数据类型 |

新增 ADR：[GitHub 数据与本地缓存](adr/0003-github-data-and-local-cache.md)、[代码 monorepo](adr/0004-code-monorepo-personal-instance.md)。Q7–Q9 已补入前两份 ADR。

## 第三轮决策与范围调整

| 问题 | 用户选择 | 后续影响 |
| --- | --- | --- |
| Q11 标签与译文 | 英文标准名及英文原始定义，其他语言为译文 | 搜索译名仍指向同一个标签 |
| Q12 首版语言 | 英文和简体中文 | 界面和标签信息都需要完整覆盖 |
| Q13 定义用途 | 简短释义加打标规则，保留旧长说明 | 结合 Q16，旧说明保留在 V1，不要求迁入 V2 |
| Q14 标签语义 | 按主题、用途分类，实现语言另行筛选 | 避免主题与偶然实现技术混淆 |
| Q15 多设备 | 支持多设备编辑，真正冲突由用户选择 | 不同字段自动合并，同字段人工冲突保留双方 |
| Q16 核心语言与兼容 | 首版无需旧数据导入；CLI 要便于独立运行，考虑 Go 或 Rust | 不再以旧数据迁移为前置要求；后续 Q19 已选择 Rust |
| Q17 初次配置 | 手动配置限定仓库的令牌，可在本机记住 | 提供仅会话保存选项，密钥不进入数据仓库 |
| Q18 周期任务 | 增量处理，频率与批量预算分别配置 | 避免每天对整库重复生成 AI 结果 |

新增 ADR：[统一标签语义与多语言](adr/0005-tag-semantics-and-localization.md)、[首版不承担旧数据导入](adr/0006-v2-without-legacy-import.md)。

“无需另装语言运行时”是分发要求，不等于程序内部不能包含运行库，也不等于一个二进制能在所有操作系统和 CPU 上运行。第三轮后曾推荐 Go；第四轮补充答复中用户选择 Rust，最终以该选择为准。

## 第四轮决策与后续澄清

| 问题 | 用户选择 | 后续影响 |
| --- | --- | --- |
| Q19 核心语言 | 了解工作流后选择 Rust 核心/CLI | 按目标平台分发，保持已确认的 TypeScript 界面 |
| Q20 译文更新 | 按语言保护人工译文，缺失时回退英文 | 自动译文随英文更新；人工译文过期后标记复核 |
| Q21 公开内容 | 主动选公开，之后自动更新白名单内容 | 只发布所选收藏及所用标签；备注、正文、规则和 AI 记录私有 |
| Q22 删除恢复 | 可恢复删除，删除后的离线修改留待用户处理 | 不自动复活，不自动清空回收站；支持 V2 整库备份 |
| Q23 模型与预算 | 先用 codex exec 调试；随后表示可提供 DeepSeek 官方 API 调试 HTTP 路径 | 两条路径使用共同规则和结果校验；后续 Q31 确定 Flash、20 条及 2 元总预算 |
| Q24 周期默认值 | 接受可配置的初始频率、新鲜度和 GitHub 批量上限 | AI 每 6 小时；GitHub 每日检查、7 天过期、每轮最多 500 个 |

新增 ADR：[可恢复删除](adr/0007-recoverable-deletion.md)。公开范围、译文保护和默认调度已补入相应 ADR。核心/CLI 与 Codex 的事实核查和候选工作流见[执行工作流](execution-workflow.md)。

补充答复确定 [Rust 核心与 TypeScript 界面](adr/0008-rust-core-typescript-ui.md)、[批处理 CLI 与本机 Codex 调试](adr/0009-batch-cli-and-local-codex.md)。DeepSeek 的具体模型及调试预算在第五轮确定，长期默认服务仍待样本验证。

## 已核实的现状

### 仓库快照

| 仓库 | 默认分支 | 本次调查的提交 |
| --- | --- | --- |
| tagmark-py | main | d530a9859e7024cd0a692ca57608d211c6fec08e |
| tagmark-ui | main | 75ffc3b80368eb30b688bf02213cf0afad9bf30d |
| my-tagmarks | main | 3f0c23d6df49ec15767c01a8a60ae59fedb693aa |

1. Python CLI 已有 `--update-github-info-after-hours`，默认 23 小时，并记录每项的更新时间。当前待更新总量超过剩余额度时会拒绝整批执行；需要补的是按预算分批、可恢复和退避。[CLI](https://github.com/pwnfan/tagmark-py/blob/d530a9859e7024cd0a692ca57608d211c6fec08e/tagmark/cli.py#L192-L237)、[更新循环](https://github.com/pwnfan/tagmark-py/blob/d530a9859e7024cd0a692ca57608d211c6fec08e/tagmark/core/data.py#L149-L210)。
2. 已有 `autotagdef` 通过 revChatGPT 为缺少定义的标签生成自由文本说明，但没有自动给收藏分类。旧标签说明未必足以充当分类规则。[实现](https://github.com/pwnfan/tagmark-py/blob/d530a9859e7024cd0a692ca57608d211c6fec08e/tagmark/tools/autotagdef.py#L25-L100)。
3. 旧收藏 ID 在导入过程中会重分配，没有修订版本或编辑来源；不能直接假定它适合多端同步。标签以字符串为键，alias 用于显示，并不负责同义词归并。[收藏模型](https://github.com/pwnfan/tagmark-py/blob/d530a9859e7024cd0a692ca57608d211c6fec08e/tagmark/core/data.py#L23-L39)、[ID](https://github.com/pwnfan/tagmark-py/blob/d530a9859e7024cd0a692ca57608d211c6fec08e/tagmark/core/data.py#L97-L127)、[标签模型](https://github.com/pwnfan/tagmark-py/blob/d530a9859e7024cd0a692ca57608d211c6fec08e/tagmark/core/tag.py#L8-L48)。
4. Diigo 的 description 导入为用户 `comment`，需要与网页描述或 AI 摘要区分。[转换](https://github.com/pwnfan/tagmark-py/blob/d530a9859e7024cd0a692ca57608d211c6fec08e/tagmark/tools/convert/diigo.py#L51-L93)。
5. 现有 UI 使用单个约 1,100 行的 JS 文件和 Tabulator/CDN，数据仓库包含同样的 UI 文件副本。UI 没有 package.json、类型检查或 lint 配置。技术栈重写需要同时解决类型检查、模块职责和发布复用，不能仅替换框架名称。[页面依赖](https://github.com/pwnfan/tagmark-ui/blob/75ffc3b80368eb30b688bf02213cf0afad9bf30d/index.html#L7-L78)。
6. my-tagmarks 快照有 2,896 条收藏，其中 2,024 条带 GitHub 元数据；实际使用 1,092 个标签，词典有 1,093 项，全部定义非空。两份数据文件合计 4,459,961 字节，约 4.25 MiB。按大小写敏感的精确字符串比较，网址及 ID 在该快照内均唯一。70 条记录 valid=false，不能据此认定应该删除。统计只记录聚合，不复制收藏内容。[收藏数据](https://github.com/pwnfan/my-tagmarks/blob/3f0c23d6df49ec15767c01a8a60ae59fedb693aa/data/tagmarks.jsonl)、[标签数据](https://github.com/pwnfan/my-tagmarks/blob/3f0c23d6df49ec15767c01a8a60ae59fedb693aa/data/tags.json)。
7. 旧搜索支持 AND/OR/NOT、括号和带筛选条件的分享链接，但实现通过 new Function 执行表达式。旧 CDN 加载与字符串执行方式不能原样迁入普通 MV3 插件页面；应保留所需搜索语义并更换实现方式。[旧过滤实现](https://github.com/pwnfan/tagmark-ui/blob/75ffc3b80368eb30b688bf02213cf0afad9bf30d/js/tagmark.js#L164-L214)、[查询语法](https://github.com/pwnfan/tagmark-ui/blob/75ffc3b80368eb30b688bf02213cf0afad9bf30d/docs/filter.zh_CN.md#L19-L70)、[Chrome CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)。
8. 旧标签已有语义歧义：技术名可能表示实现技术，也可能表示被研究或测试的对象。自动打标签前需明确这种关系是否区分，不能仅为现有标签补百科解释。[已有记录](https://github.com/pwnfan/my-tagmarks/blob/3f0c23d6df49ec15767c01a8a60ae59fedb693aa/docs/tag-doc.md#L44-L49)。
9. 现有 1,093 项 definition 合计约 235 万字符，平均约 2,152 字符，较多是知识解释而非分类边界；有的只是一行释义。标签数据是平面结构，文档章节不等于机器可读分类树。目前没有按语言保存名称或定义的结构，少量非英文标签键曾被识别为潜在迁移问题；Q16 已将旧数据导入移出首版范围。[django](https://github.com/pwnfan/my-tagmarks/blob/3f0c23d6df49ec15767c01a8a60ae59fedb693aa/data/tags.json#L2266-L2273)、[python](https://github.com/pwnfan/my-tagmarks/blob/3f0c23d6df49ec15767c01a8a60ae59fedb693aa/data/tags.json#L6306-L6313)、[sec](https://github.com/pwnfan/my-tagmarks/blob/3f0c23d6df49ec15767c01a8a60ae59fedb693aa/data/tags.json#L6946-L6953)。不丢弃或改写 V1 中的旧说明。
10. Python 核心主要使用 HTTP、JSON/JSONL、字段映射、集合和字符串处理；未发现必须保留的 Python 专有业务依赖。已有 pip 安装方式、tagmark_cli 入口和发布配置，这些现状不自动构成 V2 的兼容要求。[依赖与入口](https://github.com/pwnfan/tagmark-py/blob/d530a9859e7024cd0a692ca57608d211c6fec08e/pyproject.toml#L1-L38)。

### 现有自动任务

- 元数据工作流同时由每日 schedule、数据文件 push 和手动操作触发，调用配置的 TAGMARK_DATA_EXPIRED_HOURS。2026-10-23 Asia/Shanghai 的一次定时运行产生提交后，实际又触发了一次 push 运行；这是重复触发的证据，不能断言无限循环。[工作流](https://github.com/pwnfan/my-tagmarks/blob/3f0c23d6df49ec15767c01a8a60ae59fedb693aa/.github/workflows/update-tagmark-data.yml#L3-L81)、[定时运行](https://github.com/pwnfan/my-tagmarks/actions/runs/39848074214)、[push 运行](https://github.com/pwnfan/my-tagmarks/actions/runs/39849824507)。
- maketagdoc 是生成展示文档，不是 AI 生成标签定义；新设计必须分别表达自动分类、定义生成和元数据刷新。[文档生成工作流](https://github.com/pwnfan/my-tagmarks/blob/3f0c23d6df49ec15767c01a8a60ae59fedb693aa/.github/workflows/update-tag-doc.yml#L86-L96)。
- UI 更新会复制另一个仓库的源码，Pages 工作流部署整个仓库。根据已接受的私有数据边界，新版必须只发布明确生成的公开内容，不能照搬整库部署方式。[UI 复制](https://github.com/pwnfan/my-tagmarks/blob/3f0c23d6df49ec15767c01a8a60ae59fedb693aa/.github/workflows/update-tagmark-ui.yml#L27-L44)、[Pages 部署](https://github.com/pwnfan/my-tagmarks/blob/3f0c23d6df49ec15767c01a8a60ae59fedb693aa/.github/workflows/github_pages.yml#L35-L46)。

### 平台约束

- GitHub-hosted Actions 运行在云端环境；由环境隔离可知它不能直接读取用户浏览器的本地存储。使用云端定时任务必须提供其可访问的数据副本或数据源。[Hosted runners](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners)。
- `chrome.storage.local` 默认 10 MiB；`chrome.storage.sync` 总共 100 KiB，单项 8 KiB。现有完整数据已经不适合放入 sync。浏览器存储仍需独立备份，卸载扩展会失去本机扩展数据。[Chrome Storage](https://developer.chrome.com/docs/extensions/reference/api/storage)、[存储说明](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)。
- 普通 REST 元信息读取主要是小时额度：用户 PAT 通常 5,000 请求/小时，Actions 的 GITHUB_TOKEN 通常 1,000 请求/小时/仓库，另有二级限制，并不存在适用于所有读取的统一每日额度。[REST limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)。
- 正确认证的条件 GET 若返回 304，不计入主额度，仍需遵守二级限制。[条件请求](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate)。
- GitHub 定时任务可能延迟；公开仓库长期无活动还会停用定时任务。周期处理应允许漏跑和补跑。[Schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。
- GitHub 文件写入有版本冲突检测，但不提供收藏级合并；多文件应基于同一提交读取并生成一致的新快照。Contents API 的 SHA 对应单文件 blob，不能当成整个仓库版本锁。[Contents API](https://docs.github.com/en/rest/repos/contents)、[Git commits](https://docs.github.com/en/rest/git/commits#create-a-commit)、[GraphQL expectedHeadOid](https://docs.github.com/en/graphql/reference/commits#createcommitonbranch)。
- 单个私有数据仓库的普通文件读写可使用限定仓库的 fine-grained PAT，Contents:write；直接触发已有 Actions workflow 另需 Actions:write，该权限不只允许触发。扩展持久存储不是加密保险库，凭据不能交给页面脚本或写入收藏数据。[PAT](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)、[workflow_dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)、[Chrome 隐私说明](https://developer.chrome.com/docs/extensions/develop/security-privacy/user-privacy)。
- 个人私有源仓库直接发布 Pages 需要 GitHub Pro；独立的公开发布仓库可使用 GitHub Free。公开静态资源中包含的数据不能靠 UI 隐藏保密，跨仓库访问私有数据也需要单独授权。[Pages 计划](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[发布源公开性](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)、[GITHUB_TOKEN 范围](https://docs.github.com/en/actions/concepts/security/github_token)。
- `GITHUB_TOKEN` 仅限承载 workflow 的仓库，增加 permissions 不能让它写入另一个公开产物仓库。其推送通常也不会触发新的 on:push 工作流或分支式 Pages 构建；处理、导出和发布应显式串联，不能依赖自动提交再次触发。跨仓库发布需要目标仓库授权。[触发规则](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)、[Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

### 引用的项目组织讨论

已读取用户引用的“GitHub项目组织方式”会话的完整相关回复：建议四个仓库继续归个人账号，使用一个 Private GitHub Project 统一追踪，再用总览 README 展示依赖。该建议作为候选，不视为当前已确认决策。此公开设计记录省略个人会话链接。

GitHub Projects 负责 Issues/PR 的规划与进度跟踪；代码组织、共享契约和版本依赖仍需由仓库及构建发布方案解决。[官方定位](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects)。

### 独立 CLI 的语言候选

- Go 可以发布包含 Go runtime 的原生可执行文件，无需用户另装 Go。标准库覆盖 HTTP 和 JSON；优先使用纯 Go 依赖并按目标平台构建，避免为了 CLI 引入额外 C 依赖。不承诺所有平台都不存在系统库依赖。[Go FAQ](https://go.dev/doc/faq#runtime)、[HTTP](https://pkg.go.dev/net/http)、[JSON](https://pkg.go.dev/encoding/json)、[cgo](https://pkg.go.dev/cmd/cgo)。
- Rust 也能交付用户直接运行的原生可执行文件；Linux glibc/musl、Windows CRT 与目标链接器会影响构建及兼容范围。这些是发行端要解决的条件，不应要求最终用户安装 Rust 工具链。[Rust 可执行文件](https://doc.rust-lang.org/book/ch01-02-hello-world.html)、[平台支持](https://doc.rust-lang.org/rustc/platform-support.html)、[链接](https://doc.rust-lang.org/reference/linkage.html#static-and-dynamic-c-runtimes)。
- TypeScript 可经 Bun --compile 或转成 JS 后使用 Node SEA 打包，用户同样无需另装相应运行时。它们会将运行时带入产物；需验证目标平台和依赖兼容性，不能以“TS 一定要求用户先装 Node”排除该方案。[Bun](https://bun.sh/docs/bundler/executables)、[Node SEA](https://nodejs.org/api/single-executable-applications.html)。
- Rust 和 Go 都可将适合的纯逻辑编译为浏览器 WASM，但会增加桥接与构建步骤，文件、网络和存储环境仍需适配。当前没有已确认的 WASM 需求。[Rust WASM](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html)、[Go WASM](https://go.dev/wiki/WebAssembly)。
- Chrome 扩展直接调用本机进程需要 Native Messaging host 的安装与注册；CLI 是独立可执行文件并不能省略这一步。既定的插件访问 GitHub、Actions 后台处理方案不要求这种本机集成。[Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)。
- Rust/TypeScript 可共享 JSON Schema 和合法/非法数据样例，但结构 schema 不会自动统一冲突合并等业务行为；相关规则及行为样例仍须共同验证。[JSON Schema](https://json-schema.org/overview/what-is-jsonschema)。

此前针对 HTTP/JSON 批处理工作推荐 Go 是工程取舍判断，并非性能测试结论。用户已选择 Rust，以上候选资料保留为决策背景。

## 设计树与下一轮

第四轮已完成：Rust 核心/CLI、本机 codex exec 调试、译文保护、公开白名单、删除恢复和周期默认值均已确认。使用本机 Codex 时 AI 任务只能在能访问该进程的环境执行；在未配置云端模型服务的调试阶段，不能承诺云端 AI 自动处理已经可用。GitHub 元信息更新无需模型服务，可以独立运行。

第五轮已经收拢公开网站部署、标签整理边界、管理界面范围及调试约束。剩余设计重点是完整网址身份规则、存储格式、公开历史与少量行为边界；不要求用户现在提供密钥。

## 第五轮决策与补充问题

| 问题 | 用户选择与影响 |
| --- | --- |
| Q25 公开部署 | 兼容 Free：私有数据仓库加公开 Pages 仓库；第六轮 Q35 追加不提交公开数据历史的限制 |
| Q26 重复收藏 | 第六轮补充已接受完整 URL 标准序列化规则，HTTP/HTTPS 与不同片段均区分 |
| Q27 标签组织 | 首版平面标签，稳定身份、搜索别名、人工改名与合并 |
| Q28 AI 体系修改权 | 复用优先，自动新增；已有标签语义、改名合并删除由用户操作；证据不足暂缓 |
| Q29 查询与批量编辑 | 中英文搜索、标签布尔组合、GitHub 筛选、V2 分享链接及批量标签/公开/删除 |
| Q30 立即运行入口 | 插件内也要一键触发云端 Actions，需增加限定仓库的 Actions 写权限 |
| Q31 HTTP 调试 | 20 条样本，官方 deepseek-flash，总预算 2 元（含重试）；对照 Codex 后再定长期配置 |
| Q32 备份恢复 | 完整 V2 备份不含密钥，整库恢复到新空实例；单条回收站恢复仍在原实例 |
| Q33 CLI 平台 | 首版包括 Windows x64、Linux x64/WSL 和 macOS |

Q25、Q27–Q29、Q32 接受推荐；Q30、Q31、Q33 以本表中的用户调整为准。Q28 不改变已接受的 AI 新建标签/定义自动生效；Q32 是 V2 恢复策略，不恢复 V1 导入需求。DeepSeek 官方事实与调试约束见[执行工作流](execution-workflow.md)。新增 ADR：[私有数据与公开 Pages 产物仓库](adr/0010-private-data-public-pages-artifacts.md)。

用户在第五轮后追加存储效率问题：JSON/JSONL 是否过于冗余，是否应换用更高效格式或压缩后由前端解压。当时尚未决定 V2 文件格式，随后在第六轮按浏览器本地编辑、GitHub 快照同步和公开网站下载分别确定方案。

详见[数据存储与网址身份](data-and-url-design.md)：旧版固定数据 4,459,961 字节，紧凑 JSON 加 gzip 后 1,147,074 字节，约减少 74.3%。这里只读评估了旧版数据，没有执行迁移。已解释 `site.com/test#aaa` 与 `site.com/test#bbb` 可由页面脚本显示不同页面，片段无需以斜杠开头；TagMark 保留两者区别。

完整 WHATWG URL 序列化去重、本地 IndexedDB、私有 GitHub 文本快照、公开 JSON 加 gzip 已在第六轮接受。用户不接受公开产物仓库的旧 Git 提交保留取消公开的内容，后续 Q38 已确定采用临时产物发布。

## 第六轮：已回答

| 问题 | 用户选择 |
| --- | --- |
| Q26 补充：完整网址相等 | 按完整 WHATWG URL 序列化结果去重；保留协议、查询及片段区别；首版 HTTP(S)；重复收藏保留人工修改 |
| Q34 存储与压缩 | 本地 IndexedDB；私有 JSON/JSONL 快照；公开 JSON 加 gzip |
| Q35 公开历史 | 不允许公开 Git 历史累积收藏数据；后续 Q38 确定采用临时产物发布，未采用 amend |
| Q36 首版发布包 | CLI 覆盖 Win/Linux x64、macOS x64/arm64；Chrome 插件先下载后开发者模式加载，商店后续 |
| Q37 人工保护粒度 | 每条收藏的每个标签关联及被编辑字段分别保护；普通重跑不解锁，显式解除所选保护后才重算 |

Q26、Q34、Q36、Q37 接受推荐；Q35 拒绝公开历史累积数据，后续 Q38 明确临时产物发布。新增 ADR：[完整 URL 身份](adr/0011-complete-url-identity.md)、[分用途存储](adr/0012-record-cache-text-sync-compressed-publication.md)；人工保护与平台发行范围已写入原 ADR，公开部署边界已修订。

发布方案已确定，[整体设计与分阶段验收清单](design-overview.md)已更新。长期 AI 服务与月预算依赖已约定的 20 条样本结果，不在尚未测量时替用户决定。

## 第七轮：公开历史边界已确定

Q38 最终选择：Actions 临时包部署 Pages，不把收藏数据提交到公开 Git，部署成功后清理临时包。持续 amend 可以保持一个可见提交，但旧 SHA 或缓存仍可能访问，所以没有采用。官方支持 Pages 从 Actions artifact 部署；临时产物删除、日志控制及跨仓库授权已记入 ADR 和验收清单，不把“没有 Git 历史”解释成“平台从未存储或所有缓存可即时删除”。

用户曾追问部署包是否放 Release、能否供网页当数据使用。说明包放 Actions artifact、数据由 Pages 托管后，用户明确接受该路径；访客无需下载 Release 或访问 artifact 下载接口。“删除临时包后站点仍正常访问”必须在实施时验收。

第七轮结果汇总到[设计总览](design-overview.md)，随后提交 Q39 共同复核；用户提出的新增要求及后续决定如下。

## Q39：最终共同确认

向用户提交设计总览、术语表及 12 份 ADR 后，用户选择“还有设计内容需要调整”，随后提出以下明确要求。现有决策不整体撤销，当前保持设计阶段。

| 调整项 | 要求与后续结果 |
| --- | --- |
| AI 政策范围 | skill 与 API 共用完整版本化政策，覆盖所有 AI 生成内容；目录已补入执行工作流和 ADR 0002 |
| 公开选择 | 标签正选、反选和逐条选择汇总为清单；Q40–Q42 及 Q47 确定规则，后续强调不公开标签一票否决 |
| API 错误 | Q43、Q44 确定私有故障 Issue 通知本人、分类停止／重试及手动恢复 |
| 失效链接 | 失效独立标记、仍可公开展示并筛选隐藏；Q45、Q46 确定状态、人工覆盖及复查节奏 |

已只读核实 GitHub Actions 通知收件人、Issue 提及通知、DeepSeek 错误码和 HTTP/GitHub 状态语义。原生通知不无条件发给仓库 owner；GitHub 404 不能区分删除与无权访问，归档不等于失效。官方来源随 ADR 0014、0015 保存。本轮未调用模型、检查整个收藏库或创建故障通知。

## 第八至十轮：补充要求已确定

| 问题 | 当前生效的决定 |
| --- | --- |
| Q40 公开模式 | 仅手动默认；标签包含后排除；全部减排除；列表内任意标签匹配，空包含不变成全部，保存前预览 |
| Q41 逐条优先级 | 最初接受逐条优先，后被用户明确修订：不公开标签一票否决，手动公开不能越过；条目手动私有仍阻止公开 |
| Q42 动态公开 | 新收藏及 AI／人工标签变化自动重算，下一次成功部署生效；启用时说明，规则修改预览增删 |
| Q43 通知路径 | 私有故障 Issue 首次提及配置的本人；同一未恢复故障不重复评论或提及，恢复关闭；原生 Actions 通知可补充 |
| Q44 故障恢复 | 认证失败／余额不足停止并挂起，手动恢复；临时故障每项最多三次尝试，预算仍有效，保留合格结果与续跑进度 |
| Q45 链接状态 | 未检查／可访问／检查受阻或待复查／持续不可访问；两次 404/410 间隔至少 24 小时；人工覆盖保护，失效仍可公开 |
| Q46 复查 | 每日调度、正常和失效默认每 7 天复查，首次 404/410 至少 24 小时后复核；普通网址每轮 500，可立即复查；重定向不改网址、不合并 |
| Q47 中立标签 | 未设置的标签中立，只有明确不公开的标签执行一票否决；不要求每个标签都加入公开列表 |

公开优先级以用户后补要求和 Q47 为准：回收站 → 任意不公开标签 → 手动私有 → 手动公开 → 基础模式。前三项均阻止公开。包含 rust、排除 private 时，rust＋tool 可公开，rust＋private 不公开，即使手动公开也不例外。

新增 ADR：[公开清单](adr/0013-publication-selection-and-exclusion-veto.md)、[API 失败与通知](adr/0014-api-failure-recovery-notifications.md)、[链接状态与复查](adr/0015-link-availability-and-rechecks.md)。[设计总览](design-overview.md)与验收清单已同步，随后在 Q48 获得共同确认。

## Q48 与开发工作流

用户明确选择“确认更新后的设计并开始实现”，之后要求先说明执行方式，并核查是否已使用 to-spec。此前仅完成 grill-with-docs 的设计记录，没有执行 to-spec 或 to-tickets，没有发布规范 Issue 或开发 tickets，也没有写产品代码。

用户随后指定 AI Hero 的主流程：grill-with-docs → to-spec → to-tickets → implement → code-review → retro。当前遵循此流程，先形成[开发规范草稿](specs/tagmark-v2.md)，并核实本项目的 issue tracker、标签和技能入口配置；测试边界与 tracker 发布仍待该阶段确认。范围已确定的产品问题不重新访谈。

当前本地目录无 Git 远端、AGENTS.md、CLAUDE.md 或项目技能配置；这些事实不代表需要迁移或修改三个旧仓库。GitHub 搜索返回旧项目，仅作为现状参考，不能据此替用户选择新项目目标。

已接受的 UI 方案参考：[TypeScript strict](https://www.typescriptlang.org/tsconfig/strict.html)、[React TS](https://react.dev/learn/typescript)、[Vite](https://vite.dev/guide/)、[WXT 框架支持](https://wxt.dev/guide/essentials/frontend-frameworks.html)。

设计树收拢结果：

- 数据：已确定删除、恢复、备份、完整 URL 去重、稳定身份与存储格式；旧数据导入移出首版。
- 标签：已确定语义范围、平面标签与别名、人工体系修改、短定义与规则、逐字段保护和明确解除范围。
- 自动任务：已确定完整 AI 政策、触发、周期、GitHub 新鲜度与分批、链接检查、API 失败恢复与私有 Issue 通知；长期 AI 参数待已授权样本预算内的测量后决定。
- UI：已确定插件编辑、只读网站、搜索/批量操作、多语言、公开清单及排除标签的一票否决、失效状态筛选、公开白名单及部署后撤回。
- 工程：已确定 Rust/TypeScript、共享契约、四种 CLI 目标产物、开发者模式插件包、临时 Pages 部署和分阶段验收；具体可逆实现细节按这些约束推导。

所有建议均不得因尚未答复而自动转为已接受决策。访谈最终共同确认前不开始实现、不创建远端仓库或部署。

## 项目工作流配置与规范发布

用户确认四组测试边界，并授权创建新代码仓库采用 GitHub Issues。已创建公开代码仓库 pwnfan/tagmark-v2，启用 Issues；用户接受五个默认分流标签，并审阅配置草稿后选择创建 AGENTS.md。项目继续采用根 GLOSSARY.md 与 docs/adr/ 的单一领域布局。

规范已发布为 [Spec #1](https://github.com/pwnfan/tagmark-v2/issues/1)，标记 ready-for-agent；核对远端正文与本地规范一致，包含 84 条用户故事。当前进入 to-tickets：先审阅纵向功能切片及阻塞关系，获批后发布子 Issues，再按 implement、code-review、retro 推进。尚未编写产品代码。
