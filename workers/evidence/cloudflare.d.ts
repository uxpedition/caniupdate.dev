// Import the SDK's module-scoped types, not its globals (which replace Node's Buffer with any).
declare module 'cloudflare:workers' {
  import { CloudflareWorkersModule } from '@cloudflare/workers-types';
  export = CloudflareWorkersModule;
}
