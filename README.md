# TagMark V2

单人自部署的收藏管理工具：Chrome 插件负责收藏和整理，Rust CLI 执行 AI 分类与定期维护，完整收藏库在私有 GitHub 仓库同步，选定内容通过独立 Pages 网站分享。

当前正在开发，尚无完整产品发行版。已确认的范围及 30 张子任务见 [Spec #1](https://github.com/pwnfan/tagmark-v2/issues/1)；进展在本仓库的 [GitHub Issues](https://github.com/pwnfan/tagmark-v2/issues) 跟踪。

- [开发规范](docs/specs/tagmark-v2.md)
- [设计总览与验收清单](docs/design-overview.md)
- [领域术语](GLOSSARY.md)
- [设计决策](docs/adr/)
- [代理工作指引](AGENTS.md)

开发流程为 grill-with-docs → to-spec → to-tickets → implement → code-review → retro。产品代码、个人私有数据和 Pages 承载仓库的职责见设计总览。

## 开发与验证

开发环境需要 Rust 1.98 或更新版本、Node.js 24 或更新版本。克隆后运行：

```sh
npm ci
npx playwright install chromium
npm run check
```

CLI 的本地收藏快照入口：

```sh
cargo run -- --collection collection.json init
cargo run -- --collection collection.json save "https://example.com/article#intro" --title "An article"
cargo run -- --collection collection.json list
cargo run -- --collection collection.json edit <bookmark-id> --title "My title" --private-note "Private decision"
cargo run -- --collection collection.json edit <bookmark-id> --description "Page description" --body-excerpt "Allowed paragraph" --include-body true --skip-ai false
cargo run -- --collection collection.json ai-evidence <bookmark-id>
```

管理页可创建英文标签、编辑短定义及独立的适用／排除／例子规则，并对每条收藏添加或明确拒绝某个标签。CLI 使用相同快照语义：

```sh
cargo run -- --collection collection.json tag-create "HTTP" --definition "The HTTP protocol." --inclusion "Resources about HTTP."
cargo run -- --collection collection.json tags
cargo run -- --collection collection.json tag-edit <tag-id> --exclusion "Incidental use of HTTP."
cargo run -- --collection collection.json tag-add <bookmark-id> <tag-id>
cargo run -- --collection collection.json tag-reject <bookmark-id> <tag-id>
```

标准名使用包含英文字母的可打印 ASCII，去除两端的空格、制表符、换行、回车和换页符并统一为小写；垂直制表符不接受。支持 `c++`、`c#`、`.net`、`http/2` 和含空格的名称。同名冲突显示错误，不合并标签。短定义不能只含 Unicode `White_Space` 字符或 BOM（U+FEFF）；有效文本原样保留。创建、编辑及 CLI 快照读取使用同一校验规则。

短定义与各项规则分别记录人工来源、版本和保护；添加或拒绝按每个标签关联单独记录。未填写的规则保持未保护，保存未改变的字段不会增加版本。管理表单只提交用户实际编辑过的字段，刷新其他标签不会覆盖未保存的输入或把旧字段写回。重复收藏保留这些人工决定。标签改名／合并、解除保护和 AI 执行属于后续任务。

快照的 `tags` 和收藏的 `tagAssignments` 为版本 1 的新增字段；旧快照缺失时按空集合读取。人工版本号范围为 1 至 9,007,199,254,740,991，达到上限时拒绝修改，避免两端数字精度不一致。管理页下载的快照包含标签、规则及人工保护，CLI `tags`／`list` 可读取核对。这份本地快照是完整私有状态。

在 Chrome 的扩展程序页面开启开发者模式，加载 `apps/extension/.output/chrome-mv3` 目录。收藏缓存保存在插件自己的 IndexedDB 中，支持离线编辑和私有 GitHub 实例同步。管理页可配置限定仓库的令牌并选择仅会话或本机记住；CLI 从 `TAGMARK_GITHUB_TOKEN` 环境变量读取凭据，然后执行 `cargo run -- --collection collection.json sync --repository owner/repository`。初始化、权限、冲突处理和验收边界见[私有同步说明](docs/private-sync.md)。

插件弹窗仅在点击保存时读取当前 HTTP(S) 页面的标题和简介；正文摘录默认关闭，启用时最多保存 20,000 字符，并排除表单、可编辑区、隐藏内容与脚本。简介最多 2,000 字符。页面限制读取时仍可保存网址和标题，并显示提示。管理页可离线修改标题、网址、私人备注和页面证据，保存正文开关及单条跳过 AI 的选择。重复收藏保留已有修改；网址碰撞报错且不合并。含用户名或密码的网址会被拒绝。

`ai-evidence` 只预览允许的 AI 输入，不发起模型调用；私人备注始终排除，正文关闭时省略，跳过 AI 时返回 `null`。局部编辑记录逐字段人工来源、保护和版本；未改字段保持原样。下载的本地快照包含这些私有内容和选择，可由 CLI 读取。T01 的旧快照读取时补上空备注、空证据、关闭正文及不跳过 AI 的默认值。

URL 身份的共同样例位于 `fixtures/url-identity.json`，Rust 与 TypeScript 均读取它。浏览器测试使用独立的临时配置目录和实际构建的插件，不使用个人 Chrome 数据。

若 Windows 在默认浏览器缓存目录报 `side-by-side configuration` 错误，可将 `PLAYWRIGHT_BROWSERS_PATH` 指向本项目的 `.scratch/browsers`，重新执行浏览器安装及检查；后续运行保留同一环境变量。该配置只改变测试浏览器的缓存位置。

`list` 只显示正常收藏，`list --trash` 只显示回收站。删除和恢复保留同一身份与内容；删除状态和人工版本保存在完整快照中，不自动清空。同址重新收藏仍返回回收站中的原条目，必须显式恢复。

插件管理页提供 Saved bookmarks／Trash 两个视图和逐条恢复。Download local snapshot 下载完整私有快照，包含回收站；它不是公开导出。旧版未含删除字段的本地条目按正常收藏读取。


```sh
cargo run -- --collection collection.json delete <bookmark-id>
cargo run -- --collection collection.json list --trash
cargo run -- --collection collection.json restore <bookmark-id>
```

## 公开清单与字段白名单

管理页的 Publication selection 默认选择仅手动公开。可主动切换为任意包含标签后排除，或全部减排除；空包含列表不会选中条目。逐条选择支持跟随规则、手动公开和手动私有。优先级为回收站 → 任意不公开标签否决 → 手动私有 → 手动公开 → 基础规则；明确拒绝的标签关联不参与计算，其余未设置标签保持中立。

修改后先点击 Preview changes，检查最终清单、数量、增删及每项原因，再保存。增删对比当前保存的期望清单；预览后如其他页面修改了收藏，保存将拒绝过时预览，保留草稿供重新检查。启用标签规则后，新收藏与人工／AI 标签变化会自动改变期望清单。当前只计算允许公开的范围，不表示网站已部署或撤回；部署与公开网站属于后续任务。

从管理页下载本地快照后，CLI 可解释同一清单或生成紧凑的公开 JSON：

```sh
cargo run -- --collection collection.json publication-preview
cargo run -- --collection collection.json public-export
```

`public-export` 仅输出入选收藏的 URL、标题、有效标签 ID，以及这些标签的当前英文显示名和短定义。尚未实现的 GitHub 元信息、链接检查与译文不会伪造为默认数据。备注、正文、打标规则、AI 偏好、人工保护、拒绝关联、回收站和未使用标签都不进入公开 JSON；压缩和网站部署在后续任务实现。

私有快照中的 `publication` 保存 `mode`、`includedTagIds`、`excludedTagIds` 和逐字段 `fieldState`；收藏中的 `publicationChoice` 使用原有字段版本机制。旧快照缺失时分别使用仅手动、空列表和跟随规则，插件的 v2 IndexedDB 自动升级并保留原数据。规则引用稳定标签 ID，改显示名不改变范围；未知标签引用、无效枚举或缺失必要版本会报错，不会默默扩大公开范围。共同优先级样例见 `fixtures/publication.json`；真实 Chrome 测试会下载快照并核对 Rust CLI 与 TypeScript 的公开输出。
