#!/usr/bin/env node
/**
 * X (Twitter) Cookie 提取脚本
 * 使用 Playwright 自动登录 X 并提取 Cookie
 *
 * 使用方法:
 *   node extract-x-cookie.js <username> <password>
 *
 * 例如:
 *   node extract-x-cookie.js your_email@example.com your_password
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('❌ 缺少参数');
  console.error('使用方法: node extract-x-cookie.js <用户名或邮箱> <密码>');
  console.error('例如: node extract-x-cookie.js user@example.com password123');
  process.exit(1);
}

const [username, password] = args;

async function extractXCookie() {
  let browser;
  let context;
  let page;

  try {
    console.log('🚀 启动浏览器...');
    browser = await chromium.launch({
      headless: false, // 显示浏览器窗口，方便调试
      args: ['--disable-blink-features=AutomationControlled']
    });

    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    page = await context.newPage();

    console.log('📍 访问 X.com...');
    await page.goto('https://x.com', { waitUntil: 'networkidle' });

    // 等待登录按钮出现
    await page.waitForSelector('a[href="/login"]', { timeout: 10000 }).catch(() => {
      console.log('   ℹ️  未找到登录按钮，可能已登录或页面结构不同');
    });

    // 点击登录按钮
    const loginBtn = await page.$('a[href="/login"]');
    if (loginBtn) {
      console.log('🔑 点击登录按钮...');
      await loginBtn.click();
      await page.waitForNavigation({ waitUntil: 'networkidle' });
    }

    // 填写用户名或邮箱
    console.log('✍️  输入用户名/邮箱...');
    await page.waitForSelector('input[autocomplete="username"]', { timeout: 15000 });
    await page.fill('input[autocomplete="username"]', username);
    await page.press('input[autocomplete="username"]', 'Enter');

    // 等待密码输入框
    await page.waitForSelector('input[autocomplete="current-password"]', { timeout: 15000 });

    console.log('✍️  输入密码...');
    await page.fill('input[autocomplete="current-password"]', password);

    // 点击登录按钮
    console.log('🔐 点击登录...');
    await page.click('button:has-text("Log in")');

    // 等待登录完成（导航到首页）
    console.log('⏳ 等待登录完成...');
    try {
      await page.waitForURL('https://x.com/home', { timeout: 30000 });
    } catch (e) {
      console.log('   ⚠️  未能准确等待首页，可能需要人工干预');
      console.log('   ℹ️  如果看到验证码或其他提示，请手动完成');
      console.log('   按 Enter 键继续...');
      await new Promise(resolve => setTimeout(resolve, 5000)); // 等待 5 秒让用户处理
    }

    // 等待主页加载
    await page.waitForTimeout(3000);

    // 提取 Cookie
    console.log('🔍 提取 Cookie...');
    const cookies = await context.cookies();
    const cookieString = cookies
      .map(c => `${c.name}=${c.value}`)
      .join('; ');

    // 提取 ct0 (CSRF token)
    const ct0Cookie = cookies.find(c => c.name === 'ct0');
    const ct0 = ct0Cookie?.value || '';

    if (!cookieString || !ct0) {
      console.error('❌ 无法提取 Cookie 或 ct0');
      console.error('   Cookie:', cookieString ? '✓' : '✗');
      console.error('   ct0:', ct0 ? '✓' : '✗');
      process.exit(1);
    }

    console.log('\n✅ Cookie 提取成功！\n');

    // 显示配置信息
    console.log('📋 将以下内容添加到 config.json:\n');
    console.log('```json');
    console.log('"x": {');
    console.log(`  "cookie": "${cookieString}",`);
    console.log(`  "ct0": "${ct0}"`);
    console.log('}');
    console.log('```\n');

    // 尝试更新 config.json
    try {
      const configPath = join(import.meta.url.split('file://')[1].replace(/extract-x-cookie.js$/, ''), 'config.json');
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));

      config.x = {
        cookie: cookieString,
        ct0: ct0
      };

      writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('✅ 已自动更新 config.json\n');
    } catch (err) {
      console.log('ℹ️  未能自动更新 config.json');
      console.log('   错误:', err.message);
      console.log('   请手动编辑 config.json 并添加上述配置\n');
    }

    console.log('✨ 完成！浏览器在 10 秒后关闭...');
    await page.waitForTimeout(10000);

  } catch (error) {
    console.error('❌ 出错:', error.message);
    process.exit(1);
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

extractXCookie();
