// src/index.ts - OpenAI版本

export interface Env {
  OPENAI_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 处理CORS预检请求
    if (request.method === 'OPTIONS') {
      return handleCORS();
    }
    
    // 设置CORS并处理请求
    if (request.method === 'POST') {
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      };
      
      try {
        // 解析请求数据
        const requestData = await request.json();
        
        // 检查必要参数
        if (!requestData.prompt) {
          return new Response(JSON.stringify({ error: 'Missing required parameter: prompt' }), { 
            status: 400,
            headers: { 
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 检查API密钥存在
        if (!env.OPENAI_API_KEY) {
          console.error('API key is missing');
          return new Response(JSON.stringify({ 
            error: 'Configuration error: API key is missing' 
          }), { 
            status: 500,
            headers: { 
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        console.log('Calling OpenAI API with key:', env.OPENAI_API_KEY.substring(0, 3) + '...');
        
        // 准备调用OpenAI API
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: requestData.model || "gpt-3.5-turbo",
            messages: [
              { 
                role: "user", 
                content: requestData.prompt 
              }
            ],
            temperature: requestData.temperature || 0.7,
            max_tokens: requestData.max_tokens || 500
          })
        });
        
        // 处理API响应
        if (!response.ok) {
          const errorData = await response.text();
          console.error('OpenAI API Error:', response.status, errorData);
          
          return new Response(JSON.stringify({ 
            error: `OpenAI API error: ${response.status} ${response.statusText}`,
            details: errorData
          }), { 
            status: 502,
            headers: { 
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // 返回成功响应
        const data = await response.json();
        return new Response(JSON.stringify({
          text: data.choices[0].message.content,
          raw: data
        }), { 
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        console.error('Worker Error:', error);
        
        return new Response(JSON.stringify({ 
          error: 'Internal server error',
          message: error.message 
        }), { 
          status: 500,
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }
    
    // 对于GET请求，返回简单的健康检查
    if (request.method === 'GET') {
      return new Response(JSON.stringify({ 
        status: 'healthy',
        apiKeyConfigured: Boolean(env.OPENAI_API_KEY)
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // 其他请求方法返回404
    return new Response('Not Found', { status: 404 });
  }
};

// 处理CORS预检请求
function handleCORS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
}