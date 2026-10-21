import { createResolver, defineNuxtModule, extendPages } from 'nuxt/kit'

/**
 * Registers the public catch-all route (`publisher-document`) and the
 * administration screens. The components, composables and API work without
 * them.
 *
 * Hosts configure it in nuxt.config.ts:
 *   publisher: { administration: { paths: { documents: '/admin/content' } } }  // move the administration screens
 *   publisher: { administration: { enabled: false } }                           // own administration screens
 *   publisher: { document: { enabled: false } }                                 // own public route
 */
export interface PublisherAdministrationPaths {
  documents: string
  document: string
  moderation: string
}

export interface PublisherModuleOptions {
  document: { enabled: boolean }
  administration: { enabled: boolean, paths: PublisherAdministrationPaths }
  /** The host's sign-in page, linked when someone is signed out. */
  signIn: string
}

const SCREENS: { key: keyof PublisherAdministrationPaths, file: string }[] = [
  { key: 'documents', file: 'DocumentsPage.vue' },
  { key: 'document', file: 'EditPage.vue' },
  { key: 'moderation', file: 'ModerationPage.vue' },
]

export default defineNuxtModule<PublisherModuleOptions>({
  meta: { name: '@nuxt4-layers/publisher/routes', configKey: 'publisher' },
  defaults: {
    document: { enabled: true },
    administration: { enabled: true, paths: { documents: '/publisher', document: '/publisher/documents/:documentId', moderation: '/publisher/moderation' } },
    signIn: '/sign-in',
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    const publicConfig = nuxt.options.runtimeConfig.public as Record<string, unknown>
    const routes: Record<string, string> = { signIn: options.signIn }
    publicConfig.publisher = { routes }

    if (options.administration.enabled) {
      for (const screen of SCREENS) {
        const path = options.administration.paths[screen.key]
        if (!path.startsWith('/') || path.startsWith('//')) throw new Error(`publisher.administration.paths.${screen.key} must be an absolute path, got '${path}'.`)
        if (screen.key === 'document' && !path.includes(':documentId')) throw new Error('publisher.administration.paths.document must contain :documentId.')
        routes[screen.key] = path
      }
      // Administration pages: never framed, never cached, never leaking a path
      // in a Referer. Headers a host sets for the same path take precedence.
      const routeRules = (nuxt.options.routeRules ??= {}) as Record<string, { headers?: Record<string, string> }>
      for (const path of Object.values(options.administration.paths)) {
        const rule = (routeRules[path.replace(/\/:[A-Za-z]+.*$/, '/**')] ??= {})
        rule.headers = {
          'Content-Security-Policy': 'frame-ancestors \'none\'',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
          'Cache-Control': 'no-store',
          ...rule.headers,
        }
      }
    }

    extendPages((all) => {
      if (options.administration.enabled) {
        for (const screen of SCREENS) {
          all.push({ name: `publisher-admin-${screen.key}`, path: options.administration.paths[screen.key], file: resolve('../app/publisher-pages', screen.file) })
        }
      }
      // Last, so that every route of the host's and the administration screens win.
      if (options.document.enabled) all.push({ name: 'publisher-document', path: '/:path(.*)*', file: resolve('../app/publisher-pages', 'DocumentPage.vue') })
    })
  },
})
