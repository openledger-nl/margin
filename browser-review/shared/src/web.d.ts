// The few web globals shared code may use. Each one exists in browsers,
// extension service workers, Node and Cloudflare Workers. Typecheck fails on
// anything else (document, window, Buffer, process), which keeps shared/
// usable on every side. Add a global here only if all four runtimes have it.

declare class URL {
  constructor(url: string, base?: string | URL);
  readonly origin: string;
  readonly pathname: string;
}
