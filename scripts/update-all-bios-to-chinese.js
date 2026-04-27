/**
 * 将所有简介更新为中文版本
 */
import fs from "fs";
import axios from "axios";
import { getConfig } from "../src/feishu.js";

// 完整的中文简介映射
const BUILDER_BIOS_CN = {
  swyx: "产品思想家和 AI 构建者，对 AI 应用和开发者工具充满热情。",
  kevinweil: "OpenAI 科学副总裁，Cisco 董事会成员。前 Instagram 和 Twitter 产品负责人。",
  petergyang:
    "面向忙碌人群的 AI 实战教程和采访内容创作者，拥有超 14 万订阅者。Roblox 产品经理。",
  thenanyu: "Linear 产品负责人，产品和 AI 领域的思想领袖。",
  rauchg: "Vercel CEO，专注于前端和 AI 驱动的开发工具。",
  levie: "Box CEO，企业内容管理和数据治理的倡导者。",
  garrytan: "Y Combinator 总裁兼 CEO，支持和投资下一代创新创业者。",
  nikunj: "FPV Ventures 合伙人，专注于种子轮融资和 AI 初创企业。",
  steipete:
    "多才多艺的工程师和产品思想家，从 Apple 回归后专注于开发者工具。",
  danshipper: "Every CEO，关注创新、AI 和商业趋势的高质量订阅刊物创始人。",
  adityaag:
    "South Park Commons 普通合伙人，AI 和硅谷初创企业的投资者和导师。",
  sama: "OpenAI CEO，推动 AI 安全和应用发展的领导者。",
  karpathy: "Tesla AI 总监，OpenAI 联合创始人。深度学习领域的顶级研究员和工程师。",
  joshwoodward: "企业家和 AI 产品构建者，致力于用 AI 构建创新产品。",
  realmadhuguru: "AI 工程师和研究员，专注于大模型应用的实践。",
  AmandaAskell: "Anthropic AI 安全研究员，从事可解释性和对齐研究。",
  _catwu: "AI 研究员和工程师，探索大语言模型的应用前景。",
  trq212: "AI 爱好者和产品构建者，聚焦实用 AI 应用。",
  GoogleLabs: "Google Labs 官方账号，展示最新的 AI 和机器学习创新。",
  amasad: "Replit CEO 和创始人，构建下一代开发工具和 AI 编程平台。",
  alexalbert__: "AI 创业者，专注于开发者工具和 AI 基础设施。",
  ryolu_: "领先 AI 公司的研究员和工程师。",
  mattturck: "Redpoint Ventures 普通合伙人，专注于 AI 和数据驱动的创业公司投资。",
  zarazhangrui: "AI 研究员和开源贡献者。",
  claudeai: "Claude AI 官方账号，分享产品更新、使用技巧和 AI 应用案例。",
};

const PODCAST_BIOS_CN = {
  "https://www.youtube.com/@LatentSpacePod":
    "AI 领域最具影响力的播客之一，深入讨论机器学习、创业和 AI 应用的最新趋势。",
  "https://www.youtube.com/playlist?list=PLOhHNjZItNnMm5tdW61JpnyxeYH5NDDx8":
    "探讨数据科学、机器学习和 AI 技术发展的高质量播客节目。",
  "https://www.youtube.com/@NoPriorsPodcast":
    "聚焦 AI、创业和深度学习前沿话题，汇聚业界专家精辟观点。",
  "https://www.youtube.com/@RedpointAI":
    "无监督学习播客，专业解读 AI 和数据科学的最新进展和趋势。",
  "https://www.youtube.com/@DataDrivenNYC":
    "Matt Turck 主持的播客，深度讨论 AI、数据和创新的交叉话题。",
  "https://www.youtube.com/playlist?list=PLuMcoKK9mKgHtW_o9h5sGO2vXrffKHwJL":
    "Every 出品的播客，探讨 AI、产品和行业趋势的深度对话。",
};

const BLOG_BIOS_CN = {
  "https://www.anthropic.com/engineering":
    "Anthropic 官方技术博客，分享 AI 安全、模型训练和前沿技术的深度文章。",
  "https://claude.com/blog":
    "Claude 官方博客，发布产品更新、功能公告、使用指南和最佳实践。",
};

async function updateAllBiosToChinese() {
  const cfg = getConfig();

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
  let updatedCount = 0;

  console.log(`\n📝 开始更新简介为中文...\n`);

  for (const record of records) {
    const fields = record.fields || {};
    const platform = fields["平台"] || "";
    const userUrl = fields["user_url"] || "";
    let newBio = null;

    // X Builders
    if (platform === "X") {
      const handle = userUrl.match(/x\.com\/([^\/]+)/)?.[1];
      if (handle && BUILDER_BIOS_CN[handle]) {
        newBio = BUILDER_BIOS_CN[handle];
      }
    }

    // Podcasts
    if (platform === "Podcast" && PODCAST_BIOS_CN[userUrl]) {
      newBio = PODCAST_BIOS_CN[userUrl];
    }

    // Blogs
    if (platform === "Blog" && BLOG_BIOS_CN[userUrl]) {
      newBio = BLOG_BIOS_CN[userUrl];
    }

    if (!newBio) {
      continue;
    }

    try {
      const updateResp = await axios.put(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/tbl2VYBUBIoO7A7O/records/${record.id}`,
        { fields: { "简介": newBio } },
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
        console.log(`✅ ${name}: ${newBio.substring(0, 40)}...`);
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
}

updateAllBiosToChinese().catch(error => {
  console.error("❌ 更新失败:", error.message);
  process.exit(1);
});
