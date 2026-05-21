declare module '@alicloud/sls20201230' {
  export class GetLogsRequest {
    constructor(input: { from: number; to: number; query: string; line: number; reverse: boolean });
  }
  class SlsClient {
    constructor(config: unknown);
    getLogs(project: string, logstore: string, request: GetLogsRequest): Promise<{ body: any[] }>;
  }
  export default SlsClient;
}

declare module '@alicloud/openapi-client' {
  export class Config {
    constructor(input: Record<string, string>);
  }
}

declare module 'tencentcloud-sdk-nodejs' {
  const tencentcloud: any;
  export = tencentcloud;
}

declare module '@volcengine/openapi' {
  export const tlsOpenapi: any;
}
