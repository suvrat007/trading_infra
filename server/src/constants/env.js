import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// dotenv resolves .env against process.cwd(). That makes configuration depend
// on where you happened to launch from: `node server/src/index.js` from the
// repo root would load nothing and silently fall back to default credentials.
// Anchor to this file's location instead, so cwd never changes behavior.
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

dotenv.config({ path: path.join(SERVER_ROOT, '.env') });

export { SERVER_ROOT };
