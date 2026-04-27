/**
 * 订阅内容定时抓取服务
 * 每天 00:00 执行一次，从配置表读取订阅用户，抓取其最新内容并写入订阅内容表
 * 支持两种信源：
 * 1. 自定义 URL（手填）- 使用 Playwright 爬虫
 * 2. Follow Builders（内置）- 直接从 feed-x.json 读取
 */
import fs from "fs";
import {
  getConfig,
  getSubscriptions,
  updateLastFetchTime,
  writeToSubscriptionTable,
} from "./feishu.js";
import { fetchPageContent, fetchUserFeed } from "./scraper.js";
import { analyzeContent } from "./analyzer.js";

console.log("🤖 飞书订阅抓取服务启动...\n");

let config;
try {
  config = getConfig();
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}

const topics = config.topics || "AI,产品";

/**
 * 从 Follow Builders feed 读取指定账号的推文
 */
function getFBFeedTweets(handle, feedData, sinceTimestamp = 0) {
  if (!feedData || !feedData.x) return [];

  const builder = feedData.x.find(b => b.handle === handle);
  if (!builder || !builder.tweets) return [];

  return builder.tweets
    .filter(tweet => new Date(tweet.createdAt).getTime() > sinceTimestamp)
    .map(tweet => ({
      url: tweet.url,
      publishTime: new Date(tweet.createdAt).getTime(),
      text: tweet.text,
    }))
    .slice(0, 5); // 限制最多 5 条
}

/**
 * 加载 Follow Builders feed 数据
 */
function loadFollowBuildersFeed() {
  const fbPaths = [
    "/tmp/follow-builders/feed-x.json",
    "../follow-builders/feed-x.json",
    "./follow-builders/feed-x.json",
  ];

  for (const path of fbPaths) {
    if (fs.existsSync(path)) {
      try {
        const data = JSON.parse(fs.readFileSync(path, "utf-8"));
        console.log(`✅ 加载 Follow Builders feed: ${path}`);
        return data;
      } catch (e) {
        console.warn(`⚠️ 加载失败: ${path}`);
      }
    }
  }

  return null;
}

/**
 * 计算到下一个 00:00 的延迟毫秒数
 */
function getTimeUntilNextRun() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * 主流程：抓取所有订阅用户的最新内容
 */
async function runSubscriptionCycle() {
  console.log(`\n📅 开始订阅内容抓取循环 (${new Date().toISOString()})\n`);

  try {
    const subscriptions = await getSubscriptions();
    console.log(`📌 找到 ${subscriptions.length} 个启用的订阅配置\n`);

    if (subscriptions.length === 0) {
      console.log("⚠️ 没有启用的订阅配置，跳过本次运行\n");
      return;
    }

    // 加载 Follow Builders feed（仅一次）
    const fbFeed = loadFollowBuildersFeed();

    for (const subscription of subscriptions) {
      const recordId = subscription.id;
      const fields = subscription.fields || {};
      const platform = fields["平台"] || "";
      const userUrl = fields["user_url"] || "";
      const lastFetchTimestampStr = fields["上次抓取时间戳"] || "0";
      const isFromFB = fields["来自 Follow Builders"] === "是";

      if (!platform || !userUrl) {
        console.warn(`⚠️ 记录 ${recordId} 配置不完整，跳过`);
        continue;
      }

      console.log(`\n🔍 处理订阅: ${platform} - ${userUrl}${isFromFB ? " (Follow Builders)" : ""}`);

      try {
        let lastFetchTimestamp = parseInt(lastFetchTimestampStr) || 0;

        // 新增加的订阅（首次抓取）：只抓取近 24 小时的内容
        if (lastFetchTimestamp === 0) {
          const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
          lastFetchTimestamp = oneDayAgo;
          console.log(`   🆕 首次抓取，只获取最近 24 小时的内容`);
        }

        let posts = [];

        // 根据信源选择获取方式
        if (isFromFB && fbFeed) {
          console.log(`   📖 从 Follow Builders feed 读取...`);
          const handle = userUrl.match(/x\.com\/([^\/]+)/)?.[1];
          if (handle) {
            posts = getFBFeedTweets(handle, fbFeed, lastFetchTimestamp);
          }
        } else {
          // 抓取用户主页列表
          console.log(`   📡 爬取用户主页列表...`);
          posts = await fetchUserFeed(userUrl, lastFetchTimestamp);
        }

        if (posts.length === 0) {
          console.log(`   ℹ️ 没有新内容`);
          continue;
        }

        console.log(`   ✅ 找到 ${posts.length} 条新帖子\n`);

        // 对每条帖子进行抓取和分析
        let successCount = 0;
        for (const post of posts) {
          try {
            console.log(`   📄 处理: ${post.url}`);

            // 抓取内容
            const pageContent = await fetchPageContent(post.url);
            if (!pageContent) {
              console.log(`   ⚠️ 无法获取内容，跳过`);
              continue;
            }

            // fetchPageContent 返回 {text, originalText} 对象或纯字符串
            let contentText = "";
            let originalText = "";

            if (typeof pageContent === "object" && pageContent !== null) {
              contentText = pageContent.text || "";
              originalText = pageContent.originalText || "";
            } else if (typeof pageContent === "string") {
              contentText = pageContent;
            }

            if (!contentText) {
              console.log(`   ⚠️ 内容为空，跳过`);
              continue;
            }

            // 分析内容
            console.log(`   🤖 分析内容...`);
            const analysis = await analyzeContent(contentText, post.url, topics);

            // 组装记录
            const record = {
              url: post.url,
              title: analysis.title || "",
              author: analysis.author || "",
              source: platform,
              topics: analysis.direction || "",
              summary: analysis.summary || "",
              originalText: originalText,
              transcript: "",
              priority: analysis.relevance || 3,
              status: "未读",
            };

            // 写入订阅内容表
            await writeToSubscriptionTable(record);
            successCount++;
          } catch (postError) {
            console.error(`   ❌ 处理帖子失败: ${postError.message}`);
          }
        }

        // 更新上次抓取时间戳
        const newTimestamp = Date.now().toString();
        const updated = await updateLastFetchTime(recordId, newTimestamp);
        if (updated) {
          console.log(`   ✅ 已更新时间戳，成功写入 ${successCount} 条内容\n`);
        } else {
          console.log(`   ⚠️ 时间戳更新失败，但内容已写入\n`);
        }
      } catch (error) {
        console.error(`   ❌ 处理订阅失败: ${error.message}`);
      }
    }

    console.log(`\n✅ 订阅内容抓取循环完成 (${new Date().toISOString()})\n`);
  } catch (error) {
    console.error(`❌ 抓取循环出错: ${error.message}`);
  }
}

/**
 * 定时调度
 */
async function startScheduler() {
  // 解析命令行参数
  const args = process.argv.slice(2);
  const runNow = args.includes("--run-now");

  if (runNow) {
    console.log("⚡ --run-now 模式，立即执行一次\n");
    await runSubscriptionCycle();
    process.exit(0);
  }

  // 计算到下一个 00:00 的等待时间
  const delayMs = getTimeUntilNextRun();
  const delayHours = Math.floor(delayMs / 3600000);
  const delayMins = Math.floor((delayMs % 3600000) / 60000);

  console.log(`⏰ 下一次运行时间: 明天 00:00 (${delayHours}h ${delayMins}min)`);
  console.log(`📊 进程将保持运行，每天 00:00 自动执行\n`);

  // 首次运行前的等待
  setTimeout(async () => {
    await runSubscriptionCycle();

    // 后续每 24 小时运行一次
    setInterval(runSubscriptionCycle, 24 * 60 * 60 * 1000);
  }, delayMs);

  // 避免进程退出
  process.on("SIGINT", () => {
    console.log("\n👋 收到 SIGINT，优雅退出");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n👋 收到 SIGTERM，优雅退出");
    process.exit(0);
  });
}

startScheduler();
