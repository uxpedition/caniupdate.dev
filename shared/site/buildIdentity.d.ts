import type { BuildIdentity } from './buildIdentity';

declare module 'nuxt/schema' {
  interface AppConfigInput {
    buildIdentity?: BuildIdentity;
  }

  // Keep the generated app-config default from narrowing this union to the current build's null state.
  interface CustomAppConfig {
    buildIdentity?: BuildIdentity;
  }

  interface AppConfig {
    buildIdentity: BuildIdentity;
  }
}

declare module '@nuxt/schema' {
  interface AppConfigInput {
    buildIdentity?: BuildIdentity;
  }

  // Keep the generated app-config default from narrowing this union to the current build's null state.
  interface CustomAppConfig {
    buildIdentity?: BuildIdentity;
  }

  interface AppConfig {
    buildIdentity: BuildIdentity;
  }
}

export {};
