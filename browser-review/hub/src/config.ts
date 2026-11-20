// The hub's settings, from environment variables (docker-compose.yml).

export interface Config {
  /** Shown to developers when they add the project, for example "acme-shop". */
  project: string;
  /** The staging site customers review, for example "https://staging.acme.com". Comments from anywhere else are refused. */
  origin: string;
  /** Folder with all data. In Docker a volume, never inside the webroot. */
  dataDir: string;
  host: string;
  port: number;
  /** Most comments one review token may create per hour. */
  commentsPerHour: number;
  /** Text customers see the first time, with {name} for theirs. Null: the default welcome. */
  welcome: string | null;
}

export class ConfigError extends Error {}

/** A site's origin, for example "https://staging.acme.com" from "https://staging.acme.com/some/page". */
export function toOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`MARGIN_ORIGIN is not a URL: ${JSON.stringify(value)}. Use the staging site, for example https://staging.acme.com`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigError(`MARGIN_ORIGIN must start with https:// (or http:// for local tests), got ${JSON.stringify(value)}.`);
  }
  return url.origin;
}

export function readConfig(env: Record<string, string | undefined>): Config {
  const project = env.MARGIN_PROJECT?.trim();
  if (!project) throw new ConfigError('Set MARGIN_PROJECT to the project name, for example MARGIN_PROJECT=acme-shop.');
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,63}$/u.test(project)) {
    throw new ConfigError('MARGIN_PROJECT may contain letters, digits, spaces, dots, dashes and underscores (at most 64).');
  }
  const rawOrigin = env.MARGIN_ORIGIN?.trim();
  if (!rawOrigin) throw new ConfigError('Set MARGIN_ORIGIN to the staging site, for example MARGIN_ORIGIN=https://staging.acme.com.');

  const port = Number(env.PORT ?? 4780);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError(`PORT is not a valid port: ${env.PORT}`);
  const commentsPerHour = Number(env.MARGIN_COMMENTS_PER_HOUR ?? 60);
  if (!Number.isInteger(commentsPerHour) || commentsPerHour < 1) {
    throw new ConfigError(`MARGIN_COMMENTS_PER_HOUR must be a positive whole number, got ${env.MARGIN_COMMENTS_PER_HOUR}.`);
  }

  return {
    project,
    origin: toOrigin(rawOrigin),
    dataDir: env.MARGIN_DATA?.trim() || '/data/.margin',
    host: env.HOST?.trim() || '0.0.0.0',
    port,
    commentsPerHour,
    welcome: readWelcome(env.MARGIN_WELCOME),
  };
}

function readWelcome(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  if (text.length > 1000) throw new ConfigError('MARGIN_WELCOME is at most 1000 characters.');
  return text;
}
