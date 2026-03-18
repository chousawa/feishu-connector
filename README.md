# 飞书链接收集助手

从飞书群自动收集链接，AI 分析后存入飞书多维表格。

## 功能

- 监听飞书群消息，自动提取链接
- 触发关键词："收集"、"抓取"、"处理"、"开始"
- AI 分析内容并分类（方向、摘要、优先级）
- 自动写入飞书多维表格

## 配置

1. 复制配置模板：
```bash
cp config.example.json config.json
```

2. 填写 `config.json`：
- `feishu.app_id` - 飞书应用 ID
- `feishu.app_secret` - 飞书应用密钥
- `feishu.chat_id` - 目标群 ID
- `bitable.app_token` - 多维表格 App Token
- `bitable.table_id` - 多维表格 Table ID
- `minimax.api_key` - MiniMax API Key

## 运行

```bash
# 安装依赖
npm install

# 启动监听服务
npm run listen

# 或手动触发
npm run trigger
```

## 飞书配置

1. 创建飞书应用并开启"机器人"能力
2. 配置事件订阅：
   - 订阅方式：使用长连接接收事件
   - 事件：`im.message.receive_v1`
3. 添加机器人到目标群
4. 发布应用

## 部署到服务器

```bash
# 克隆项目
git clone https://cnb.cool/sawa-2025/feishu-connector.git

# 安装依赖
npm install

# 启动（使用 PM2）
pm2 start src/listener.js --name feishu-collector
pm2 save
```
