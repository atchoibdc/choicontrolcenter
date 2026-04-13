// ===== OMEGA COMMAND — App Logic with Backend Integration =====

// ===== CONFIG =====
const API_BASE = `${window.location.protocol}//${window.location.hostname}:3001`;
const WS_URL = `ws://${window.location.hostname}:3001`;

// ===== DATA: AI Agents (used for demo fallback) =====
const agents = [
  { id: 'jarvis', name: 'JARVIS', role: 'Project Lead / Orchestrator', emoji: '🤖', color: 'teal', bgClass: 'bg-teal' },
  { id: 'forge', name: 'FORGE', role: 'Web App Developer', emoji: '⚙️', color: 'teal', bgClass: 'bg-teal' },
  { id: 'bolt', name: 'BOLT', role: 'Mobile App Developer', emoji: '⚡', color: 'yellow', bgClass: 'bg-yellow' },
  { id: 'lens', name: 'LENS', role: 'SEO Specialist', emoji: '🔍', color: 'blue', bgClass: 'bg-blue' },
  { id: 'pixel', name: 'PIXEL', role: 'UI/UX Designer', emoji: '🎨', color: 'orange', bgClass: 'bg-orange' },
  { id: 'sage', name: 'SAGE', role: 'Research Analyst', emoji: '🔬', color: 'purple', bgClass: 'bg-purple' },
  { id: 'scribe', name: 'SCRIBE', role: 'Content Writer', emoji: '✍️', color: 'green', bgClass: 'bg-green' },
];

const taskPool = [
  'Writing blog post about AI trends', 'Analyzing conversion metrics',
  'Monitoring server uptime', 'Designing landing page mockup',
  'Optimizing database queries', 'Scheduling social media posts',
  'Running security audit', 'Researching market competitors',
  'Building REST API endpoints', 'Improving SEO rankings',
];

const actionVerbs = ['Writing','Analyzing','Monitoring','Generating','Optimizing','Deploying','Reviewing','Scheduling','Scanning','Researching','Compiling','Testing','Designing','Updating','Publishing'];
const actionTargets = ['blog post about AI automation','social media content for Q2','server performance metrics','landing page conversion rates','customer support response templates','weekly analytics report','email newsletter for subscribers','security vulnerability scan','competitor pricing analysis','database backup verification'];

// ===== STATE =====
let isConnected = false;
let ws = null;
let activeAgents = [];
let activityLog = [];
let statsData = { tasks: 0, credits: 0, onlineCount: 7, totalAgents: 7 };
let currentMode = 'tools';
let officeAnimFrame = null;

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initTaskForm();
  initModeToggle();
  connectWebSocket();
  
  // Set up agents with idle state initially
  activeAgents = agents.map(agent => ({
    ...agent,
    status: 'idle',
    progress: 0,
    subtask: ''
  }));
  renderAgentList();
  
  // Empty activity feed by default
  activityLog = [];
  renderActivityFeed();
  
  renderChat();
  renderOrgChart();
  renderMemory();
  renderHistory();
  renderProjects();
  initOffice();
  initRefreshButtons();

  // ONLY start simulation if we are still not connected after a short delay
  setTimeout(() => {
    if (!isConnected) {
      console.log('[Demo] Starting background simulation...');
      setInterval(() => { if (!isConnected) updateAgentProgress(); }, 3000);
      setInterval(() => { if (!isConnected) addNewActivity(); }, 8000); // Slower updates
      setInterval(() => { if (!isConnected) updateStatCounters(); }, 10000);
    }
  }, 2000);
});

// ===== WebSocket Connection =====
function connectWebSocket() {
  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      isConnected = true;
      updateConnectionStatus('connected', 'Connected to server — Live mode');
      activityLog = []; // CLEAR FAKE INITIAL HISTORY ON CONNECT
      renderActivityFeed();
      console.log('[WS] Connected to OMEGA COMMAND server');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
      } catch (e) {
        console.warn('[WS] Failed to parse message:', e);
      }
    };

    ws.onclose = () => {
      isConnected = false;
      updateConnectionStatus('demo', 'Server offline — Demo mode (start server with: cd server && npm start)');
      console.log('[WS] Disconnected. Running in demo mode.');
      setTimeout(connectWebSocket, 5000); // Retry
    };

    ws.onerror = () => {
      isConnected = false;
      updateConnectionStatus('demo', 'Server offline — Demo mode (start server with: cd server && npm start)');
    };
  } catch {
    isConnected = false;
    updateConnectionStatus('demo', 'Server offline — Demo mode');
  }
}

function updateConnectionStatus(status, text) {
  const bar = document.getElementById('connectionBar');
  const textEl = document.getElementById('connectionText');
  bar.className = `connection-bar ${status}`;
  textEl.textContent = text;
}

function handleServerMessage(data) {
  switch (data.type) {
    case 'init':
      // Merge server agents with our display data
      if (data.agents) {
        activeAgents = data.agents.map(a => {
          const local = agents.find(l => l.id === a.id) || {};
          return { ...local, ...a, bgClass: local.bgClass || 'bg-teal', status: a.status || 'idle', progress: 0 };
        });
        renderAgentList();
      }
      if (data.stats) {
        statsData.tasks = data.stats.tasksCompleted || 0;
        statsData.credits = data.stats.creditsUsed || 0;
        statsData.onlineCount = data.stats.onlineCount || 7;
        statsData.totalAgents = data.stats.totalAgents || 7;
        updateStatDisplay();
      }
      break;

    case 'agent:status':
      updateAgentStatus(data);
      break;

    case 'agent:progress':
      updateAgentProgressFromServer(data);
      break;

    case 'agent:action':
      addActivityFromServer(data);
      break;

    case 'agent:complete':
      showTaskResult(data);
      break;

    case 'agent:error':
      showTaskError(data);
      break;

    case 'stats:update':
      if (data.tasksCompleted !== undefined) statsData.tasks = data.tasksCompleted;
      if (data.creditsUsed !== undefined) statsData.credits = data.creditsUsed;
      if (data.onlineCount !== undefined) statsData.onlineCount = data.onlineCount;
      if (data.totalAgents !== undefined) statsData.totalAgents = data.totalAgents;
      updateStatDisplay();
      break;
  }
}

// ===== HISTORY =====
async function renderHistory() {
  if (!isConnected) return;
  try {
    const response = await fetch(`${API_BASE}/api/history`);
    const data = await response.json();
    updateHistoryDisplay(data.tasks || []);
  } catch (err) {
    console.error('[History] Failed to fetch:', err);
  }
}

function updateHistoryDisplay(tasks) {
  const container = document.getElementById('historyList');
  if (!tasks || tasks.length === 0) {
    container.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 2rem; opacity: 0.5;">No history available yet.</td></tr>';
    return;
  }

  container.innerHTML = tasks.map(task => {
    const timeStr = new Date(task.createdAt).toLocaleString('en-US', { 
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false 
    });
    const agent = agents.find(a => a.id === task.agentId) || { name: task.agentId, color: 'teal' };
    const statusClass = task.status === 'completed' ? 'working' : (task.status === 'error' ? 'idle' : 'working');
    
    return `
      <tr>
        <td class="history-time">${timeStr}</td>
        <td><span class="history-agent" style="color: var(--accent-${agent.color})">${agent.name}</span></td>
        <td class="history-task" title="${task.prompt}">${task.prompt}</td>
        <td><span class="agent-status-badge ${statusClass}">${task.status}</span></td>
      </tr>
    `;
  }).join('');
}

// ===== PROJECTS =====
async function renderProjects() {
  if (!isConnected) return;
  try {
    const response = await fetch(`${API_BASE}/api/workspace`);
    const data = await response.json();
    updateProjectsDisplay(data.projects || []);
  } catch (err) {
    console.error('[Projects] Failed to fetch:', err);
  }
}

function updateProjectsDisplay(projects) {
  const container = document.getElementById('projectsGrid');
  if (!projects || projects.length === 0) {
    container.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding: 4rem; opacity: 0.5;">Workspace is empty. Submit tasks to create projects!</div>';
    return;
  }

  container.innerHTML = projects.map(project => {
    const modDate = new Date(project.modified).toLocaleDateString();
    return `
      <div class="project-card">
        <div class="project-icon">📂</div>
        <div class="project-name">${project.name}</div>
        <div class="project-meta">
          <span>Created: <b>${new Date(project.created).toLocaleDateString()}</b></span>
          <span>Modified: <b>${modDate}</b></span>
        </div>
      </div>
    `;
  }).join('');
}

function initRefreshButtons() {
  document.getElementById('refreshHistory').addEventListener('click', renderHistory);
  document.getElementById('refreshProjects').addEventListener('click', renderProjects);
}

function updateAgentStatus(data) {
  const agent = activeAgents.find(a => a.id === data.agentId);
  if (agent) {
    agent.status = data.status;
    agent.currentTask = data.task || null;
    renderAgentList();
  }
}

function updateAgentProgressFromServer(data) {
  const agent = activeAgents.find(a => a.id === data.agentId);
  if (agent) {
    agent.progress = data.progress || 0;
    agent.subtask = data.step || '';
    const bar = document.getElementById(`progress-${agent.id}`);
    if (bar) bar.style.width = `${agent.progress}%`;
  }
}

function addActivityFromServer(data) {
  const timeStr = new Date(data.timestamp || Date.now()).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  activityLog.unshift({
    time: timeStr,
    agent: data.name,
    message: data.message,
    color: data.color || 'teal',
  });
  if (activityLog.length > 50) activityLog.pop();
  renderActivityFeed();
}

function showTaskResult(data) {
  const panel = document.getElementById('taskResultPanel');
  const content = document.getElementById('taskResultContent');
  panel.style.display = 'block';
  content.innerHTML = `<strong style="color: var(--accent-teal)">${data.name}</strong> completed the task:\n\n${data.result || 'Task completed successfully.'}`;

  // Re-enable submit button
  const btn = document.getElementById('taskSubmitBtn');
  btn.disabled = false;
  btn.querySelector('span:first-child').textContent = 'Submit Task';
}

function showTaskError(data) {
  const panel = document.getElementById('taskResultPanel');
  const content = document.getElementById('taskResultContent');
  panel.style.display = 'block';
  content.innerHTML = `<strong style="color: var(--accent-red)">❌ ${data.name}</strong> encountered an error:\n\n${data.error || 'Unknown error'}`;

  const btn = document.getElementById('taskSubmitBtn');
  btn.disabled = false;
  btn.querySelector('span:first-child').textContent = 'Submit Task';
}

// ===== TASK FORM =====
function initTaskForm() {
  const submitBtn = document.getElementById('taskSubmitBtn');
  const taskInput = document.getElementById('taskInput');
  const closeBtn = document.getElementById('closeResultBtn');

  submitBtn.addEventListener('click', submitTask);
  taskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitTask(); }
  });
  closeBtn.addEventListener('click', () => {
    document.getElementById('taskResultPanel').style.display = 'none';
  });
}

async function submitTask() {
  const taskInput = document.getElementById('taskInput');
  const agentSelect = document.getElementById('agentSelect');
  const submitBtn = document.getElementById('taskSubmitBtn');
  const prompt = taskInput.value.trim();

  if (!prompt) return;

  submitBtn.disabled = true;
  submitBtn.querySelector('span:first-child').textContent = 'Working...';

  if (isConnected) {
    // Real backend submission
    try {
      const response = await fetch(`${API_BASE}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          agentId: agentSelect.value,
          mode: currentMode,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Server error');

      taskInput.value = '';
      addActivityFromServer({
        name: agents.find(a => a.id === agentSelect.value)?.name || 'AGENT',
        message: `Task submitted: ${prompt.substring(0, 60)}...`,
        color: agents.find(a => a.id === agentSelect.value)?.color || 'teal',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      showTaskError({ name: 'SYSTEM', error: err.message });
    }
  } else {
    // Demo mode — simulate a response
    const agent = agents.find(a => a.id === agentSelect.value) || agents[0];
    taskInput.value = '';

    addActivityFromServer({
      name: agent.name,
      message: `[Demo] Processing: ${prompt.substring(0, 60)}...`,
      color: agent.color,
      timestamp: new Date().toISOString(),
    });

    setTimeout(() => {
      showTaskResult({
        name: agent.name,
        result: `[Demo Mode] This is a simulated response from ${agent.name}.\n\nTo get real AI responses, start the backend server:\n\n  1. cd server\n  2. npm install\n  3. Add your OpenRouter API key to .env\n  4. npm start\n\nThe dashboard will auto-connect when the server is running.`,
      });
    }, 2000);
  }
}

// ===== MODE TOGGLE =====
function initModeToggle() {
  document.getElementById('modeTools').addEventListener('click', () => setMode('tools'));
  document.getElementById('modeChat').addEventListener('click', () => setMode('chat'));
}

function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-mode="${mode}"]`).classList.add('active');
}

// ===== TAB SWITCHING =====
function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'office') startOfficeAnimation();
      else cancelAnimationFrame(officeAnimFrame);
      
      if (btn.dataset.tab === 'history') renderHistory();
      if (btn.dataset.tab === 'projects') renderProjects();
    });
  });
}

// ===== AGENTS =====
function initAgentsDemo() {
  activeAgents = agents.map(agent => ({
    ...agent,
    status: Math.random() > 0.3 ? 'working' : 'idle',
    task: taskPool[Math.floor(Math.random() * taskPool.length)],
    currentTask: taskPool[Math.floor(Math.random() * taskPool.length)],
    progress: Math.floor(Math.random() * 85) + 10,
    subtask: `Step ${Math.floor(Math.random() * 5) + 1} of ${Math.floor(Math.random() * 4) + 5}`,
  }));
}

function renderAgentList() {
  const container = document.getElementById('agentList');
  const progressColors = ['teal', 'blue', 'purple', 'green', 'orange'];
  container.innerHTML = activeAgents.map((agent, i) => {
    const task = agent.currentTask || agent.task || 'Awaiting task';
    return `
    <div class="agent-card">
      <div class="agent-top">
        <div class="agent-avatar ${agent.bgClass || 'bg-teal'} ${agent.status === 'working' ? 'online' : ''}">
          ${agent.emoji}
        </div>
        <div class="agent-details">
          <div class="agent-name">${agent.name}</div>
          <div class="agent-role">${agent.role}</div>
        </div>
        <span class="agent-status-badge ${agent.status}">${agent.status}</span>
      </div>
      ${agent.status === 'working' ? `
        <div class="agent-task"><span class="task-label">Task:</span> ${task}</div>
        <div class="progress-bar-container">
          <div class="progress-bar ${progressColors[i % progressColors.length]}" style="width: ${agent.progress || 0}%" id="progress-${agent.id}"></div>
        </div>
        <div class="progress-info">
          <span class="progress-text">${agent.subtask || ''}</span>
          <span class="progress-text">${agent.progress || 0}%</span>
        </div>
      ` : `
        <div class="agent-task"><span class="task-label">Status:</span> On standby — awaiting next assignment</div>
      `}
    </div>`;
  }).join('');

  document.getElementById('workingCount').textContent = `${activeAgents.filter(a => a.status === 'working').length} agents`;
}

function updateAgentProgress() {
  activeAgents.forEach(agent => {
    if (agent.status === 'working') {
      agent.progress = Math.min(100, (agent.progress || 0) + Math.floor(Math.random() * 5) + 1);
      const bar = document.getElementById(`progress-${agent.id}`);
      if (bar) bar.style.width = `${agent.progress}%`;
      if (agent.progress >= 100) {
        agent.status = 'idle';
        setTimeout(() => {
          agent.status = 'working';
          agent.progress = Math.floor(Math.random() * 15) + 5;
          agent.currentTask = taskPool[Math.floor(Math.random() * taskPool.length)];
          agent.subtask = `Step 1 of ${Math.floor(Math.random() * 4) + 5}`;
          renderAgentList();
        }, 3000);
      }
    }
  });
  activeAgents.forEach(agent => {
    const card = document.querySelector(`#progress-${agent.id}`)?.closest('.agent-card');
    if (card) {
      const texts = card.querySelectorAll('.progress-text');
      if (texts[1]) texts[1].textContent = `${agent.progress}%`;
    }
  });
}

// ===== STATS =====
function updateStatDisplay() {
  document.getElementById('statTasks').textContent = statsData.tasks;
  document.getElementById('statCredits').textContent = `$${(+statsData.credits).toFixed(2)}`;
  document.getElementById('statAgents').textContent = `${statsData.onlineCount}/${statsData.totalAgents}`;
}

function updateStatCounters() {
  statsData.tasks += Math.floor(Math.random() * 3);
  statsData.credits += +(Math.random() * 0.5).toFixed(2);
  updateStatDisplay();
}

// ===== ACTIVITY FEED =====
function generateInitialActivity() {
  for (let i = 0; i < 20; i++) activityLog.push(createActivityEntry(i));
}

function createActivityEntry(minutesAgo = 0) {
  const agent = agents[Math.floor(Math.random() * agents.length)];
  const verb = actionVerbs[Math.floor(Math.random() * actionVerbs.length)];
  const target = actionTargets[Math.floor(Math.random() * actionTargets.length)];
  const now = new Date(); now.setMinutes(now.getMinutes() - minutesAgo);
  return {
    time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
    agent: agent.name, message: `${verb} ${target}`, color: agent.color,
  };
}

function renderActivityFeed() {
  const container = document.getElementById('activityFeed');
  container.innerHTML = activityLog.slice(0, 25).map(entry => `
    <div class="activity-item">
      <span class="activity-time">${entry.time}</span>
      <div class="activity-dot ${entry.color}"></div>
      <div class="activity-content">
        <span class="activity-agent" style="color: var(--accent-${entry.color})">${entry.agent}</span>
        <div class="activity-message">${entry.message}</div>
      </div>
    </div>
  `).join('');
}

function addNewActivity() {
  if (isConnected) return; // DON'T ADD FAKE ACTIVITY IF CONNECTED
  activityLog.unshift(createActivityEntry(0));
  if (activityLog.length > 50) activityLog.pop();
  renderActivityFeed();
}

// ===== CHAT =====
const chatChannels = [
  { name: '# general', icon: '💬', unread: 3 },
  { name: '# content-team', icon: '📝', unread: 1 },
  { name: '# dev-ops', icon: '⚙️', unread: 0 },
  { name: '# marketing', icon: '📣', unread: 2 },
  { name: '# security', icon: '🔐', unread: 0 },
  { name: '# design', icon: '🎨', unread: 0 },
  { name: '# research', icon: '🔬', unread: 1 },
];

const chatMessages = [
  { type: 'system', text: '🤖 System initialized — All agents connected to OMEGA COMMAND' },
  { agent: agents[0], text: 'Good morning team. Running the daily orchestration cycle. All systems nominal.', time: '09:00' },
  { agent: agents[1], text: 'Ready for build tasks. Current project queue is clear.', time: '09:02' },
  { agent: agents[3], text: '🟢 All services healthy. Uptime: 99.97% over the last 30 days. No incidents to report.', time: '09:05' },
  { agent: agents[5], text: 'Weekly analytics summary ready. Key highlights: 23% increase in organic traffic.', time: '09:08' },
  { agent: agents[6], text: 'Started drafting "The Future of AI Agents in Business" — ETA 45 minutes.', time: '09:14' },
  { agent: agents[4], text: 'Landing page A/B test variant B is outperforming by 12%. Recommending we switch.', time: '09:20' },
  { agent: agents[2], text: 'Mobile build pipeline verified. React Native 0.76 ready for deployment.', time: '09:25' },
  { type: 'system', text: '📊 Daily standup complete — 7 agents reported status' },
];

function renderChat() {
  const channelContainer = document.getElementById('chatChannels');
  channelContainer.innerHTML = chatChannels.map((ch, i) => `
    <div class="chat-channel ${i === 0 ? 'active' : ''}" data-channel="${i}">
      <span class="channel-icon">${ch.icon}</span>
      ${ch.name}
      ${ch.unread > 0 ? `<span class="unread">${ch.unread}</span>` : ''}
    </div>
  `).join('');

  channelContainer.querySelectorAll('.chat-channel').forEach(ch => {
    ch.addEventListener('click', () => {
      channelContainer.querySelectorAll('.chat-channel').forEach(c => c.classList.remove('active'));
      ch.classList.add('active');
      document.getElementById('chatTitle').textContent = chatChannels[+ch.dataset.channel].name;
    });
  });

  const msgContainer = document.getElementById('chatMessages');
  msgContainer.innerHTML = chatMessages.map(msg => {
    if (msg.type === 'system') return `<div class="chat-message system"><div class="chat-msg-text system-text">${msg.text}</div></div>`;
    return `
      <div class="chat-message">
        <div class="chat-msg-avatar ${msg.agent.bgClass}">${msg.agent.emoji}</div>
        <div class="chat-msg-body">
          <div class="chat-msg-header">
            <span class="chat-msg-name" style="color: var(--accent-${msg.agent.color})">${msg.agent.name}</span>
            <span class="chat-msg-time">${msg.time}</span>
          </div>
          <div class="chat-msg-text">${msg.text}</div>
        </div>
      </div>`;
  }).join('');
  msgContainer.scrollTop = msgContainer.scrollHeight;

  document.getElementById('chatSendBtn').addEventListener('click', sendChat);
  document.getElementById('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
}

async function sendChat() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  const msgContainer = document.getElementById('chatMessages');
  const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  msgContainer.insertAdjacentHTML('beforeend', `
    <div class="chat-message">
      <div class="chat-msg-avatar bg-teal" style="background: linear-gradient(135deg, var(--accent-teal), var(--accent-blue)); color: white;">👑</div>
      <div class="chat-msg-body">
        <div class="chat-msg-header">
          <span class="chat-msg-name" style="color: var(--accent-teal)">numbaJuan <span style="font-size: 0.7em; opacity: 0.7; font-weight: normal;">(CEO)</span></span>
          <span class="chat-msg-time">${now}</span>
        </div>
        <div class="chat-msg-text">${text}</div>
      </div>
    </div>`);
  msgContainer.scrollTop = msgContainer.scrollHeight;

  // Try real backend chat, otherwise demo
  if (isConnected) {
    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, agentId: 'jarvis' }),
      });
      const data = await response.json();
      appendAgentChatReply(agents[0], data.response?.content || data.response || 'No response');
    } catch {
      appendAgentChatReply(agents[0], '[Connection error — server may be unavailable]');
    }
  } else {
    const responder = agents[Math.floor(Math.random() * agents.length)];
    const replies = [
      'Acknowledged. I\'ll factor that into my current workflow.',
      'Understood. Processing your request now.',
      'Got it! I\'m on it. Will report back shortly.',
      'Noted. This aligns with my current objectives.',
      'Copy that. Adjusting priorities accordingly.',
    ];
    setTimeout(() => {
      appendAgentChatReply(responder, replies[Math.floor(Math.random() * replies.length)]);
    }, 1200);
  }
}

function appendAgentChatReply(agent, text) {
  const msgContainer = document.getElementById('chatMessages');
  const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  msgContainer.insertAdjacentHTML('beforeend', `
    <div class="chat-message">
      <div class="chat-msg-avatar ${agent.bgClass}">${agent.emoji}</div>
      <div class="chat-msg-body">
        <div class="chat-msg-header">
          <span class="chat-msg-name" style="color: var(--accent-${agent.color})">${agent.name}</span>
          <span class="chat-msg-time">${now}</span>
        </div>
        <div class="chat-msg-text">${text}</div>
      </div>
    </div>`);
  msgContainer.scrollTop = msgContainer.scrollHeight;
}

// ===== ORG CHART =====
function renderOrgChart() {
  document.getElementById('orgChart').innerHTML = `
    <div class="org-level">
      <div class="org-node ceo">
        <div class="org-avatar bg-teal" style="background: linear-gradient(135deg, var(--accent-teal), var(--accent-blue)); color: white; font-size: 1.8rem;">👑</div>
        <div class="org-name">numbaJuan</div>
        <div class="org-role">CEO / Founder</div>
        <div class="org-status">Online</div>
      </div>
    </div>
    <div class="org-level-connector"></div>
    <div class="org-branch-line" style="width: 0%"></div>
    <div class="org-level">
      <div class="org-node" style="border-color: var(--accent-teal); box-shadow: 0 0 10px rgba(45, 212, 191, 0.1);">
        <div class="org-avatar bg-teal">🤖</div>
        <div class="org-name">JARVIS</div>
        <div class="org-role">Project Lead / Orchestrator</div>
        <div class="org-status">Online</div>
      </div>
    </div>
    <div class="org-level-connector"></div>
    <div class="org-branch-line" style="width: 60%"></div>
    <div class="org-level">
      <div class="org-node"><div class="org-avatar bg-teal">⚙️</div><div class="org-name">FORGE</div><div class="org-role">Web App Developer</div><div class="org-status">Online</div></div>
      <div class="org-node"><div class="org-avatar bg-yellow">⚡</div><div class="org-name">BOLT</div><div class="org-role">Mobile App Developer</div><div class="org-status">Online</div></div>
      <div class="org-node"><div class="org-avatar bg-orange">🎨</div><div class="org-name">PIXEL</div><div class="org-role">UI/UX Designer</div><div class="org-status">Online</div></div>
    </div>
    <div class="org-level-connector"></div>
    <div class="org-branch-line" style="width: 50%"></div>
    <div class="org-level">
      <div class="org-node"><div class="org-avatar bg-blue">🔍</div><div class="org-name">LENS</div><div class="org-role">SEO Specialist</div><div class="org-status">Online</div></div>
      <div class="org-node"><div class="org-avatar bg-purple">🔬</div><div class="org-name">SAGE</div><div class="org-role">Research Analyst</div><div class="org-status">Online</div></div>
      <div class="org-node"><div class="org-avatar bg-green">✍️</div><div class="org-name">SCRIBE</div><div class="org-role">Content Writer</div><div class="org-status">Online</div></div>
    </div>`;
}

// ===== MEMORY =====
const memoryCategories = [
  { name: 'All Memories', icon: '📚', count: 42, id: 'all' },
  { name: 'Research', icon: '🔬', count: 12, id: 'research' },
  { name: 'Analytics', icon: '📊', count: 8, id: 'analytics' },
  { name: 'Content', icon: '📝', count: 10, id: 'content' },
  { name: 'Security', icon: '🔐', count: 5, id: 'security' },
  { name: 'Engineering', icon: '⚙️', count: 7, id: 'engineering' },
];

const memoryData = [
  { agent: agents[5], time: '2 min ago', content: 'Competitor analysis complete: Company X launched a freemium tier. Recommend we evaluate our pricing strategy.', tags: ['research', 'strategy'], category: 'research' },
  { agent: agents[3], time: '8 min ago', content: 'Traffic spike detected on /pricing page — 340% increase from LinkedIn referral. Conversion holding at 4.2%.', tags: ['analytics', 'traffic'], category: 'analytics' },
  { agent: agents[6], time: '15 min ago', content: 'Blog post "The Future of AI Agents" completed. 2,847 words. SEO score: 94/100. Ready for review.', tags: ['content', 'blog'], category: 'content' },
  { agent: agents[1], time: '30 min ago', content: 'API v2.4.1 deployed. New endpoints: /analytics/realtime, /agents/status. Response time improved 18%.', tags: ['engineering', 'api'], category: 'engineering' },
  { agent: agents[3], time: '45 min ago', content: 'SEO keyword gap analysis: 23 high-volume keywords where competitors rank but we don\'t.', tags: ['research', 'seo'], category: 'research' },
  { agent: agents[4], time: '1 hr ago', content: 'Homepage redesign variant B finalized. A/B test starting tomorrow.', tags: ['content', 'design'], category: 'content' },
  { agent: agents[2], time: '1.5 hrs ago', content: 'React Native build pipeline verified. iOS and Android release builds passing all tests.', tags: ['engineering', 'mobile'], category: 'engineering' },
  { agent: agents[0], time: '2 hrs ago', content: 'Daily orchestration plan updated. Priority: 60% content, 20% engineering, 20% analytics.', tags: ['strategy', 'planning'], category: 'research' },
];

function renderMemory() {
  const catContainer = document.getElementById('memoryCategories');
  catContainer.innerHTML = memoryCategories.map((cat, i) => `
    <div class="memory-category ${i === 0 ? 'active' : ''}" data-category="${cat.id}">
      <span><span class="memory-category-icon">${cat.icon}</span> ${cat.name}</span>
      <span class="memory-category-count">${cat.count}</span>
    </div>
  `).join('');

  catContainer.querySelectorAll('.memory-category').forEach(cat => {
    cat.addEventListener('click', () => {
      catContainer.querySelectorAll('.memory-category').forEach(c => c.classList.remove('active'));
      cat.classList.add('active');
      renderMemoryEntries(cat.dataset.category);
    });
  });
  renderMemoryEntries('all');

  document.getElementById('memorySearch').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const active = catContainer.querySelector('.memory-category.active')?.dataset.category || 'all';
    renderMemoryEntries(active, q);
  });
}

function renderMemoryEntries(category = 'all', search = '') {
  let filtered = category === 'all' ? memoryData : memoryData.filter(m => m.category === category);
  if (search) filtered = filtered.filter(m => m.content.toLowerCase().includes(search) || m.agent.name.toLowerCase().includes(search));
  document.getElementById('memoryEntries').innerHTML = filtered.map(e => `
    <div class="memory-entry">
      <div class="memory-entry-header">
        <span class="memory-entry-agent" style="color: var(--accent-${e.agent.color})">${e.agent.emoji} ${e.agent.name}</span>
        <span class="memory-entry-time">${e.time}</span>
      </div>
      <div class="memory-entry-content">${e.content}</div>
      <div class="memory-entry-tags">${e.tags.map(t => `<span class="memory-tag">${t}</span>`).join('')}</div>
    </div>
  `).join('');
}

// ===== PIXEL ART OFFICE =====
const officeState = { agents: [], frame: 0 };
const COLORS = {
  floor: '#1a1f2e', floorTile: '#1e2538', wall: '#252d42', wallAccent: '#2d3754',
  desk: '#3d4a5c', deskTop: '#4a5a72', monitor: '#0f172a', monitorScreen: '#22d3ee',
  chair: '#374151', plant: '#22c55e', plantPot: '#78350f', kitchen: '#2a1f1a',
  coffeeTable: '#4a3728', coffee: '#8b5e3c', window: '#1e293b', windowGlow: '#3b82f6',
  labelBg: 'rgba(0,0,0,0.6)', labelText: '#94a3b8',
};

function initOffice() {
  officeState.agents = agents.map((agent, i) => {
    const isWorking = Math.random() > 0.3;
    const deskX = 80 + (i % 4) * 200;
    const deskY = isWorking ? (i < 4 ? 140 : 260) : 420;
    return { ...agent, x: deskX, y: deskY, targetX: deskX, targetY: deskY, isWorking, bobOffset: Math.random() * Math.PI * 2, speed: 0.3 + Math.random() * 0.4 };
  });
  setInterval(() => {
    officeState.agents.forEach((agent, i) => {
      if (Math.random() < 0.03) {
        agent.isWorking = !agent.isWorking;
        const deskX = 80 + (i % 4) * 200;
        if (agent.isWorking) { agent.targetX = deskX; agent.targetY = i < 4 ? 140 : 260; }
        else { agent.targetX = 350 + (Math.random() - 0.5) * 200; agent.targetY = 400 + Math.random() * 50; }
      }
    });
  }, 3000);
}

function startOfficeAnimation() {
  function draw() {
    const canvas = document.getElementById('officeCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    officeState.frame++;
    ctx.fillStyle = COLORS.floor; ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let x = 0; x < canvas.width; x += 40) for (let y = 0; y < canvas.height; y += 40) if ((x / 40 + y / 40) % 2 === 0) { ctx.fillStyle = COLORS.floorTile; ctx.fillRect(x, y, 40, 40); }
    ctx.fillStyle = COLORS.wall; ctx.fillRect(0, 0, canvas.width, 80);
    ctx.fillStyle = COLORS.wallAccent; ctx.fillRect(0, 75, canvas.width, 5);
    for (let i = 0; i < 5; i++) { const wx = 80 + i * 180; ctx.fillStyle = COLORS.window; ctx.fillRect(wx, 10, 70, 55); ctx.fillStyle = COLORS.windowGlow; ctx.fillRect(wx + 3, 13, 30, 22); ctx.fillRect(wx + 37, 13, 30, 22); ctx.fillRect(wx + 3, 39, 30, 22); ctx.fillRect(wx + 37, 39, 30, 22); }
    ctx.fillStyle = COLORS.labelBg; ctx.fillRect(20, 90, 120, 22); ctx.font = '11px "JetBrains Mono", monospace'; ctx.fillStyle = COLORS.labelText; ctx.fillText('💻 WORKSTATIONS', 28, 105);
    ctx.fillStyle = COLORS.labelBg; ctx.fillRect(20, 380, 100, 22); ctx.fillStyle = COLORS.labelText; ctx.fillText('☕ KITCHEN', 28, 395);
    ctx.fillStyle = COLORS.kitchen; ctx.fillRect(600, 380, 280, 8);
    ctx.fillStyle = COLORS.coffeeTable; ctx.fillRect(620, 410, 60, 40); ctx.fillRect(720, 410, 60, 40);
    ctx.fillStyle = COLORS.coffee; ctx.fillRect(635, 418, 12, 14); ctx.fillRect(655, 418, 12, 14); ctx.fillRect(735, 418, 12, 14);
    [[20, 120], [860, 120], [20, 340], [860, 340]].forEach(([px, py]) => { ctx.fillStyle = COLORS.plantPot; ctx.fillRect(px, py + 12, 16, 12); ctx.fillStyle = COLORS.plant; ctx.fillRect(px + 2, py, 12, 14); ctx.fillRect(px - 2, py + 4, 6, 8); ctx.fillRect(px + 14, py + 4, 6, 8); });
    for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) { const dx = 60 + col * 200; const dy = row === 0 ? 160 : 280; ctx.fillStyle = COLORS.desk; ctx.fillRect(dx, dy, 100, 35); ctx.fillStyle = COLORS.deskTop; ctx.fillRect(dx, dy, 100, 4); ctx.fillStyle = COLORS.monitor; ctx.fillRect(dx + 30, dy - 25, 40, 25); const g = 0.5 + 0.5 * Math.sin(officeState.frame * 0.03 + col + row * 4); ctx.fillStyle = `rgba(34,211,238,${g * 0.7})`; ctx.fillRect(dx + 33, dy - 22, 34, 19); ctx.fillStyle = COLORS.monitor; ctx.fillRect(dx + 47, dy - 1, 6, 4); ctx.fillStyle = COLORS.chair; ctx.fillRect(dx + 38, dy + 38, 24, 18); ctx.fillRect(dx + 42, dy + 56, 16, 6); }
    const agentColors = { teal: '#c084fc', blue: '#fb7185', purple: '#e879f9', red: '#f87171', orange: '#fb923c', cyan: '#818cf8', green: '#34d399', yellow: '#fbbf24' };
    officeState.agents.forEach(agent => {
      const dx = agent.targetX - agent.x, dy = agent.targetY - agent.y, dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 2) { agent.x += (dx / dist) * agent.speed * 2; agent.y += (dy / dist) * agent.speed * 2; }
      const bob = Math.sin(officeState.frame * 0.05 + agent.bobOffset) * (agent.isWorking ? 1 : 2);
      const ax = Math.round(agent.x), ay = Math.round(agent.y + bob);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(ax - 1, ay + 18, 22, 4);
      const bc = agentColors[agent.color] || '#2dd4bf';
      ctx.fillStyle = '#fbbf24'; ctx.fillRect(ax + 5, ay - 4, 10, 10);
      ctx.fillStyle = bc; ctx.fillRect(ax + 3, ay + 6, 14, 12);
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; const nw = ctx.measureText(agent.name).width + 6; ctx.fillRect(ax + 10 - nw / 2, ay - 16, nw, 12);
      ctx.font = '8px "JetBrains Mono", monospace'; ctx.fillStyle = bc; ctx.fillText(agent.name, ax + 10 - nw / 2 + 3, ay - 7);
      ctx.fillStyle = agent.isWorking ? '#22c55e' : '#eab308'; ctx.fillRect(ax + 16, ay - 2, 5, 5);
    });
    officeAnimFrame = requestAnimationFrame(draw);
  }
  cancelAnimationFrame(officeAnimFrame);
  draw();
}
