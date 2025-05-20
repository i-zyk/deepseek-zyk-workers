import { graphql } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';

// Define your GraphQL schema
const typeDefs = `
  type Query {
    hello: String
    generateAIResponse(prompt: String!): String
  }
`;

// Define resolvers
const resolvers = {
  Query: {
    hello: () => 'Hello World!',
    generateAIResponse: async (_, { prompt }, { env }) => {
      try {
        // DeepSeek API调用
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 500
          })
        });
        
        if (!response.ok) {
          throw new Error(`DeepSeek API error: ${response.statusText}`);
        }
        
        const data = await response.json();
        return data.choices[0].message.content;
      } catch (error) {
        console.error('Error calling DeepSeek API:', error);
        return `Error: ${error.message}`;
      }
    }
  }
};

// Create executable schema
const schema = makeExecutableSchema({
  typeDefs,
  resolvers,
});

// Handle GraphQL requests
async function handleGraphQLRequest(request, env) {
  const contentType = request.headers.get('content-type');
  
  if (contentType && contentType.includes('application/json')) {
    const { query, variables } = await request.json();
    
    const result = await graphql({
      schema,
      source: query,
      variableValues: variables,
      contextValue: { env }
    });
    
    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
  
  return new Response('Unsupported Media Type', { status: 415 });
}

// Main worker function
export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight requests
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
    
    // Handle actual GraphQL requests
    if (request.method === 'POST') {
      return handleGraphQLRequest(request, env);
    }
    
    // Simple health check for GET requests
    if (request.method === 'GET') {
      return new Response(JSON.stringify({ status: 'healthy' }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // Return 404 for other methods
    return new Response('Not Found', { status: 404 });
  }
};