import { chromium } from 'playwright';
import { getPlatform } from '/home/admin/feishu-connector/src/linkParser.js';
import { fetchPageContent } from '/home/admin/feishu-connector/src/scraper.js';

async function fetchWeiboWithPlaywright(url) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const mobileUrl = url.replace('weibo.com/', 'm.weibo.cn/detail/').replace(/\/(\d+)\/(\w+)/, '/$2');
    await page.goto(mobileUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    const result = await page.evaluate(() => {
      const textEl = document.querySelector('.weibo-text') ||
                     document.querySelector('[node-type="feed_content"]') ||
                     document.querySelector('article') ||
                     document.querySelector('main');
      const text = textEl?.innerText?.trim() ||
                   document.body.innerText.match(/微博正文[\s\S]*?(?=转发|评论|$)/)?.[0]?.trim() || '';
      return { text: text || document.body.innerText.slice(0, 100) };
    });
    return result.text && result.text.length > 10
      ? { text: result.text.slice(0, 8000), originalText: result.text.slice(0, 8000) }
      : null;
  } finally {
    await browser.close();
  }
}

const testUrls = [
  'https://weibo.com/1727858283/5288486435556244',
  'https://weibo.com/5078115336/5288585021883579'
];

console.log('=== 完整微博处理链路测试 ===\n');

for (const url of testUrls) {
  const platform = getPlatform(url);
  console.log(`\n${url}`);
  console.log(`platform: ${platform}`);

  let content;
  if (platform === "微博") {
    const r1 = await fetchPageContent(url);
    console.log(`fetchPageContent: ${r1 === null ? 'null' : '有值'}`);
    const r2 = await fetchWeiboWithPlaywright(url);
    console.log(`fetchWeiboWithPlaywright: ${r2 ? r2.text.length + '字' : 'null'}`);
    content = r2;
    if (content === null) {
      console.log('❌ 跳过');
      continue;
    }
  }

  let transcript = "", originalText = "";
  if (content && typeof content === "object") {
    transcript = content.transcript || "";
    originalText = content.originalText || "";
    content = content.text;
  }
  console.log(`content: ${content ? content.length + '字' : 'null'}`);
  if (!content || content.length < 20) {
    console.log('❌ 内容检查失败');
  } else {
    console.log('✅ 送入分析');
  }
}

console.log('\n=== 完成 ===');