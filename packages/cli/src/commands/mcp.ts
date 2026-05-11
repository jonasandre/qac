import { Command } from 'commander';

export function mcpCommand(): Command {
  const cmd = new Command('mcp').description('Start the MCP server over stdio.');
  cmd.action(async () => {
    const mod = await import('@qac/mcp');
    await mod.startMcpStdio();
  });
  return cmd;
}
