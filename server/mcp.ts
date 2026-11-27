/**
 * Entry for Fretlane's MCP server over stdio (see server/mcpTools.ts). Claude Desktop, Claude Code
 * or another MCP client starts it; it finds the running Fretlane app on this computer.
 *
 *   claude mcp add fretlane -- npx tsx /path/to/Fretlane/server/mcp.ts
 *
 * Stdout carries the protocol, so everything else that would print there goes to stderr.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFretlaneMcp } from './mcpTools.ts';

console.log = console.error;
console.info = console.error;
console.debug = console.error;

await createFretlaneMcp().connect(new StdioServerTransport());
