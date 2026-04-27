/**
 * 从 Follow Builders feed-x.json 导入订阅配置
 * 使用方式: node scripts/import-follow-builders.js <path-to-feed-x.json>
 */
import fs from "fs";
import axios from "axios";
import { getConfig } from "../src/feishu.js";

async function importFollowBuilders(feedFilePath) {
  // 读取 feed 数据
  if (!fs.existsSync(feedFilePath)) {
    console.error(`❌ 文件不存在: ${feedFilePath}`);
    process.exit(1);
  }

  let feedData;
  try {
    feedData = JSON.parse(fs.readFileSync(feedFilePath, "utf-8"));
  } catch (e) {
    console.error(`❌ JSON 解析失败: ${e.message}`);
    process.exit(1);
  }

  if (!feedData.x || !Array.isArray(feedData.x)) {
    console.error("❌ feed-x.json 格式不正确，缺少 x 数组");
    process.exit(1);
  }

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

  // 获取已有的订阅配置（用于去重）
  console.log("📋 正在获取现有订阅配置...");
  const existingResp = await axios.get(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/${cfg.subscription.config_table_id}/records`,
    { headers: { Authorization: `Bearer ${token}` }, params: { page_size: 100 } }
  );

  const existingHandles = new Set();
  existingResp.data.data.items.forEach(item => {
    const user_url = item.fields?.["user_url"] || "";
    const match = user_url.match(/x\.com\/([^\/]+)/);
    if (match) existingHandles.add(match[1]);
  });

  console.log(`✅ 已有 ${existingHandles.size} 个账号配置\n`);

  // 批量添加新的 builder
  let successCount = 0;
  let skipCount = 0;

  console.log(`📝 开始导入 ${feedData.x.length} 个 builder...\n`);

  for (const builder of feedData.x) {
    const handle = builder.handle;
    const userUrl = `https://x.com/${handle}`;

    // 检查是否已存在
    if (existingHandles.has(handle)) {
      console.log(`⏭️ 跳过（已存在）: ${builder.name} (@${handle})`);
      skipCount++;
      continue;
    }

    try {
      const newRecord = {
        fields: {
          "平台": "X",
          "user_url": userUrl,
          "上次抓取时间戳": "0",
          "是否启用": "启用",
          "来自 Follow Builders": "是",
        },
      };

      const postResp = await axios.post(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/${cfg.subscription.config_table_id}/records`,
        newRecord,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (postResp.data?.data?.record) {
        console.log(`✅ 添加: ${builder.name} (@${handle})`);
        successCount++;
      }
    } catch (error) {
      console.error(
        `❌ 添加失败: ${builder.name} - ${error.response?.data?.msg || error.message}`
      );
    }
  }

  console.log(`\n📊 导入完成:`);
  console.log(`   ✅ 新增: ${successCount} 个`);
  console.log(`   ⏭️ 跳过: ${skipCount} 个`);
  console.log(`   📈 总计: ${successCount + skipCount} 个`);
}

// 获取命令行参数
const feedPath = process.argv[2] || "/tmp/follow-builders/feed-x.json";
importFollowBuilders(feedPath).catch(error => {
  console.error("❌ 导入失败:", error.message);
  process.exit(1);
});
