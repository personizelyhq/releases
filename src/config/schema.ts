import { z } from 'zod'

const color = z
  .string()
  .regex(/^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|color-mix)\([^;{}<>]*\))$/, 'Use a hex value like #2f54eb or rgb()/hsl()/oklch()')

/** A color for both schemes, or `{ light, dark }` to set each. */
const themedColor = z.union([color, z.object({ light: color, dark: color })])

const asset = z.string().min(1).describe('URL, absolute path, or a file in the releases folder such as "assets/logo.svg"')

export const configSchema = z.object({
  name: z.string().min(1).default('Changelog').describe('Product name, used in the header, titles and RSS. "Personizely"'),
  title: z.string().optional().describe('Page heading. Defaults to "<name> changelog", or "Changelog" when no name is set'),
  description: z.string().default('New features, improvements and fixes.').describe('Shown under the heading and in meta tags'),
  url: z
    .url()
    .optional()
    .describe('Public base URL. When unset it is taken from the request (Host and X-Forwarded-* headers)'),
  website: z
    .object({ label: z.string(), href: z.url() })
    .optional()
    .describe('Link back to your product in the header'),

  logo: z
    .union([asset, z.object({ light: asset, dark: asset })])
    .optional()
    .describe('Shown in the header instead of the name. Use { light, dark } for separate dark-mode artwork'),
  logoHeight: z.number().int().min(12).max(64).default(28),
  favicon: asset.optional(),
  ogImage: asset.optional().describe('Default social preview image'),

  font: z
    .union([
      z.string().describe('A Google Fonts family name, e.g. "Inter", loaded automatically'),
      z.object({
        family: z.string().describe('CSS font-family value'),
        url: z.url().optional().describe('Stylesheet URL to load it from'),
      }),
    ])
    .optional(),

  colors: z
    .object({
      accent: themedColor.default('#2f54eb').describe('Links, focus rings, "new" markers and unread indicators'),
      background: themedColor.optional(),
      text: themedColor.optional(),
      muted: themedColor.optional().describe('Secondary text and dates'),
      border: themedColor.optional(),
      new: themedColor.optional().describe('Label color for new features. Defaults to accent'),
      improved: themedColor.optional(),
      fixed: themedColor.optional(),
    })
    .prefault({}),

  labels: z
    .object({
      new: z.string().default('New feature'),
      improved: z.string().default('Improvement'),
      fixed: z.string().default('Fix'),
    })
    .prefault({})
    .describe('Wording for entry types'),

  embed: z
    .object({
      title: z.string().default("What's new"),
      limit: z.number().int().min(1).max(200).default(30),
    })
    .prefault({}),

  // Runtime settings. Environment variables override these.
  dir: z.string().default('./releases').describe('Releases folder. Env: RELEASES_DIR'),
  dataDir: z.string().default('./.data').describe('Where the SQLite file lives. Env: DATA_DIR'),
  port: z.number().int().default(3000).describe('Env: PORT'),
  host: z.string().default('0.0.0.0').describe('Env: HOST'),
  allowedOrigins: z.array(z.string()).default(['*']).describe('CORS for /api/me/*. Env: ALLOWED_ORIGINS'),
  frameAncestors: z.array(z.string()).default(['*']).describe('Who may iframe /embed. Env: FRAME_ANCESTORS'),
  tokenMaxAge: z.number().int().positive().default(60 * 60 * 24 * 30).describe('Seconds. User tokens expiring later than this are rejected'),
})

/** What you write in releases.config.* (everything optional). */
export type UserConfig = z.input<typeof configSchema>

/** Fully resolved configuration used at runtime. */
export type ResolvedConfig = z.output<typeof configSchema> & {
  /** Absolute paths. */
  dir: string
  dataDir: string
  /** From RELEASES_SECRET. Never read from the config file. */
  secret: string | null
  /** Folder the config was loaded relative to. */
  root: string
}

/** Typed helper for releases.config.ts / .js. */
export function defineConfig (config: UserConfig): UserConfig {
  return config
}
