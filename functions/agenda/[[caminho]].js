// Cloudflare Pages: /agenda/<token>.ics (link assinado no Google Agenda). A lógica fica em netlify/functions/agenda.mjs.
import { tratar } from '../../netlify/functions/agenda.mjs';

export const onRequest = ({ request, env }) => tratar(request, env);
