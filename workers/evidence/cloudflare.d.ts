// Keep this file an ambient script: top-level imports turn cloudflare:workers into a missing-module augmentation.
// Narrow imported aliases avoid the SDK's blanket globals and retain Node's Buffer types.
type DurableObjectStorage = import('@cloudflare/workers-types').DurableObjectStorage;
type SqlStorageValue = import('@cloudflare/workers-types').SqlStorageValue;
type SqlStorageCursor<T extends Record<string, SqlStorageValue>> =
  import('@cloudflare/workers-types').SqlStorageCursor<T>;

declare module 'cloudflare:workers' {
  import { CloudflareWorkersModule } from '@cloudflare/workers-types';
  export = CloudflareWorkersModule;
}
