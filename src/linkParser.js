/**
 * 链接解析模块
 * 从文本中提取各种平台的链接
 */

// 平台匹配正则
const PLATFORM_PATTERNS = [
  { name: "小红书", pattern: /xiaohongshu\.com|xhslink\.com/i },
  { name: "微博", pattern: /weibo\.com|weibo\.cn|m\.weibo\.cn/i },
  { name: "公众号", pattern: /mp\.weixin\.qq\.com/i },
  { name: "小宇宙", pattern: /xiaoyuzhou\.fm|xiaoyuzhoufm\.com|xiaoyuzhouapp\.com/i },
  { name: "B站", pattern: /bilibili\.com|b23\.tv/i },
  { name: "抖音", pattern: /douyin\.com|aweme\.vivo\.com\.cn/i },
  { name: "知乎", pattern: /zhihu\.com|zhihu\.cn/i },
  { name: "掘金", pattern: /juejin\.cn|juejin\.im/i },
  { name: "即刻", pattern: /jike\.com/i },
  { name: "X", pattern: /twitter\.com|x\.com/i },
  { name: "GitHub", pattern: /github\.com/i },
  { name: "36氪", pattern: /36kr\.com/i },
];

/**
 * 从文本中提取所有链接
 * @param {string} text 文本内容
 * @returns {Array} 链接数组
 */
export function extractLinks(text) {
  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
  const matches = text.match(urlPattern) || [];
  return [...new Set(matches)]; // 去重
}

/**
 * 判断链接所属平台
 * @param {string} url 链接
 * @returns {string} 平台名称
 */
export function getPlatform(url) {
  for (const platform of PLATFORM_PATTERNS) {
    if (platform.pattern.test(url)) {
      return platform.name;
    }
  }
  return "其他";
}

/**
 * 解析消息中的链接信息
 * @param {string} messageText 消息文本
 * @returns {Array} 链接信息数组 [{ url, platform }]
 */
export function parseMessageLinks(messageText) {
  const links = extractLinks(messageText);

  return links.map((url) => ({
    url: url,
    platform: getPlatform(url),
  }));
}

export default {
  extractLinks,
  getPlatform,
  parseMessageLinks,
};
