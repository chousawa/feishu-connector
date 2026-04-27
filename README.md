# 飞书链接收集助手

将日常遇到的小红书、播客、微博、公众号等需要稍后阅读的帖子发到飞书，交给 AI 整理分析后存入飞书多维表格，后续按照时间、优先级、方向标签等批量阅读处理，帮助解决信息囤积癖。

## 功能特性

### 被动收集（Listener）
- 📡 实时监听飞书群消息，发链接即自动触发收集
- 🤖 AI 分析内容（标题、摘要、分类、优先级）
- 📊 自动写入飞书多维表格
- 🎬 小红书视频自动转录，字幕写入"视频/图片原文"列
- 🖼️ 小红书图文笔记图片自动 OCR，提取图中文字
- 💬 引用消息补充想法，自动追加到表格"我的想法"字段
- 🔄 支持手动发"收集"触发全量扫描
- ⚡ AI 限流自动重试，WS 断连自动重启

### 主动订阅（Subscriber）✨ 新增
- 📅 每天 00:00 自动抓取订阅源的最新内容
- 🏗️ 支持 Follow Builders 内置源（25 个 X builders + 6 个 podcasts + 2 个 official blogs）
- 🔗 支持自定义 URL 源（X/Twitter、小红书、微博、通用博客）
- 🧠 自动内容分析和分类（同被动收集）
- 🚫 智能 URL 去重，避免重复收集
- 📢 抓取完成自动发送飞书群通知
- ☁️ 支持服务器部署（PM2）

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/chousawa/feishu-connector.git
cd feishu-connector
```

### 2. 安装依赖

```bash
npm install
pip3 install douyin-mcp-server  # 小红书内容解析
```

### 3. 配置飞书应用

#### 3.1 创建飞书应用

1. 打开 [飞书开放平台](https://open.feishu.cn/)
2. 创建企业自建应用
3. 添加应用能力 → 机器人

#### 3.2 配置应用权限

在应用的"权限管理"中添加以下权限：

**消息相关：**
- `im:chat:read` - 查看群信息
- `im:chat:readonly` - 获取群组信息
- `im:message` - 获取与发送单聊、群组消息
- `im:message:send_as_bot` - 以应用的身份发消息
- `im:message.group_msg` - 获取群组中所有消息
- `im:chat:member:readonly_only_getChatMember` - 获取群组成员

**多维表格相关：**
- `bitable:app:readonly` - 读取多维表格
- `bitable:app` - 管理多维表格

> **注意**：在多维表格中点击"为协作者配置精细化权限"，将机器人添加为"管理员"以获取编辑权限。

#### 3.3 订阅事件

在应用的"事件与回调"中配置：
- 订阅方式：使用长连接接收事件
- 添加事件：`im.message.receive_v1`

#### 3.4 发布应用

1. 创建应用版本
2. **可见范围选择"所有员工"**（重要：否则无法将机器人添加到群聊）
3. 点击"申请发布" → "发布应用"

发布后将应用添加到你的飞书群。

### 4. 创建配置文件

```bash
cp config.example.json config.json
```

编辑 `config.json`，参考 `config.example.json` 填入你的配置。**必填项：**

```json
{
  "feishu": {
    "app_id": "cli_xxxxx",
    "app_secret": "xxxxx",
    "chat_id": "oc_xxxxx"
  },
  "bitable": {
    "app_token": "xxxxx",
    "table_id": "tbl_xxxxx"
  },
  "minimax": {
    "api_key": "your-api-key",
    "base_url": "https://api.minimaxi.com/anthropic",
    "model": "MiniMax-M2.7"
  }
}
```

**必填项配置说明：**
- `feishu.app_id` / `app_secret` - 在[飞书开放平台](https://open.feishu.cn/)应用详情的"凭证与基础信息"获取
- `feishu.chat_id` - 飞书群设置底部的"会话ID"
- `bitable.app_token` / `table_id` - 多维表格 URL 中的参数（示例：`https://xxx.feishu.cn/bitable/appTokenxxxxx?table_id=tblxxxxx`）；用于被动收集的数据表
- `minimax.api_key` - 在 [MiniMax 开放平台](https://platform.minimaxi.com/) 获取，用于 AI 内容分析

**可选项配置说明：**
- `dashscope.api_key` - 在[阿里云百炼](https://bailian.console.aliyun.com/)获取，用于小红书视频转录和图片 OCR；新用户有免费额度；不配置时视频/图片原文功能不可用
- `kimi.api_key` - 在 [Kimi 开放平台](https://platform.moonshot.cn/) 获取，可作为 MiniMax 的替代内容分析器；如果配置则优先使用 Kimi
- `x.cookie` / `x.ct0` - X.com 登录 Cookie（仅在订阅自定义 X/Twitter 用户时需要）；获取方法见下面"X/Twitter 自定义源配置"章节

> **config.json 不随 git 推送**（在 .gitignore 中），更新后需手动同步到服务器：
> ```bash
> scp config.json user@your-server:/path/to/feishu-connector/config.json
> ```

### 5. 配置主动订阅（可选）

如果要使用定时自动订阅功能，需要在飞书多维表格中创建「订阅配置表」。

**创建订阅配置表：**
1. 在与被动收集相同的 App（`bitable.app_token`）中新建一个 table
2. 添加以下字段：

| 字段名 | 类型 | 说明 |
|-------|------|------|
| 平台 | 文本 | X / Podcast / Blog / 其他 |
| user_url | 文本 | 用户主页或博客 URL |
| 上次抓取时间戳 | 文本 | Unix 时间戳（自动更新，首次填 0） |
| 是否启用 | 单选 | 启用 / 停用 |
| 来自 Follow Builders | 单选 | 是 / 否 |
| 简介 | 文本 | 源的描述 |

**更新 config.json：**

```json
{
  "subscription": {
    "config_table_id": "tbl_xxxxx",    // 上面创建的订阅配置表 ID
    "table_id": "tbl_xxxxx"            // 订阅内容表 ID（可与被动收集共用，或单独创建）
  }
}
```

> 两个 table_id 可以相同（共用同一个表），也可以分开（订阅内容单独保存）

### 6. 运行

**本地开发运行：**

```bash
# 被动收集模式（实时监听）
npm run listen

# 手动触发一次扫描群内未处理链接
npm run trigger

# 主动订阅模式（立即执行一次，用于测试）
npm run subscribe-now

# 主动订阅模式（常驻运行，每天 00:00 自动执行）
npm run subscribe
```

> npm scripts 在 package.json 中定义，通常推荐在本地开发时使用；服务器生产环境推荐用 PM2（见下面"服务器部署"章节）

## 使用方法

### 被动收集（发链接自动收集）

1. 将机器人添加到飞书群
2. 在群里直接发送链接，机器人自动触发收集
3. 或发送"收集"关键词，触发扫描群内所有未处理链接

**触发关键词：** `收集`、`抓取`、`处理`、`开始`

**停止服务：** 发送"停止"

### 主动订阅（定时抓取）

配置好订阅源后，系统会每天 00:00 自动抓取最新内容。

**支持的信源：**
- **Follow Builders**（预置）：25 个知名 X builders、6 个 AI 播客、2 个官方博客
- **自定义 URL**：
  - **小红书**：账号主页 URL（无需额外认证）
  - **微博**：账号主页 URL（无需额外认证）
  - **个人博客**：支持通用博客爬虫（日期或 slug 格式）
  - **X/Twitter**：需要有效的 Cookie 认证（`config.json` 中的 `x.cookie`）

#### X/Twitter 自定义源配置

如果要订阅自定义的 X/Twitter 用户，需要先获取有效的 Cookie：

1. 在浏览器中登录 X.com
2. 打开浏览器开发工具（F12） → Network 标签
3. 刷新页面，查看任意请求的 Request Headers 中的 `Cookie` 字段
4. 复制整个 Cookie 字符串，粘贴到 `config.json` 的 `x.cookie` 字段

**示例：**
```json
{
  "x": {
    "cookie": "auth_token=xxxxx; ct0=xxxxx; other=xxxxx...",
    "ct0": "xxxxx"
  }
}
```

> **注意**：Cookie 会定期失效，需要定期更新。如果 X 用户主页无法访问，尝试重新获取 Cookie。

**自动去重：** 同一篇文章不会被重复收集到表格中，即使多次扫描也不会产生重复记录。

**手动测试：**
```bash
node src/subscriber.js --run-now  # 立即执行一次（不等待 00:00）
```

### 补充想法

引用群里已发过的链接消息，同时输入你的想法，机器人会自动将想法追加到表格对应记录的"我的想法"字段。

> 前提：该链接已被收集到表格中。

**支持的链接平台：**
- 小红书（图文笔记抓取正文；视频笔记自动转录字幕；图片自动 OCR 提取文字）
- 微博
- 公众号（微信）
- 小宇宙播客

> 本地运行需保持电脑打开且联网。推荐部署到云服务器以实现不间断监听。

**本地快捷启动：** 在 Finder 中找到项目文件夹，双击 `启动飞书监听.command` 即可。关闭终端窗口即停止服务。

## 小红书内容处理

小红书笔记走以下链路自动处理：

**视频笔记：**
1. 使用 `douyin-mcp-server` 解析视频直链
2. 将直链提交给阿里云百炼 paraformer-v2 转录，约 17 秒完成（150 秒视频）
3. 转录结果写入表格"视频/图片原文"列
4. 转录失败时自动降级为抓取图文内容

**图文笔记：**
1. 使用 `douyin-mcp-server` 解析图片列表和正文
2. 对图片批量 OCR（最多 5 张），提取图中文字
3. 正文 + 图片文字合并写入"视频/图片原文"列

**依赖安装：**

```bash
pip3 install douyin-mcp-server
```

> Mac 本地运行注意：代码中通过 `process.platform === "darwin"` 自动切换为 `python3.12`（Mac）或 `python3`（Linux）。如果本地 python 版本不同，需修改 `scraper.js` 中的对应版本号。

## 服务器部署

### PM2 部署（推荐）

```bash
# 安装 PM2
npm install -g pm2

# 启动所有进程（被动收集 + 主动订阅）
pm2 start ecosystem.config.cjs

# 仅启动被动收集
pm2 start src/listener.js --name feishu-collector

# 仅启动主动订阅
pm2 start src/subscriber.js --name feishu-subscriber

# 设置开机自启
pm2 startup
pm2 save
```

**常用管理命令：**

```bash
pm2 list                                          # 查看状态
pm2 logs feishu-collector --lines 50 --nostream   # 查看被动收集日志
pm2 logs feishu-subscriber --lines 50 --nostream  # 查看主动订阅日志
pm2 restart feishu-collector                      # 重启被动收集
pm2 restart feishu-subscriber                     # 重启主动订阅
```

**定时任务检查：**

为了确保定时任务可靠性，建议每周检查一次进程状态：

```bash
pm2 list
# 如果进程显示 stopped，执行重启
pm2 restart feishu-subscriber
```

### Docker 部署

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY . .
RUN npm install

CMD ["node", "src/listener.js"]
```

## 项目结构

```
feishu-connector/
├── src/
│   ├── listener.js                  # 被动收集：飞书长连接监听，消息路由
│   ├── subscriber.js                # 主动订阅：定时抓取调度，多源内容获取 ✨
│   ├── feishu.js                    # 飞书 API 封装（含 URL 去重、订阅表管理）
│   ├── scraper.js                   # 网页内容抓取（X、小红书、微博、通用博客）
│   ├── analyzer.js                  # AI 内容分析（MiniMax / Kimi）
│   ├── linkParser.js                # 链接提取与平台识别
│   ├── index.js                     # 手动触发入口
│   ├── backfill-xhs.js              # 小红书历史记录回填工具
│   └── backfill-xhs-transcript.js   # 历史视频转录回填工具
├── scripts/
│   └── populate-bios.js             # 为订阅源填充简介（从 Follow Builders feed）
├── ecosystem.config.cjs             # PM2 配置（两个进程：feishu-collector + feishu-subscriber）
├── feed-x.json                      # Follow Builders 内置源列表（自动读取，无硬编码）
├── config.example.json              # 配置文件模板
├── package.json
└── README.md
```

## 常见问题

### 被动收集相关

**Q: 收不到群消息？**
A: 检查应用是否已发布，事件订阅是否配置正确，机器人是否已加入群聊。

**Q: 链接收集不全？**
A: 服务部署到云服务器可保证全天候监听，本地运行需保持电脑开机联网。

**Q: AI 分析失败？**
A: 检查 MiniMax API Key 是否有效，服务内置 429 限流自动重试（最多 3 次）。

**Q: 小红书视频/图片原文为空？**
A: 检查以下几点：
1. 是否安装了 `douyin-mcp-server`：`pip3 install douyin-mcp-server`
2. 服务器 `config.json` 是否配置了 `dashscope.api_key`
3. 查看日志：`pm2 logs feishu-collector --lines 30 --nostream`，看是否有报错

**Q: 引用补充想法没有写入？**
A: 确认被引用的链接已经收集到表格中，且引用时不要包含触发关键词。

### 主动订阅相关

**Q: 订阅源配置在哪里？**
A: 在飞书多维表格中创建新的「订阅配置表」，将表 ID 填入 `config.json` 的 `subscription.config_table_id`。

**Q: 订阅内容写入哪个表？**
A: 默认写入 `subscription.table_id` 指定的表，可以与被动收集共用同一个表。

**Q: 订阅怎么去重？**
A: 系统会自动检查 URL 是否已存在，重复的内容不会被写入。

**Q: 定时任务没有执行？**
A: 检查以下几点：
1. PM2 进程是否在线：`pm2 list`
2. 查看日志：`pm2 logs feishu-subscriber --lines 50 --nostream`
3. 确认 `config.json` 中 `subscription` 配置正确
4. 尝试手动触发：`node src/subscriber.js --run-now`

**Q: Follow Builders 源如何更新？**
A: 将最新的 `feed-x.json` 放在 `/tmp/follow-builders/` 或项目目录中，subscriber.js 会自动读取最新数据。

**Q: X/Twitter 自定义源无法访问？**
A: X.com 现在要求登录，需要配置有效的 Cookie。步骤：
1. 浏览器登录 X.com
2. F12 打开开发工具 → Network 标签
3. 刷新页面，查看任意请求的 Request Headers 中的 Cookie
4. 复制 Cookie 值到 `config.json` 的 `x.cookie`
5. Cookie 会定期失效，需要定期更新
6. 重启订阅进程以使配置生效

**Q: 内容分析用 MiniMax 还是 Kimi？**
A: 系统默认使用 MiniMax（必填）。如果配置了 `kimi.api_key`，则会优先使用 Kimi 进行内容分析。两者兼容 Anthropic API 格式，任选其一或都配置。

## 许可证

MIT License
