import type {
  PublisherActionRequestInput,
  PublisherBacklink,
  PublisherContentInput,
  PublisherDocument,
  PublisherErrorCode,
  PublisherListing,
  PublisherPermissionAction,
  PublisherResolution,
  PublisherRisk,
  PublisherVersion,
} from '../../shared/contracts'
import { PUBLISHER_ERROR_CODES } from '../../shared/contracts'

/** A registered type as the administration pages see it. */
export interface PublisherTypeView {
  type: string
  label: { one: string, many: string }
  address: { kind: 'none' } | { kind: 'path', base: string, pattern: 'slug' | 'date-slug' }
  listing: { listable: boolean, order: string, filterable: string[] }
  lifecycle: { approval: boolean, moderation: boolean, scheduling: boolean }
  personalData: boolean
  markdownFields: string[]
  risks: Record<PublisherPermissionAction, PublisherRisk>
  /** The fields' JSON Schema, to build a form; the server checks every value again. */
  schema: Record<string, unknown>
  may: Record<PublisherPermissionAction, boolean>
}

export interface PublisherErrorBody {
  code: PublisherErrorCode
  reason?: string
}

/** The contract error a failed request carried, if any. */
export function publisherErrorOf(error: unknown): PublisherErrorBody | null {
  const body = (error as { data?: { data?: unknown } } | null)?.data?.data as Partial<PublisherErrorBody> | undefined
  if (body && (PUBLISHER_ERROR_CODES as readonly unknown[]).includes(body.code)) return { code: body.code!, ...(body.reason ? { reason: body.reason } : {}) }
  const status = (error as { statusCode?: number, status?: number } | null)?.statusCode ?? (error as { status?: number } | null)?.status
  if (status === 401) return { code: 'unauthenticated' }
  if (status === 403) return { code: 'forbidden' }
  return null
}

/**
 * The layer's only way to the server, for pages and components. For the
 * user experience only: it decides nothing, and every request is decided
 * again on the server.
 */
export function usePublisher() {
  const request = useRequestFetch()
  const base = '/api/publisher'
  const admin = `${base}/admin/documents`
  return {
    resolve: (path: string, preview: boolean) => request<PublisherResolution>(`${base}/resolve`, { query: preview ? { path, preview: '1' } : { path } }),
    list: (query: { type: string, [field: string]: string | number | undefined }) => request<PublisherListing>(`${base}/documents`, { query }),
    types: () => request<PublisherTypeView[]>(`${base}/admin/types`),
    documents: (query: { type: string, search?: string, status?: string }) => request<PublisherListing>(admin, { query: Object.fromEntries(Object.entries(query).filter(([, value]) => value)) }),
    document: (documentId: string, version?: number) => request<PublisherDocument>(`${admin}/${documentId}`, { query: version ? { version } : undefined }),
    history: (documentId: string) => request<PublisherVersion[]>(`${admin}/${documentId}/history`),
    backlinks: (documentId: string) => request<PublisherBacklink[]>(`${admin}/${documentId}/backlinks`),
    moderation: () => request<PublisherListing>(`${base}/admin/moderation`),
    create: (type: string, content: PublisherContentInput) => $fetch<PublisherDocument>(admin, { method: 'POST', body: { type, content } }),
    act: (documentId: string, action: PublisherActionRequestInput) => $fetch<PublisherDocument>(`${admin}/${documentId}/actions`, { method: 'POST', body: action }),
  }
}

/**
 * Shared state for an action: pending, the error to show and its code.
 * `disabled` stays true until hydrated, so a form never submits natively.
 */
export function usePublisherAction() {
  const text = usePublisherText()
  const pending = ref(false)
  const hydrated = ref(false)
  onMounted(() => { hydrated.value = true })
  const disabled = computed(() => pending.value || !hydrated.value)
  const error = ref<string | null>(null)
  const code = ref<PublisherErrorCode | null>(null)

  function messageFor(body: PublisherErrorBody | null): string {
    if (!body) return text('publisher.error.unavailable')
    if (body.reason && hasPublisherMessage(`publisher.reason.${body.reason}`)) return text(`publisher.reason.${body.reason}`)
    return text(`publisher.error.${body.code}`)
  }

  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    pending.value = true
    error.value = null
    code.value = null
    try {
      return await action()
    }
    catch (failure) {
      const body = publisherErrorOf(failure)
      code.value = body?.code ?? 'unavailable'
      error.value = messageFor(body)
      return null
    }
    finally {
      pending.value = false
    }
  }

  return { pending, disabled, error, code, run, messageFor, text }
}

/** The host's routes for the layer's pages (`publisher` in nuxt.config.ts). */
export function usePublisherRoutes(): { documents: string, document: string, moderation: string, signIn: string } {
  const routes = (useRuntimeConfig().public as { publisher?: { routes?: Record<string, string> } }).publisher?.routes ?? {}
  return {
    documents: routes.documents ?? '/publisher',
    document: routes.document ?? '/publisher/documents/:documentId',
    moderation: routes.moderation ?? '/publisher/moderation',
    signIn: routes.signIn ?? '/sign-in',
  }
}
