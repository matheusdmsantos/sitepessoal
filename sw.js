/* Service worker do app instalável (manifest.webmanifest). Existe só para o Chrome e o
   PWABuilder reconhecerem o site como app: não guarda nada em cache, então cada abertura pega a
   versão publicada (os dados vêm do Supabase, que precisa de internet de qualquer jeito).
   shortcut: sem funcionamento offline; se um dia precisar, cachear as páginas e os js/css aqui. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', ev => ev.waitUntil(self.clients.claim()));
