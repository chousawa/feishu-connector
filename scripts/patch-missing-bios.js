/**
 * 为缺失简介的 X builders 补充信息
 */
import axios from "axios";
import { getConfig } from "../src/feishu.js";

// 基于公开信息的 builder 简介
const BUILDER_BIOS = {
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
};

async function patchMissingBios() {
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
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/${cfg.subscription.config_table_id}/records`,
    {
      headers: { Authorization: `Bearer ${token}` },
      params: { page_size: 100 },
    }
  );

  const records = configResp.data.data.items;
  let updatedCount = 0;

  for (const record of records) {
    const fields = record.fields || {};
    const platform = fields["平台"] || "";
    const userUrl = fields["user_url"] || "";
    const currentBio = fields["简介"] || "";

    // 只处理 X 平台且简介是默认值的
    if (platform !== "X" || !currentBio.includes("X 内容订阅")) {
      continue;
    }

    const handle = userUrl.match(/x\.com\/([^\/]+)/)?.[1];
    if (!handle || !BUILDER_BIOS[handle]) {
      continue;
    }

    const newBio = BUILDER_BIOS[handle];

    try {
      const updateResp = await axios.put(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/${cfg.subscription.config_table_id}/records/${record.id}`,
        { fields: { "简介": newBio } },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (updateResp.data?.msg === "success") {
        console.log(`✅ @${handle}: ${newBio.substring(0, 40)}...`);
        updatedCount++;
      }
    } catch (error) {
      console.error(
        `❌ 更新失败: @${handle} - ${error.response?.data?.msg || error.message}`
      );
    }
  }

  console.log(`\n📊 补充完成:`);
  console.log(`   ✅ 已补充: ${updatedCount} 个`);
}

patchMissingBios().catch(error => {
  console.error("❌ 补充失败:", error.message);
  process.exit(1);
});
