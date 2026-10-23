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

快照的 `tags` 和收藏的 `tagAssignments` 为版本 1 的新增字段；旧快照缺失时按空集合读取。人工版本号范围为 1 至 9,007,199,254,740,991，达到上限时拒绝修改，避免两端数字精度不一致。管理页下载的快照包含标签、规则及人工保护，CLI `tags`／`list` 可读取核对。导出仍是完整私有状态。

在 Chrome 的扩展程序页面开启开发者模式，加载 `apps/extension/.output/chrome-mv3` 目录。收藏缓存保存在插件自己的 IndexedDB 中；当前开发阶段尚未接通 GitHub 同步。

URL 身份的共同样例位于 `fixtures/url-identity.json`，Rust 与 TypeScript 均读取它。浏览器测试使用独立的临时配置目录和实际构建的插件，不使用个人 Chrome 数据。

若 Windows 在默认浏览器缓存目录报 `side-by-side configuration` 错误，可将 `PLAYWRIGHT_BROWSERS_PATH` 指向本项目的 `.scratch/browsers`，重新执行浏览器安装及检查；后续运行保留同一环境变量。该配置只改变测试浏览器的缓存位置。
