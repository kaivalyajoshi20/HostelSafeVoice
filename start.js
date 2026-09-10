import fs from 'fs/promises';

const source = await fs.readFile(new URL('./server.js', import.meta.url), 'utf8');
const marker = "const requireHigher = requireRole('higher');";
if (!source.includes(marker)) throw new Error('Hostel SafeVoice server marker not found');
const injected = `${source}

import { registerPhase3 } from './phase3.js';
import { registerPhase4 } from './phase4.js';
import { registerPhase5 } from './phase5.js';
import { registerPhase6 } from './phase6.js';
import { registerPhase7 } from './phase7.js';
import { registerPhase8 } from './phase8.js';
import { registerPhase9 } from './phase9.js';
import { registerPhase10 } from './phase10.js';
import { registerPhase11 } from './phase11.js';
import { registerPhase12 } from './phase12.js';
registerPhase3({ app, pool, requireAdmin, requireHigher });
registerPhase4({ app, pool, requireAdmin, requireHigher });
registerPhase5({ app });
registerPhase6({ app, pool, requireAdmin, requireHigher });
registerPhase7({ app, pool, requireAdmin, requireHigher });
registerPhase8({ app, pool, requireAdmin, requireHigher });
registerPhase9({ app, pool });
registerPhase10({ app });
registerPhase11({ app, pool });
registerPhase12({ app });
`;
const runtimeUrl = new URL('./.runtime-server.mjs', import.meta.url);
await fs.writeFile(runtimeUrl, injected, 'utf8');
await import(runtimeUrl.href);
