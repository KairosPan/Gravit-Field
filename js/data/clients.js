// js/data/clients.js — the line each client takes to add Gravity Field (spec §5.4), and the face's tool names (spec §6)
export const CLIENTS = ['Claude Code', 'Cursor', 'Codex'];
export const TOOL_NAMES = ['shop_search', 'shop_get', 'shop_publish', 'plugin_call'];
// they need an owner; registered when identity arrives (spec §12)
export const RESERVED_TOOLS = ['shop_install', 'shop_uninstall', 'shop_mine'];

export function clientLines(origin) {
  const url = `${origin}/mcp`;
  return {
    'Claude Code': { file: null, code: `claude mcp add --transport http gravity-field ${url}` },
    Cursor: { file: '~/.cursor/mcp.json', code: JSON.stringify({ mcpServers: { 'gravity-field': { url } } }, null, 2) },
    Codex: { file: '~/.codex/config.toml', code: `[mcp_servers.gravity-field]\nurl = "${url}"` },
  };
}
