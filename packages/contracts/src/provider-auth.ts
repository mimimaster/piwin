/**
 * Provider authentication descriptors shared across the Host/backend seam.
 *
 * `bootstrap` is deliberately only an opaque reference. The corresponding
 * raw value lives in an in-memory, one-shot worker bootstrap channel and must
 * never be placed in a JSONL request, persisted blueprint, log, or argv/env.
 */
export type ProviderAuthDescriptor =
  | { readonly kind: 'env'; readonly envName: string }
  | { readonly kind: 'bootstrap'; readonly secretId: string }
  | { readonly kind: 'inline'; readonly apiKey: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'oauth'; readonly providerId: string };

/**
 * Authentication modes allowed to cross the worker JSONL boundary. Inline
 * keys are SDK-only and are excluded here so the protocol cannot represent a
 * raw provider credential.
 */
export type WorkerProviderAuthDescriptor = Exclude<
  ProviderAuthDescriptor,
  { readonly kind: 'inline'; readonly apiKey: string }
>;

/**
 * Ephemeral secret material paired with a `ProviderAuthDescriptor` bootstrap
 * reference. This type is intentionally in-memory only; callers must not
 * serialize or persist values of it.
 */
export type EphemeralProviderSecret = {
  readonly secretId: string;
  readonly value: string;
};
