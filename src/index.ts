// src/index.ts - 带速率限制处理的Worker

export interface Env {
  OPENAI_API_KEY: string;
  // 可选：添加KV存储用于缓存和速率限制
  AI_CACHE?: KVNamespace;
}

// 重试配置
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1秒
  maxDelay: 10000, // 10秒
};

// 延迟函数
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 计算退避延迟
function getBackoffDelay(attempt: number, baseDelay: number, maxDelay: number): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 1000; // 添加随机抖动
  return Math.min(exponentialDelay + jitter, maxDelay);
}

// 带重试的API调用函数
async function callOpenAIWithRetry(prompt: string, env: Env, options: any = {}): Promise<any> {
  const requestBody = {
    model: options.model || "gpt-3.5-turbo",
    messages: [{ role: "user", content: prompt }],
    temperature: options.temperature || 0.7,
    max_tokens: options.max_tokens || 500
  };

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      console.log(`API调用尝试 ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}`);
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify(requestBody)
      });

      // 处理成功响应
      if (response.ok) {
        const data = await response.json();
        console.log('API调用成功');
        return data;
      }

      // 处理各种错误状态
      const errorText = await response.text();
      console.error(`API错误 (尝试 ${attempt + 1}):`, response.status, errorText);

      // 429 - 速率限制
      if (response.status === 429) {
        if (attempt < RETRY_CONFIG.maxRetries) {
          // 检查Retry-After头
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? 
            parseInt(retryAfter) * 1000 : 
            getBackoffDelay(attempt, RETRY_CONFIG.baseDelay, RETRY_CONFIG.maxDelay);
          
          console.log(`速率限制触发，等待 ${waitTime}ms 后重试...`);
          await delay(waitTime);
          continue;
        } else {
          throw new Error('API速率限制：请求过于频繁，请稍后再试。建议等待1-2分钟。');
        }
      }

      // 401 - 认证错误
      if (response.status === 401) {
        throw new Error('API认证失败：请检查OpenAI API密钥是否正确');
      }

      // 403 - 权限错误
      if (response.status === 403) {
        throw new Error('API权限错误：您的账户可能没有足够的权限或余额');
      }

      // 500系列错误 - 服务器错误，可以重试
      if (response.status >= 500 && attempt < RETRY_CONFIG.maxRetries) {
        const waitTime = getBackoffDelay(attempt, RETRY_CONFIG.baseDelay, RETRY_CONFIG.maxDelay);
        console.log(`服务器错误，等待 ${waitTime}ms 后重试...`);
        await delay(waitTime);
        continue;
      }

      // 其他错误
      throw new Error(`OpenAI API错误 (${response.status}): ${response.statusText}`);

    } catch (error) {
      // 网络错误或其他异常
      if (attempt < RETRY_CONFIG.maxRetries && (error.message.includes('fetch') || error.message.includes('network'))) {
        const waitTime = getBackoffDelay(attempt, RETRY_CONFIG.baseDelay, RETRY_CONFIG.maxDelay);
        console.log(`网络错误，等待 ${waitTime}ms 后重试...`);
        await delay(waitTime);
        continue;
      }
      throw error;
    }
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 处理CORS预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // 健康检查
    if (request.method === 'GET') {
      return new Response(JSON.stringify({ 
        status: 'healthy',
        features: {
          retryMechanism: true,
          rateLimitHandling: true,
          maxRetries: RETRY_CONFIG.maxRetries
        },
        apiKeyConfigured: Boolean(env.OPENAI_API_KEY)
      }), {
        headers: { 
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    // 处理POST请求
    if (request.method === 'POST') {
      try {
        const requestData = await request.json();
        
        if (!requestData.prompt) {
          return new Response(JSON.stringify({ 
            error: 'Missing required parameter: prompt' 
          }), { 
            status: 400,
            headers: { 
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }

        if (!env.OPENAI_API_KEY) {
          return new Response(JSON.stringify({ 
            error: 'Configuration error: OpenAI API key is missing' 
          }), { 
            status: 500,
            headers: { 
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }

        // 调用带重试机制的API
        const data = await callOpenAIWithRetry(requestData.prompt, env, {
          model: requestData.model,
          temperature: requestData.temperature,
          max_tokens: requestData.max_tokens
        });

        return new Response(JSON.stringify({
          text: data.choices[0].message.content,
          usage: data.usage,
          model: data.model
        }), {
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });

      } catch (error) {
        console.error('Worker Error:', error);
        
        // 根据错误类型返回不同的状态码
        let statusCode = 500;
        if (error.message.includes('速率限制') || error.message.includes('Too Many Requests')) {
          statusCode = 429;
        } else if (error.message.includes('认证失败') || error.message.includes('Unauthorized')) {
          statusCode = 401;
        } else if (error.message.includes('权限错误') || error.message.includes('Forbidden')) {
          statusCode = 403;
        }
        
        return new Response(JSON.stringify({ 
          error: error.message,
          type: 'AI_API_ERROR',
          timestamp: new Date().toISOString()
        }), { 
          status: statusCode,
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }

    return new Response('Method not allowed', { 
      status: 405,
      headers: corsHeaders
    });
  }
};