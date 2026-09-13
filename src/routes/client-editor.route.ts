import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAdmin } from '../auth.js';

function prepareClientEditorHtml(html: string): string {
  const initialSlugScript = `
    const initialBusinessSlug = new URLSearchParams(location.search).get('businessSlug');
    loadBusinesses().then(() => {
      if (initialBusinessSlug && [...$('businessSelect').options].some((option) => option.value === initialBusinessSlug)) {
        $('businessSelect').value = initialBusinessSlug;
        $('businessSlug').value = initialBusinessSlug;
        setLinks(initialBusinessSlug);
      }
      return loadProfile();
    }).catch((error) => {
      $('message').innerHTML = \`<p class="bad">\${error.message || 'Chyba při načítání klientů.'}</p>\`;
    });`;

  return html
    .replace(/4\.[0-9]+\.[0-9]+/g, '5.1.0')
    .replace(/target="_blank" rel="noreferrer"/g, '')
    .replace(/target="_blank"/g, '')
    .replace(/rel="noreferrer"/g, '')
    .replace(/loadBusinesses\(\)\.then\(loadProfile\)\.catch\(\(error\) => \{\s*\$\('message'\)\.innerHTML = `<p class="bad">\$\{error\.message \|\| 'Chyba při načítání klientů\.'\}<\/p>`;\s*\}\);/s, initialSlugScript);
}

async function sendClientEditorPage(reply: FastifyReply): Promise<FastifyReply> {
  try {
    const filePath = path.resolve(process.cwd(), 'public', 'client-editor.html');
    const html = prepareClientEditorHtml(await readFile(filePath, 'utf8'));
    return reply.header('Cache-Control', 'no-store, max-age=0').type('text/html; charset=utf-8').send(html);
  } catch {
    return reply.code(404).send({ error: 'not_found' });
  }
}

export async function clientEditorRoute(app: FastifyInstance): Promise<void> {
  app.get('/client-editor', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return sendClientEditorPage(reply);
  });

  app.get('/admin/client-editor', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return sendClientEditorPage(reply);
  });

  app.get('/edit-client', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return sendClientEditorPage(reply);
  });
}
