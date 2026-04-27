/**
 * 飞书 API 封装
 * 使用 axios 直接调用飞书 Open API
 */
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载配置
function loadConfig() {
  const configPath = path.join(__dirname, "..", "config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error("配置文件 config.json 不存在，请复制 config.example.json 为 config.json 并填写配置");
  }
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

let config = null;
let tenantAccessToken = null;
let tokenExpireTime = 0;

/**
 * 获取配置
 */
export function getConfig() {
  if (!config) {
    config = loadConfig();
  }
  return config;
}

/**
 * 获取 tenant_access_token
 */
async function getTenantAccessToken() {
  const cfg = getConfig();
  const now = Date.now();

  // 检查缓存的 token 是否有效
  if (tenantAccessToken && now < tokenExpireTime) {
    return tenantAccessToken;
  }

  try {
    const response = await axios.post(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        app_id: cfg.feishu.app_id,
        app_secret: cfg.feishu.app_secret,
      },
      {
        headers: { "Content-Type": "application/json" },
      }
    );

    if (response.data && response.data.tenant_access_token) {
      tenantAccessToken = response.data.tenant_access_token;
      // 提前5分钟过期
      tokenExpireTime = now + (response.data.expire - 300) * 1000;
      return tenantAccessToken;
    }
    throw new Error("获取 token 失败");
  } catch (error) {
    console.error("获取 tenant_access_token 失败:", error.message);
    throw error;
  }
}

/**
 * 获取群消息
 * @param {string} chatId 飞书群 ID
 * @param {number} pageSize 获取消息数量
 */
export async function getGroupMessages(chatId = null, pageSize = 50, pageToken = null) {
  const cfg = getConfig();
  const targetChatId = chatId || cfg.feishu.chat_id;
  const token = await getTenantAccessToken();

  const params = {
    container_id_type: "chat",
    container_id: targetChatId,
    page_size: pageSize,
    sort: "ByCreateTimeDesc", // 按创建时间倒序，获取最新消息
  };

  if (pageToken) {
    params.page_token = pageToken;
  }

  try {
    const response = await axios.get(
      "https://open.feishu.cn/open-apis/im/v1/messages",
      {
        params,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (response.data && response.data.data && response.data.data.items) {
      return {
        items: response.data.data.items,
        nextPageToken: response.data.data.page_token || null,
      };
    }
    return { items: [], nextPageToken: null };
  } catch (error) {
    console.error("获取群消息失败:", error.response?.data?.msg || error.message);
    throw error;
  }
}

/**
 * 从消息中获取文本内容
 * @param {string} messageId 消息 ID
 */
export async function getMessageContent(messageId) {
  const token = await getTenantAccessToken();

  try {
    const response = await axios.get(
      `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (response.data && response.data.data && response.data.data.body) {
      return response.data.data.body;
    }
    return null;
  } catch (error) {
    console.error(`获取消息 ${messageId} 内容失败:`, error.message);
    return null;
  }
}

/**
 * 写入多维表格记录
 * @param {Object} record 记录数据
 */
/**
 * 更新指定记录
 * @param {string} recordId 记录 ID
 * @param {Object} fields 字段数据
 */
export async function updateBitableRecord(recordId, fields) {
  const cfg = getConfig();
  const token = await getTenantAccessToken();

  try {
    const updateResp = await axios.put(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/${cfg.bitable.table_id}/records/${recordId}`,
      { fields },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (updateResp.data && updateResp.data.msg === "success") {
      console.log(`✅ 成功更新记录: ${recordId}`);
      return updateResp.data.data.record;
    }
    return null;
  } catch (error) {
    console.error("更新多维表格记录失败:", error.response?.data?.msg || error.message);
    throw error;
  }
}

export async function writeToBitable(record) {
  const cfg = getConfig();
  const token = await getTenantAccessToken();

  const fields = {
    "链接": { "text": record.url, "url": record.url || "" },
    "标题": record.title || "",
    "作者": record.author || "",
    "来源": record.source || "其他",
    "方向": record.topics || "",
    "内容概括": record.summary || "",
    "视频/图片原文": record.transcript || "",
    "帖子原文": record.originalText || "",
    "优先级": String(record.priority || 3),
    "状态": record.status || "未读",
    "添加时间": new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " "),
  };

  try {
    // 获取所有记录，找空记录（完整分页）
    let pageToken = null;
    let emptyRecord = null;

    do {
      const params = { page_size: 100 };
      if (pageToken) params.page_token = pageToken;

      const listResp = await axios.get(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/${cfg.bitable.table_id}/records`,
        {
          params,
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (listResp.data && listResp.data.data && listResp.data.data.items) {
        emptyRecord = listResp.data.data.items.find(item => !item.fields || Object.keys(item.fields).length === 0);
        if (emptyRecord) break;
        pageToken = listResp.data.data.page_token || null;
      } else {
        break;
      }
    } while (pageToken);

    if (emptyRecord) {
      // 用 PUT 更新空记录
      const updateResp = await axios.put(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/${cfg.bitable.table_id}/records/${emptyRecord.id}`,
        { fields },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (updateResp.data && updateResp.data.msg === "success") {
        console.log(`✅ 成功写入记录: ${record.title}`);
        return updateResp.data.data.record;
      }
    }

    // 如果没有空记录，尝试 POST（不需要 records 包装）
    const postResp = await axios.post(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/${cfg.bitable.table_id}/records`,
      { fields },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (postResp.data && postResp.data.data && postResp.data.data.record) {
      console.log(`✅ 成功写入记录: ${record.title}`);
      return postResp.data.data.record;
    }
    return null;
  } catch (error) {
    console.error("写入多维表格失败:", error.response?.data?.msg || error.message);
    throw error;
  }
}

/**
 * 获取多维表格的所有记录（完整分页）
 */
export async function getBitableRecords() {
  const cfg = getConfig();
  const token = await getTenantAccessToken();
  const allRecords = [];
  let pageToken = null;

  try {
    do {
      const params = { page_size: 100 };
      if (pageToken) {
        params.page_token = pageToken;
      }

      const response = await axios.get(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/${cfg.bitable.table_id}/records`,
        {
          params,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.data && response.data.data && response.data.data.items) {
        allRecords.push(...response.data.data.items);
        pageToken = response.data.data.page_token || null;
      } else {
        break;
      }
    } while (pageToken);

    return allRecords;
  } catch (error) {
    console.error("获取多维表格记录失败:", error.response?.data?.msg || error.message);
    return [];
  }
}

/**
 * 获取群列表
 */
export async function getChatList() {
  const token = await getTenantAccessToken();

  try {
    const response = await axios.get(
      "https://open.feishu.cn/open-apis/im/v1/chats",
      {
        params: {
          page_size: 100,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (response.data && response.data.data && response.data.data.items) {
      return response.data.data.items;
    }
    return [];
  } catch (error) {
    console.error("获取群列表失败:", error.response?.data?.msg || error.message);
    throw error;
  }
}

/**
 * 发送消息到群
 * @param {string} chatId 群 ID
 * @param {string} text 消息文本
 */
export async function sendMessage(chatId, text) {
  const token = await getTenantAccessToken();

  try {
    // 清理文本
    const cleanText = text.replace(/[\x00-\x1F\x7F]/g, '').slice(0, 5000);

    const response = await axios.post(
      "https://open.feishu.cn/open-apis/im/v1/messages",
      {
        receive_id_type: "chat_id",
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text: cleanText }),
      },
      {
        params: {
          receive_id_type: "chat_id",
        },
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.data && response.data.msg === "success") {
      return true;
    }
    console.error("发送消息失败:", JSON.stringify(response.data, null, 2));
    return false;
  } catch (error) {
    console.error("发送消息失败:", JSON.stringify(error.response?.data, null, 2) || error.message);
    return false;
  }
}

/**
 * 获取最新消息（用于监听模式）
 * @param {string} chatId 群 ID
 * @param {number} pageSize 消息数量
 */
export async function getLatestMessages(chatId, pageSize = 20) {
  const token = await getTenantAccessToken();

  try {
    const response = await axios.get(
      "https://open.feishu.cn/open-apis/im/v1/messages",
      {
        params: {
          container_id_type: "chat",
          container_id: chatId,
          page_size: pageSize,
          sort: "ByCreateTimeDesc",
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (response.data && response.data.data && response.data.data.items) {
      return response.data.data.items;
    }
    return [];
  } catch (error) {
    console.error("获取消息失败:", error.response?.data?.msg || error.message);
    return [];
  }
}

/**
 * 创建多维表格字段
 * @param {string} fieldName 字段名称
 * @param {string} fieldType 字段类型 (text, number, singleSelect, multiSelect, date, checkbox, url)
 */
export async function createField(fieldName, fieldType = "text") {
  const cfg = getConfig();
  const token = await getTenantAccessToken();

  const fieldConfig = {
    field_name: fieldName,
    type: getFieldTypeId(fieldType),
  };

  try {
    const response = await axios.post(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/${cfg.bitable.table_id}/fields`,
      fieldConfig,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.data && response.data.msg === "success") {
      console.log(`✅ 字段 "${fieldName}" 创建成功`);
      return response.data.data;
    }
    return null;
  } catch (error) {
    if (error.response?.data?.msg?.includes("field_name already exists")) {
      console.log(`ℹ️ 字段 "${fieldName}" 已存在`);
      return null;
    }
    console.error(`创建字段 "${fieldName}" 失败:`, error.response?.data?.msg || error.message);
    return null;
  }
}

/**
 * 获取字段类型 ID
 */
function getFieldTypeId(type) {
  const typeMap = {
    text: 1,          // 文本
    number: 2,        // 数字
    singleSelect: 3,  // 单选
    multiSelect: 4,   // 多选
    date: 5,          // 日期
    checkbox: 7,      // 复选框
    url: 15,          // 链接
    person: 17,       // 人员
    group: 18,        // 群组
  };
  return typeMap[type] || 1;
}

/**
 * 按 URL 查找多维表格中的记录
 * @param {string} url 链接
 * @returns {{ recordId, currentThoughts } | null}
 */
export async function findRecordByUrl(url) {
  const records = await getBitableRecords();
  for (const record of records) {
    const linkField = record.fields?.["链接"];
    let recordUrl = null;
    if (typeof linkField === "string") {
      recordUrl = linkField;
    } else if (linkField && typeof linkField === "object") {
      recordUrl = linkField.link || linkField.url || linkField.text || null;
    }
    if (recordUrl === url) {
      const thoughtsField = record.fields?.["我的想法"];
      const currentThoughts = typeof thoughtsField === "string" ? thoughtsField : "";
      return { recordId: record.id, currentThoughts };
    }
  }
  return null;
}

/**
 * 追加想法到指定记录（不覆盖，用换行分隔）
 * @param {string} recordId 记录 ID
 * @param {string} existingThoughts 已有想法内容
 * @param {string} newThought 新增想法
 */
export async function appendThought(recordId, existingThoughts, newThought) {
  const timestamp = new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
  const entry = `[${timestamp}] ${newThought}`;
  const merged = existingThoughts ? `${existingThoughts}\n${entry}` : entry;
  return updateBitableRecord(recordId, { "我的想法": merged });
}

/**
 * 获取订阅配置表中所有启用的订阅配置
 */
export async function getSubscriptions() {
  const cfg = getConfig();
  const token = await getTenantAccessToken();
  const configTableId = cfg.subscription.config_table_id;
  const allRecords = [];
  let pageToken = null;

  try {
    do {
      const params = { page_size: 100 };
      if (pageToken) params.page_token = pageToken;

      const response = await axios.get(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/${configTableId}/records`,
        {
          params,
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (response.data?.data?.items) {
        allRecords.push(...response.data.data.items);
        pageToken = response.data.data.page_token || null;
      } else {
        break;
      }
    } while (pageToken);

    // 过滤启用的配置（是否启用 = 启用）
    return allRecords.filter(record => {
      const enabledField = record.fields?.["是否启用"];
      return enabledField === "启用" || enabledField?.[0]?.text === "启用";
    });
  } catch (error) {
    console.error("获取订阅配置失败:", error.response?.data?.msg || error.message);
    return [];
  }
}

/**
 * 更新订阅配置表中的上次抓取时间戳
 */
export async function updateLastFetchTime(recordId, timestamp) {
  const cfg = getConfig();
  const token = await getTenantAccessToken();
  const configTableId = cfg.subscription.config_table_id;

  try {
    const updateResp = await axios.put(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/${configTableId}/records/${recordId}`,
      { fields: { "上次抓取时间戳": timestamp } },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (updateResp.data?.msg === "success") {
      return true;
    }
    return false;
  } catch (error) {
    console.error(`更新订阅时间戳 ${recordId} 失败:`, error.response?.data?.msg || error.message);
    return false;
  }
}

/**
 * 写入订阅内容表
 */
/**
 * 检查 URL 是否已在订阅内容表中存在
 */
export async function urlExistsInSubscriptionTable(url) {
  const cfg = getConfig();
  const token = await getTenantAccessToken();
  const subscriptionTableId = cfg.subscription.table_id;

  try {
    let pageToken = null;
    do {
      const params = { page_size: 100 };
      if (pageToken) params.page_token = pageToken;

      const listResp = await axios.get(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/${subscriptionTableId}/records`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params,
        }
      );

      if (listResp.data?.data?.items) {
        const found = listResp.data.data.items.some(record => {
          const linkField = record.fields["链接"];
          // 链接字段可能是字符串或对象格式
          const recordUrl = typeof linkField === "string" ? linkField : linkField?.url;
          return recordUrl === url;
        });

        if (found) return true;
        pageToken = listResp.data?.data?.page_token;
      } else {
        break;
      }
    } while (pageToken);

    return false;
  } catch (error) {
    console.error("检查 URL 存在性失败:", error.message);
    return false;
  }
}

export async function writeToSubscriptionTable(record) {
  const cfg = getConfig();
  const token = await getTenantAccessToken();
  const subscriptionTableId = cfg.subscription.table_id;

  // 检查 URL 去重
  const exists = await urlExistsInSubscriptionTable(record.url);
  if (exists) {
    console.log(`⏭️ URL 已存在，跳过: ${record.url}`);
    return null;
  }

  const fields = {
    "链接": { text: record.url, url: record.url || "" },
    "标题": record.title || "",
    "作者": record.author || "",
    "来源": record.source || "其他",
    "方向": record.topics || "",
    "内容概括": record.summary || "",
    "视频/图片原文": record.transcript || "",
    "帖子原文": record.originalText || "",
    "优先级": String(record.priority || 3),
    "状态": record.status || "未读",
    "添加时间": new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " "),
  };

  try {
    const postResp = await axios.post(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${cfg.bitable.app_token}/tables/${subscriptionTableId}/records`,
      { fields },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (postResp.data?.data?.record) {
      console.log(`✅ 成功写入订阅内容: ${record.title}`);
      return postResp.data.data.record;
    }
    return null;
  } catch (error) {
    console.error("写入订阅内容表失败:", error.response?.data?.msg || error.message);
    return null;
  }
}

export default {
  getConfig,
  getGroupMessages,
  getMessageContent,
  writeToBitable,
  getBitableRecords,
  getChatList,
  createField,
  sendMessage,
  getLatestMessages,
  findRecordByUrl,
  appendThought,
  updateBitableRecord,
  getSubscriptions,
  updateLastFetchTime,
  writeToSubscriptionTable,
  urlExistsInSubscriptionTable,
};
