/**
 * 飞书长连接事件监听服务
 * 使用飞书 SDK 的 WSClient 建立长连接接收群消息事件
 */
import { Client, WSClient, EventDispatcher, LoggerLevel } from "@larksuiteoapi/node-sdk";
import { getConfig, writeToBitable, createField, sendMessage } from "./feishu.js";
import { fetchLinks, getExistingUrls } from "./index.js";
import { fetchPageContent } from "./scraper.js";
import { analyzeContent } from "./analyzer.js";
import { parseMessageLinks, getPlatform } from "./linkParser.js";

console.log("🤖 飞书消息监听服务启动...\n");

let config;
try {
  config = getConfig();
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}

const feishuConfig = config.feishu;
const targetChatId = feishuConfig.chat_id;
const topics = config.topics || "AI,产品";
const triggerKeywords = ["收集", "抓取", "处理", "开始"];
const stopKeywords = ["停止", "退出", "结束"];

console.log(`📌 监听群: ${targetChatId}`);
console.log(`📌 关注方向: ${topics}`);
console.log(`📌 触发关键词: ${triggerKeywords.join(", ")}\n`);

// 初始化飞书客户端
const client = new Client({
  appId: feishuConfig.app_id,
  appSecret: feishuConfig.app_secret,
});

// 发送消息到群
async function sendReply(chatId, text) {
  try {
    await client.im.v1.message.create({
      params: {
        receive_id_type: "chat_id",
      },
      data: {
        receive_id: chatId,
        content: JSON.stringify({ text }),
        msg_type: "text",
      },
    });
    return true;
  } catch (error) {
    console.error("发送消息失败:", error.message);
    return false;
  }
}

// 使用 Playwright 获取微博内容
async function fetchWeiboWithPlaywright(url) {
  let browser;
  try {
    // 动态导入 playwright
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000); // 等待页面加载

    // 获取文章内容
    const content = await page.evaluate(() => {
      const article = document.querySelector('article');
      if (article) {
        return article.innerText;
      }
      // 备用方案
      const main = document.querySelector('main');
      if (main) {
        return main.innerText;
      }
      return '';
    });

    if (content && content.length > 50) {
      return content;
    }
    return null;
  } catch (error) {
    console.error(`   Playwright获取失败: ${error.message}`);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// 执行自动流程
async function runAutoProcess() {
  console.log("🚀 开始执行自动收集流程...\n");

  await sendReply(targetChatId, "🔄 开始收集链接...");

  try {
    await createField("方向", "text");

    // 优先使用队列中的链接
    let queueLinks = [...messageQueue];
    console.log(`   队列中有 ${queueLinks.length} 个链接`);

    // 同时从API获取最近消息作为补充
    console.log("   从API获取最近消息...");
    const apiLinks = await fetchLinks({ chatId: targetChatId });

    // 合并去重
    const allLinks = [...queueLinks];
    for (const link of apiLinks) {
      if (!allLinks.find(l => l.url === link.url)) {
        allLinks.push(link);
      }
    }

    console.log(`   合并后共 ${allLinks.length} 个链接\n`);
    let links = allLinks;

    if (links.length === 0) {
      await sendReply(targetChatId, "✅ 未发现新链接");
      return;
    }

    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;
    const titles = [];

    // 一次性获取已存在 URL，避免循环内重复调用 API
    const existingUrls = await getExistingUrls();

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      console.log(`   处理 [${i + 1}/${links.length}]: ${link.url}`);

      try {
        // 再次检查URL是否已存在（防止重复写入）
        if (existingUrls.has(link.url)) {
          console.log(`   ⏭️  跳过已存在: ${link.url}`);
          skipCount++;
          continue;
        }

        // 根据平台选择获取方式
        let content;
        if (link.platform === "微博") {
          console.log("   使用 Playwright 获取微博内容...");
          content = await fetchWeiboWithPlaywright(link.url);
        } else {
          content = await fetchPageContent(link.url);
        }

        // 检查是否成功获取到内容
        if (!content || content.includes("获取失败") || content.includes("解析失败") || content.length < 20) {
          console.log(`   ⏭️  跳过（无法获取内容）: ${link.url}`);
          skipCount++;
          continue;
        }

        let analysis;
        try {
          analysis = await analyzeContent(content, link.url, topics);
        } catch (e) {
          console.log(`   ⏭️  跳过（分析失败）: ${link.url}`);
          skipCount++;
          continue;
        }

        const record = {
          url: link.url,
          title: analysis.title,
          source: link.platform,
          topics: analysis.direction,
          summary: analysis.summary,
          priority: analysis.relevance,
          status: "未读",
        };

        await writeToBitable(record);
        existingUrls.add(link.url); // 防止同批次重复写入
        successCount++;
        titles.push(analysis.title);

        // 从队列中移除已处理的链接
        const idx = messageQueue.findIndex(l => l.url === link.url);
        if (idx !== -1) messageQueue.splice(idx, 1);

        console.log(`   ✅ 成功: ${analysis.title}`);

        await new Promise((resolve) => setTimeout(resolve, 1500));
      } catch (error) {
        failCount++;
        console.error(`   ❌ 失败: ${error.message}`);
      }
    }

    let resultText = `✅ 链接收集完成！\n\n📊 处理结果：`;
    if (successCount > 0) {
      resultText += `\n   ✅ 成功: ${successCount} 条`;
      if (titles.length > 0) {
        resultText += `\n\n📝 收录内容：`;
        titles.forEach((title, i) => {
          resultText += `\n   ${i + 1}. ${title}`;
        });
      }
    }
    if (failCount > 0) {
      resultText += `\n   ❌ 失败: ${failCount} 条`;
    }
    if (skipCount > 0) {
      resultText += `\n   ⏭️  跳过: ${skipCount} 条`;
    }

    await sendReply(targetChatId, resultText);
    console.log("\n📊 执行完成");

    // 清空已处理的链接
    messageQueue.length = 0;

  } catch (error) {
    console.error("自动流程出错:", error.message);
    await sendReply(targetChatId, `❌ 处理失败: ${error.message}`);
  }
}

// 解析消息文本
function extractMessageText(data) {
  try {
    const content = JSON.parse(data.message.content);
    return content.text || "";
  } catch {
    return "";
  }
}

// 处理状态追踪
let lastTriggerTime = 0;
let isProcessing = false;
let pendingTrigger = null; // 待处理的触发请求
const TRIGGER_COOLDOWN = 60000; // 60秒冷却时间，防止重复触发
const COLLECT_WINDOW = 3000; // 收集窗口：收到"收集"后等待3秒再处理
const STARTUP_WARMUP = 10000; // 启动预热期10秒，忽略消息

// 记录启动时间和已处理的消息ID
const startupTime = Date.now();
const processedMessages = new Set();

// 消息队列：从事件中提取的待处理链接
const messageQueue = [];

// 初始化飞书长连接客户端
const wsClient = new WSClient({
  appId: feishuConfig.app_id,
  appSecret: feishuConfig.app_secret,
  loggerLevel: LoggerLevel.info,
});

// 启动长连接监听
wsClient.start({
  eventDispatcher: new EventDispatcher({}).register({
    "im.message.receive_v1": async (data) => {
      console.log("\n📩 收到消息事件");

      // 启动预热期内忽略消息（防止长连接重连时重复处理）
      if (Date.now() - startupTime < STARTUP_WARMUP) {
        console.log("   ⏳ 预热期内，忽略消息");
        return;
      }

      const chatId = data.message?.chat_id;
      const messageId = data.message?.message_id;

      // 忽略已处理过的消息（防止重连后重复处理）
      if (messageId && processedMessages.has(messageId)) {
        console.log(`   ⏭️ 忽略重复消息: ${messageId}`);
        return;
      }

      if (chatId !== targetChatId) {
        console.log(`   忽略其他群: ${chatId}`);
        return;
      }

      // 记录已处理的消息
      if (messageId) {
        processedMessages.add(messageId);
        if (processedMessages.size > 1000) {
          processedMessages.clear();
        }
      }

      const text = extractMessageText(data);
      console.log(`   消息: ${text.slice(0, 50)}...`);

      // 提取消息中的链接并加入队列
      if (text && text.includes('http')) {
        const links = parseMessageLinks(text);
        for (const link of links) {
          // 去重
          if (!messageQueue.find(l => l.url === link.url)) {
            messageQueue.push({ url: link.url, platform: getPlatform(link.url) });
            console.log(`   📎 加入队列: ${link.url}`);
          }
        }
      }

      // 如果正在处理中，忽略触发
      if (isProcessing) {
        console.log("   ⏳ 正在处理中，跳过");
        return;
      }

      // 冷却时间内忽略触发
      const now = Date.now();
      if (now - lastTriggerTime < TRIGGER_COOLDOWN) {
        console.log("   ⏳ 冷却时间内，跳过");
        return;
      }

      // 检查是否停止
      if (stopKeywords.some(kw => text.includes(kw))) {
        console.log("👋 收到停止命令");
        await sendReply(targetChatId, "👋 监听服务已停止");
        process.exit(0);
      }

      // 检查是否触发
      const shouldTrigger = triggerKeywords.some(kw => text.includes(kw));
      if (shouldTrigger) {
        if (isProcessing) {
          console.log("   ⏳ 正在处理中，跳过");
          return;
        }

        const now2 = Date.now();
        if (now2 - lastTriggerTime < TRIGGER_COOLDOWN) {
          console.log("   ⏳ 冷却时间内，跳过");
          return;
        }

        console.log("🚀 触发自动收集!");
        lastTriggerTime = now2;
        isProcessing = true;
        try {
          await runAutoProcess();
        } finally {
          isProcessing = false;
        }
        return;
      }
    },
  }),
}).then(() => {
  console.log("🟢 长连接已建立，监听中...\n");
  console.log("💡 在群里发送'收集'来触发链接收集");
  console.log("💡 发送'停止'来退出监听\n");
}).catch((error) => {
  console.error("❌ 长连接建立失败:", error.message);
  process.exit(1);
});
