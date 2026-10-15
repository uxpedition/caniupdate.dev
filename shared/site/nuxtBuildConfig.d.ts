// Nuxt generates this virtual module at build time; Nitro's separate app config is not the Nuxt config.
declare module '#internal/nuxt/app-config' {
  const appConfig: { readonly buildIdentity: import('./buildIdentity').BuildIdentity };

  export default appConfig;
}
