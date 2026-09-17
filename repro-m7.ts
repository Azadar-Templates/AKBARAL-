import { db } from './src/db';
import { createApiServer } from './src/app';
import { syncAgentRegistry } from './src/agents/registry';

async function main(): Promise<void> {
syncAgentRegistry();
const api = createApiServer();
const { port } = await api.listen(0);
const baseUrl = `http://127.0.0.1:${port}`;

async function register(label: string): Promise<string> {
  const email = `repro-${label}@akbaral.test`;
  await fetch(`${baseUrl}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse-battery-staple', name: label }) });
  const login = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }) });
  return ((await login.json()) as { accessToken: string }).accessToken;
}

const publisher = await register('publisher');
const alice = await register('alice');

const template = await (await fetch(`${baseUrl}/api/factory/templates?q=research&limit=1`, { headers: { authorization: `Bearer ${publisher}` } })).json() as { templates: Array<{ slug: string }> };
const created = await (await fetch(`${baseUrl}/api/factory/agents/from-template`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${publisher}` }, body: JSON.stringify({ template_slug: template.templates[0].slug, name: 'Repro Specialist' }) })).json() as { agent: { slug: string } };
const slug = created.agent.slug;
console.log('created:', slug);
console.log('publish:', (await fetch(`${baseUrl}/api/marketplace/${slug}/publish`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${publisher}` }, body: JSON.stringify({ price_cents: 0 }) })).status);
console.log('install1:', (await fetch(`${baseUrl}/api/marketplace/${slug}/install`, { method: 'POST', headers: { authorization: `Bearer ${alice}` } })).status);
console.log('install2:', (await fetch(`${baseUrl}/api/marketplace/${slug}/install`, { method: 'POST', headers: { authorization: `Bearer ${alice}` } })).status);

const row = db.get<{ install_count: number }>('SELECT install_count FROM agent_marketplace m JOIN agents a ON a.id = m.agent_id WHERE a.slug = ?', [slug]);
console.log('install_count:', row?.install_count);
const ua = db.all('SELECT user_id, agent_id FROM user_agents') as unknown[];
console.log('user_agents rows:', ua.length);
const ords = db.all('SELECT id FROM agent_orders') as unknown[];
console.log('orders:', ords.length);
await api.close();
db.close();

}

main().catch((error) => { console.error(error); process.exit(1); });
