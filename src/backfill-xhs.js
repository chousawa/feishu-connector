/**
 * 批量补全小红书记录的「帖子原文」和「视频原文」
 *
 * 用法: node src/backfill-xhs.js
 *
 * 逻辑:
 * 1. 从飞书多维表格获取所有记录
 * 2. 筛选来源=小红书 且 帖子原文 和 视频原文 均为空
 * 3. 按添加时间倒序，取最近 13 条
 * 4. 对每条记录调用 scraper 重新抓取内容
 * 5. 将 originalText / transcript 写回表格对应字段
 */

import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- 配置加载 ----------
function loadConfig() {
  const configPath = path.join(__dirname, "..", "config.json");
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

const config = loadConfig();

// ---------- 飞书 Token ----------
let _token = null;
let _tokenExpire = 0;

async function getToken() {
  const now = Date.now();
  if (_token && now < _tokenExpire) return _token;

  const res = await axios.post(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    { app_id: config.feishu.app_id, app_secret: config.feishu.app_secret },
    { headers: { "Content-Type": "application/json" } }
  );
  _token = res.data.tenant_access_token;
  _tokenExpire = now + (res.data.expire - 300) * 1000;
  return _token;
}

// ---------- 获取所有记录（完整分页）----------
async function getAllRecords() {
  const token = await getToken();
  const allRecords = [];
  let pageToken = null;

  do {
    const params = { page_size: 100 };
    if (pageToken) params.page_token = pageToken;

    const res = await axios.get(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.bitable.app_token}/tables/${config.bitable.table_id}/records`,
      { params, headers: { Authorization: `Bearer ${token}` } }
    );

    if (res.data?.data?.items) {
      allRecords.push(...res.data.data.items);
      pageToken = res.data.data.page_token || null;
    } else {
      break;
    }
  } while (pageToken);

  return allRecords;
}

// ---------- 更新单条记录的原文字段 ----------
async function updateRecord(recordId, fields) {
  const token = await getToken();

  const res = await axios.put(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.bitable.app_token}/tables/${config.bitable.table_id}/records/${recordId}`,
    { fields },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  return res.data?.msg === "success";
}

// ---------- 获取小红书内容（复用 scraper 逻辑）----------
import { fetchPageContent } from "./scraper.js";

// ---------- 解析链接字段 ----------
function extractUrl(linkField) {
  if (!linkField) return null;
  if (typeof linkField === "string") return linkField;
  if (typeof linkField === "object") {
    // 飞书 url 字段格式: { link: "...", text: "..." } 或 { text: "...", url: "..." }
    return linkField.link || linkField.url || linkField.text || null;
  }
  return null;
}

// ---------- 解析添加时间 ----------
function parseAddTime(timeField) {
  if (!timeField) return 0;
  // 可能是字符串 "2026-04-10 18:30" 或时间戳（ms）
  if (typeof timeField === "number") return timeField;
  const d = new Date(String(timeField).replace(" ", "T"));
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// ---------- 主流程 ----------
async function main() {
  console.log("📋 正在获取飞书多维表格记录...");
  const records = await getAllRecords();
  console.log(`   共获取 ${records.length} 条记录`);

  // 筛选：来源=小红书 且 帖子原文和视频原文都为空
  const needFill = records.filter((r) => {
    const fields = r.fields || {};
    const source = fields["来源"] || "";
    const originalText = fields["帖子原文"] || "";
    const transcript = fields["视频原文"] || "";
    const url = extractUrl(fields["链接"]);

    // 来源字段可能是字符串或选项对象
    const sourceStr = typeof source === "object" ? (source.text || JSON.stringify(source)) : String(source);
    const isXhs = sourceStr.includes("小红书");

    const hasOriginalText = typeof originalText === "string" ? originalText.trim().length > 0 : false;
    const hasTranscript = typeof transcript === "string" ? transcript.trim().length > 0 : false;

    return isXhs && !hasOriginalText && !hasTranscript && url;
  });

  console.log(`   小红书中帖子原文/视频原文均为空的记录: ${needFill.length} 条`);

  if (needFill.length === 0) {
    console.log("✅ 没有需要补全的记录，退出。");
    return;
  }

  // 按添加时间倒序排序，取最近 13 条
  needFill.sort((a, b) => {
    const ta = parseAddTime(a.fields?.["添加时间"]);
    const tb = parseAddTime(b.fields?.["添加时间"]);
    return tb - ta;
  });

  const targets = needFill.slice(0, 13);
  console.log(`\n🎯 即将补全最近 ${targets.length} 条记录:\n`);
  targets.forEach((r, i) => {
    const url = extractUrl(r.fields?.["链接"]);
    const title = r.fields?.["标题"] || "(无标题)";
    const addTime = r.fields?.["添加时间"] || "";
    console.log(`  ${i + 1}. [${addTime}] ${title}`);
    console.log(`     ${url}`);
  });
  console.log();

  // 逐条处理
  let successCount = 0;
  for (let i = 0; i < targets.length; i++) {
    const record = targets[i];
    const url = extractUrl(record.fields?.["链接"]);
    const title = record.fields?.["标题"] || "(无标题)";
    const recordId = record.id;

    console.log(`\n[${i + 1}/${targets.length}] 处理: ${title}`);
    console.log(`   链接: ${url}`);

    try {
      const result = await fetchPageContent(url);

      if (!result) {
        console.log("   ⚠️  抓取返回空，跳过");
        continue;
      }

      // result 可能是字符串或对象 { text, originalText, transcript }
      let originalText = "";
      let transcript = "";

      if (typeof result === "string") {
        originalText = result;
      } else if (typeof result === "object") {
        originalText = result.originalText || "";
        transcript = result.transcript || "";
      }

      // 只更新非空字段，避免覆盖原有数据
      const updateFields = {};
      if (originalText.trim().length > 0) updateFields["帖子原文"] = originalText.slice(0, 10000);
      if (transcript.trim().length > 0) updateFields["视频原文"] = transcript.slice(0, 10000);

      if (Object.keys(updateFields).length === 0) {
        console.log("   ⚠️  抓取结果中没有原文内容，跳过");
        continue;
      }

      const ok = await updateRecord(recordId, updateFields);
      if (ok) {
        console.log(`   ✅ 更新成功 | 帖子原文: ${originalText.length} 字 | 视频原文: ${transcript.length} 字`);
        successCount++;
      } else {
        console.log("   ❌ 更新失败");
      }
    } catch (err) {
      console.error(`   ❌ 处理出错: ${err.message}`);
    }

    // 间隔 2 秒，避免过快请求
    if (i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log(`\n🎉 批量补全完成: ${successCount}/${targets.length} 条成功`);
}

main().catch((err) => {
  console.error("脚本运行出错:", err);
  process.exit(1);
});
