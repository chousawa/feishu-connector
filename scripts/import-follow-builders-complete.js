/**
 * 从 Follow Builders README 导入完整的 builder 列表
 * 包括: 25 个 X builders + 6 个 podcasts + 2 个 official blogs
 */
import axios from "axios";
import { getConfig } from "../src/feishu.js";

// README 中的完整 builder 列表
const BUILDERS_X = [
  "karpathy",
  "swyx",
  "joshwoodward",
  "kevinweil",
  "petergyang",
  "thenanyu",
  "realmadhuguru",
  "AmandaAskell",
  "_catwu",
  "trq212",
  "GoogleLabs",
  "amasad",
  "rauchg",
  "alexalbert__",
  "levie",
  "ryolu_",
  "garrytan",
  "mattturck",
  "zarazhangrui",
  "nikunj",
  "steipete",
  "danshipper",
  "adityaag",
  "sama",
  "claudeai",
];

const PODCASTS = [
  {
    name: "Latent Space",
    url: "https://www.youtube.com/@LatentSpacePod",
    platform: "Podcast",
  },
  {
    name: "Training Data",
    url: "https://www.youtube.com/playlist?list=PLOhHNjZItNnMm5tdW61JpnyxeYH5NDDx8",
    platform: "Podcast",
  },
  {
    name: "No Priors",
    url: "https://www.youtube.com/@NoPriorsPodcast",
    platform: "Podcast",
  },
  {
    name: "Unsupervised Learning",
    url: "https://www.youtube.com/@RedpointAI",
    platform: "Podcast",
  },
  {
    name: "The MAD Podcast with Matt Turck",
    url: "https://www.youtube.com/@DataDrivenNYC",
    platform: "Podcast",
  },
  {
    name: "AI & I by Every",
    url: "https://www.youtube.com/playlist?list=PLuMcoKK9mKgHtW_o9h5sGO2vXrffKHwJL",
    platform: "Podcast",
  },
];

const BLOGS = [
  {
    name: "Anthropic Engineering",
    url: "https://www.anthropic.com/engineering",
    platform: "Blog",
  },
  { name: "Claude Blog", url: "https://claude.com/blog", platform: "Blog" },
];

async function importCompleteSources() {
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
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/tbl2VYBUBIoO7A7O/records`,
    { headers: { Authorization: `Bearer ${token}` }, params: { page_size: 100 } }
  );

  const existingUrls = new Set();
  existingResp.data.data.items.forEach(item => {
    const url = item.fields?.["user_url"] || "";
    existingUrls.add(url);
  });

  console.log(`✅ 已有 ${existingUrls.size} 个配置\n`);

  // 批量添加 X builders
  console.log(`📝 开始导入 X builders (${BUILDERS_X.length} 个)...\n`);
  let xSuccess = 0;
  let xSkip = 0;

  for (const handle of BUILDERS_X) {
    const userUrl = `https://x.com/${handle}`;

    if (existingUrls.has(userUrl)) {
      xSkip++;
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
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/tbl2VYBUBIoO7A7O/records`,
        newRecord,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (postResp.data?.data?.record) {
        console.log(`✅ X: @${handle}`);
        xSuccess++;
      }
    } catch (error) {
      console.error(`❌ X: @${handle} - ${error.response?.data?.msg || error.message}`);
    }
  }

  console.log(`\n📊 X Builders: ✅ ${xSuccess} | ⏭️ ${xSkip}\n`);

  // 批量添加 Podcasts
  console.log(`📝 开始导入 Podcasts (${PODCASTS.length} 个)...\n`);
  let podSuccess = 0;
  let podSkip = 0;

  for (const podcast of PODCASTS) {
    if (existingUrls.has(podcast.url)) {
      podSkip++;
      continue;
    }

    try {
      const newRecord = {
        fields: {
          "平台": "Podcast",
          "user_url": podcast.url,
          "上次抓取时间戳": "0",
          "是否启用": "启用",
          "来自 Follow Builders": "是",
        },
      };

      const postResp = await axios.post(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/tbl2VYBUBIoO7A7O/records`,
        newRecord,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (postResp.data?.data?.record) {
        console.log(`✅ Podcast: ${podcast.name}`);
        podSuccess++;
      }
    } catch (error) {
      console.error(`❌ Podcast: ${podcast.name} - ${error.response?.data?.msg || error.message}`);
    }
  }

  console.log(`\n📊 Podcasts: ✅ ${podSuccess} | ⏭️ ${podSkip}\n`);

  // 批量添加 Blogs
  console.log(`📝 开始导入 Blogs (${BLOGS.length} 个)...\n`);
  let blogSuccess = 0;
  let blogSkip = 0;

  for (const blog of BLOGS) {
    if (existingUrls.has(blog.url)) {
      blogSkip++;
      continue;
    }

    try {
      const newRecord = {
        fields: {
          "平台": "Blog",
          "user_url": blog.url,
          "上次抓取时间戳": "0",
          "是否启用": "启用",
          "来自 Follow Builders": "是",
        },
      };

      const postResp = await axios.post(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/tbl2VYBUBIoO7A7O/records`,
        newRecord,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (postResp.data?.data?.record) {
        console.log(`✅ Blog: ${blog.name}`);
        blogSuccess++;
      }
    } catch (error) {
      console.error(`❌ Blog: ${blog.name} - ${error.response?.data?.msg || error.message}`);
    }
  }

  console.log(`\n📊 Blogs: ✅ ${blogSuccess} | ⏭️ ${blogSkip}\n`);

  // 总结
  const totalSuccess = xSuccess + podSuccess + blogSuccess;
  const totalSkip = xSkip + podSkip + blogSkip;
  console.log(`\n📊 导入完成:`);
  console.log(`   ✅ 新增: ${totalSuccess} 个`);
  console.log(`   ⏭️ 跳过: ${totalSkip} 个`);
  console.log(`   📈 总计: ${totalSuccess + totalSkip} 个`);
  console.log(`\n   X Builders: ${BUILDERS_X.length} 个`);
  console.log(`   Podcasts: ${PODCASTS.length} 个`);
  console.log(`   Blogs: ${BLOGS.length} 个`);
}

importCompleteSources().catch(error => {
  console.error("❌ 导入失败:", error.message);
  process.exit(1);
});
