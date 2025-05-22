// src/index-graphql.ts - 完整的GraphQL Worker实现

export interface Env {
  OPENAI_API_KEY: string;
}

// 简单的GraphQL解析器，不依赖外部库
class GraphQLHandler {
  private resolvers: any;

  constructor(resolvers: any) {
    this.resolvers = resolvers;
  }

  async execute(query: string, variables: any = {}, context: any = {}) {
    try {
      // 简单的GraphQL查询解析
      if (query.includes('generateAIResponse')) {
        const promptMatch = query.match(/prompt:\s*\$(\w+)/);
        const promptVar = promptMatch ? promptMatch[1] : 'prompt';
        const prompt = variables[promptVar];

        if (!prompt) {
          return {
            errors: [{ message: 'Missing required variable: prompt' }]
          };
        }

        const result = await this.resolvers.Query.generateAIResponse(null, { prompt }, context);
        return {
          data: {
            generateAIResponse: result
          }
        };
      }

      if (query.includes('hello')) {
        const result = await this.resolvers.Query.hello();
        return {
          data: {
            hello: result
          }
        };
      }

      return {
        errors: [{ message: 'Unknown query' }]
      };
    } catch (error) {
      return {
        errors: [{ message: error.message }]
      };
    }
  }
}

// GraphQL resolvers
const resolvers = {
  Query: {
    hello: () => 'Hello World!',
    generateAIResponse: async (parent: any, args: any, context: any) => {
      const { prompt } = args;
      const { env } = context;

      if (!env.OPENAI_API_KEY) {
        throw new Error('OpenAI API key is not configured');
      }

      try {
        console.log('Calling OpenAI API...');
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 500
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('OpenAI API Error:', response.status, errorText);
          throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
      } catch (error) {
        console.error('Error calling OpenAI API:', error);
        throw new Error(`AI API Error: ${error.message}`);
      }
    }
  }
};

const graphqlHandler = new GraphQLHandler(resolvers);

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
        type: 'GraphQL API',
        endpoints: {
          graphql: 'POST /',
          health: 'GET /'
        }
      }), {
        headers: { 
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    // 处理GraphQL POST请求
    if (request.method === 'POST') {
      try {
        const contentType = request.headers.get('content-type') || '';
        
        if (!contentType.includes('application/json')) {
          return new Response(JSON.stringify({
            errors: [{ message: 'Content-Type must be application/json' }]
          }), {
            status: 400,
            headers: { 
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }

        const body = await request.json();
        const { query, variables = {} } = body;

        if (!query) {
          return new Response(JSON.stringify({
            errors: [{ message: 'Missing GraphQL query' }]
          }), {
            status: 400,
            headers: { 
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }

        // 执行GraphQL查询
        const result = await graphqlHandler.execute(query, variables, { env });

        return new Response(JSON.stringify(result), {
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      } catch (error) {
        console.error('GraphQL execution error:', error);
        
        return new Response(JSON.stringify({
          errors: [{ message: 'Internal server error', details: error.message }]
        }), {
          status: 500,
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