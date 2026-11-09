// Cloudflare Pages: /api/ia-resumo. A lógica fica em netlify/functions/ia-resumo.mjs (comum às duas hospedagens).
import { tratar } from '../../netlify/functions/ia-resumo.mjs';

export const onRequest = ({ request, env }) => tratar(request, env);
