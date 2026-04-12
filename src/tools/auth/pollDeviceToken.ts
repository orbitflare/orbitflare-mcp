import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi, CustomerApiError } from '../../utils/customerApi.js';
import { asError, asJson, asText } from '../../utils/formatters.js';
import { setBearerToken } from '../../config.js';

const inputSchema = {
  device_code: z.string().describe('Device code returned from requestDeviceCode'),
};

interface DeviceTokenResponse {
  success: boolean;
  data?: { token: string; user?: { id: number; name?: string; email?: string } };
}

export function registerPollDeviceToken(server: McpServer): void {
  server.registerTool(
    'pollDeviceToken',
    {
      title: 'Poll For Device Token',
      description:
        'Polls the device-authorization endpoint with a device_code. Returns 428 (authorization_pending) until the user completes auth, then returns a Bearer token which is automatically stored in the session.',
      inputSchema,
    },
    async ({ device_code }) => {
      try {
        const result = await customerApi<DeviceTokenResponse>('/auth/device/token', {
          method: 'POST',
          public: true,
          body: { device_code },
        });
        if (result.data?.token) {
          setBearerToken(result.data.token);
          return asJson(
            { token: 'stored', user: result.data.user ?? null },
            'Bearer token stored in session. Customer API tools can now be called.',
          );
        }
        return asJson(result);
      } catch (err) {
        if (err instanceof CustomerApiError && err.status === 428) {
          return asText('authorization_pending — user has not completed the flow yet. Wait `interval` seconds and call this tool again.');
        }
        if (err instanceof CustomerApiError && err.status === 429) {
          return asText('slow_down — polling too fast. Increase the interval and try again.');
        }
        return asError(err);
      }
    },
  );
}
