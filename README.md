# 飞书链接收集助手

将日常遇到的小红书、播客、微博、公众号等需要稍后阅读的帖子发到飞书，交给AI 整理分析后存入飞书多维表格，后续按照时间、优先级、方向标签等批量阅读处理，帮助解决信息囤积癖。

## 功能特性

- 📡 实时监听飞书群消息，自动提取链接
- 🤖 AI 分析内容（标题、摘要、分类、优先级）
- 📊 自动写入飞书多维表格
- 🎬 小红书视频自动转录，写入"视频原文"列
- 🔄 支持手动触发收集
- ☁️ 支持服务器部署（PM2）

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/你的用户名/feishu-link-collector.git
cd feishu-link-collector
```

### 2. 安装依赖

```bash
npm install
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


> **注意**：同时多维表格中点击"为协作者配置精细化权限"，将机器人添加为"管理员"来获取多维表格创建、编辑权限。

#### 3.3 订阅事件

在应用的"事件与回调"中配置：
- 订阅方式：使用长连接接收事件
- 添加事件：`im.message.receive_v1`

#### 3.4 发布应用

1. 创建应用版本
2. **可见范围选择"所有员工"**（重要：否则无法将机器人添加到群聊）
3. 点击"申请发布"
4. 点击"发布应用"

发布后将应用添加到你的飞书群。

### 4. 创建配置文件

```bash
cp config.example.json config.json
```

编辑 `config.json`，填入你的配置，这里我使用的模型是minimax的coding plan，量大划算：

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
    "api_key": "your-minimax-api-key",
    "base_url": "https://api.minimaxi.com/anthropic",
    "model": "MiniMax-M2.5"
  }
}
```

**配置说明：**
- `feishu.app_id` / `app_secret` - 在[飞书开放平台](https://open.feishu.cn/)应用详情的凭证与基础信息获取
- `feishu.chat_id` - 群设置中的群 ID（在飞书群设置底部会话ID）
- `bitable.app_token` / `table_id` - 多维表格 URL 中的参数（示例：`https://xxx.feishu.cn/bitable/appTokenxxxxx?table_id=tblxxxxx`，`appTokenxxxxx` 是 app_token，`tblxxxxx` 是 table_id）
- `dashscope.api_key` - 在[阿里云百炼](https://bailian.console.aliyun.com/)获取，用于小红书视频转录（模型：paraformer-v2），新用户有 36000 秒免费额度
- `minimax.api_key` - 在 [MiniMax 开放平台](https://platform.minimaxi.com/) 获取

### 5. 运行

```bash
# 开发模式（终端运行）
npm run listen

# 或手动触发一次收集
npm run trigger
```

## 使用方法

1. 将机器人添加到飞书群
2. 在群里发送链接
3. 输入"收集"触发处理
4. 机器人会自动分析并写入表格

**支持的链接平台：**
- 小红书（图文笔记抓取文字；视频笔记自动转录字幕写入"视频原文"列）
- 微博
- 公众号（微信）
- 小宇宙

注意：下载后在本地使用，需要保持电脑打开且联网，借助AI运行监听的程序，才能触发；如果想不限时间地点使用，需要将程序部署到云服务器上

**本地快捷启动：** 在 Finder 中找到项目文件夹，双击 `启动飞书监听.command` 即可自动打开终端并启动服务。关闭终端窗口即停止服务。

**触发关键词：** `收集`、`抓取`、`处理`、`开始`

**停止服务：** 发送"停止"

## 小红书视频转录

视频笔记走以下链路自动处理：

1. **解析视频直链**：使用 [wanyi-watermark](https://github.com/Ryan7t/wanyi-watermark) 从分享链接解析出 mp4 直链，无需登录 cookie
2. **云端转录**：将直链传给阿里云百炼 paraformer-v2，约 17 秒完成（150 秒视频），转录结果写入表格"视频原文"列
3. **降级兜底**：转录失败时自动降级为抓取图文内容

**依赖安装（服务器/本地均需执行）：**

```bash
pip3 install wanyi-watermark
```

> Mac 本地运行注意：Node.js 调用的 python 版本需与 wanyi-watermark 安装的版本一致。代码中通过 `process.platform === "darwin"` 自动切换为 `python3.12`（Mac）或 `python3`（Linux）。如果本地 python 版本不同，需修改 `scraper.js` 中的 `python3.12`。

**config.json 更新后需手动同步到服务器**（config.json 在 .gitignore 中不会自动推送）：

```bash
# 在服务器上直接编辑
ssh feishu 'nano /home/admin/feishu-connector/config.json'
```

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
feishu-link-collector/
├── src/
│   ├── listener.js    # 飞书长连接监听
│   ├── index.js       # 主入口
│   ├── feishu.js     # 飞书 API 封装
│   ├── scraper.js    # 网页内容抓取
│   ├── analyzer.js   # AI 内容分析
│   └── linkParser.js # 链接解析
├── config.example.json
├── package.json
└── README.md
```

## 常见问题

**Q: 收不到群消息？**
A: 检查应用是否已发布，事件订阅是否配置正确。

**Q: 链接收集不全？**
A: 确保先发链接，再发"收集"命令。或者使用服务器部署保持长时间运行。

**Q: AI 分析失败？**
A: 检查 MiniMax API Key 是否有效。

**Q: 小红书视频原文为空？**
A: 检查以下几点：
1. 服务器上是否安装了 `wanyi-watermark`：`pip3 install wanyi-watermark`
2. 服务器 `config.json` 是否有 `dashscope.api_key`（config.json 不随 git 推送，需手动更新）
3. 查看日志：`pm2 logs feishu-collector --lines 30 --nostream`，看是否有 `⚠️ 视频转录失败` 的报错

## 许可证

MIT License
