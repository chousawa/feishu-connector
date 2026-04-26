/**
 * 网页内容爬取模块
 * 自动获取链接的页面内容
 */
import axios from "axios";
import { execFile } from "child_process";
import { promisify } from "util";
import { getPlatform } from "./linkParser.js";

const execFileAsync = promisify(execFile);

/**
 * 获取网页内容
 * @param {string} url 页面URL
 * @returns {string} 页面内容
 */
export async function fetchPageContent(url) {
  const platform = getPlatform(url);

  try {
    // 根据不同平台使用不同的获取策略
    switch (platform) {
      case "公众号":
        return await fetchWechatArticle(url);
      case "小红书":
        return await fetchXiaohongshu(url);
      case "知乎":
        return await fetchZhihu(url);
      case "36氪":
        return await fetch36kr(url);
      case "微博":
        return await fetchWeibo(url);
      case "小宇宙":
        return await fetchXiaoyuzhou(url);
      case "X":
        return await fetchX(url);
      default:
        return await fetchGenericPage(url);
    }
  } catch (error) {
    console.error(`   ❌ 获取内容失败: ${error.message}`);
    return null;
  }
}

/**
 * 获取公众号文章内容（axios 直接请求）
 */
async function fetchWechatArticle(url) {
  const response = await axios.get(url, {
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Cookie": "wapsso=1; wapsso_cache=1",
    },
  });

  const html = response.data;

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "公众号文章";

  // 提取正文（id="js_content"）
  let content = "";
  const contentMatch = html.match(/id="js_content"[^>]*>([\s\S]*?)<\/div>/i);
  if (contentMatch) {
    content = cleanHtml(contentMatch[1]);
  }

  // 提取作者
  let author = "";
  const authorMatch = html.match(/var\s+nickname\s*=\s*"([^"]+)"/) ||
                      html.match(/"nick_name"\s*:\s*"([^"]+)"/) ||
                      html.match(/id="js_name"[^>]*>([^<]+)</);
  if (authorMatch) {
    author = authorMatch[1].trim();
  }

  return {
    text: `标题: ${title}\n\n作者: ${author}\n\n内容: ${content.slice(0, 8000)}`,
    originalText: content.slice(0, 8000),
  };
}

/**
 * 用 douyin_mcp_server 解析小红书视频直链
 */
async function getXhsVideoUrl(url) {
  const python = process.platform === "darwin" ? "python3.12" : "python3";
  const { stdout } = await execFileAsync(python, [
    "-m", "douyin_mcp_server.xiaohongshu_processor", url
  ], { timeout: 20000 });
  const data = JSON.parse(stdout.trim());
  return { videoUrl: data.url, title: data.title };
}

/**
 * 用 douyin_mcp_server 解析小红书图文笔记，获取正文和标题
 */
async function getXhsImageNote(url) {
  const python = process.platform === "darwin" ? "python3.12" : "python3";
  const script = `
from douyin_mcp_server.xiaohongshu_processor import XiaohongshuProcessor
import json, sys
p = XiaohongshuProcessor()
try:
    d = p.parse_image_note(sys.argv[1])
    print(json.dumps({"title": d["title"], "desc": d["desc"], "images": d.get("images", [])}, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"error": str(e)}, ensure_ascii=False))
`;
  const { stdout } = await execFileAsync(python, ["-c", script, url], { timeout: 20000 });
  return JSON.parse(stdout.trim());
}

/**
 * 用百炼 qwen-vl-ocr-latest 对图片做 OCR，提取文字
 */
async function ocrImagesWithDashscope(imageUrls) {
  const { getConfig } = await import("./feishu.js");
  const config = getConfig();
  const apiKey = config.dashscope?.api_key;
  if (!apiKey || !imageUrls?.length) return "";

  const results = [];
  for (const img of imageUrls.slice(0, 5)) {
    // 图片可能是字符串或对象（含 url_png/url_webp）
    const imgUrl = typeof img === "string" ? img : (img.url_png || img.url_webp || "");
    if (!imgUrl) continue;
    try {
      const res = await axios.post(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        {
          model: "qwen-vl-ocr-latest",
          messages: [{
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: imgUrl },
                min_pixels: 3072,
                max_pixels: 1024 * 1024,
              }
            ],
          }],
        },
        {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 30000,
        }
      );
      const text = res.data?.choices?.[0]?.message?.content || "";
      if (text.trim()) results.push(text.trim());
    } catch (e) {
      console.warn(`   ⚠️ OCR 第 ${results.length + 1} 张图片失败: ${e.message}`);
    }
  }
  return results.join("\n\n");
}

/**
 * 用阿里云百炼 paraformer-v2 转录视频字幕
 */
async function transcribeWithDashscope(videoUrl) {
  const { getConfig } = await import("./feishu.js");
  const config = getConfig();
  const apiKey = config.dashscope?.api_key;
  if (!apiKey) throw new Error("dashscope api_key 未配置");

  // 提交异步转录任务
  const submitRes = await axios.post(
    "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription",
    {
      model: "paraformer-v2",
      input: { file_urls: [videoUrl] },
      parameters: { language_hints: ["zh"] },
    },
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      timeout: 15000,
    }
  );

  const taskId = submitRes.data?.output?.task_id;
  if (!taskId) throw new Error("提交转录任务失败");

  // 轮询任务状态，最多等60秒
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes = await axios.get(
      `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
      { headers: { "Authorization": `Bearer ${apiKey}` }, timeout: 10000 }
    );
    const status = pollRes.data?.output?.task_status;
    if (status === "SUCCEEDED") {
      const transcriptionUrl = pollRes.data?.output?.results?.[0]?.transcription_url;
      if (!transcriptionUrl) throw new Error("未获取到转录结果URL");
      const resultRes = await axios.get(transcriptionUrl, { timeout: 10000 });
      const text = resultRes.data?.transcripts?.[0]?.text || "";
      return text;
    }
    if (status === "FAILED") throw new Error("转录任务失败");
  }
  throw new Error("转录超时");
}

/**
 * 获取小红书内容（视频走转录，图文走抓取）
 */
async function fetchXiaohongshu(url) {
  const response = await axios.get(url, {
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  const html = response.data;

  // 提取标题
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "小红书笔记";

  let content = "";
  let author = "";

  // 解析页面数据
  const jsonMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/i);
  let noteType = "normal";
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]);
      if (data.note && data.note.noteDetailMap) {
        const noteData = Object.values(data.note.noteDetailMap)[0];
        if (noteData && noteData.note) {
          noteType = noteData.note.type || "normal";
          content = noteData.note.title + "\n" + (noteData.note.desc || "");
          author = noteData.note.user?.nickname || noteData.note.user?.nickName || noteData.note.user?.name || "";
        }
      }
      if (!author && data.user && data.user.nickname) {
        author = data.user.nickname;
      }
    } catch (e) {
      // 忽略解析错误
    }
  }

  if (!author) {
    const nicknameMatch = html.match(/"nickname"\s*:\s*"([^"]+)"/);
    if (nicknameMatch) author = nicknameMatch[1];
  }

  // 图文笔记或 HTML 解析失败：尝试 meta description，再尝试 Python 解析
  if (!content || content.length < 10) {
    const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
    content = descMatch ? descMatch[1] : "";
  }

  // 用 Python 解析图文笔记，同时拿到图片 URL 列表（只调用一次）
  let xhsImages = [];
  if (!content || content.length < 10) {
    try {
      const noteData = await getXhsImageNote(url);
      if (!noteData.error && noteData.desc) {
        content = (noteData.title ? noteData.title + "\n" : "") + noteData.desc;
        console.log("   📝 Python 解析图文成功，内容长度:", content.length);
      }
      if (noteData.images?.length) xhsImages = noteData.images;
    } catch (e) {
      console.error(`   ⚠️ Python 图文解析失败: ${e.message}`);
    }
  } else {
    // 内容已有，但仍需要拿图片列表
    try {
      const noteData = await getXhsImageNote(url);
      if (!noteData.error && noteData.images?.length) xhsImages = noteData.images;
    } catch (e) {
      // 拿不到图片列表不影响主流程
    }
  }

  // 视频笔记：用百炼转录获取字幕
  const isVideo = noteType === "video" || html.includes('"type":"video"') || /<video/i.test(html);
  if (isVideo) {
    try {
      console.log("   🎬 检测到视频笔记，开始转录...");
      const { videoUrl } = await getXhsVideoUrl(url);
      console.log("   📹 获取视频直链成功，提交转录任务...");
      const transcript = await transcribeWithDashscope(videoUrl);
      if (transcript && transcript.length > 10) {
        console.log("   ✅ 转录成功");
        return {
          text: `标题: ${title}\n\n作者: ${author}\n\n视频字幕:\n${transcript.slice(0, 8000)}`,
          transcript,
          originalText: content.slice(0, 8000),
        };
      }
    } catch (e) {
      console.error(`   ⚠️ 视频转录失败: ${e.message}`);
    }
    return {
      text: `标题: ${title}\n\n作者: ${author}\n\n内容: ${content.slice(0, 8000)}`,
      transcript: "（缺少视频原文）",
      originalText: content.slice(0, 8000),
    };
  }

  // 图文笔记：对图片做 OCR
  let imageText = "";
  if (xhsImages.length > 0) {
    console.log(`   🖼️ 检测到 ${xhsImages.length} 张图片，开始 OCR...`);
    try {
      imageText = await ocrImagesWithDashscope(xhsImages);
      if (imageText) console.log(`   ✅ OCR 完成，提取 ${imageText.length} 字`);
    } catch (e) {
      console.warn(`   ⚠️ 图片 OCR 失败: ${e.message}`);
    }
  }

  const fullContent = imageText ? `${content}\n\n【图片文字】\n${imageText}` : content;

  return {
    text: `标题: ${title}\n\n作者: ${author}\n\n内容: ${fullContent.slice(0, 8000)}`,
    transcript: imageText ? `【图片OCR】\n${imageText.slice(0, 3000)}` : "（图片）",
    originalText: content.slice(0, 8000),
  };
}

/**
 * 获取知乎内容
 */
async function fetchZhihu(url) {
  const response = await axios.get(url, {
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  const html = response.data;

  // 提取标题
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "知乎文章";

  // 知乎文章内容在 JSON 中
  const jsonMatch = html.match(/<script[^>]*id="js-initialData"[^>]*>([\s\S]*?)<\/script>/i);
  let content = "";

  let author = "";
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]);
      // 提取答案内容和作者
      if (data.initialState && data.initialState.entities) {
        const answers = data.initialState.entities.answers;
        const users = data.initialState.entities.users;
        if (answers) {
          const firstAnswer = Object.values(answers)[0];
          if (firstAnswer && firstAnswer.content) {
            content = cleanHtml(firstAnswer.content);
          }
          if (firstAnswer && firstAnswer.author && users) {
            const authorId = firstAnswer.author.id || firstAnswer.author.urlToken;
            const userInfo = users[authorId];
            author = userInfo?.name || "";
          }
        }
        // 知乎文章（专栏）
        if (!author) {
          const articles = data.initialState.entities.articles;
          if (articles) {
            const firstArticle = Object.values(articles)[0];
            if (firstArticle && firstArticle.author && users) {
              const authorId = firstArticle.author.id || firstArticle.author.urlToken;
              const userInfo = users[authorId];
              author = userInfo?.name || "";
            }
          }
        }
      }
    } catch (e) {
      // 忽略
    }
  }

  return `标题: ${title}\n\n作者: ${author}\n\n内容: ${content.slice(0, 8000)}`;
}

/**
 * 获取微博内容（使用移动端API）
 */
async function fetchWeibo(url) {
  try {
    // 从URL提取微博ID
    const match = url.match(/weibo\.com\/\d+\/([a-zA-Z0-9]+)/);
    if (!match) {
      return `标题: 微博链接\n\n内容: ${url}`;
    }
    const weiboId = match[1];

    // 尝试调用微博移动端API
    const response = await axios.get(`https://m.weibo.cn/statuses/show?id=${weiboId}`, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
        "Referer": "https://m.weibo.cn/",
      },
    });

    if (response.data && response.data.ok === 1 && response.data.data) {
      const data = response.data.data;
      const text = data.text || "";
      const createdAt = data.created_at || "";
      const userName = data.user?.screen_name || "";

      // 解析HTML
      const plainText = text.replace(/<[^>]+>/g, "");

      return `标题: ${userName} 的微博\n\n作者: ${userName}\n\n发布时间: ${createdAt}\n\n内容: ${plainText.slice(0, 8000)}`;
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * 获取小宇宙播客内容（使用 Playwright 确保拿到完整渲染后的页面）
 */
async function fetchXiaoyuzhou(url) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });

    const result = await page.evaluate(() => {
      const title = document.querySelector('meta[property="og:title"]')?.content ||
                    document.title ||
                    "小宇宙播客";
      const description = document.querySelector('meta[property="og:description"]')?.content ||
                          document.querySelector('meta[name="description"]')?.content ||
                          "";
      // 尝试从 JSON-LD 获取作者
      let author = "";
      const jsonLd = document.querySelector('script[type="application/ld+json"]')?.textContent;
      if (jsonLd) {
        try {
          const data = JSON.parse(jsonLd);
          author = data.author?.name || data.partOfSeries?.name || "";
        } catch (e) {
          // 忽略
        }
      }
      return { title, description, author };
    });

    await context.close();
    await browser.close();

    return {
      text: `标题: ${result.title}\n\n播客: ${result.author}\n\n简介:\n${result.description.slice(0, 8000)}`,
      originalText: result.description.slice(0, 8000),
    };
  } catch (error) {
    await context.close();
    await browser.close();
    throw error;
  }
}

/**
 * 获取 X (Twitter) 内容
 */
async function fetchX(url) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  // 添加反爬虫规避
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    });
  });

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    const result = await page.evaluate(() => {
      let author = "Unknown Author";
      let tweetText = "";
      let timestamp = new Date().toISOString();

      // 尝试多种方式获取推文信息
      const articles = document.querySelectorAll('article');

      if (articles.length > 0) {
        // 遍历所有 article，找到包含文本的最新一条
        for (let i = 0; i < Math.min(articles.length, 3); i++) {
          const article = articles[i];

          // 尝试从 data-testid 获取文本
          let textEl = article.querySelector('[data-testid="tweetText"]');
          if (textEl) {
            tweetText = textEl.innerText || "";
          }

          // 备选：直接从 p 标签获取
          if (!tweetText) {
            const pEl = article.querySelector('p');
            if (pEl) tweetText = pEl.innerText || "";
          }

          if (tweetText && tweetText.length > 10) break;
        }

        // 获取作者名称
        const authorLink = articles[0].querySelector('a[href*="/@"]');
        if (authorLink) {
          const href = authorLink.getAttribute('href');
          author = href?.split('/').filter(Boolean).pop() || author;
        }

        // 获取时间戳
        const timeEl = articles[0].querySelector('time');
        if (timeEl) {
          timestamp = timeEl.getAttribute('datetime') || timestamp;
        }
      }

      // 如果还是没有文本，尝试从整个 main 获取
      if (!tweetText || tweetText.length < 10) {
        const main = document.querySelector('main');
        if (main) {
          const allText = main.innerText;
          // 取前 500 字作为备选
          tweetText = allText.substring(0, 500) || tweetText;
        }
      }

      return {
        author: author.trim(),
        text: tweetText.trim() || "（内容获取失败）",
        timestamp: timestamp,
        url: window.location.href,
      };
    });

    await context.close();
    await browser.close();

    return {
      text: `推文作者: ${result.author}\n\n发布时间: ${result.timestamp}\n\n内容:\n${result.text.slice(0, 8000)}`,
      originalText: result.text.slice(0, 8000),
    };
  } catch (error) {
    await context.close();
    await browser.close();
    console.error(`   X 内容获取失败: ${error.message}`);
    return null;
  }
}

/**
 * 获取36氪内容
 */
async function fetch36kr(url) {
  const response = await axios.get(url, {
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  const html = response.data;

  // 提取标题
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "36氪文章";

  // 提取文章内容
  const contentMatch = html.match(/class="article-content"[^>]*>([\s\S]*?)<\/div>/i) ||
                       html.match(/class="content"[^>]*>([\s\S]*?)<\/div>/i);
  let content = "";

  if (contentMatch) {
    content = cleanHtml(contentMatch[1]);
  }

  return `标题: ${title}\n\n内容: ${content.slice(0, 8000)}`;
}

/**
 * 通用网页获取
 */
async function fetchGenericPage(url) {
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
    });

    let html = response.data;
    // 确保是字符串
    if (typeof html !== 'string') {
      html = JSON.stringify(html);
    }

    // 提取标题
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "网页";

    // 提取 meta 描述
    const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
    const description = descMatch ? descMatch[1] : "";

    // 提取 meta 作者
    const authorMatch = html.match(/<meta[^>]*name="author"[^>]*content="([^"]+)"/i) ||
                        html.match(/<meta[^>]*property="article:author"[^>]*content="([^"]+)"/i);
    const author = authorMatch ? authorMatch[1] : "";

    // 尝试提取正文
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    let content = "";

    if (bodyMatch) {
      content = cleanHtml(bodyMatch[1]);
    }

    return `标题: ${title}\n\n作者: ${author}\n\n描述: ${description}\n\n内容: ${content.slice(0, 6000)}`;
  } catch (error) {
    console.error(`   获取页面失败: ${error.message}`);
    return null;
  }
}

/**
 * 清理 HTML 标签，提取纯文本
 */
function cleanHtml(html) {
  if (!html) return "";

  return html
    // 移除脚本和样式
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    // 移除 HTML 标签
    .replace(/<[^>]+>/g, "\n")
    // 移除多余空白
    .replace(/[\n\r]+/g, "\n")
    .replace(/[ \t]+/g, " ")
    // 解码 HTML 实体
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // 移除多余空白行
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join("\n");
}

export default {
  fetchPageContent,
};
