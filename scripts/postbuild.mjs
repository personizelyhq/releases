// Copy static assets next to the compiled code and emit a JSON Schema for releases.config.json.
import { chmod, cp, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { configSchema } from '../dist/config/schema.js'

await cp('src/static', 'dist/static', { recursive: true })
await cp('src/templates', 'dist/templates', { recursive: true })
await chmod('dist/cli.js', 0o755)

const schema = z.toJSONSchema(configSchema, { io: 'input', unrepresentable: 'any' })
schema.title = '@personizely/releases config'
schema.properties.$schema = { type: 'string' }
await writeFile('dist/schema.json', JSON.stringify(schema, null, 2) + '\n')
console.log('postbuild: static files copied, schema.json written')
