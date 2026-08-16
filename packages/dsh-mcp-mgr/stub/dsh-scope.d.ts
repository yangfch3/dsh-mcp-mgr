/**
 * Compile-time stub of `@deepseek-ai/dsh-scope`.
 *
 * Only `scopeOf` is needed (read the scope tag of a context); the real package
 * is resolved at runtime through the host app's node_modules. Kept minimal so
 * the Typert analysis program never drags the real d.ts chain in.
 */
declare module '@deepseek-ai/dsh-scope' {
  /** Read the nearest scope tag inherited by a context. */
  export function scopeOf(ctx: unknown): string | undefined
}
