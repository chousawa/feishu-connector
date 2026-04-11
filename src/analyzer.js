/**
 * MiniMax API 分析模块
 * 使用 MiniMax 分析链接内容，提取关键信息
 */
import axios from "axios";
import { getConfig } from "./feishu.js";

/**
 * 调用 MiniMax API 分析内容
 * @param {string} content 页面内容
 * @param {string} url 页面URL
 * @param {string} topics 关注方向（逗号分隔）
 * @returns {Object} 分析结果
 */
export async function analyzeContent(content, url, topics = "") {
  const config = getConfig();
  const miniMaxConfig = config.minimax;

  // 截取内容（前8000字符，避免超过API限制）
  const truncatedContent = content.slice(0, 8000);

  const prompt = `你是一个内容分析助手。请分析以下链接的内容，并提取关键信息。

链接: ${url}
关注方向: ${topics}

内容:
${truncatedContent}

请以JSON格式返回分析结果，包含以下字段：
{
  "title": "标题（如果无法提取则用'未知标题'）",
  "author": "作者或发布者名称（如果无法提取则用空字符串）",
  "summary": "内容概括（50-200字）",
  "relevance": "与关注方向的相关度评分（1-5分，5分最高）",
  "direction": "内容方向，如果是AI相关可以是：AI创作,AI编程,AI求职,AI产品,AI资讯。如果都不是，请用2-4个字总结一个最贴切的方向（如：产品设计、职场成长、技术分享等）",
  "insights": "主要观点或亮点（可选）"
}

只返回JSON，不要其他内容。`;

  try {
    const baseUrl = miniMaxConfig.base_url || "https://api.minimaxi.com/anthropic";
    const response = await axios.post(
      `${baseUrl}/v1/messages`,
      {
        model: miniMaxConfig.model,
        messages: [
          {
            role: "system",
            content: "你是一个专业的内容分析助手，擅长提取关键信息和总结要点。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 1024,
        temperature: 0.7,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": miniMaxConfig.api_key,
        },
        timeout: 60000,
      }
    );

    if (response.data && response.data.content && response.data.content.length > 0) {
      // MiniMax 返回格式: content 是数组，包含 type: "text" 的对象
      const contentArray = response.data.content;
      let resultText = "";

      for (const item of contentArray) {
        if (item.type === "text") {
          resultText = item.text;
          break;
        }
      }

      if (!resultText) {
        resultText = JSON.stringify(contentArray);
      }

      // 尝试解析 JSON
      try {
        // 处理可能的 markdown 代码块
        const jsonMatch = resultText.match(/```json\n?([\s\S]*?)\n?```/) ||
                          resultText.match(/```\n?([\s\S]*?)\n?```/) ||
                          [null, resultText];

        const jsonStr = jsonMatch[1] || resultText;
        const result = JSON.parse(jsonStr.trim());

        return {
          title: result.title || "未知标题",
          author: result.author || "",
          summary: result.summary || "",
          relevance: parseInt(result.relevance) || 3,
          direction: result.direction || "其他",
          insights: result.insights || "",
        };
      } catch (parseError) {
        console.error("解析JSON失败:", parseError.message);
        // 尝试从文本中提取标题
        let title = "内容分析";
        let summary = resultText.slice(0, 300);

        // 尝试匹配标题
        const titleMatch = resultText.match(/"title"\s*:\s*"([^"]+)"/) ||
                          resultText.match(/标题[：:]\s*(.+)/) ||
                          resultText.match(/^#\s*(.+)/m);
        if (titleMatch) {
          title = titleMatch[1].slice(0, 100);
        }

        // 尝试提取summary
        const summaryMatch = resultText.match(/"summary"\s*:\s*"([^"]+)"/) ||
                           resultText.match(/内容概括[：:]\s*(.+)/);
        if (summaryMatch) {
          summary = summaryMatch[1].slice(0, 300);
        }

        return {
          title: title,
          author: "",
          summary: summary,
          relevance: 3,
          direction: "其他",
          insights: "",
        };
      }
    }

    throw new Error("API 返回格式异常");
  } catch (error) {
    console.error(`分析内容失败: ${error.message}`);
    // 返回默认值
    return {
      title: "获取失败",
      author: "",
      summary: "内容获取失败",
      relevance: 1,
      direction: "其他",
      insights: "",
    };
  }
}

export default {
  analyzeContent,
};
