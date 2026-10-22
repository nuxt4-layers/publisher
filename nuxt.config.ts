/**
 * Nuxt layer entry point for `@nuxt4-layers/publisher`.
 *
 * Hosts compose this layer by package name from `extends`, register their
 * document types and supply the ports from a Nitro plugin with the
 * `providePublisher*` functions.
 */
export default defineNuxtConfig({
  compatibilityDate: '2026-06-30',
  runtimeConfig: {
    // Server only. `false` (or NUXT_PUBLISHER_API_ENABLED=false) answers every `/api/publisher/*` request 404.
    publisher: { api: { enabled: true } },
  },
})
