#!/usr/bin/env node
/**
 * Endless Cues for Claude Code, Codex and other MCP clients.
 *
 *   ec-mcp                        the show open in the Endless Cues app on this computer
 *                                 (turn on "Let coding agents work on the show" in Settings ▸ Assistant)
 *   ec-mcp --show My.ecshow       a show folder, with no app; changes are left unsaved for review
 *   ec-mcp --show My.ecshow --save    …or written and versioned at once
 *   --no-instructions             send no server instructions (the caller's system prompt has them: the app's own turns)
 *
 * Add it to Claude Code:    claude mcp add endless-cues -- node /path/to/bin/ec-mcp.js
 * Add it to Codex:          in ~/.codex/config.toml:   [mcp_servers.endless-cues]
 *                                                       command = "node"
 *                                                       args = ["/path/to/bin/ec-mcp.js"]
 *
 * It speaks MCP on stdin/stdout; anything it has to say to a person goes to stderr.
 */
import * as path from 'path';
import * as mcp from '../core/assistant/mcp';

async function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const showDir = arg('--show');
  let backend;
  if (showDir) backend = mcp.fileBackend(path.resolve(showDir), { save: argv.includes('--save') });
  else {
    backend = await mcp.appBackend({ session: arg('--session') || undefined, client: arg('--client') || 'an agent' });
    if (!backend) {
      // still a valid server, so the client shows the reason instead of "failed to start"
      const why = 'Endless Cues is not offering its tools on this computer. Open the app and turn on “Let coding agents work on the show” in Settings ▸ Assistant, or start this server with --show <folder> to work on a show folder directly.';
      backend = { describe: 'nothing', call: async () => ({ content: why, is_error: true }) };
      process.stderr.write(`ec-mcp: ${why}\n`);
    }
  }
  process.stderr.write(`ec-mcp: serving ${backend.describe}\n`);
  // (--no-instructions: the app's own Claude Code and Codex turns, whose system prompt already carries them)
  await mcp.serve({ input: process.stdin, output: process.stdout, backend, version: require('../package.json').version, log: (l) => process.stderr.write(`ec-mcp: ${l}\n`),
                    ...(argv.includes('--no-instructions') ? { instructions: null } : {}) });
}
main(process.argv.slice(2)).catch((err) => { process.stderr.write(`ec-mcp: ${err.message}\n`); process.exitCode = 1; });
