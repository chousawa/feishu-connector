import { fetchPageContent } from './src/scraper.js';
import { getPlatform } from './src/linkParser.js';

const urls = [
  'https://mp.weixin.qq.com/s/0jwzDcvD7X17xoWgl0BS8g',
  'https://mp.weixin.qq.com/s/A5x6eurNorROWHW-iBHjZg',
  'https://mp.weixin.qq.com/s/btweyh9v84Jvb3HF_U7JCw',
  'https://weibo.com/1727858283/5288486435556244',
  'https://weibo.com/5078115336/5288585021883579'
];

for (const url of urls) {
  console.log(`\n=== ${getPlatform(url)}: ${url.slice(0,40)}... ===`);
  try {
    const r = await fetchPageContent(url);
    if (r) {
      const text = typeof r === 'string' ? r : r.text;
      console.log('内容长度:', text.length);
      console.log('前100字:', text.slice(0, 100));
    } else {
      console.log('返回 null');
    }
  } catch(e) {
    console.log('异常:', e.message);
  }
}