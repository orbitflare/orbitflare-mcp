import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAccountTools } from './account.js';
import { registerApexTools } from './apex.js';
import { registerAssetTools } from './assets.js';
import { registerChainTools } from './chain.js';
import { registerStreamingTools } from './streaming.js';
import { registerSwapTools } from './swap.js';
import { registerTransactionTools } from './transactions.js';
import { registerWalletTools } from './wallet.js';

export function registerTools(server: McpServer): void {
  registerAssetTools(server);
  registerChainTools(server);
  registerSwapTools(server);
  registerStreamingTools(server);
  registerTransactionTools(server);
  registerApexTools(server);
  registerWalletTools(server);
  registerAccountTools(server);
}
