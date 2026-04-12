import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { customerApi } from '../../utils/customerApi.js';
import { asError, asJson } from '../../utils/formatters.js';

interface DeviceCodeResponse {
  success: boolean;
  data?: {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };
}

export function registerRequestDeviceCode(server: McpServer): void {
  server.registerTool(
    'requestDeviceCode',
    {
      title: 'Request OrbitFlare Device Code',
      description:
        'Starts the device authorization flow. Returns a verification URL and short user code — the user opens the URL in a browser and enters the code, then call pollDeviceToken with the device_code.',
      inputSchema: {},
    },
    async () => {
      try {
        const result = await customerApi<DeviceCodeResponse>('/auth/device/code', {
          method: 'POST',
          public: true,
        });
        return asJson(
          {
            ...result.data,
            instructions:
              `Open ${result.data?.verification_uri} in a browser, enter the user code "${result.data?.user_code}", ` +
              `then call pollDeviceToken with device_code="${result.data?.device_code}".`,
          },
          'Device code issued. Display the verification_uri and user_code to the user, then poll for the token.',
        );
      } catch (err) {
        return asError(err);
      }
    },
  );
}
