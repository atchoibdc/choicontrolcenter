// ===== OMEGA COMMAND — Server Entry Point =====
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const { AgentEngine } = require('./lib/agent-engine');
const { getAgentDefinitions } = require('./agents/definitions');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..')));

// ===== STATE =====
const engine = new AgentEngine();
const clients = new Set();
const taskHistory = [];

// ===== WebSocket Server =====
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[WS] Client connected (${clients.size} total)`);

  // Send current state on connect
  ws.send(JSON.stringify({
    type: 'init',
    agents: engine.getAgentStatuses(),
    activeTasks: engine.getActiveTasks(),
    stats: engine.getStats(),
  }));

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected (${clients.size} total)`);
  });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// Attach broadcast to engine for real-time updates
engine.on('agent:status', (data) => broadcast({ type: 'agent:status', ...data }));
engine.on('agent:progress', (data) => broadcast({ type: 'agent:progress', ...data }));
engine.on('agent:action', (data) => broadcast({ type: 'agent:action', ...data }));
engine.on('agent:message', (data) => broadcast({ type: 'agent:message', ...data }));
engine.on('agent:complete', (data) => broadcast({ type: 'agent:complete', ...data }));
engine.on('agent:error', (data) => broadcast({ type: 'agent:error', ...data }));
engine.on('stats:update', (data) => broadcast({ type: 'stats:update', ...data }));

// ===== REST API =====

// Get all agent statuses
app.get('/api/agents', (req, res) => {
  res.json({ agents: engine.getAgentStatuses() });
});

// Get a single agent's details
app.get('/api/agents/:agentId', (req, res) => {
  const agent = engine.getAgent(req.params.agentId);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json(agent);
});

// Submit a new task
app.post('/api/tasks', async (req, res) => {
  const { prompt, agentId, mode = 'tools', projectContext } = req.body;

  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

  console.log(`[API] Received task request: ${prompt.substring(0, 50)}... (Agent: ${agentId})`);
  const taskId = uuidv4();
  const task = {
    id: taskId,
    prompt,
    agentId: agentId || 'jarvis',
    mode,
    projectContext: projectContext || null,
    status: 'queued',
    createdAt: new Date().toISOString(),
  };

  taskHistory.push(task);

  // Execute task asynchronously
  console.log(`[API] Handing off task ${taskId} to engine...`);
  engine.executeTask(task).catch(err => {
    console.error(`[Task ${taskId}] Error:`, err.message);
  });

  res.json({ taskId, status: 'queued', message: 'Task submitted successfully' });
});

// Get task status
app.get('/api/tasks/:taskId', (req, res) => {
  const task = taskHistory.find(t => t.id === req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// Get task history
app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ tasks: taskHistory.slice(-limit).reverse() });
});

// Get workspace projects (directories only)
app.get('/api/workspace', (req, res) => {
  try {
    const workspacePath = engine.workspaceDir;
    if (!fs.existsSync(workspacePath)) return res.json({ projects: [] });

    const contents = fs.readdirSync(workspacePath, { withFileTypes: true });
    const projects = contents
      .filter(dirent => dirent.isDirectory())
      .map(dirent => {
        const stats = fs.statSync(path.join(workspacePath, dirent.name));
        return {
          name: dirent.name,
          modified: stats.mtime,
          created: stats.birthtime,
        };
      });

    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get stats
app.get('/api/stats', (req, res) => {
  res.json(engine.getStats());
});

// Chat with an agent (simple request/response)
app.post('/api/chat', async (req, res) => {
  const { message, agentId = 'jarvis' } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  try {
    const response = await engine.chat(agentId, message);
    res.json({ agentId, response });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'operational',
    uptime: process.uptime(),
    agents: engine.getAgentStatuses().length,
    activeTasks: engine.getActiveTasks().length,
  });
});

// ===== START =====
server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║       🎯 OMEGA COMMAND SERVER            ║');
  console.log(`  ║       Running on port ${PORT}              ║`);
  console.log('  ║       AI Agent Dashboard Backend          ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  console.log(`  🌐 Dashboard: http://localhost:${PORT}`);
  console.log(`  📡 API:       http://localhost:${PORT}/api`);
  console.log(`  🔌 WebSocket: ws://localhost:${PORT}`);
  console.log('');

  const agents = engine.getAgentStatuses();
  console.log(`  🤖 ${agents.length} agents loaded:`);
  agents.forEach(a => console.log(`     • ${a.name} — ${a.role}`));
  console.log('');
});
