import type { Context } from '@deepseek-ai/cordis'

/**
 * Compile-time boundary for the Typert protocol.
 *
 * The aggregate host project maps the protocol to the vendored source so the
 * generator can inspect its standard-decorator metadata. The package-local
 * project keeps only the public shapes needed to type-check the host source;
 * emitted JavaScript still imports the official npm package.
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  export class TypertRemoteService {
    protected readonly ctx: Context
    protected constructor(ctx: Context, name: string)
  }

  export function Remote<This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ): void

  export function Remote(exportName: string): <
    This extends object,
    Args extends unknown[],
    Result,
  >(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ) => void
}
