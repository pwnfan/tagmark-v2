---
status: accepted
---

# API 失败分类、恢复与私有故障通知

无人值守 AI 任务必须能说明 API 不可用、认证失败或余额耗尽等原因，并通知用户。失败不应丢失已经验证的结果，也不能继续无上限地发起付费请求。

Q43、Q44 已接受以下行为：

- 认证失败或余额不足立即停止本批 AI，并将自动 AI 挂起。用户修正凭据或余额后，执行“恢复并重试”。挂起状态对用户可见，不能显示成任务完成。
- 限流、超时、断连或服务端故障有限退避重试。同一项 API 操作在一次运行中最多尝试 3 次，含首次；所有尝试受单轮任务数、总时限和费用上限约束。耗尽后本次运行失败，下个周期可继续尝试，遵守服务返回的等待时间。
- 请求格式或参数错误需要修正，不盲目重复原请求。无效、空白或截断输出不能作为成功结果写入；修复或重试同样受预算约束。
- 通过校验且仍适用于当前输入的结果可保留；失败项记录原因和续跑位置，不写入残缺输出，也不解除人工保护。GitHub 元信息及已有公开数据的发布可独立继续，但任务摘要必须如实表达 AI 失败。

DeepSeek 当前官方错误码中，401 是认证失败，402 是余额不足，429 是限流，500/503 是服务端错误或过载；这些是该服务的语义，其他服务应按其文档映射。[DeepSeek 错误码](https://api-docs.deepseek.com/quick_start/error_codes/)

CLI 对必要步骤的失败返回非零退出码；工作流保留失败结果，并写出经过脱敏的错误分类、建议操作及运行链接。仅写错误注解不能代替失败退出码，不用 continue-on-error 将必要步骤失败显示为成功。[退出码](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/set-exit-codes)

每个未恢复故障在私有数据仓库保留一条故障 Issue，首次创建时提及配置的本人 GitHub 用户名。重复失败写入任务状态，不反复创建 Issue、评论或提及；恢复后关闭一次。安装流程启用 Issues，并给通知工作流本仓库 `issues: write`。Issue 只包含故障类型、发生时间、处理建议和 run 链接，不包含密钥、原始请求、收藏正文或模型提示词。

Actions 失败状态和插件提示始终保留。原生 Actions 通知可由用户开启作为补充，其收件者通常是触发者，定时任务还受创建者、cron 修改者或重新启用者影响。GitHub Notifications API 不提供向任意指定用户直接创建通知的接口；Issue 提及的实际通知仍受 GitHub 权限和用户设置影响，不能保证强制送达邮件或收件箱。[运行通知](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs)、[通知 API](https://docs.github.com/en/rest/activity/notifications)、[创建 Issue](https://docs.github.com/en/rest/issues/issues#create-an-issue)

通知写入失败必须保留为独立错误，不能覆盖原始 API 故障或伪称已通知。此方案增加私有仓库的 Issue 和少量运维状态，换取明确的收件人、可操作的故障记录及同一故障去重。本次只确认产品设计，未创建 Issue、发送通知或调用模型。
