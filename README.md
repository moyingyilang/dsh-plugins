# dsh-plugins

两个 DeepSeek Harness（DSH）插件，MIT 许可，与 DSH 主仓分离发布。

| 插件 | 半边 | 用途 |
| --- | --- | --- |
| `session-intercom` | host | 会话间显式消息：带署名的 `intercom_send`、去署名的 `intercom_relay`、带 `self` 的 `intercom_list` |
| `token-total` | client | 输入框底部多一个 pill，显示本机所有会话累计消耗的 tokens |

## session-intercom

在 DSH 里启用后提供三个模型工具：

- `intercom_list`：列出其它会话的标题与可用状态，并**返回调用方自己的 `self`**。
  存在的理由：模型无从知道自己的 session id，容易在正文里写错回信地址。
- `intercom_send`：带署名的对等消息，接收方看得到是谁在问。
- `intercom_relay`：中转投递。正文只有 `summary` 与可选 `evidence`，**去掉发送方标题与 id**，
  身份仍写入消息 `source` 供审计。用于“让接收方按信息本身判断，而不是按来源权威”。

插件另把调度规则写进系统提示：问经验用 `send`、传结论用 `relay`、
有顺序依赖或写入冲突的走任务板。

安装：

```bash
npm install <本目录>/session-intercom-0.2.2-rc.1.tgz
# 然后在 DSH 配置里启用插件
```

## token-total

客户端插件，向 `conversation.composer.dock` 注册一个 `order: 2` 的条目，
读取每个会话摘要里 durable 的 `tokenUsage` 投影并求和——**客户端本地算术，不额外请求 Host**。

> 状态：源码完整、思路与主仓里已验证的实现一致；但**独立包的构建链路尚未在这台设备上跑通**
> （pnpm 在 android-arm64 上无法安装新 workspace 包）。要用的话需要先在能跑 pnpm 的机器上
> `tsdown` 出 `lib/client.js`，或把 `src/client/` 直接并入 DSH 的 ui-chat（主仓现在就是这么做的）。

## 许可

MIT，与 DSH 一致。
