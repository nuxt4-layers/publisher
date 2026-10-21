import { PUBLISHER_MESSAGES } from '../publisher-messages'
import type { PublisherMessageKey } from '../publisher-messages'

/**
 * The layer's text, with `{name}` placeholders filled in. Hosts change
 * wording in `app.config.ts` under `publisher.messages`. A key with no
 * message answers itself, so a missing message is visible, never blank.
 */
export function usePublisherText() {
  const overrides = (useAppConfig() as { publisher?: { messages?: Record<string, string> } }).publisher?.messages ?? {}
  return function text(key: PublisherMessageKey | (string & {}), values: Record<string, string | number> = {}): string {
    const template = overrides[key] ?? (PUBLISHER_MESSAGES as Record<string, string>)[key] ?? key
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''))
  }
}

/** Whether the catalogue words a key (for labels with a fallback). */
export function hasPublisherMessage(key: string): boolean {
  const overrides = (useAppConfig() as { publisher?: { messages?: Record<string, string> } }).publisher?.messages ?? {}
  return key in overrides || key in PUBLISHER_MESSAGES
}
