#!/usr/bin/env python3
"""
用 requests 直接调用 X 的 Guest API 获取推文（无需登录）
"""
import sys
import json
import requests

def fetch_tweet(tweet_id):
    """获取推文内容"""
    try:
        # X 的 Guest API 端点（无需认证）
        url = f"https://api.x.com/graphql"

        # GraphQL 查询（仅获取公开信息）
        query = {
            "operationName": "TweetDetail",
            "variables": {
                "tweetId": tweet_id,
                "withCommunity": False,
                "includePromotedContent": False,
                "withVoice": False
            },
            "query": """
            query TweetDetail($tweetId: ID!) {
              tweet(id: $tweetId) {
                rest_id
                core {
                  user_results {
                    result {
                      __typename
                      id
                      rest_id
                      legacy {
                        created_at
                        default_profile
                        description
                        id_str
                        name
                        screen_name
                        followers_count
                        friends_count
                        statuses_count
                      }
                    }
                  }
                }
                legacy {
                  created_at
                  conversation_id_str
                  display_text_range
                  entities {
                    user_mentions {
                      name
                      screen_name
                    }
                    urls {
                      display_url
                      expanded_url
                      url
                    }
                    hashtags {
                      text
                    }
                  }
                  favorite_count
                  full_text
                  in_reply_to_screen_name
                  in_reply_to_status_id_str
                  in_reply_to_user_id_str
                  is_quote_status
                  quote_count
                  reply_count
                  retweet_count
                  user_id_str
                  id_str
                }
              }
            }
            """
        }

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }

        # 尝试请求
        response = requests.post(url, json=query, headers=headers, timeout=15)
        response.raise_for_status()

        data = response.json()

        # 提取推文信息
        if "data" in data and "tweet" in data["data"]:
            tweet = data["data"]["tweet"]
            legacy = tweet.get("legacy", {})
            user = tweet.get("core", {}).get("user_results", {}).get("result", {}).get("legacy", {})

            return {
                "success": True,
                "author": user.get("name", "Unknown"),
                "username": user.get("screen_name", "Unknown"),
                "text": legacy.get("full_text", ""),
                "created_at": legacy.get("created_at", ""),
                "likes": legacy.get("favorite_count", 0),
                "retweets": legacy.get("retweet_count", 0),
            }
        else:
            return {"success": False, "error": "推文未找到或已删除"}

    except requests.exceptions.RequestException as e:
        return {"success": False, "error": f"网络错误: {str(e)}"}
    except Exception as e:
        return {"success": False, "error": f"解析错误: {str(e)}"}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "缺少 tweet_id 参数"}))
        sys.exit(1)

    tweet_id = sys.argv[1]
    result = fetch_tweet(tweet_id)
    print(json.dumps(result, ensure_ascii=False))
