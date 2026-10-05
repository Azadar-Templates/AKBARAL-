/** Registers the audit-only module hooks (CSS modules, next/link, next/navigation). */
import { register } from 'node:module';
register('./module-hooks.mjs', import.meta.url);
