/**
 * 飞书长连接事件监听服务
 * 使用飞书 SDK 的 WSClient 建立长连接接收群消息事件
 */
import { Client, WSClient, EventDispatcher, LoggerLevel } from "@larksuiteoapi/node-sdk";
import { getConfig, writeToBitable, createField, sendMessage, findRecordByUrl, appendThought } from "./feishu.js";
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
const stopKeywords = ["停止", "退出", "结束"];

console.log(`📌 监听群: ${targetChatId}`);
console.log(`📌 关注方向: ${topics}`);
console.log(`📌 发链接自动收集，发"停止"退出\n`);

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
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const mobileUrl = url.replace('weibo.com/', 'm.weibo.cn/detail/').replace(/\/(\d+)\/(\w+)/, '/$2');
    console.log(`   Playwright访问: ${mobileUrl}`);
    await page.goto(mobileUrl, { waitUntil: 'networkidle', timeout: 30000 });
    // 等内容加载
    await page.waitForTimeout(3000);
    // 尝试多个选择器
    const result = await page.evaluate(() => {
      const textEl = document.querySelector('.weibo-text') ||
                     document.querySelector('[node-type="feed_content"]') ||
                     document.querySelector('article') ||
                     document.querySelector('main');
      const text = textEl?.innerText?.trim() ||
                   document.body.innerText.match(/微博正文[\s\S]*?(?=转发|评论|$)/)?.[0]?.trim() || '';
      return { text: text || document.body.innerText.slice(0, 100) };
    });
    console.log(`   Playwright抓到 ${result.text.length} 字`);
    if (result.text && result.text.length > 10) {
      return { text: result.text.slice(0, 8000), originalText: result.text.slice(0, 8000) };
    }
    return null;
  } catch (error) {
    console.error(`   Playwright微博获取失败: ${error.message}`);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// 处理引用消息：提取被引用消息里的链接，把当前消息文本作为想法追加到表格
async function handleQuoteMessage(data) {
  const parentId = data.message?.parent_id;
  const currentText = extractMessageText(data);

  if (!currentText || !currentText.trim()) {
    console.log("   引用消息无文字内容，跳过");
    await sendReply(targetChatId, "⚠️ 引用补充的消息没有文字内容，请输入你的想法");
    return;
  }

  // 获取被引用的父消息内容
  let parentContent = null;
  try {
    const resp = await client.im.v1.message.get({ path: { message_id: parentId } });
    parentContent = resp?.data?.items?.[0] ?? null;
  } catch (e) {
    console.error("   获取父消息失败:", e.message);
  }

  if (!parentContent) {
    console.log("   无法获取被引用消息，跳过");
    await sendReply(targetChatId, "⚠️ 无法获取被引用的消息，记录失败");
    return;
  }

  // 从父消息里提取链接
  let parentText = "";
  try {
    const body = JSON.parse(parentContent.body?.content || "{}");
    parentText = body.text || "";
  } catch {
    parentText = parentContent.body?.content || "";
  }

  const links = parseMessageLinks(parentText);
  if (links.length === 0) {
    console.log("   被引用消息不含链接，跳过");
    await sendReply(targetChatId, "⚠️ 被引用的消息不含链接，无法关联记录");
    return;
  }

  const thought = currentText.trim();
  let updatedCount = 0;

  for (const link of links) {
    const found = await findRecordByUrl(link.url);
    if (!found) {
      console.log(`   ⚠️  表格中未找到该链接，跳过: ${link.url}`);
      continue;
    }
    await appendThought(found.recordId, found.currentThoughts, thought);
    console.log(`   ✅ 已追加想法到: ${link.url}`);
    updatedCount++;
  }

  if (updatedCount > 0) {
    await sendReply(targetChatId, `✅ 想法已记录（更新 ${updatedCount} 条）`);
  } else {
    await sendReply(targetChatId, "⚠️ 被引用的链接尚未收集到表格，请先收集后再补充想法");
  }
}

// 执行自动流程
async function runAutoProcess() {
  console.log("🚀 开始执行自动收集流程...\n");

  await sendReply(targetChatId, "🔄 开始收集链接...");

  try {
    await createField("方向", "text");
    await createField("视频/图片原文", "text");
    await createField("帖子原文", "text");
    await createField("我的想法", "text");

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
          content = await fetchPageContent(link.url);
          content = await fetchWeiboWithPlaywright(link.url);
        } else {
          content = await fetchPageContent(link.url);
        }

        // 兼容返回对象（视频转录/小红书图文）和字符串
        let transcript = "";
        let originalText = "";
        if (content && typeof content === "object") {
          transcript = content.transcript || "";
          originalText = content.originalText || "";
          content = content.text;
        }

        // content 现在是字符串或 null。只检查 null 和长度，不检查内容文本
        if (!content || content.length < 20) {
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
          author: analysis.author,
          source: link.platform,
          topics: analysis.direction,
          summary: analysis.summary,
          transcript,
          originalText,
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
let isProcessing = false;
const STARTUP_WARMUP = 10000; // 启动预热期10秒，忽略消息

// 记录启动时间和已处理的消息ID
const startupTime = Date.now();
const processedMessages = new Set();

// WS 活跃时间 watchdog：SDK 重连成功会输出 'ws client ready'，拦截以重置计时
let lastWsActivity = Date.now();
const _origLog = console.log.bind(console);
console.log = (...args) => {
  const msg = args.join(' ');
  if (msg.includes('ws client ready') || msg.includes('ws_client_ready')) {
    lastWsActivity = Date.now();
  }
  _origLog(...args);
};

// 超过 30 分钟无任何 WS 活动则自动退出，由 PM2 重启
setInterval(() => {
  const idleMs = Date.now() - lastWsActivity;
  if (idleMs > 30 * 60 * 1000) {
    console.error(`❌ WS 连接已静默 ${Math.round(idleMs / 60000)} 分钟，触发自动重启`);
    process.exit(1);
  }
}, 5 * 60 * 1000);

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
      lastWsActivity = Date.now();
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

      // 引用消息：补充想法（有 parent_id 且不含触发关键词）
      const parentId = data.message?.parent_id;
      const isQuote = !!parentId;
      const isStop = stopKeywords.some(kw => text.includes(kw));

      if (isQuote && !isStop) {
        console.log(`   📝 识别为引用补充，父消息: ${parentId}`);
        await handleQuoteMessage(data);
        return;
      }

      // 检查是否停止
      if (isStop) {
        console.log("👋 收到停止命令");
        await sendReply(targetChatId, "👋 监听服务已停止");
        process.exit(0);
      }

      // 有链接就直接触发收集
      if (text && text.includes('http')) {
        const links = parseMessageLinks(text);
        if (links.length === 0) return;

        if (isProcessing) {
          console.log("   ⏳ 正在处理中，链接已忽略");
          return;
        }

        console.log(`   🔗 检测到 ${links.length} 个链接，触发收集`);
        // 把本条消息的链接放入队列
        for (const link of links) {
          if (!messageQueue.find(l => l.url === link.url)) {
            messageQueue.push({ url: link.url, platform: getPlatform(link.url) });
          }
        }

        isProcessing = true;
        try {
          await runAutoProcess();
        } finally {
          isProcessing = false;
        }
      }
    },
  }),
}).then(() => {
  lastWsActivity = Date.now();
  console.log("🟢 长连接已建立，监听中...\n");
  console.log("💡 在群里发送链接自动触发收集");
  console.log("💡 发送'停止'来退出监听\n");
}).catch((error) => {
  console.error("❌ 长连接建立失败:", error.message);
  process.exit(1);
});
