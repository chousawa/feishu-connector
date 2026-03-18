/**
 * 飞书信息收集助手 - 主入口
 * 从飞书群读取链接，分析内容后写入飞书多维表格
 *
 * 使用方式:
 * 1. 脚本获取链接列表: node src/index.js --fetch
 * 2. 手动获取内容后运行分析: node src/index.js --process
 * 3. 或直接运行完整流程（需要提供内容文件）: node src/index.js --topics "AI,产品"
 */
import { getGroupMessages, writeToBitable, getBitableRecords, getConfig, getChatList, createField, sendMessage, getLatestMessages } from "./feishu.js";
import { parseMessageLinks, getPlatform } from "./linkParser.js";
import { analyzeContent } from "./analyzer.js";
import { fetchPageContent } from "./scraper.js";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 解析命令行参数
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    mode: "full", // full, fetch, process, chats, auto
    topics: "",
    chatId: null,
    contentFile: null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--topics" || args[i] === "-t") {
      options.topics = args[i + 1] || "";
      i++;
    } else if (args[i] === "--chat-id" || args[i] === "-c") {
      options.chatId = args[i + 1] || null;
      i++;
    } else if (args[i] === "--content-file" || args[i] === "-f") {
      options.contentFile = args[i + 1] || null;
      i++;
    } else if (args[i] === "--fetch") {
      options.mode = "fetch";
    } else if (args[i] === "--process") {
      options.mode = "process";
    } else if (args[i] === "--chats") {
      options.mode = "chats";
    } else if (args[i] === "--auto" || args[i] === "-a") {
      options.mode = "auto";
    } else if (args[i] === "--listen" || args[i] === "-l") {
      options.mode = "listen";
    } else if (args[i] === "--trigger" || args[i] === "-r") {
      options.mode = "trigger";
    } else if (args[i] === "--help" || args[i] === "-h") {
      options.help = true;
    }
  }

  return options;
}

/**
 * 打印帮助信息
 */
function printHelp() {
  console.log(`
飞书信息收集助手

用法:
  node src/index.js [选项]

选项:
  --fetch              只获取链接列表，不处理
  --auto, -a          全自动模式（获取链接→抓取内容→分析→写入表格）
  --listen, -l        监听模式：监听群消息，收到"收集"触发后自动处理
  --chats              查看可访问的群列表
  --process            处理已有内容文件（需要 -f 指定文件）
  --topics, -t <方向>  设置关注方向，多个方向用逗号分隔
  --content-file, -f   指定内容文件（JSON格式）
  --chat-id, -c <ID>  指定飞书群 ID（可选，默认使用配置）
  --help, -h          显示帮助信息

示例:
  # 完整流程（需要提供内容文件）
  node src/index.js --topics "AI,产品" --content-file content.json

  # 只获取链接
  node src/index.js --fetch

  # 处理已有内容
  node src/index.js --process --content-file content.json --topics "AI,产品"

内容文件格式:
[
  {
    "url": "https://...",
    "content": "页面内容..."
  }
]
`);
}

/**
 * 获取已存在的URL列表（用于去重）
 */
async function getExistingUrls() {
  const records = await getBitableRecords();
  const urls = new Set();

  for (const record of records) {
    if (record.fields && record.fields["链接"]) {
      const link = record.fields["链接"];
      if (typeof link === "string") {
        urls.add(link);
      } else if (typeof link === "object") {
        // 飞书链接字段格式: { "link": "http://...", "text": "标题" }
        if (link.link) urls.add(link.link);
        if (link.text) urls.add(link.text);
        if (link.url) urls.add(link.url);
      }
    }
  }

  return urls;
}

/**
 * 检查URL是否已存在
 */
async function isUrlExists(url) {
  const existingUrls = await getExistingUrls();
  return existingUrls.has(url);
}

/**
 * 提取消息中的纯文本内容
 */
function extractMessageText(item) {
  if (item.body && item.body.content) {
    try {
      const content = JSON.parse(item.body.content);
      if (content.text) {
        return content.text;
      }
    } catch {
      return item.body.content;
    }
  }

  if (item.message && item.message.body) {
    try {
      const content = JSON.parse(item.message.body.content);
      if (content.text) {
        return content.text;
      }
    } catch {
      return item.message.body.content;
    }
  }

  return "";
}

/**
 * 获取链接列表
 */
async function fetchLinks(options) {
  console.log("📥 读取飞书群消息...");

  let config;
  try {
    config = getConfig();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    console.log("\n请复制 config.example.json 为 config.json 并填写配置");
    process.exit(1);
  }

  // 分页获取所有消息，收集所有新链接
  const existingUrls = await getExistingUrls();
  const allMessages = [];
  let pageToken = null;
  let hasNewUrlsInPage = true;
  let consecutiveEmptyPages = 0;

  do {
    const result = await getGroupMessages(options.chatId, 50, pageToken);
    const messages = result.items;

    if (messages.length === 0) break;

    // 检查这页是否有任何新链接
    hasNewUrlsInPage = false;
    for (const msg of messages) {
      const text = extractMessageText(msg);
      if (text) {
        const parsedLinks = parseMessageLinks(text);
        for (const link of parsedLinks) {
          if (!existingUrls.has(link.url)) {
            hasNewUrlsInPage = true;
            break;
          }
        }
      }
      if (hasNewUrlsInPage) break;
    }

    allMessages.push(...messages);
    console.log(`   获取到 ${allMessages.length} 条消息${hasNewUrlsInPage ? ' (发现新链接)' : ''}...`);

    // 如果这页没有新链接，连续3页都没有新链接就停止
    if (!hasNewUrlsInPage) {
      consecutiveEmptyPages++;
      if (consecutiveEmptyPages >= 3) {
        console.log(`   连续3页无新链接，停止获取`);
        break;
      }
    } else {
      consecutiveEmptyPages = 0;
    }

    pageToken = result.nextPageToken;
    if (!pageToken) break;

  } while (pageToken);

  console.log(`   共获取 ${allMessages.length} 条消息\n`);

  // 按时间倒序（最早在前，方便从旧到新处理）
  const messages = [...allMessages].reverse();

  console.log(`   已存在 ${existingUrls.size} 条记录\n`);

  const links = [];
  for (const msg of messages) {
    const text = extractMessageText(msg);
    if (text) {
      const parsedLinks = parseMessageLinks(text);
      for (const link of parsedLinks) {
        if (!existingUrls.has(link.url)) {
          links.push(link);
        }
      }
    }
  }

  return links;
}

/**
 * 处理内容文件并写入表格
 */
async function processContent(options) {
  if (!options.contentFile) {
    console.error("❌ 请指定内容文件 (-f 或 --content-file)");
    process.exit(1);
  }

  const contentPath = path.resolve(options.contentFile);
  if (!fs.existsSync(contentPath)) {
    console.error(`❌ 文件不存在: ${contentPath}`);
    process.exit(1);
  }

  let contents;
  try {
    const fileContent = fs.readFileSync(contentPath, "utf-8");
    contents = JSON.parse(fileContent);
  } catch (error) {
    console.error(`❌ 读取内容文件失败: ${error.message}`);
    process.exit(1);
  }

  if (!Array.isArray(contents)) {
    console.error("❌ 内容文件必须是 JSON 数组");
    process.exit(1);
  }

  console.log(`📝 开始处理 ${contents.length} 个链接...\n`);

  const topics = options.topics || "AI,产品";
  console.log(`📌 关注方向: ${topics}\n`);

  let successCount = 0;
  let failCount = 0;

  for (const item of contents) {
    try {
      console.log(`📝 处理: ${item.url}`);
      const platform = getPlatform(item.url);
      console.log(`   平台: ${platform}`);

      console.log("   🔍 分析内容...");
      const analysis = await analyzeContent(item.content || "", item.url, topics);

      const record = {
        url: item.url,
        title: analysis.title,
        source: platform,
        summary: analysis.summary,
        priority: analysis.relevance,
        status: "未读",
      };

      await writeToBitable(record);
      successCount++;

      console.log(`   ✅ 完成: ${analysis.title}\n`);

      await new Promise((resolve) => setTimeout(resolve, 1000));

    } catch (error) {
      console.error(`   ❌ 处理失败: ${error.message}\n`);
      failCount++;
    }
  }

  console.log("=".repeat(50));
  console.log(`📊 处理完成!`);
  console.log(`   ✅ 成功: ${successCount} 条`);
  if (failCount > 0) {
    console.log(`   ❌ 失败: ${failCount} 条`);
  }
  console.log("=".repeat(50));
}

/**
 * 触发模式：执行一次收集并把结果发到群里
 */
async function runTrigger(options) {
  console.log("🚀 飞书信息收集助手 - 触发模式\n");

  let config;
  try {
    config = getConfig();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }

  const chatId = options.chatId || config.feishu.chat_id;
  const topics = options.topics || "AI,产品";

  console.log(`📌 关注方向: ${topics}\n`);

  // 发送开始消息
  await sendMessage(chatId, "🔄 开始收集链接...");

  try {
    // 执行自动化流程
    const result = await executeAutoFlow(chatId, topics);

    // 发送结果
    let resultText = `✅ 链接收集完成！\n\n📊 处理结果：`;
    if (result.success > 0) {
      resultText += `\n   ✅ 成功: ${result.success} 条`;
      // 列出成功收集的标题
      if (result.titles && result.titles.length > 0) {
        resultText += `\n\n📝 收录内容：`;
        result.titles.forEach((title, i) => {
          resultText += `\n   ${i + 1}. ${title}`;
        });
      }
    }
    if (result.fail > 0) {
      resultText += `\n   ❌ 失败: ${result.fail} 条`;
    }
    if (result.skip > 0) {
      resultText += `\n   ⏭️  跳过: ${result.skip} 条`;
    }
    if (result.success === 0 && result.fail === 0 && result.skip === 0) {
      resultText += `\n   未发现新链接`;
    }

    console.log(resultText.replace(/\n/g, '\n   '));
    await sendMessage(chatId, resultText);

  } catch (error) {
    const errorText = `❌ 收集失败: ${error.message}`;
    console.error(errorText);
    await sendMessage(chatId, errorText);
  }
}

/**
 * 监听模式：持续监听群消息，收到触发关键词后执行自动化
 */
async function runListen(options) {
  console.log("👂 飞书信息收集助手 - 监听模式\n");

  let config;
  try {
    config = getConfig();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    console.log("\n请复制 config.example.json 为 config.json 并填写配置");
    process.exit(1);
  }

  const chatId = options.chatId || config.feishu.chat_id;
  const topics = options.topics || "AI,产品";
  const triggerKeywords = ["收集", "抓取", "处理链接", "开始"];
  const pollInterval = 3000; // 3秒轮询一次

  console.log(`📌 监听群: ${chatId}`);
  console.log(`📌 关注方向: ${topics}`);
  console.log(`📌 触发关键词: ${triggerKeywords.join(", ")}`);
  console.log(`⏰ 轮询间隔: ${pollInterval / 1000}秒`);
  console.log("\n💡 在群里发送以下命令触发收集：");
  console.log("   - '收集' 或 '抓取' → 执行全自动流程");
  console.log("   - '停止' → 退出监听模式");
  console.log("\n🟢 监听中...\n");

  let lastMessageTime = Date.now();
  let processedMessageIds = new Set();

  // 获取初始消息时间戳
  const initialMessages = await getLatestMessages(chatId, 1);
  if (initialMessages.length > 0) {
    lastMessageTime = parseInt(initialMessages[0].create_time) || Date.now();
  }

  while (true) {
    try {
      const messages = await getLatestMessages(chatId, 10);

      for (const msg of messages) {
        const msgTime = parseInt(msg.create_time);
        if (msgTime <= lastMessageTime) continue;
        if (processedMessageIds.has(msg.message_id)) continue;

        processedMessageIds.add(msg.message_id);
        if (processedMessageIds.size > 100) {
          processedMessageIds.clear();
        }

        // 提取消息文本
        let text = "";
        if (msg.body && msg.body.content) {
          try {
            const content = JSON.parse(msg.body.content);
            text = content.text || "";
          } catch {
            text = msg.body.content || "";
          }
        }

        // 忽略空消息和系统消息
        if (!text || text === "This message was recalled" || text.includes("started the group") || text.includes("invited")) {
          continue;
        }

        console.log(`\n📩 收到消息: ${text.slice(0, 80)}`);

        // 检查是否是停止命令
        if (text.includes("停止") || text.includes("退出") || text.includes("结束")) {
          console.log("👋 收到停止命令，退出监听模式");
          await sendMessage(chatId, "👋 监听模式已停止");
          process.exit(0);
        }

        // 检查是否触发关键词
        const shouldTrigger = triggerKeywords.some(kw => text.includes(kw));
        console.log(`   文本: "${text}"`);
        console.log(`   触发检查: ${shouldTrigger}`);
        if (!shouldTrigger) {
          continue;
        }

        console.log("🚀 触发自动化流程...");

        // 发送开始处理消息
        await sendMessage(chatId, "🔄 开始收集链接...");

        // 执行自动化流程
        const result = await executeAutoFlow(chatId, topics);

        // 发送结果
        const resultText = `✅ 链接收集完成！\n\n📊 处理结果：\n   ✅ 成功: ${result.success} 条\n   ❌ 失败: ${result.fail} 条\n   ⏭️  跳过: ${result.skip} 条`;

        console.log(resultText);
        await sendMessage(chatId, resultText);
      }

      // 更新最新消息时间
      if (messages.length > 0) {
        lastMessageTime = parseInt(messages[0].create_time) || lastMessageTime;
      }

    } catch (error) {
      console.error("监听出错:", error.message);
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}

/**
 * 执行自动流程（供监听模式调用）
 */
async function executeAutoFlow(chatId, topics) {
  // 确保表格有方向字段
  await createField("方向", "text");

  // 获取链接
  const links = await fetchLinks({ chatId });

  if (links.length === 0) {
    return { success: 0, fail: 0, skip: 0, titles: [] };
  }

  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;
  const titles = [];

  for (let i = 0; i < links.length; i++) {
    const link = links[i];

    try {
      // 再次检查URL是否已存在（防止重复写入）
      if (await isUrlExists(link.url)) {
        console.log(`   ⏭️  跳过已存在: ${link.url}`);
        skipCount++;
        continue;
      }

      // 抓取内容
      const content = await fetchPageContent(link.url);
      if (!content) {
        skipCount++;
        continue;
      }

      // 分析内容
      const analysis = await analyzeContent(content, link.url, topics);

      // 写入表格
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
      successCount++;
      titles.push(analysis.title);

      await new Promise(resolve => setTimeout(resolve, 1500));

    } catch (error) {
      failCount++;
    }
  }

  return { success: successCount, fail: failCount, skip: skipCount, titles };
}

/**
 * 完整流程
 */
async function runFull(options) {
  console.log("🚀 飞书信息收集助手启动...\n");

  let config;
  try {
    config = getConfig();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    console.log("\n请复制 config.example.json 为 config.json 并填写配置");
    process.exit(1);
  }

  const topics = options.topics || "AI,产品";
  console.log(`📌 关注方向: ${topics}\n`);

  // 1. 获取链接
  console.log("📋 步骤1: 获取链接...\n");
  const links = await fetchLinks(options);

  if (links.length === 0) {
    console.log("✅ 未发现新链接，所有链接已存在于表格中");
    return;
  }

  console.log(`🔗 发现 ${links.length} 个新链接\n`);
  console.log("链接列表:");
  links.forEach((link, i) => {
    console.log(`  ${i + 1}. [${link.platform}] ${link.url}`);
  });

  console.log("\n" + "=".repeat(50));
  console.log("⚠️  后续步骤:");
  console.log("1. 使用 MCP Playwright 或 Agent Reach 获取这些链接的内容");
  console.log("2. 将内容保存为 JSON 文件，格式如下:");
  console.log(`
[
  { "url": "链接1", "content": "内容1" },
  { "url": "链接2", "content": "内容2" }
]
`);
  console.log("3. 运行: node src/index.js --process -f <文件> -t \"AI,产品\"");
  console.log("=".repeat(50));
}

/**
 * 全自动模式：获取链接 → 抓取内容 → 分析 → 写入表格
 */
async function runAuto(options) {
  console.log("🤖 飞书信息收集助手 - 全自动模式\n");

  let config;
  try {
    config = getConfig();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    console.log("\n请复制 config.example.json 为 config.json 并填写配置");
    process.exit(1);
  }

  const topics = options.topics || "AI,产品";
  console.log(`📌 关注方向: ${topics}\n`);

  // 确保表格有"方向"字段
  console.log("📋 准备表格字段...");
  await createField("方向", "text");

  // 步骤1: 获取链接
  console.log("📋 步骤1: 获取飞书群链接...\n");
  const links = await fetchLinks(options);

  if (links.length === 0) {
    console.log("✅ 未发现新链接，任务结束");
    return;
  }

  console.log(`🔗 发现 ${links.length} 个新链接\n`);

  // 步骤2: 抓取内容并处理
  console.log("📋 步骤2: 自动抓取内容并分析...\n");
  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    console.log(`\n[${i + 1}/${links.length}] 处理: ${link.url}`);
    console.log(`   平台: ${link.platform}`);

    try {
      // 抓取网页内容
      console.log("   🌐 抓取网页内容...");
      const content = await fetchPageContent(link.url);

      if (!content) {
        console.log("   ⚠️ 无法获取内容，跳过");
        skipCount++;
        continue;
      }

      console.log(`   ✅ 内容获取成功 (${content.length} 字符)`);

      // 分析内容
      console.log("   🔍 分析内容...");
      const analysis = await analyzeContent(content, link.url, topics);

      console.log(`   📝 标题: ${analysis.title}`);
      console.log(`   📊 相关度: ${analysis.relevance}/5`);

      // 写入多维表格
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
      successCount++;
      console.log("   ✅ 已写入多维表格");

      // 避免请求过快
      await new Promise((resolve) => setTimeout(resolve, 1500));

    } catch (error) {
      console.error(`   ❌ 处理失败: ${error.message}`);
      failCount++;
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("📊 全自动流程执行完成!");
  console.log(`   ✅ 成功: ${successCount} 条`);
  if (skipCount > 0) {
    console.log(`   ⏭️  跳过: ${skipCount} 条`);
  }
  if (failCount > 0) {
    console.log(`   ❌ 失败: ${failCount} 条`);
  }
  console.log("=".repeat(50));
}

/**
 * 主函数
 */
async function main() {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    return;
  }

  if (options.mode === "fetch") {
    const links = await fetchLinks(options);
    if (links.length === 0) {
      console.log("✅ 未发现新链接");
    } else {
      console.log(`\n🔗 发现 ${links.length} 个新链接:\n`);
      links.forEach((link, i) => {
        console.log(`  ${i + 1}. [${link.platform}] ${link.url}`);
      });
    }
  } else if (options.mode === "chats") {
    console.log("📋 获取群列表...\n");
    const chats = await getChatList();
    console.log(`共 ${chats.length} 个群:\n`);
    chats.forEach((chat, i) => {
      console.log(`  ${i + 1}. ${chat.name || '未命名'}`);
      console.log(`     ID: ${chat.chat_id}\n`);
    });
  } else if (options.mode === "process") {
    await processContent(options);
  } else if (options.mode === "auto") {
    await runAuto(options);
  } else if (options.mode === "listen") {
    await runListen(options);
  } else if (options.mode === "trigger") {
    // 触发一次收集并发送结果到群里
    await runTrigger(options);
  } else {
    await runFull(options);
  }
}

main().catch((error) => {
  console.error("❌ 程序异常:", error);
  process.exit(1);
});

// 导出函数供其他模块使用
export { executeAutoFlow, fetchLinks, isUrlExists };
