// ===== File Operations Tool =====
const fs = require('fs');
const path = require('path');
const { registerTool } = require('./index');

// ===== READ FILE =====
registerTool({
  name: 'read_file',
  description: 'Read the contents of a file. Returns the file content as text.',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Relative path to the file from the workspace root (e.g., "src/index.js")',
      },
    },
    required: ['filePath'],
  },
  async execute(args, context) {
    const fullPath = _resolveSafe(args.filePath, context.workspaceDir);
    if (!fullPath) return 'Error: Path is outside the workspace.';
    if (!fs.existsSync(fullPath)) return `Error: File not found: ${args.filePath}`;
    const content = fs.readFileSync(fullPath, 'utf-8');
    const maxLength = 8000;
    if (content.length > maxLength) {
      return content.substring(0, maxLength) + `\n\n... [Truncated. File is ${content.length} characters.]`;
    }
    return content;
  },
});

// ===== WRITE FILE =====
registerTool({
  name: 'write_file',
  description: 'Write content to a file. Creates the file if it does not exist, or overwrites if it does. Also creates any necessary parent directories.',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Relative path to the file from the workspace root (e.g., "src/App.jsx")',
      },
      content: {
        type: 'string',
        description: 'The full content to write to the file',
      },
    },
    required: ['filePath', 'content'],
  },
  async execute(args, context) {
    const fullPath = _resolveSafe(args.filePath, context.workspaceDir);
    if (!fullPath) return 'Error: Path is outside the workspace.';
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, args.content, 'utf-8');
    return `File written successfully: ${args.filePath} (${args.content.length} characters)`;
  },
});

// ===== LIST DIRECTORY =====
registerTool({
  name: 'list_directory',
  description: 'List files and directories in a given directory path. Returns names, types, and sizes.',
  parameters: {
    type: 'object',
    properties: {
      dirPath: {
        type: 'string',
        description: 'Relative path to the directory from workspace root (e.g., "src" or ".")',
      },
    },
    required: ['dirPath'],
  },
  async execute(args, context) {
    const fullPath = _resolveSafe(args.dirPath || '.', context.workspaceDir);
    if (!fullPath) return 'Error: Path is outside the workspace.';
    if (!fs.existsSync(fullPath)) return `Error: Directory not found: ${args.dirPath}`;
    if (!fs.statSync(fullPath).isDirectory()) return `Error: Not a directory: ${args.dirPath}`;

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const items = entries.slice(0, 100).map(e => {
      const itemPath = path.join(fullPath, e.name);
      if (e.isDirectory()) {
        return `📁 ${e.name}/`;
      }
      const stats = fs.statSync(itemPath);
      const size = stats.size < 1024 ? `${stats.size}B` : `${(stats.size / 1024).toFixed(1)}KB`;
      return `📄 ${e.name} (${size})`;
    });

    return `Directory: ${args.dirPath}\n${items.join('\n')}`;
  },
});

// ===== CREATE DIRECTORY =====
registerTool({
  name: 'create_directory',
  description: 'Create a new directory (including parent directories if needed).',
  parameters: {
    type: 'object',
    properties: {
      dirPath: {
        type: 'string',
        description: 'Relative path for the new directory (e.g., "src/components")',
      },
    },
    required: ['dirPath'],
  },
  async execute(args, context) {
    const fullPath = _resolveSafe(args.dirPath, context.workspaceDir);
    if (!fullPath) return 'Error: Path is outside the workspace.';
    fs.mkdirSync(fullPath, { recursive: true });
    return `Directory created: ${args.dirPath}`;
  },
});

/**
 * Resolve and sanitize a path to prevent directory traversal attacks
 */
function _resolveSafe(relPath, workspaceDir) {
  const resolved = path.resolve(workspaceDir, relPath);
  if (!resolved.startsWith(path.resolve(workspaceDir))) {
    return null; // Path escape attempt
  }
  return resolved;
}
