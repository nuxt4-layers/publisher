import type {
  PublisherActionRequestInput,
  PublisherBacklink,
  PublisherContentInput,
  PublisherDocument,
  PublisherEditorType,
  PublisherErrorCode,
  PublisherListing,
  PublisherPermissionAction,
  PublisherResolution,
  PublisherRisk,
  PublisherVersion,
} from '../../shared/contracts'
import { PUBLISHER_ERROR_CODES } from '../../shared/contracts'

/** A registered type as `/api/publisher/admin/types` answers it, for the host's own screens and editor. */
export interface PublisherTypeView extends PublisherEditorType {
  listing: { listable: boolean, order: string, filterable: string[] }
  lifecycle: { approval: boolean, moderation: boolean, scheduling: boolean }
  personalData: boolean
  risks: Record<PublisherPermissionAction, PublisherRisk>
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
 * A typed client for the HTTP API, for the host's own screens: data and
 * actions only. It decides nothing; every request is decided again on the
 * server.
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
