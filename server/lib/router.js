// ===== Smart Model Router — OpenRouter Integration =====
const OpenAI = require('openai');

// Model tiers with pricing (per 1M tokens)
const MODEL_TIERS = {
  simple: {
    model: process.env.MODEL_SIMPLE || 'google/gemini-2.0-flash-001',
    label: 'Flash',
    inputCost: 0.10,
    outputCost: 0.40,
  },
  medium: {
    model: process.env.MODEL_MEDIUM || 'google/gemini-2.0-flash-001',
    label: 'Pro',
    inputCost: 0.10,
    outputCost: 0.40,
  },
  complex: {
    model: process.env.MODEL_COMPLEX || 'anthropic/claude-3.5-sonnet',
    label: 'Claude',
    inputCost: 3.00,
    outputCost: 15.00,
  },
  auto: {
    model: 'openrouter/auto',
    label: 'Auto',
    inputCost: 0,
    outputCost: 0,
  },
};

class ModelRouter {
  constructor() {
    this.client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY || '',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/google-deepmind/antigravity',
        'X-Title': 'OMEGA COMMAND AI Agent Dashboard',
      },
    });
    this.totalCost = 0;
    this.requestCount = 0;
    this.costLog = [];
  }

  /**
   * Send a completion request with automatic model selection
   * @param {Object} options
   * @param {string} options.tier - 'simple' | 'medium' | 'complex' | 'auto'
   * @param {Array} options.messages - Chat messages array
   * @param {Array} [options.tools] - Tool definitions
   * @param {number} [options.maxTokens] - Max tokens
   * @param {number} [options.temperature] - Temperature
   * @param {boolean} [options.stream] - Stream response
   * @returns {Promise<Object>}
   */
  async complete({ tier = 'auto', messages, tools, maxTokens = 4096, temperature = 0.7, stream = false }) {
    const modelConfig = MODEL_TIERS[tier] || MODEL_TIERS.auto;

    const params = {
      model: modelConfig.model,
      messages,
      max_tokens: maxTokens,
      temperature,
    };

    // Add tools if provided (for function calling)
    if (tools && tools.length > 0) {
      params.tools = tools;
      params.tool_choice = 'auto';
    }

    try {
      if (stream) {
        return this._streamComplete(params, modelConfig);
      }

      // Check if we should use prompting fallback instead of native tools
      // Some free models on OpenRouter claim tool support but fail with 404
      const useNativeTools = tools && tools.length > 0 && !modelConfig.model.includes(':free');
      
      if (!useNativeTools && tools && tools.length > 0) {
        this._injectToolsIntoPrompt(params, tools);
        delete params.tools;
        delete params.tool_choice;
      }

      const response = await this.client.chat.completions.create(params);

      // Track cost
      this._trackCost(response, modelConfig);

      let content = response.choices[0]?.message?.content || '';
      let toolCalls = response.choices[0]?.message?.tool_calls || [];

      // If we used prompting fallback, try to parse tool calls from content
      if (!useNativeTools && tools && tools.length > 0 && content) {
        const parsed = this._parseManualToolCalls(content);
        if (parsed.toolCalls.length > 0) {
          toolCalls = parsed.toolCalls;
          content = parsed.remainingContent;
        }
      }

      return {
        content: content,
        toolCalls: toolCalls,
        model: response.model || modelConfig.model,
        usage: response.usage || {},
        cost: this._calculateCost(response.usage, modelConfig),
        finishReason: response.choices[0]?.finish_reason,
      };
    } catch (error) {
      // If native tools failed with 404, retry with prompt injection
      if (error.status === 404 && params.tools) {
        console.warn(`[Router] Tool-use not supported for ${modelConfig.model}. Retrying with prompt injection...`);
        const fallbackParams = { ...params };
        this._injectToolsIntoPrompt(fallbackParams, tools);
        delete fallbackParams.tools;
        delete fallbackParams.tool_choice;
        
        try {
          const fallbackResponse = await this.client.chat.completions.create(fallbackParams);
          this._trackCost(fallbackResponse, modelConfig);
          const content = fallbackResponse.choices[0]?.message?.content || '';
          const parsed = this._parseManualToolCalls(content);
          
          return {
            content: parsed.remainingContent,
            toolCalls: parsed.toolCalls,
            model: fallbackResponse.model || modelConfig.model,
            usage: fallbackResponse.usage || {},
            cost: this._calculateCost(fallbackResponse.usage, modelConfig),
            finishReason: fallbackResponse.choices[0]?.finish_reason,
          };
        } catch (innerError) {
          throw innerError;
        }
      }

      // Fallback: try next tier down
      if (tier === 'complex') {
        console.warn(`[Router] ${modelConfig.model} failed, falling back to medium tier`);
        return this.complete({ ...arguments[0], tier: 'medium' });
      }
      if (tier === 'medium') {
        console.warn(`[Router] ${modelConfig.model} failed, falling back to simple tier`);
        return this.complete({ ...arguments[0], tier: 'simple' });
      }
      throw error;
    }
  }

  /**
   * Inject tool definitions into the system prompt as text
   */
  _injectToolsIntoPrompt(params, tools) {
    const toolInstructions = `
## Available Tools
You can use the following tools by responding with a JSON block in your message:
\`\`\`json
{
  "tool_calls": [
    {
      "function": {
        "name": "tool_name",
        "arguments": "{\\"arg1\\": \\"value\\"}"
      }
    }
  ]
}
\`\`\`

AVAILABLE TOOLS:
${tools.map(t => `- ${t.function.name}: ${t.function.description}. Parameters: ${JSON.stringify(t.function.parameters)}`).join('\n')}
`;
    
    if (params.messages[0].role === 'system') {
      params.messages[0].content += toolInstructions;
    } else {
      params.messages.unshift({ role: 'system', content: toolInstructions });
    }
  }

  /**
   * Parse manual tool calls from a JSON block in the content
   */
  _parseManualToolCalls(content) {
    const toolCallRegex = /```json\s*([\s\S]*?)\s*```/g;
    let match;
    const toolCalls = [];
    let remainingContent = content;

    while ((match = toolCallRegex.exec(content)) !== null) {
      try {
        const json = JSON.parse(match[1]);
        if (json.tool_calls) {
          toolCalls.push(...json.tool_calls.map((tc, index) => ({
            id: `manual_${Date.now()}_${index}`,
            type: 'function',
            function: tc.function
          })));
          remainingContent = remainingContent.replace(match[0], '');
        }
      } catch (e) {
        // Not a tool call block, skip
      }
    }

    return { toolCalls, remainingContent: remainingContent.trim() };
  }

  /**
   * Stream a completion
   */
  async *_streamComplete(params, modelConfig) {
    params.stream = true;
    const stream = await this.client.chat.completions.create(params);
    let fullContent = '';

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      fullContent += delta;
      yield { content: delta, full: fullContent, done: chunk.choices[0]?.finish_reason === 'stop' };
    }
  }

  /**
   * Determine the best tier for a task
   * @param {string} taskDescription
   * @returns {string}
   */
  static recommendTier(taskDescription) {
    const lower = taskDescription.toLowerCase();

    // Complex tasks — code generation, architecture, multi-step reasoning
    const complexPatterns = [
      'build', 'create app', 'develop', 'implement', 'architect',
      'refactor', 'debug complex', 'full stack', 'mobile app',
      'web app', 'api design', 'database schema', 'migration',
    ];
    if (complexPatterns.some(p => lower.includes(p))) return 'complex';

    // Medium tasks — analysis, research, SEO, design guidance
    const mediumPatterns = [
      'analyze', 'research', 'seo', 'optimize', 'audit',
      'design', 'strategy', 'plan', 'compare', 'review',
      'improve', 'evaluate', 'assess',
    ];
    if (mediumPatterns.some(p => lower.includes(p))) return 'medium';

    // Simple — summaries, writing, simple questions
    return 'simple';
  }

  _calculateCost(usage, modelConfig) {
    if (!usage) return 0;
    const inputCost = ((usage.prompt_tokens || 0) / 1_000_000) * modelConfig.inputCost;
    const outputCost = ((usage.completion_tokens || 0) / 1_000_000) * modelConfig.outputCost;
    return +(inputCost + outputCost).toFixed(6);
  }

  _trackCost(response, modelConfig) {
    const cost = this._calculateCost(response.usage, modelConfig);
    this.totalCost += cost;
    this.requestCount++;
    this.costLog.push({
      model: response.model || modelConfig.model,
      tokens: response.usage,
      cost,
      timestamp: new Date().toISOString(),
    });
  }

  getStats() {
    return {
      totalCost: +this.totalCost.toFixed(4),
      requestCount: this.requestCount,
      recentCosts: this.costLog.slice(-20),
    };
  }
}

module.exports = { ModelRouter, MODEL_TIERS };
