/**
 * Type declaration for the optional 'open' package.
 * This package may not be installed — imports should be wrapped in try/catch.
 */
declare module 'open' {
  function open(target: string, options?: Record<string, unknown>): Promise<unknown>;
  export default open;
}
