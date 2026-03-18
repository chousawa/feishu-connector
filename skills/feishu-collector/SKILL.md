---
name: feishu-collector
description: Use when 用户需要从飞书群收集链接并整理到多维表格 - 自动获取群消息、提取链接、获取内容、分析并写入飞书多维表格
metadata:
  author: 42ailab
  version: '1.0'
  title: 飞书信息收集助手
  description_zh: 从飞书群自动收集链接并整理到多维表格
---

# 飞书信息收集助手

## Overview

从飞书群自动读取链接，获取页面内容，使用 AI 分析后写入飞书多维表格。

## When to Use

- 用户说"帮我收集飞书群里的链接"或类似需求
- 需要把群里的文章链接自动整理到表格

## When NOT to Use

- 只需要读取群消息（用 --fetch 即可）
- 只需要处理已有内容文件（用 --process）

## Quick Reference

| 任务 | 操作 |
|-----|------|
| 完整流程 | 读取链接 → Playwright 获取内容 → 写入表格 |
| 只获取链接 | `node src/index.js --fetch` |
| 处理内容文件 | `node src/index.js --process -f <file> -t "<topics>"` |

## 项目结构

```
feishu-connector/
├── config.json          # 配置文件
├── src/
│   ├── feishu.js       # 飞书 API 封装
│   ├── linkParser.js    # 链接提取
│   ├── analyzer.js      # MiniMax 分析
│   └── index.js         # 主入口
└── content.json         # 内容临时文件
```

## 配置步骤（重要！）

### 1. 飞书应用配置

在 [飞书开发者后台](https://open.feishu.cn/) 创建应用：

1. 创建应用 → 获取 App ID 和 App Secret
2. 添加机器人能力
3. 开通权限：
   - `im:message` / `im:message:readonly` - 读取群消息
   - `im:chat` / `im:chat:readonly` - 群聊相关
   - `bitable:app` - 多维表格读写
4. **发布应用**

### 2. 应用可见范围（必须！）

在发布管理中设置：
- **谁可以安装此应用** → 设置为"全员"或"整个企业"

**关键**：应用必须对全员可见，机器人才能被添加到群

### 3. 机器人加群

在群里添加机器人（需要先发布应用）

### 4. 多维表格

1. 创建多维表格，获取 app_token 和 table_id
2. 创建字段：链接、标题、来源、内容概括、优先级、状态、添加日期
3. **关键**：在表格权限管理中添加应用为成员，授予编辑权限

## 配置文件格式

```json
{
  "feishu": {
    "app_id": "cli_xxx",
    "app_secret": "xxx",
    "chat_id": "oc_xxx"
  },
  "bitable": {
    "app_token": "xxx",
    "table_id": "tblxxx"
  },
  "minimax": {
    "api_key": "xxx",
    "base_url": "https://api.minimaxi.com/anthropic",
    "model": "MiniMax-M2.5"
  }
}
```

## 常见问题

### 1. 群里搜不到机器人

**原因**：应用可见范围未设置为全员

**解决**：在发布管理中设置"谁可以安装此应用"为"全员"

### 2. POST 创建记录返回 field validation failed

**原因**：权限不足或请求格式错误

**解决**：
- 在多维表格权限管理中添加应用为成员
- POST 请求不需要 `records` 包装，直接用 `fields`
- 链接字段需要对象格式：`{"text": "标题", "url": "链接"}`

### 2. 获取群消息失败 Bot/User can NOT be out of the chat

**原因**：机器人未加入群

**解决**：在群里添加机器人

### 3. 小红书内容获取需要登录

**方案**：
- 使用 MCP Playwright 访问已登录的浏览器
- 或配置小红书 MCP：`docker run -d --name xiaohongshu-mcp -p 18060:18060 xpzouying/xiaohongshu-mcp`

### 4. MCP Playwright 无法启动浏览器

**解决**：重新安装 `mcp__playwright__browser_install`

### 5. 公众号需要验证

**解决**：使用 MCP Playwright 访问（无需登录）

## 使用流程

1. **用户发链接到飞书群**
2. **运行脚本**：
   ```bash
   node src/index.js --fetch  # 获取链接
   ```
3. **自动处理**：
   - MCP Playwright 获取页面内容
   - MiniMax 分析提取关键信息
   - 写入飞书多维表格

## 内容文件格式

```json
[
  {
    "url": "https://...",
    "content": "页面内容..."
  }
]
```

## 关键代码片段

### 飞书 API 调用（重要！）

```javascript
// POST 写入记录（正确格式）
axios.post(url, { fields: {...} })

// 链接字段格式
{ "链接": { "text": "标题", "url": "https://..." } }
```

### 获取已存在记录去重

```javascript
// 获取多维表格记录
const records = await getBitableRecords();
const existingUrls = new Set(records.map(r => r.fields["链接"]?.url));
```

## 依赖

- Node.js
- @larksuiteoapi/node-sdk
- axios
- MCP Playwright（获取页面内容）
- MiniMax API（分析内容）

## Resources

- 飞书开发者后台：https://open.feishu.cn/
- 项目代码：src/index.js
