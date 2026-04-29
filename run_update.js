const fs = require('fs');
const p = '/Users/apple/Library/Application Support/Code/User/settings.json';
let data = fs.readFileSync(p, 'utf-8');
data = data.replace(/,(\s*\})/g, '$1');
const jsonStr = data.replace(/^\s*\/\/.*$/gm, '');
const settings = JSON.parse(jsonStr);
settings.mcpServers = settings.mcpServers || {};
settings.mcpServers['restaurant-mcp'] = {
  command: 'node',
  args: ['src/index.js'],
  cwd: "/Users/apple/Desktop/learnings/restaurant/mcp-server",
  env: {
    "ML_SERVICE_URL": "http://localhost:8000"
  }
};
fs.writeFileSync(p, JSON.stringify(settings, null, 2));
