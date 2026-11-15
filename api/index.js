/**
 * Vercel serverless function: every /api/* request is rewritten here (see vercel.json).
 * It loads the API bundled at build time (npm run build:api → server-dist/app.mjs): one
 * self-contained ES module, so no extensionless-import or TypeScript issues at runtime.
 */
import app from '../server-dist/app.mjs'

export default app
