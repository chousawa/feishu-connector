# 飞书链接收集助手

将日常遇到的小红书、播客、微博、公众号等需要稍后阅读的帖子发到飞书，交给 AI 整理分析后存入飞书多维表格，后续按照时间、优先级、方向标签等批量阅读处理，帮助解决信息囤积癖。

## 功能特性

- 📡 实时监听飞书群消息，发链接即自动触发收集
- 🤖 AI 分析内容（标题、摘要、分类、优先级）
- 📊 自动写入飞书多维表格
- 🎬 小红书视频自动转录，字幕写入"视频/图片原文"列
- 🖼️ 小红书图文笔记图片自动 OCR，提取图中文字
- 💬 引用消息补充想法，自动追加到表格"我的想法"字段
- 🔄 支持手动发"收集"触发全量扫描
- ⚡ AI 限流自动重试，WS 断连自动重启
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

编辑 `config.json`，填入你的配置：

```json
{
  "feishu": {
    "app_id": "cli_xxxxx",
    "app_secret": "xxxxx",
    "chat_id": "oc_xxxxx"
  },
  "bitable": {
    "app_token": "xxxxx",
    "table_id": "xxxxx"
  },
  "dashscope": {
    "api_key": "sk-xxxxx"
  },
  "minimax": {
    "api_key": "your-api-key",
    "base_url": "https://api.minimaxi.com/anthropic",
    "model": "MiniMax-M2.5"
  }
}
```

**配置说明：**
- `feishu.app_id` / `app_secret` - 在[飞书开放平台](https://open.feishu.cn/)应用详情的"凭证与基础信息"获取
- `feishu.chat_id` - 飞书群设置底部的"会话ID"
- `bitable.app_token` / `table_id` - 多维表格 URL 中的参数（示例：`https://xxx.feishu.cn/bitable/appTokenxxxxx?table_id=tblxxxxx`）
- `dashscope.api_key` - 在[阿里云百炼](https://bailian.console.aliyun.com/)获取，用于小红书视频转录和图片 OCR，新用户有免费额度
- `minimax.api_key` - 在 [MiniMax 开放平台](https://platform.minimaxi.com/) 获取，用于 AI 内容分析

> **config.json 不随 git 推送**（在 .gitignore 中），更新后需手动同步到服务器：
> ```bash
> scp config.json user@your-server:/path/to/feishu-connector/config.json
> ```

### 5. 运行

```bash
# 开发模式（终端运行）
npm run listen

# 或手动触发一次收集
npm run trigger
```

## 使用方法

### 基本使用

1. 将机器人添加到飞书群
2. 在群里直接发送链接，机器人自动触发收集
3. 或发送"收集"关键词，触发扫描群内所有未处理链接

**触发关键词：** `收集`、`抓取`、`处理`、`开始`

**停止服务：** 发送"停止"

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

# 启动
pm2 start src/listener.js --name feishu-collector

# 设置开机自启
pm2 startup
pm2 save
```

**常用管理命令：**

```bash
pm2 list                                          # 查看状态
pm2 logs feishu-collector --lines 50 --nostream   # 查看日志
pm2 restart feishu-collector                      # 重启服务
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
│   ├── listener.js              # 飞书长连接监听，消息路由
│   ├── feishu.js                # 飞书 API 封装
│   ├── scraper.js               # 网页内容抓取（含小红书视频转录、图片 OCR）
│   ├── analyzer.js              # AI 内容分析
│   ├── linkParser.js            # 链接提取与平台识别
│   ├── index.js                 # 手动触发入口
│   ├── backfill-xhs.js          # 小红书历史记录回填工具
│   └── backfill-xhs-transcript.js  # 历史视频转录回填工具
├── config.example.json
├── package.json
└── README.md
```

## 常见问题

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

## 许可证

MIT License
