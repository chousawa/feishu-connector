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
      default:
        return await fetchGenericPage(url);
    }
  } catch (error) {
    console.error(`   ❌ 获取内容失败: ${error.message}`);
    return null;
  }
}

/**
 * 获取公众号文章内容
 */
async function fetchWechatArticle(url) {
  // 尝试直接获取
  const response = await axios.get(url, {
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Cookie": "wapsso=1; wapsso_cache=1",
    },
  });

  // 公众号文章需要解析 HTML
  const html = response.data;

  // 提取标题
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "公众号文章";

  // 提取正文内容（尝试多种选择器）
  let content = "";

  // 尝试提取 id="js_content" 的内容
  const contentMatch = html.match(/id="js_content"[^>]*>([\s\S]*?)<\/div>/i);
  if (contentMatch) {
    content = cleanHtml(contentMatch[1]);
  }

  // 如果没找到，尝试提取整个文章区域
  if (!content || content.length < 50) {
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) {
      content = cleanHtml(articleMatch[1]);
    }
  }

  // 提取作者（公众号名）
  let author = "";
  const nicknameMatch = html.match(/var\s+nickname\s*=\s*"([^"]+)"/) ||
                        html.match(/"nick_name"\s*:\s*"([^"]+)"/) ||
                        html.match(/id="js_name"[^>]*>([^<]+)</) ||
                        html.match(/<meta[^>]*name="author"[^>]*content="([^"]+)"/i);
  if (nicknameMatch) {
    author = nicknameMatch[1].trim();
  }

  return `标题: ${title}\n\n作者: ${author}\n\n内容: ${content.slice(0, 8000)}`;
}

/**
 * 用 wanyi-watermark 解析小红书视频直链
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
        };
      }
    } catch (e) {
      console.error(`   ⚠️ 视频转录失败，降级为图文抓取: ${e.message}`);
    }
  }

  // 图文笔记或转录失败：用文字内容
  if (!content || content.length < 10) {
    const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
    content = descMatch ? descMatch[1] : "";
  }

  return `标题: ${title}\n\n作者: ${author}\n\n内容: ${content.slice(0, 8000)}`;
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

    // 如果API失败，返回基本信息
    return `标题: 微博\n\n内容: 链接: ${url}\n\n备注: 微博有反爬虫机制，内容获取失败。请手动复制内容。`;
  } catch (error) {
    return `标题: 微博\n\n内容: 链接: ${url}\n\n备注: 微博内容获取失败: ${error.message}`;
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
