#!/usr/bin/env node
/**
 * 本地 X 内容代理服务
 * 在你的电脑上运行，服务器通过 HTTP 调用获取 X 推文内容
 *
 * 使用方法:
 *   node local-x-proxy.js
 *
 * 然后在服务器的 config.json 中配置:
 * {
 *   "x": {
 *     "cookie": "...",
 *     "proxy_url": "http://你的电脑IP:3000"
 *   }
 * }
 */

import axios from 'axios';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { URL } from 'url';

const PORT = 3000;

// 读取 Cookie
let config = {};
try {
  config = JSON.parse(readFileSync('./config.json', 'utf-8'));
} catch (e) {
  console.error('❌ 无法读取 config.json:', e.message);
  process.exit(1);
}

const xCookie = config.x?.cookie;
if (!xCookie) {
  console.error('❌ config.json 中未找到 x.cookie 配置');
  process.exit(1);
}

/**
 * 获取 X 推文内容
 */
async function fetchXTweet(url) {
  try {
    const tweetIdMatch = url.match(/status\/(\d+)/);
    const userMatch = url.match(/(?:x\.com|twitter\.com)\/([^\/]+)/);

    if (!tweetIdMatch || !userMatch) {
      return { success: false, error: '无法解析 URL' };
    }

    const tweetId = tweetIdMatch[1];
    const username = userMatch[1];

    console.log(`   📥 获取推文: ${username}/${tweetId}`);

    const response = await axios.get(
      `https://x.com/${username}/status/${tweetId}`,
      {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Cookie': xCookie,
          'Referer': 'https://x.com/',
        }
      }
    );

    const html = response.data;
    const textMatch = html.match(/"text":"([^"]*(?:\\.[^"]*)*)"/);

    if (textMatch) {
      const text = JSON.parse(`"${textMatch[1]}"`);
      console.log(`   ✅ 获取成功`);
      return {
        success: true,
        text: `推文作者: ${username}\n\n内容:\n${text.slice(0, 8000)}`,
        originalText: text.slice(0, 8000),
      };
    }

    return { success: false, error: '无法提取推文文本' };
  } catch (error) {
    console.error(`   ❌ 获取失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  const url = parsedUrl.searchParams.get('url');

  if (pathname === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok' }));
  } else if (pathname === '/api/tweet') {
    if (!url) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: '缺少 url 参数' }));
      return;
    }

    const result = await fetchXTweet(url);
    res.writeHead(200);
    res.end(JSON.stringify(result));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: '未找到路由' }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 X 代理服务运行在 http://0.0.0.0:${PORT}`);
  console.log(`\n📍 服务器配置示例:`);
  console.log(`{
  "x": {
    "cookie": "...",
    "proxy_url": "http://你的电脑IP:${PORT}"
  }
}`);
  console.log(`\n📝 API 端点:`);
  console.log(`  GET /api/tweet?url=https://x.com/user/status/123`);
  console.log(`  GET /health`);
  console.log(`\n⏹️  按 Ctrl+C 停止`);
});
