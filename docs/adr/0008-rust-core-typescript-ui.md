---
status: accepted
---

# Rust 核心与独立 CLI，TypeScript 界面

用户选择 Rust 编写核心处理与 CLI。Chrome 插件和网站继续使用已确认的 TypeScript 严格检查与 React，分别通过 WXT、Vite 构建。

CLI 按目标操作系统和 CPU 分发可执行文件，用户无需另装 Rust 工具链。语言选择不要求插件调用本机 CLI，也不要求首版引入 WASM。核心与界面共享版本化数据契约、合法/非法样例和同步合并等关键行为样例；结构 schema 不替代跨语言的业务一致性验证。

首版提供 Windows x64、Linux x64（含 WSL）、macOS Intel x64 和 Apple Silicon arm64 的可执行文件。Chrome 插件先发布可下载包，用户通过开发者模式加载，商店上架不属于首版要求；各平台最低系统版本在发行说明与构建验证中明确。

Go 和 TypeScript 独立打包都曾是可行候选，用户最终选择 Rust。代价是维护 Rust 与 TypeScript 两端实现，并在发布端验证平台链接和系统依赖；无需为了调用 Codex 而采用某种特定语言或 SDK。
