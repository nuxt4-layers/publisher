import { publisherApiEnabledFrom, setPublisherApiEnabled } from '../internal/http'

/**
 * Reads `runtimeConfig.publisher.api.enabled` once at start-up (default on;
 * `NUXT_PUBLISHER_API_ENABLED=false` switches it off). Off, every
 * `/api/publisher/*` request answers 404; the server functions still work.
 */
export default defineNitroPlugin(() => {
  setPublisherApiEnabled(publisherApiEnabledFrom(useRuntimeConfig().publisher))
})
