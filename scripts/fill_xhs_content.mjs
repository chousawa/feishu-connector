/**
 * 批量补全小红书记录的帖子原文和视频原文
 * 找来源=小红书、帖子原文和视频原文都为空的记录，按添加时间排序取最近17条，逐条抓取并更新
 */
import axios from "axios";
import { execFile } from "child_process";
import { promisify } from "util";
import { getBitableRecords, getConfig } from "../src/feishu.js";

const execFileAsync = promisify(execFile);

// ========== 飞书 API ==========

async function getTenantAccessToken() {
  const cfg = getConfig();
  const res = await axios.post(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    { app_id: cfg.feishu.app_id, app_secret: cfg.feishu.app_secret },
    { headers: { "Content-Type": "application/json" } }
  );
  return res.data.tenant_access_token;
}

async function updateRecord(token, recordId, fields) {
  const cfg = getConfig();
  const res = await axios.put(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/${cfg.bitable.table_id}/records/${recordId}`,
    { fields },
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
  );
  return res.data?.msg === "success";
}

// ========== 小红书抓取 ==========

const PYTHON = "python3.12";

async function getXhsImageNote(url) {
  const script = `
from douyin_mcp_server.xiaohongshu_processor import XiaohongshuProcessor
import json, sys
p = XiaohongshuProcessor()
try:
    d = p.parse_image_note(sys.argv[1])
    print(json.dumps({"title": d["title"], "desc": d["desc"]}, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"error": str(e)}, ensure_ascii=False))
`;
  const { stdout } = await execFileAsync(PYTHON, ["-c", script, url], { timeout: 30000 });
  return JSON.parse(stdout.trim());
}

async function getXhsVideoUrl(url) {
  const { stdout } = await execFileAsync(
    PYTHON,
    ["-m", "douyin_mcp_server.xiaohongshu_processor", url],
    { timeout: 30000 }
  );
  const data = JSON.parse(stdout.trim());
  return { videoUrl: data.url, title: data.title };
}

async function transcribeWithDashscope(videoUrl) {
  const cfg = getConfig();
  const apiKey = cfg.dashscope?.api_key;
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

  // 轮询最多90秒
  for (let i = 0; i < 18; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes = await axios.get(
      `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10000 }
    );
    const status = pollRes.data?.output?.task_status;
    console.log(`     轮询 ${i + 1}/18 状态: ${status}`);
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

async function fetchXhsContent(url) {
  // 先尝试解析图文
  let originalText = "";
  let transcript = "";
  let isVideo = false;

  try {
    const html = (await axios.get(url, {
      timeout: 15000,
      maxRedirects: 10,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    })).data;

    // 判断是否视频
    isVideo = html.includes('"type":"video"') || /<video/i.test(html);

    // 尝试从 __INITIAL_STATE__ 解析内容
    const jsonMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/i);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[1]);
        const noteDetailMap = data?.note?.noteDetailMap;
        if (noteDetailMap) {
          const noteData = Object.values(noteDetailMap)[0];
          if (noteData?.note) {
            const note = noteData.note;
            isVideo = note.type === "video";
            const desc = note.desc || "";
            const title = note.title || "";
            originalText = (title + (desc ? "\n" + desc : "")).trim();
          }
        }
      } catch (e) { /* ignore */ }
    }

    // fallback: meta description
    if (!originalText) {
      const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
      if (descMatch) originalText = descMatch[1];
    }
  } catch (e) {
    console.log(`   ⚠️ HTTP 抓取失败: ${e.message}`);
  }

  // 用 Python 解析图文（可绕过反爬）
  if (!originalText || originalText.length < 10) {
    try {
      const noteData = await getXhsImageNote(url);
      if (!noteData.error && noteData.desc) {
        originalText = ((noteData.title || "") + "\n" + noteData.desc).trim();
        console.log(`   📝 Python 图文解析成功，长度: ${originalText.length}`);
      } else if (noteData.error) {
        console.log(`   ⚠️ Python 图文解析报错: ${noteData.error}`);
        // 若报错含 video 关键词，标记为视频
        if (/video/i.test(noteData.error)) isVideo = true;
      }
    } catch (e) {
      console.log(`   ⚠️ Python 图文解析异常: ${e.message}`);
    }
  }

  // 视频：转录
  if (isVideo) {
    try {
      console.log(`   🎬 视频笔记，开始获取直链...`);
      const { videoUrl } = await getXhsVideoUrl(url);
      console.log(`   📹 直链获取成功，提交转录...`);
      transcript = await transcribeWithDashscope(videoUrl);
      if (transcript?.length > 10) {
        console.log(`   ✅ 转录成功，长度: ${transcript.length}`);
      }
    } catch (e) {
      console.log(`   ⚠️ 视频转录失败: ${e.message}`);
    }
  }

  return { originalText, transcript };
}

// ========== 主流程 ==========

async function main() {
  console.log("📋 获取多维表格记录...");
  const records = await getBitableRecords();
  console.log(`总记录数: ${records.length}`);

  // 筛选：来源=小红书，帖子原文和视频原文都为空
  const targets = records.filter(r => {
    const f = r.fields || {};
    return (
      f["来源"] === "小红书" &&
      !f["帖子原文"] &&
      !f["视频原文"]
    );
  });

  // 按添加时间倒序，取最近17条
  targets.sort((a, b) => {
    const ta = a.fields["添加时间"] || "";
    const tb = b.fields["添加时间"] || "";
    return tb.localeCompare(ta);
  });
  const top17 = targets.slice(0, 17);

  console.log(`\n找到 ${targets.length} 条待补全，处理前 17 条\n`);

  const accessToken = await getTenantAccessToken();

  for (let i = 0; i < top17.length; i++) {
    const r = top17[i];
    const f = r.fields || {};
    const urlField = f["链接"];
    const url = typeof urlField === "object" ? urlField.link || urlField.url : urlField;
    const title = f["标题"] || "未知标题";

    console.log(`\n[${i + 1}/17] ${title}`);
    console.log(`   链接: ${url}`);

    if (!url) {
      console.log("   ⚠️ 链接为空，跳过");
      continue;
    }

    try {
      const { originalText, transcript } = await fetchXhsContent(url);

      if (!originalText && !transcript) {
        console.log("   ❌ 未获取到任何内容，跳过");
        continue;
      }

      // 构造更新字段（只更新有内容的字段）
      const updateFields = {};
      if (originalText) updateFields["帖子原文"] = originalText;
      if (transcript) updateFields["视频原文"] = transcript;

      const ok = await updateRecord(accessToken, r.record_id, updateFields);
      if (ok) {
        console.log(`   ✅ 更新成功 | 帖子原文: ${originalText.length} 字 | 视频原文: ${transcript.length} 字`);
      } else {
        console.log(`   ❌ 更新失败`);
      }
    } catch (e) {
      console.log(`   ❌ 处理异常: ${e.message}`);
    }

    // 每条之间稍作间隔，避免触发限流
    if (i < top17.length - 1) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  console.log("\n🎉 全部处理完毕");
}

main().catch(e => {
  console.error("脚本异常:", e.message);
  process.exit(1);
});
