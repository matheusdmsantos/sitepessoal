// Cloudflare Pages: /api/usuarios. A lógica fica em netlify/functions/usuarios.mjs (comum às duas hospedagens).
import { tratar } from '../../netlify/functions/usuarios.mjs';

export const onRequest = ({ request, env }) => tratar(request, env);
