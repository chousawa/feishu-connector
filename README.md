# 飞书链接收集助手

从飞书群自动收集链接，AI 分析后存入飞书多维表格。

## 功能特性

- 📡 实时监听飞书群消息，自动提取链接
- 🤖 AI 分析内容（标题、摘要、分类、优先级）
- 📊 自动写入飞书多维表格
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
- `im:message:send_as_bot` - 发送消息
- `im:message:group:send_as_bot` - 在群组中发送消息
- `im:chat:readonly` - 获取群组信息
- `im:chat:member:readonly_only_getChatMember` - 获取群组成员

**多维表格相关：**
- `bitable:app:readonly` - 读取多维表格
- `bitable:table:readonly` - 读取表格
- `bitable:table:write` - 写入表格
- `bitable:field:readonly` - 读取字段

> **注意**：也可以在多维表格中点击"为协作者配置精细化权限"，将机器人添加为"管理员"来获取多维表格权限。

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
  "minimax": {
    "api_key": "your-minimax-api-key",
    "base_url": "https://api.minimaxi.com/anthropic",
    "model": "MiniMax-M2.5"
  }
}
```

**配置说明：**
- `feishu.app_id` / `app_secret` - 在飞书应用详情页获取
- `feishu.chat_id` - 群设置中的群 ID
- `bitable.app_token` / `table_id` - 多维表格 URL 中的参数
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

**触发关键词：** `收集`、`抓取`、`处理`、`开始`

**停止服务：** 发送"停止"

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

## 许可证

MIT License
