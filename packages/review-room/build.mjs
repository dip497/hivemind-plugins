import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
await rm(here('./dist'), { recursive: true, force: true });
await mkdir(here('./dist'), { recursive: true });
await cp(here('./hivemind-package.json'), here('./dist/hivemind-package.json'));
console.log('Built review-room/dist. This does not install or start the bundle.');
