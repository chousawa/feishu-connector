#!/bin/bash
# 飞书链接自动收集定时任务
# 每5分钟运行一次检查

cd "/Users/zhangshuang/个人知识库/B-MyCreate/5-App/feishu-connector"

echo "=== $(date) 触发链接收集 ==="
node src/index.js --trigger -t "AI,产品"

# 记录执行日志
echo "$(date): 执行完成" >> auto_collect.log
