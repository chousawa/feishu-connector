# X (Twitter) Cookie 配置指南

为了在服务器上自动获取 X 推文，需要配置你的 X 账户 Cookie。

## 步骤 1: 获取 Cookie

### 方法 A: 使用浏览器开发者工具（推荐）

1. 在浏览器中打开 **X.com**（需要已登录你的账户）
2. 按 **F12** 打开开发者工具，切换到 **Network** 标签页
3. 刷新页面，找到任何请求（如 `https://x.com/`）
4. 点击该请求，查看 **Request Headers**
5. 找到 **Cookie** 字段，完整复制其值（包括所有内容）
6. 也找到 **x-csrf-token** 字段，复制其值

### 方法 B: 使用浏览器控制台脚本

在 X.com 上打开浏览器控制台（F12 → Console），粘贴以下代码：

```javascript
// 复制 Cookie
const cookie = document.cookie;
console.log('Cookie:', cookie);
console.log(cookie); // 选中并复制

// 获取 CSRF Token（通常在 localStorage 中）
const ct0 = localStorage.getItem('ct0') || document.cookie.match(/ct0=([^;]+)/)?.[1];
console.log('x-csrf-token:', ct0);
```

执行后，复制输出的 Cookie 和 ct0 值。

## 步骤 2: 配置 config.json

编辑 `config.json`，在顶级添加 `x` 配置：

```json
{
  "feishu": { ... },
  "x": {
    "cookie": "你复制的 Cookie 完整值",
    "ct0": "你复制的 ct0 值"
  }
}
```

**重要**：
- Cookie 很敏感，不要分享给他人
- 不要提交包含真实 Cookie 的 config.json 到 Git
- 建议添加到 `.gitignore`：
  ```
  config.json
  ```

## 步骤 3: 测试

在项目目录运行：

```bash
node -e "
import('./src/scraper.js').then(m => {
  m.fetchPageContent('https://x.com/karpathy/status/2040470801506541998')
    .then(r => console.log(r?.text || '获取失败'))
    .catch(e => console.error('错误:', e.message));
});
"
```

如果成功会看到推文内容。

## 常见问题

**Q: Cookie 会过期吗？**
A: X 的 Cookie 通常有效期很长（几个月），但如果你退出登录或改密码，旧 Cookie 会失效。定期更新即可。

**Q: 可以多账户吗？**
A: 可以，用多个 Cookie 轮流使用避免被限流。

**Q: 会被检测到吗？**
A: 使用自己账户的 Cookie，X 不会检测这是"爬虫"。只要不超频请求就没问题。

## 重置 Cookie

如果 Cookie 失效或要撤销访问权限：
1. 在 X.com 上退出登录
2. 重新登录
3. 重新提取 Cookie
