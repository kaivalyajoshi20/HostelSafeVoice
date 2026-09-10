import fs from 'fs/promises';

const source = await fs.readFile(new URL('./server.js', import.meta.url), 'utf8');
const marker = "const requireHigher = requireRole('higher');";
if (!source.includes(marker)) throw new Error('Hostel SafeVoice server marker not found');
const injected = `${source}\n\nimport { registerPhase3 } from './phase3.js';\nregisterPhase3({ app, pool, requireAdmin, requireHigher });\n`;
const runtimeFile = '/tmp/hostel-safevoice-server.mjs';
await fs.writeFile(runtimeFile, injected, 'utf8');
await import(runtimeFile);
