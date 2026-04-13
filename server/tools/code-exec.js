// ===== Code Execution Tool — Sandboxed Node.js subprocess =====
const { execSync } = require('child_process');
const path = require('path');
const { registerTool } = require('./index');

registerTool({
  name: 'execute_code',
  description: 'Execute a shell command in the workspace directory. Use for running Node.js scripts, installing packages (npm install), running build commands, etc. Commands are sandboxed to the workspace directory.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute (e.g., "node script.js", "npm install express", "npm run build")',
      },
      workingDir: {
        type: 'string',
        description: 'Optional. Subdirectory within workspace to run the command in (e.g., "my-project")',
      },
    },
    required: ['command'],
  },
  async execute(args, context) {
    // Deny dangerous commands
    const blocked = ['rm -rf /', 'format', 'del /s', 'shutdown', 'reboot', 'mkfs', 'dd if='];
    if (blocked.some(b => args.command.toLowerCase().includes(b))) {
      return 'Error: This command is blocked for safety reasons.';
    }

    const cwd = args.workingDir
      ? path.resolve(context.workspaceDir, args.workingDir)
      : context.workspaceDir;

    // Ensure cwd is within workspace
    if (!cwd.startsWith(path.resolve(context.workspaceDir))) {
      return 'Error: Working directory must be within the workspace.';
    }

    try {
      const output = execSync(args.command, {
        cwd,
        timeout: 60000, // 60 second timeout
        maxBuffer: 1024 * 1024, // 1MB output buffer
        encoding: 'utf-8',
        windowsHide: true,
        env: { ...process.env, NODE_ENV: 'development' },
      });

      const trimmed = output.length > 4000
        ? output.substring(0, 4000) + '\n\n... [Output truncated]'
        : output;

      return `Command executed successfully:\n\`\`\`\n${trimmed}\n\`\`\``;
    } catch (err) {
      const stderr = err.stderr || err.message || 'Unknown error';
      const trimmedErr = stderr.length > 2000
        ? stderr.substring(0, 2000) + '\n... [Error truncated]'
        : stderr;

      return `Command failed:\n\`\`\`\n${trimmedErr}\n\`\`\``;
    }
  },
});
