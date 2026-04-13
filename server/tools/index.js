// ===== Tool Registry — Central tool management =====

const tools = new Map();

/**
 * Register a tool
 */
function registerTool(definition) {
  tools.set(definition.name, definition);
}

/**
 * Get the full registry
 */
function getToolRegistry() {
  return tools;
}

/**
 * Format tools for OpenAI-compatible function calling
 */
function formatToolsForLLM(toolList) {
  return toolList.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Execute a tool by name
 */
async function executeTool(name, args, context) {
  const tool = tools.get(name);
  if (!tool) return `Error: Tool '${name}' not found.`;

  try {
    const result = await tool.execute(args, context);
    return result;
  } catch (err) {
    return `Error executing ${name}: ${err.message}`;
  }
}

// Export first, then load tool modules to avoid circular deps
module.exports = { registerTool, getToolRegistry, formatToolsForLLM, executeTool };

// ===== LOAD ALL TOOLS (after exports to avoid circular dependency) =====
require('./file-ops');
require('./web-search');
require('./code-exec');
