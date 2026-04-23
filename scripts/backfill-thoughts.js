/**
 * 一次性脚本：捞历史引用消息，把想法追加到飞书表格
 * 运行: node scripts/backfill-thoughts.js
 */
import axios from "axios";
import { getConfig, findRecordByUrl, appendThought } from "../src/feishu.js";
import { parseMessageLinks } from "../src/linkParser.js";

const cfg = getConfig();
const feishuCfg = cfg.feishu;

async function getTenantAccessToken() {
  const res = await axios.post(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    { app_id: feishuCfg.app_id, app_secret: feishuCfg.app_secret },
    { headers: { "Content-Type": "application/json" } }
  );
  return res.data.tenant_access_token;
}

async function getAllMessages(token, chatId) {
  const all = [];
  let pageToken = null;
  do {
    const params = { container_id_type: "chat", container_id: chatId, page_size: 50, sort: "ByCreateTimeDesc" };
    if (pageToken) params.page_token = pageToken;
    const res = await axios.get("https://open.feishu.cn/open-apis/im/v1/messages", {
      params,
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = res.data?.data;
    if (!data?.items?.length) break;
    all.push(...data.items);
    pageToken = data.page_token || null;
    console.log(`   已获取 ${all.length} 条消息...`);
  } while (pageToken);
  return all;
}

async function getMessage(token, messageId) {
  try {
    const res = await axios.get(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data?.data?.items?.[0] ?? null;
  } catch {
    return null;
  }
}

function extractText(item) {
  try {
    const body = JSON.parse(item.body?.content || "{}");
    return body.text || "";
  } catch {
    return item.body?.content || "";
  }
}

async function main() {
  console.log("🔍 开始捞历史引用消息...\n");
  const token = await getTenantAccessToken();
  const chatId = feishuCfg.chat_id;

  const messages = await getAllMessages(token, chatId);
  console.log(`\n📦 共获取 ${messages.length} 条消息，筛选引用消息...\n`);

  // 筛选出有 parent_id 的消息（引用消息）
  const quoteMessages = messages.filter(m => m.parent_id && m.msg_type === "text");
  console.log(`📝 发现 ${quoteMessages.length} 条引用消息\n`);

  if (quoteMessages.length === 0) {
    console.log("✅ 没有需要处理的历史引用消息");
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const msg of quoteMessages) {
    const thought = extractText(msg).trim();
    if (!thought) { skipped++; continue; }

    // 获取被引用的父消息
    const parent = await getMessage(token, msg.parent_id);
    if (!parent) {
      console.log(`   ⚠️  父消息获取失败: ${msg.parent_id}`);
      skipped++;
      continue;
    }

    const parentText = extractText(parent);
    const links = parseMessageLinks(parentText);
    if (links.length === 0) {
      console.log(`   ⏭️  父消息无链接，跳过。内容: ${parentText.slice(0, 40)}`);
      skipped++;
      continue;
    }

    for (const link of links) {
      const found = await findRecordByUrl(link.url);
      if (!found) {
        console.log(`   ⚠️  表格中未找到: ${link.url}`);
        skipped++;
        continue;
      }
      // 检查是否已经包含这条想法（防止重复追加）
      if (found.currentThoughts.includes(thought)) {
        console.log(`   ⏭️  已存在，跳过: ${thought.slice(0, 30)}`);
        skipped++;
        continue;
      }
      await appendThought(found.recordId, found.currentThoughts, thought);
      console.log(`   ✅ 追加想法 → ${link.url.slice(0, 60)}`);
      console.log(`      内容: ${thought.slice(0, 60)}`);
      updated++;
      // 避免频繁调用 API
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`\n📊 完成！更新: ${updated} 条，跳过: ${skipped} 条`);
}

main().catch(e => {
  console.error("❌ 出错:", e.message);
  process.exit(1);
});
