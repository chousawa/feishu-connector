/**
 * 从 Follow Builders 和其他来源为订阅配置填充简介
 */
import fs from "fs";
import axios from "axios";
import { getConfig } from "../src/feishu.js";

// Podcasts 和 Blogs 的简介
const DESCRIPTIONS = {
  "https://www.youtube.com/@LatentSpacePod":
    "AI 领域最具影响力的播客之一，深入讨论机器学习、创业和 AI 应用的最新趋势",
  "https://www.youtube.com/playlist?list=PLOhHNjZItNnMm5tdW61JpnyxeYH5NDDx8":
    "探讨数据科学、机器学习和 AI 技术发展的高质量播客",
  "https://www.youtube.com/@NoPriorsPodcast":
    "聚焦 AI、创业和深度学习的前沿话题，汇聚业界专家观点",
  "https://www.youtube.com/@RedpointAI":
    "无监督学习播客，专业解读 AI 和数据科学的最新进展",
  "https://www.youtube.com/@DataDrivenNYC":
    "Matt Turck 主持，讨论 AI、数据和创新的深度对话",
  "https://www.youtube.com/playlist?list=PLuMcoKK9mKgHtW_o9h5sGO2vXrffKHwJL":
    "Every 出品的播客，探讨 AI、产品和行业趋势的交叉话题",
  "https://www.anthropic.com/engineering":
    "Anthropic 官方技术博客，分享 AI 安全、模型训练等深度技术文章",
  "https://claude.com/blog": "Claude 官方博客，发布产品更新、功能公告和使用指南",
};

async function populateBios() {
  const cfg = getConfig();

  // 读取 Follow Builders feed
  let fbFeed = null;
  if (fs.existsSync("/tmp/follow-builders/feed-x.json")) {
    fbFeed = JSON.parse(
      fs.readFileSync("/tmp/follow-builders/feed-x.json", "utf-8")
    );
  }

  // 获取 token
  console.log("🔐 正在获取飞书 token...");
  const tokenResp = await axios.post(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      app_id: cfg.feishu.app_id,
      app_secret: cfg.feishu.app_secret,
    }
  );
  const token = tokenResp.data.tenant_access_token;

  // 获取所有订阅配置
  console.log("📋 正在获取订阅配置...");
  const configResp = await axios.get(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/tbl2VYBUBIoO7A7O/records`,
    {
      headers: { Authorization: `Bearer ${token}` },
      params: { page_size: 100 },
    }
  );

  const records = configResp.data.data.items;
  console.log(`✅ 获取到 ${records.length} 条配置\n`);

  let updatedCount = 0;
  let skipCount = 0;

  for (const record of records) {
    const fields = record.fields || {};
    const platform = fields["平台"] || "";
    const userUrl = fields["user_url"] || "";
    const currentBio = fields["简介"] || "";

    // 如果已有简介，跳过
    if (currentBio && currentBio.length > 0) {
      skipCount++;
      continue;
    }

    let bio = null;

    // X Builders: 从 Follow Builders feed 读取 bio
    if (platform === "X" && fbFeed) {
      const handle = userUrl.match(/x\.com\/([^\/]+)/)?.[1];
      if (handle) {
        const builder = fbFeed.x.find(b => b.handle === handle);
        if (builder && builder.bio) {
          bio = builder.bio.split("\n")[0]; // 只取第一行
        }
      }
    }

    // Podcasts 和 Blogs: 使用预定义的简介
    if (!bio && DESCRIPTIONS[userUrl]) {
      bio = DESCRIPTIONS[userUrl];
    }

    // 没有找到简介，使用默认值
    if (!bio) {
      bio = `${platform} 内容订阅`;
    }

    // 更新记录
    try {
      const updateResp = await axios.put(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/tbl2VYBUBIoO7A7O/records/${record.id}`,
        { fields: { "简介": bio } },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (updateResp.data?.msg === "success") {
        const name = fields["user_url"]
          ?.split("/")
          .pop()
          .substring(0, 20) || fields["平台"];
        console.log(`✅ ${name}: ${bio.substring(0, 40)}...`);
        updatedCount++;
      }
    } catch (error) {
      console.error(
        `❌ 更新失败: ${userUrl} - ${error.response?.data?.msg || error.message}`
      );
    }
  }

  console.log(`\n📊 更新完成:`);
  console.log(`   ✅ 已更新: ${updatedCount} 个`);
  console.log(`   ⏭️ 已跳过: ${skipCount} 个`);
}

populateBios().catch(error => {
  console.error("❌ 更新失败:", error.message);
  process.exit(1);
});
