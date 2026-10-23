/* js/supabase-client.js
 * Cliente Supabase compartilhado por todas as páginas.
 * A chave "anon" é pública por natureza: quem protege os dados são as
 * políticas RLS do banco (ver supabase/rls.sql), não o segredo da chave.
 * Requer, antes deste arquivo: https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2
 */
const SUPABASE_URL = 'https://smbvlquqqhtgmvgddjlq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtYnZscXVxcWh0Z212Z2RkamxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MDI0NjAsImV4cCI6MjA5OTE3ODQ2MH0.Asz3z7D-fGHN4R9PTE7et_IkzodrQcw_py267jZkfiw';

if (!window.supabase || !window.supabase.createClient) {
  throw new Error('supabase-js não carregou. Inclua o script do CDN antes de supabase-client.js.');
}

window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
