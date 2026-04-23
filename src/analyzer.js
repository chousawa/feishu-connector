import axios from "axios";
import { getConfig } from "./feishu.js";

export async function analyzeContent(content, url, topics = "") {
  const config = getConfig();
  const kimiConfig = config.kimi;

  const truncatedContent = content.slice(0, 8000);

  const prompt = `你是一个内容分析助手。请分析以下链接的内容，并提取关键信息。

链接: ${url}
关注方向: ${topics}

内容:
${truncatedContent}

请以JSON格式返回分析结果，包含以下字段：
{
  "title": "必须从内容中提取或生成一个简短标题（15字以内），微博/帖子类内容可用正文开头几个字加省略号，不要用'未知标题'或'无标题'",
  "author": "作者或发布者名称（如果无法提取则用空字符串）",
  "summary": "内容概括（50-200字）",
  "relevance": "与关注方向的相关度评分（1-5分，5分最高）",
  "direction": "内容方向，如果是AI相关可以是：AI创作,AI编程,AI求职,AI产品,AI资讯。如果都不是，请用2-4个字总结一个最贴切的方向（如：产品设计、职场成长、技术分享等）",
  "insights": "主要观点或亮点（可选）"
}

只返回JSON，不要其他内容。`;

  const baseUrl = kimiConfig.base_url || "https://api.kimi.com/coding/";
  const maxRetries = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(
        `${baseUrl}v1/messages`,
        {
          model: kimiConfig.model,
          messages: [
            { role: "system", content: "你是一个专业的内容分析助手，擅长提取关键信息和总结要点。" },
            { role: "user", content: prompt },
          ],
          max_tokens: 1024,
          temperature: 0.7,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${kimiConfig.api_key}`,
          },
          timeout: 60000,
        }
      );

      if (!response.data?.content?.length) {
        throw new Error("API 返回格式异常");
      }

      const contentArray = response.data.content;
      let resultText = "";
      for (const item of contentArray) {
        if (item.type === "text") { resultText = item.text; break; }
      }
      if (!resultText) resultText = JSON.stringify(contentArray);

      try {
        const jsonMatch = resultText.match(/```json\n?([\s\S]*?)\n?```/) ||
                          resultText.match(/```\n?([\s\S]*?)\n?```/) ||
                          [null, resultText];
        const result = JSON.parse((jsonMatch[1] || resultText).trim());
        return {
          title: result.title || truncatedContent.slice(0, 15) + "...",
          author: result.author || "",
          summary: result.summary || "",
          relevance: parseInt(result.relevance) || 3,
          direction: result.direction || "其他",
          insights: result.insights || "",
        };
      } catch (parseError) {
        console.error("解析JSON失败:", parseError.message);
        let title = truncatedContent.slice(0, 15) + "...";
        let summary = resultText.slice(0, 300);
        const titleMatch = resultText.match(/"title"\s*:\s*"([^"]+)"/) ||
                           resultText.match(/标题[：:]\s*(.+)/) ||
                           resultText.match(/^#\s*(.+)/m);
        if (titleMatch) title = titleMatch[1].slice(0, 100);
        const summaryMatch = resultText.match(/"summary"\s*:\s*"([^"]+)"/) ||
                             resultText.match(/内容概括[：:]\s*(.+)/);
        if (summaryMatch) summary = summaryMatch[1].slice(0, 300);
        return { title, author: "", summary, relevance: 3, direction: "其他", insights: "" };
      }
    } catch (error) {
      lastError = error;
      if (error.response?.status === 429 && attempt < maxRetries) {
        const waitSec = attempt * 10;
        console.warn(`   ⚠️ 分析限流(429)，${waitSec}s 后重试(${attempt}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
        continue;
      }
      break;
    }
  }

  console.error(`分析内容失败: ${lastError.message}`);
  return {
    title: "获取失败",
    author: "",
    summary: "内容获取失败",
    relevance: 1,
    direction: "其他",
    insights: "",
  };
}

export default { analyzeContent };
