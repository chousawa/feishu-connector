/**
 * 批量补全小红书记录的「视频原文」
 *
 * 规则:
 * - 来源 = 小红书
 * - 视频原文 为空 或 等于"（缺少视频原文）"
 * - 排除「（图片）」
 * - 排除已知失效链接
 * - 按添加时间倒序，全量处理（无上限）
 * - 只更新「视频原文」字段，不动其他字段
 */

import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

// ---------- 已知失效链接 ----------
const DEAD_LINKS = new Set([
  "http://xhslink.com/o/323rhEuAwBn",
  "http://xhslink.com/o/1K5fZTiUDYq",
]);

// ---------- 配置 ----------
function loadConfig() {
  const configPath = path.join(__dirname, "..", "config.json");
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}
const config = loadConfig();

// ---------- Token ----------
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

// ---------- 获取所有记录 ----------
async function getAllRecords() {
  const token = await getToken();
  const all = [];
  let pageToken = null;
  do {
    const params = { page_size: 100 };
    if (pageToken) params.page_token = pageToken;
    const res = await axios.get(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.bitable.app_token}/tables/${config.bitable.table_id}/records`,
      { params, headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.data?.data?.items) {
      all.push(...res.data.data.items);
      pageToken = res.data.data.page_token || null;
    } else break;
  } while (pageToken);
  return all;
}

// ---------- 更新记录 ----------
async function updateRecord(recordId, fields) {
  const token = await getToken();
  const res = await axios.put(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.bitable.app_token}/tables/${config.bitable.table_id}/records/${recordId}`,
    { fields },
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
  );
  return res.data?.msg === "success";
}

// ---------- 解析链接字段 ----------
function extractUrl(linkField) {
  if (!linkField) return null;
  if (typeof linkField === "string") return linkField.trim();
  if (typeof linkField === "object") {
    return (linkField.link || linkField.url || linkField.text || "").trim();
  }
  return null;
}

// ---------- 解析添加时间 ----------
function parseAddTime(t) {
  if (!t) return 0;
  if (typeof t === "number") return t;
  const d = new Date(String(t).replace(" ", "T"));
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// ---------- 获取视频直链 ----------
async function getXhsVideoUrl(url) {
  const python = process.platform === "darwin" ? "python3.12" : "python3";
  const { stdout } = await execFileAsync(
    python,
    ["-m", "douyin_mcp_server.xiaohongshu_processor", url],
    { timeout: 20000 }
  );
  const data = JSON.parse(stdout.trim());
  return { videoUrl: data.url, title: data.title };
}

// ---------- 阿里云百炼转录 ----------
async function transcribeWithDashscope(videoUrl) {
  const apiKey = config.dashscope?.api_key;
  if (!apiKey) throw new Error("dashscope api_key 未配置");

  const submitRes = await axios.post(
    "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription",
    {
      model: "paraformer-v2",
      input: { file_urls: [videoUrl] },
      parameters: { language_hints: ["zh"] },
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      timeout: 15000,
    }
  );

  const taskId = submitRes.data?.output?.task_id;
  if (!taskId) throw new Error("提交转录任务失败");

  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const pollRes = await axios.get(
      `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10000 }
    );
    const status = pollRes.data?.output?.task_status;
    if (status === "SUCCEEDED") {
      const transcriptionUrl = pollRes.data?.output?.results?.[0]?.transcription_url;
      if (!transcriptionUrl) throw new Error("未获取到转录结果URL");
      const resultRes = await axios.get(transcriptionUrl, { timeout: 10000 });
      return resultRes.data?.transcripts?.[0]?.text || "";
    }
    if (status === "FAILED") throw new Error("转录任务失败");
  }
  throw new Error("转录超时");
}

// ---------- 判断是否是视频笔记（通过 HTML） ----------
async function isVideoNote(url) {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    const html = res.data || "";

    // 从 window.__INITIAL_STATE__ 判断
    const jsonMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/i);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[1]);
        if (data.note?.noteDetailMap) {
          const noteData = Object.values(data.note.noteDetailMap)[0];
          if (noteData?.note?.type === "video") return { isVideo: true, html };
          if (noteData?.note?.type === "normal") return { isVideo: false, html };
        }
      } catch (_) {}
    }

    // fallback：检查 html 特征
    const isVideo =
      html.includes('"type":"video"') || /<video/i.test(html);
    return { isVideo, html };
  } catch (err) {
    throw err;
  }
}

// ---------- 主流程 ----------
async function main() {
  console.log("📋 正在获取飞书多维表格记录...");
  const records = await getAllRecords();
  console.log(`   共获取 ${records.length} 条记录`);

  const targets = records
    .filter((r) => {
      const src = r.fields?.["来源"];
      const s =
        typeof src === "object"
          ? src?.text || JSON.stringify(src)
          : String(src || "");
      if (!s.includes("小红书")) return false;

      const url = extractUrl(r.fields?.["链接"]);
      if (!url || DEAD_LINKS.has(url)) return false;

      const transcript = r.fields?.["视频原文"] || "";
      if (transcript === "（图片）") return false;

      return (
        !transcript ||
        transcript.trim() === "" ||
        transcript === "（缺少视频原文）"
      );
    })
    .sort(
      (a, b) =>
        parseAddTime(b.fields?.["添加时间"]) -
        parseAddTime(a.fields?.["添加时间"])
    );

  console.log(`\n🎯 共需补全视频原文: ${targets.length} 条\n`);
  targets.forEach((r, i) => {
    const url = extractUrl(r.fields?.["链接"]);
    const title = r.fields?.["标题"] || "(无标题)";
    const addTime = r.fields?.["添加时间"] || "";
    console.log(`  ${i + 1}. [${addTime}] ${title}`);
    console.log(`     ${url}`);
  });
  console.log();

  let success = 0, skipped = 0, failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const record = targets[i];
    const url = extractUrl(record.fields?.["链接"]);
    const title = record.fields?.["标题"] || "(无标题)";
    const recordId = record.id;

    console.log(`\n[${i + 1}/${targets.length}] ${title}`);
    console.log(`   链接: ${url}`);

    try {
      const { isVideo, html } = await isVideoNote(url);

      if (!isVideo) {
        console.log("   📝 图文笔记，标记为（图片），跳过转录");
        // 更新为（图片）标记，避免重复处理
        await updateRecord(recordId, { "视频原文": "（图片）" });
        skipped++;
        continue;
      }

      console.log("   🎬 视频笔记，开始获取直链...");
      const { videoUrl } = await getXhsVideoUrl(url);
      console.log("   📹 获取直链成功，提交转录任务...");
      const transcript = await transcribeWithDashscope(videoUrl);

      if (!transcript || transcript.length < 5) {
        console.log("   ⚠️  转录结果为空，标记为（缺少视频原文）");
        await updateRecord(recordId, { "视频原文": "（缺少视频原文）" });
        failed++;
        continue;
      }

      const ok = await updateRecord(recordId, {
        "视频原文": transcript.slice(0, 10000),
      });
      if (ok) {
        console.log(`   ✅ 转录成功，写入 ${transcript.length} 字`);
        success++;
      } else {
        console.log("   ❌ 写入失败");
        failed++;
      }
    } catch (err) {
      console.error(`   ❌ 出错: ${err.message}`);
      // 如果是视频直链获取失败，标记缺少
      if (
        err.message.includes("timeout") ||
        err.message.includes("转录") ||
        err.message.includes("直链")
      ) {
        try {
          await updateRecord(recordId, { "视频原文": "（缺少视频原文）" });
          console.log("   ↩️  已标记为（缺少视频原文）");
        } catch (_) {}
      }
      failed++;
    }

    // 间隔 2 秒
    if (i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log(
    `\n🎉 完成: ✅ 转录成功 ${success} | 📝 图文跳过 ${skipped} | ❌ 失败/缺少 ${failed} / 共 ${targets.length} 条`
  );
}

main().catch((err) => {
  console.error("脚本出错:", err);
  process.exit(1);
});
