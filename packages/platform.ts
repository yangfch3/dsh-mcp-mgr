/**
 * Shared browser platform modules. Seeding, bundling externals, and Vite
 * aliases consume this list so their module identities cannot drift.
 *
 * Mirrors the `staticModules` seed the dsh web shell passes to
 * `__ModuleLoader__.create`: a client bundle `require` must hit that table, so
 * an entry the shell does not seed throws at runtime while a seeded module
 * missing here is inlined as a duplicate instance. Re-sync on every dsh
 * upgrade (current list: dsh@0.2.0-rc.2).
 * @module @deepseek-ai/dsh-client-web/src/platform
 */

/** The module specifiers the shell shares into the frozen module table. */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const

/** One platform module specifier (a seed-table key). */
export type PlatformModule = (typeof PLATFORM_MODULES)[number]
