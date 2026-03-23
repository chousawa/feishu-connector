# feishu-connector 项目说明

## 服务器连接

```bash
ssh feishu   # 直接连接，已配置好
```

- IP: 8.145.44.81，用户名: admin，端口: **8022**
- 密钥: ~/.ssh/id_feishu
- **注意：不要修改 SSH 端口**，改了阿里云一键登录也会失效（曾经搞崩过一次）

## 服务管理

```bash
ssh feishu 'pm2 list'                                          # 查看状态
ssh feishu 'pm2 logs feishu-collector --lines 50 --nostream'   # 查看日志
ssh feishu 'pm2 restart feishu-collector'                      # 重启服务
```

- 项目路径: /home/admin/feishu-connector
- 进程名: feishu-collector（运行 src/listener.js）
- 在飞书群发"收集"触发采集流程

## 开发部署流程

```bash
# 1. 本地改代码、测试
# 2. 提交推送到 CNB
git add . && git commit -m "..." && git push origin master

# 3. 服务器拉取并重启
ssh feishu "cd /home/admin/feishu-connector && git pull && pm2 restart feishu-collector"
```

- 远程仓库: https://cnb.cool/sawa-2025/feishu-connector（同步镜像到 GitHub）
- 服务器已配置好 CNB 凭证，直接 `git pull` 即可

## 项目架构

| 文件 | 作用 |
|------|------|
| src/listener.js | 飞书长连接监听，收到"收集"触发流程 |
| src/analyzer.js | 调用 MiniMax AI 分析内容 |
| src/scraper.js | 抓取各平台网页内容 |
| src/feishu.js | 飞书 API 封装 |
| config.json | 配置文件（含 API keys） |

## MiniMax API
- 使用 Anthropic 兼容格式
- base_url: https://api.minimaxi.com/anthropic
- header 用 `x-api-key`（不是 Authorization Bearer）
- 必须传 `max_tokens`

## 已知问题
- 小红书短链接（xhslink.com）内容抓取成功率低
- 微博用 Playwright 抓取，依赖系统库（libatk 等，已用 yum 安装）
