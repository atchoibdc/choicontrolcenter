// ===== Agent Engine — Core Orchestration =====
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { ModelRouter } = require('./router');
const { getAgentDefinitions } = require('../agents/definitions');
const { getToolRegistry, formatToolsForLLM, executeTool } = require('../tools/index');

class AgentEngine extends EventEmitter {
  constructor() {
    super();
    this.router = new ModelRouter();
    this.agents = new Map();
    this.activeTasks = new Map();
    this.stats = {
      tasksCompleted: 0,
      creditsUsed: 0,
      startTime: Date.now(),
    };

    // Memory storage directory
    this.memoryDir = path.join(__dirname, '..', 'data', 'memory');
    this._ensureDir(this.memoryDir);

    // Workspace directory
    this.workspaceDir = path.resolve(__dirname, '..', process.env.WORKSPACE_DIR || '../workspace');
    this._ensureDir(this.workspaceDir);

    // Load agent definitions
    this._loadAgents();
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  _loadAgents() {
    const definitions = getAgentDefinitions();
    for (const def of definitions) {
      this.agents.set(def.id, {
        ...def,
        status: 'idle',
        currentTask: null,
        conversationHistory: this._loadMemory(def.id),
      });
    }
  }

  // ===== MEMORY MANAGEMENT =====
  _loadMemory(agentId) {
    const memFile = path.join(this.memoryDir, `${agentId}.json`);
    try {
      if (fs.existsSync(memFile)) {
        const data = JSON.parse(fs.readFileSync(memFile, 'utf-8'));
        // Keep last 50 messages to avoid context overflow
        return data.slice(-50);
      }
    } catch (e) {
      console.warn(`[Memory] Failed to load memory for ${agentId}:`, e.message);
    }
    return [];
  }

  _saveMemory(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    const memFile = path.join(this.memoryDir, `${agentId}.json`);
    try {
      const data = agent.conversationHistory.slice(-50);
      fs.writeFileSync(memFile, JSON.stringify(data, null, 2));
    } catch (e) {
      console.warn(`[Memory] Failed to save memory for ${agentId}:`, e.message);
    }
  }

  // ===== AGENT STATUSES =====
  getAgentStatuses() {
    return Array.from(this.agents.values()).map(a => ({
      id: a.id,
      name: a.name,
      role: a.role,
      emoji: a.emoji,
      color: a.color,
      status: a.status,
      currentTask: a.currentTask,
      tier: a.tier,
      tools: a.tools || [],
    }));
  }

  getAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      emoji: agent.emoji,
      color: agent.color,
      status: agent.status,
      currentTask: agent.currentTask,
      tier: agent.tier,
      tools: agent.tools || [],
      memorySize: agent.conversationHistory.length,
    };
  }

  getActiveTasks() {
    return Array.from(this.activeTasks.values());
  }

  getStats() {
    return {
      tasksCompleted: this.stats.tasksCompleted,
      creditsUsed: +this.stats.creditsUsed.toFixed(4),
      onlineCount: Array.from(this.agents.values()).filter(a => a.status !== 'error').length,
      totalAgents: this.agents.size,
      uptime: Math.floor((Date.now() - this.stats.startTime) / 1000),
      routerStats: this.router.getStats(),
    };
  }

  // ===== CHAT MODE (Simple Q&A) =====
  async chat(agentId, message) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    // Add user message to history
    agent.conversationHistory.push({ role: 'user', content: message });

    const messages = [
      { role: 'system', content: agent.systemPrompt },
      ...agent.conversationHistory.slice(-30),
    ];

    const result = await this.router.complete({
      tier: agent.tier,
      messages,
      temperature: 0.7,
    });

    // Add response to history
    agent.conversationHistory.push({ role: 'assistant', content: result.content });
    this._saveMemory(agentId);

    // Track cost
    this.stats.creditsUsed += result.cost || 0;
    this.emit('stats:update', this.getStats());

    return {
      content: result.content,
      model: result.model,
      cost: result.cost,
    };
  }

  // ===== TASK EXECUTION (Tools Mode) =====
  async executeTask(task) {
    const agent = this.agents.get(task.agentId);
    if (!agent) throw new Error(`Agent ${task.agentId} not found`);

    // Mark agent as working
    console.log(`[Engine] Executing task ${task.id} with agent ${task.agentId}`);
    agent.status = 'working';
    agent.currentTask = task.prompt.substring(0, 100);
    this.activeTasks.set(task.id, task);
    task.status = 'running';

    this.emit('agent:status', {
      agentId: agent.id,
      name: agent.name,
      status: 'working',
      task: agent.currentTask,
    });

    this.emit('agent:action', {
      agentId: agent.id,
      name: agent.name,
      color: agent.color,
      message: `Started: ${task.prompt.substring(0, 80)}...`,
      timestamp: new Date().toISOString(),
    });

    try {
      let result;
      if (task.mode === 'chat') {
        result = await this.chat(task.agentId, task.prompt);
        task.result = result;
      } else {
        result = await this._executeWithTools(agent, task);
        task.result = result;
      }

      task.status = 'completed';
      this.stats.tasksCompleted++;

      this.emit('agent:complete', {
        taskId: task.id,
        agentId: agent.id,
        name: agent.name,
        result: result.content || result,
      });
    } catch (err) {
      task.status = 'error';
      task.error = err.message;

      this.emit('agent:error', {
        taskId: task.id,
        agentId: agent.id,
        name: agent.name,
        error: err.message,
      });
    } finally {
      agent.status = 'idle';
      agent.currentTask = null;
      this.activeTasks.delete(task.id);

      this.emit('agent:status', {
        agentId: agent.id,
        name: agent.name,
        status: 'idle',
      });

      this.emit('stats:update', this.getStats());
    }
  }

  /**
   * Execute a task with the tool-calling loop
   */
  async _executeWithTools(agent, task) {
    const toolRegistry = getToolRegistry();
    const agentTools = (agent.tools || [])
      .filter(t => toolRegistry.has(t))
      .map(t => toolRegistry.get(t));

    const toolDefs = formatToolsForLLM(agentTools);

    // Inject Workspace Summary
    const workspaceSummary = this._getWorkspaceSummary();
    const systemContent = `${agent.systemPrompt}\n\n## Global Workspace Intelligence\n${workspaceSummary}\nAlways check the workspace using tools if you are unsure about the state of projects.`;

    // Build messages
    const messages = [
      { role: 'system', content: systemContent },
      ...agent.conversationHistory.slice(-30),
      { role: 'user', content: task.prompt },
    ];

    if (task.projectContext) {
      messages.push({
        role: 'user',
        content: `Project context:\n${task.projectContext}`,
      });
    }

    const allOutputs = [];
    let iteration = 0;
    const MAX_ITERATIONS = 10;

    while (iteration < MAX_ITERATIONS) {
      iteration++;

      this.emit('agent:progress', {
        agentId: agent.id,
        name: agent.name,
        progress: Math.min(95, (iteration / MAX_ITERATIONS) * 100),
        step: `Step ${iteration}`,
      });

      console.log(`[Engine] Calling LLM for ${agent.name} (Iteration ${iteration}, Tier ${agent.tier})...`);
      const result = await this.router.complete({
        tier: agent.tier,
        messages,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        maxTokens: 4096,
        temperature: 0.5,
      });
      console.log(`[Engine] LLM response received for ${agent.name}. Tool calls: ${result.toolCalls?.length || 0}`);

      this.stats.creditsUsed += result.cost || 0;

      // If there are tool calls, execute them
      if (result.toolCalls && result.toolCalls.length > 0) {
        // Add assistant message with tool calls
        messages.push({
          role: 'assistant',
          content: result.content || null,
          tool_calls: result.toolCalls,
        });

        for (const toolCall of result.toolCalls) {
          const toolName = toolCall.function.name;
          let toolArgs;

          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            toolArgs = {};
          }

          this.emit('agent:action', {
            agentId: agent.id,
            name: agent.name,
            color: agent.color,
            message: `Using tool: ${toolName}`,
            timestamp: new Date().toISOString(),
          });

          const toolResult = await executeTool(toolName, toolArgs, {
            workspaceDir: this.workspaceDir,
            agentId: agent.id,
          });

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
          });

          allOutputs.push({ tool: toolName, args: toolArgs, result: toolResult });
        }
      } else {
        // No tool calls — agent is done
        allOutputs.push({ content: result.content });

        // Save to memory
        agent.conversationHistory.push({ role: 'user', content: task.prompt });
        agent.conversationHistory.push({ role: 'assistant', content: result.content });
        this._saveMemory(agent.id);

        return {
          content: result.content,
          model: result.model,
          cost: this.stats.creditsUsed,
          outputs: allOutputs,
          iterations: iteration,
        };
      }
    }

    // Reached max iterations
    const finalContent = allOutputs.map(o => o.content || `Tool ${o.tool}: done`).join('\n');
    return {
      content: finalContent || 'Task completed (max iterations reached)',
      outputs: allOutputs,
      iterations: iteration,
    };
  }

  // ===== UTILS =====
  _getWorkspaceSummary() {
    try {
      if (!fs.existsSync(this.workspaceDir)) return 'Workspace is currently empty.';
      const contents = fs.readdirSync(this.workspaceDir, { withFileTypes: true });
      const projects = contents
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      
      if (projects.length === 0) return 'Workspace is currently empty.';
      return `Existing projects in /workspace: [${projects.join(', ')}].`;
    } catch (err) {
      return `Error scanning workspace: ${err.message}`;
    }
  }
}

module.exports = { AgentEngine };
