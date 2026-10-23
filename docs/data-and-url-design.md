# 数据存储、网址身份与公开发布

日期：2026-10-23。完整 URL 规则、三层存储方式及 Actions 临时产物部署均已接受；尚未实现。

## 不同片段确实可以显示不同页面

`https://site.com/test#aaa` 与 `https://site.com/test#bbb` 可以呈现完全不同的页面内容，不要求片段以 `/` 开头。浏览器最初向服务器请求的路径都是 `/test`；页面脚本读取片段，选择不同视图，并可继续请求不同数据。片段变化还可触发 `hashchange`。这是网址片段不进入初始 HTTP 请求、但仍能决定用户看到哪个页面的具体场景。[RFC 3986 片段](https://www.rfc-editor.org/rfc/rfc3986.html#section-3.5)、[HTML 导航](https://html.spec.whatwg.org/multipage/browsing-the-web.html#scroll-to-fragid)

TagMark 已确认保留这种区别，不尝试判断某个片段究竟是滚动锚点、前端页面标识，还是应用的其他状态。

## Q26 已接受：完整 URL 解析后的序列化结果作为去重键

首版收藏 HTTP(S) 网页。按 WHATWG URL 规则解析绝对 URL，将完整序列化结果作为去重键；包括查询串和片段，不进行额外的内容等价推断。同一键重复收藏时打开现有条目，保留人工修改；条目身份使用独立稳定 ID，编辑标题或网址不改变 ID。网址修改导致键碰撞时提示处理，不静默合并两份人工内容。

| 地址差异 | 已接受的相等规则 | 说明 |
| --- | --- | --- |
| `http://site.com/test` / `https://site.com/test` | 不同，已确认 | 协议是地址的一部分 |
| `/test#aaa` / `/test#bbb` | 不同，已确认 | 完整保留片段，即使某个站点碰巧显示相同内容 |
| `HTTPS://SITE.COM/test` / `https://site.com/test` | 相同 | 协议和域名规范化大小写 |
| `https://site.com:443/test` / `https://site.com/test` | 相同 | 去掉协议的默认端口；其他端口保留 |
| `https://site.com` / `https://site.com/` | 相同 | HTTP(S) 空根路径规范化为 `/` |
| `/Test` / `/test`，`/test` / `/test/` | 不同 | 保留路径大小写和非根路径末尾斜杠 |
| `?a=1&b=2` / `?b=2&a=1` | 不同 | 不重排参数，不删除重复参数或跟踪参数 |
| `/test` / `/test?` / `/test#` | 不同 | 保留不存在与存在但为空的查询串、片段的区别 |
| `/a/./b/../c` / `/a/c` | 相同 | 使用标准解析器对路径点段的处理 |
| `/%7Ealice` / `/~alice`，`/a%2fb` / `/a%2Fb` | 不同 | 不额外解码路径或统一百分号编码字母大小写 |
| `/a%2Fb` / `/a/b` | 不同 | 不把编码后的字符改写为路径分隔符 |
| 跳转前后、不同域名、去掉跟踪参数后 | 不自动合并 | 不因内容相似、重定向或 canonical 标签推断相同 |

这些例子已用 Node 的 WHATWG URL 实现做事实探测；正式实现仍需用同一组样例验证 Chrome 与 Rust `url` crate 的结果一致，不能仅凭两者声称遵循标准就假定完全一致。[URL 等价](https://url.spec.whatwg.org/#url-equivalence)、[Node URL](https://nodejs.org/api/url.html#the-whatwg-url-api)、[Rust URL 序列化](https://docs.rs/url/2.5.8/url/struct.Url.html#method.as_str)

浏览器内部页、`javascript:`、`data:`、本地文件等不在首版网页收藏范围内。

## JSON 冗余与 gzip 实测

对旧版公开数据的固定提交 `3f0c23d6df49ec15767c01a8a60ae59fedb693aa` 进行了只读探测：2,896 条收藏、1,093 项标签定义。下载内容验证了 Git blob 身份，压缩后解压并解析的结果与原数据相同。这是格式评估，不是把 V1 数据导入 V2。

| 数据 | 原文件字节 | 去掉 JSON 空白后 | 再用 gzip 压缩后 |
| --- | ---: | ---: | ---: |
| 收藏 JSONL | 1,852,374 | 1,852,374 | 423,966 |
| 标签 JSON | 2,607,587 | 2,529,983 | 723,108 |
| 合计 | 4,459,961 | 4,382,357 | 1,147,074 |

合计约 4.25 MiB → 1.09 MiB，减少约 74.3%。仅移除空白减少约 1.7%；对原文件直接 gzip 也只需 1,151,439 字节，与先去空白再压缩差约 0.38%。重复字段名容易被通用压缩利用，因此不必先把每个字段改成难读的单字母，或引入自定义二进制格式。

旧标签定义正文约 235 万 UTF-8 字节，约占标签紧凑 JSON 的 93%。V2 已选择短定义，公开输出还会筛选字段，因此这里的大小和压缩率不能外推为 V2 的最终结果。

测量环境：Windows 11 AMD64，Python 3.12.14，zlib 1.3.2，gzip level 6，固定压缩时间戳。一次预热后进行 21 次内存操作，取中位数，不计下载或磁盘 I/O。两份文件的解压中位数分别约 4.52 ms 和 9.61 ms；解压加解析分别约 26.48 ms 和 17.15 ms。这不是 Chrome、Rust 或网页加载性能测试。

原始公开输入：[tagmarks.jsonl](https://github.com/pwnfan/my-tagmarks/blob/3f0c23d6df49ec15767c01a8a60ae59fedb693aa/data/tagmarks.jsonl)、[tags.json](https://github.com/pwnfan/my-tagmarks/blob/3f0c23d6df49ec15767c01a8a60ae59fedb693aa/data/tags.json)。

## Q34 已接受：按用途选择存储形式

| 用途 | 已选择形式 | 原因与限制 |
| --- | --- | --- |
| 插件本地编辑与离线缓存 | IndexedDB 按记录保存，建立必要索引 | 支持单条更新和事务，不把整库压成每次都需解压重写的 blob；同步和全文检索规则仍由应用实现 |
| 私有 GitHub 数据 | 版本化 JSON/JSONL 快照，稳定 ID 和确定性排序；同一提交包含一致状态 | 便于查看变更和排错；应用按共同基线做语义合并，文本格式本身不保证正确同步 |
| 公开网站数据 | 白名单输出生成紧凑 JSON，再 gzip；浏览器原生解压 | 优先减小下载量；公开输出可随私有数据重新生成，无须携带人工保护、冲突或后台进度 |

Git 自身会压缩对象，并可用 packfile 保存差异，所以工作区原始 JSON 字节数不等于 Git 仓库实际占用，也不等于 GitHub API 的传输字节数。私有同步仍应实测实际 API 路径；若 V2 的体积或同步耗时成为瓶颈，再评估压缩快照或按需分片。[Git packfiles](https://git-scm.com/book/en/v2/Git-Internals-Packfiles)

Chrome 提供 `DecompressionStream('gzip')`，无需为 gzip 另装前端解压库。实现时要区别“HTTP Content-Encoding 已由浏览器解码”和“响应体本身是 gzip 文件”，避免重复解压。服务器如何响应须在实际部署中验证，不能仅依据 `.gz` 后缀推断。[Chrome Compression Streams](https://developer.chrome.com/blog/compression-streams-api/)、[Fetch HTTP network fetch](https://fetch.spec.whatwg.org/#http-network-fetch)

SQLite 适合本机需要 SQL 的场景，但各设备提交独立数据库文件并不会自动解决多设备合并；浏览器 SQLite 还需相应运行层。CBOR、MessagePack 能提供紧凑二进制表示，但本次没有实测它们优于 gzip JSON，不以猜测增加编解码依赖。首版暂不增加浏览器 SQLite、自定义二进制、分片、后台解压 Worker 或 Rust WASM。[SQLite 单文件](https://sqlite.org/onefile.html)、[SQLite 隔离](https://sqlite.org/isolation.html)、[SQLite WASM](https://sqlite.org/wasm/doc/trunk/index.md)、[CBOR](https://www.rfc-editor.org/rfc/rfc8949.html)

压缩节省传输和存储空间，不消除解压后对象的内存占用；不将压缩称为加密。

## Q35 已明确：公开 Git 历史不能累积收藏数据

最初考虑的公开数据提交方式会留下历史：取消公开后，即使最新站点已经移除该条目，旧提交仍可能保存曾公开的 URL、标题和标签。这不同于第三方自行保存的副本；改写历史也不能保证清除所有引用、缓存或副本，因此用户最终选择了下文的临时产物路径。[GitHub 历史删除说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)

用户选择“不在公开 Git 历史里累积收藏数据”，并追问是否能始终使用 amend。若从一个根提交开始，持续 amend 加强推可使该分支的常规历史保持一个提交；amend 创建替代提交，不会原地擦除旧对象，旧 SHA 或缓存仍可能访问。它能满足“历史列表不增长”，不能保证删除已上传的旧内容。[Git amend](https://git-scm.com/docs/git-commit#Documentation/git-commit.txt---amend)、[GitHub 改写历史的限制](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)

用户在 Q38 补充答复中选择 Actions 临时部署包：收藏数据不提交到公开 Git，未采用 amend。当前没有远端部署或待清理的数据历史。

### 临时部署包路径的事实核查

这里的“临时部署包”是 GitHub Actions 的 artifact，位于工作流运行记录，不是 Release 附件。它用于部署交接，不作为浏览器直接读取的数据接口。部署完成后，包内的 `index.html`、脚本和 `data/collection.json.gz` 成为 Pages 托管的站点文件；网页通过自己站点的 URL 获取数据，不需要访问 Actions 产物下载地址或携带 GitHub 凭据。

```mermaid
flowchart LR
  B[网站文件与公开数据] --> A[Actions 临时部署包]
  A --> D[Pages 部署]
  D --> P[Pages 托管的站点文件]
  P --> W[浏览器读取同站点数据]
```

因此数据可以供静态网页消费；用户无需手动下载部署包。公开 Git 仓库用于承载工作流及站点配置，数据文件不必提交进 Git。官方文档也允许在 Actions 运行时生成站点入口文件，再随 artifact 部署。[Pages 站点与 Actions 产物](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)

GitHub Pages 支持从 Actions artifact 部署，因此“公开仓库只保留 UI/工作流，收藏数据不 commit”在标准工作流内可行。官方 `deploy-pages` 在当前 run 查找产物，并固定向当前仓库创建 Pages 部署，没有跨仓库目标参数；不能仅替换 PAT 就宣称私有 run 可直接部署另一个公开仓库。[自定义 Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[官方 action 的当前 run 与仓库逻辑](https://github.com/actions/deploy-pages/blob/main/src/internal/api-client.js)

已选择的发布路径具体化为以下交接步骤，真实账户上的执行效果仍须验收：

1. 私有处理任务生成完整的公开字段白名单输出，作为私有 Actions artifact 上传。
2. 显式触发公开仓库的发布 workflow，只传固定来源下的 run/artifact 标识，不把收藏内容放进触发参数。
3. 公开发布任务验证来源并下载该导出，与 UI 组合为本次 run 的 Pages artifact，然后用公开仓库自身的权限和 OIDC 部署。
4. 确认部署成功后删除公开 artifact，并核对当前站点数据版本；取消公开同样发布最新完整导出。

跨仓库需要两项授权：向公开仓库发起 `workflow_dispatch` 的 Actions:write，以及下载私有源 artifact 的 Actions:read。公开任务因此无需读取私有仓库 Contents，但 Actions:read 是仓库级权限，并非单个产物权限。公开部署使用该仓库 `GITHUB_TOKEN` 的 pages:write、id-token:write；产物清理另需 actions:write。[触发权限](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)、[跨 run/仓库下载](https://github.com/actions/download-artifact#download-artifacts-from-other-workflow-runs-or-repositories)、[删除产物 API](https://docs.github.com/en/rest/actions/artifacts#delete-an-artifact)

公开 workflow 的产物在删除前可由具备读取权限的登录用户下载，不能视为私密临时内存。Pages 上传 action 默认保留一天，方案应主动删除，并以短保留期处理清理未完成的情况。日志、run 标题、文件名和 summary 不得含收藏内容；固定文件名、禁止输出数据正文，避免把旧数据转移到日志历史。[下载权限](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts)、[默认保留期](https://github.com/actions/upload-pages-artifact/blob/main/action.yml)

待实施验收：用无敏感样例确认“部署成功→删除 artifact→站点仍完整可访问”，并验证失败与取消时的清理。默认一天保留期支持站点无需永久依赖 artifact 的推断，但没有据此宣称本项目已经实测通过。此路径保证不向公开 Git 提交数据，不承诺 GitHub 后台缓存、部署历史和外部副本的完全擦除。
