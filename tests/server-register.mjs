import { register } from 'node:module';

register(new URL('./server-hooks.mjs', import.meta.url));
