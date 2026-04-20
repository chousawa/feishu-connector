import { chromium } from 'playwright';
import { getPlatform } from '/home/admin/feishu-connector/src/linkParser.js';
import { fetchPageContent } from '/home/admin/feishu-connector/src/scraper.js';

const testUrls = [
  'https://weibo.com/1727858283/5288486435556244',
  'https://weibo.com/5078115336/5288585021883579'
];

// Step 1: fetchPageContent (axios via scraper)
console.log('=== Step 1: fetchPageContent ===');
for (const url of testUrls) {
  console.log(`[${getPlatform(url)}] ${url}`);
  try {
    const r = await fetchPageContent(url);
    const desc = r ? (typeof r === 'string' ? r.length + '字' : JSON.stringify(r).length + '字对象') : 'null';
    console.log(`  结果: ${desc}`);
    if (r) console.log(`  前50字: ${(typeof r === 'string' ? r : r.text).slice(0, 50)}`);
  } catch(e) {
    console.log(`  异常: ${e.message}`);
  }
}

// Step 2: Playwright direct
console.log('\n=== Step 2: Playwright ===');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

for (const url of testUrls) {
  console.log(`\n${url}`);
  const mobileUrl = url.replace('weibo.com/', 'm.weibo.cn/detail/').replace(/\/(\d+)\/(\w+)/, '/$2');
  try {
    await page.goto(mobileUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    const result = await page.evaluate(() => {
      const textEl = document.querySelector('.weibo-text');
      return { text: textEl?.innerText?.trim() || document.body.innerText.slice(0, 100) };
    });
    console.log(`  Playwright: ${result.text.length}字, ${result.text.slice(0, 60)}`);
  } catch(e) {
    console.log(`  异常: ${e.message}`);
  }
}

await browser.close();