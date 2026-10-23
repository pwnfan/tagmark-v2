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

在 Chrome 的扩展程序页面开启开发者模式，加载 `apps/extension/.output/chrome-mv3` 目录。收藏缓存保存在插件自己的 IndexedDB 中；当前开发阶段尚未接通 GitHub 同步。

URL 身份的共同样例位于 `fixtures/url-identity.json`，Rust 与 TypeScript 均读取它。浏览器测试使用独立的临时配置目录和实际构建的插件，不使用个人 Chrome 数据。

若 Windows 在默认浏览器缓存目录报 `side-by-side configuration` 错误，可将 `PLAYWRIGHT_BROWSERS_PATH` 指向本项目的 `.scratch/browsers`，重新执行浏览器安装及检查；后续运行保留同一环境变量。该配置只改变测试浏览器的缓存位置。
