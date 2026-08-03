import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import { env } from '../config/env.js';
import { sendCallLeadEmail } from '../email/call-lead-email.js';
import { DEFAULT_BUSINESS_SLUG, safeBusinessSlug } from '../storage-postgres.js';

const { Pool } = pg;

type CallLeadRow = {
  id: string;
  business_slug: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  service_name: string;
  message: string;
  source: string;
  created_at: string;
  updated_at: string;
};

let pool: pg.Pool | null = null;
let tableReady = false;
let memoryLeads: CallLeadRow[] = [];

const callLeadSchema = z.object({
  businessSlug: z.string().optional(),
  customerName: z.string().trim().min(1).max(160),
  customerPhone: z.string().trim().min(3).max(80),
  serviceName: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(3000),
  status: z.enum(['nové', 'volat zpět', 'rezervace', 'hotovo']).optional().default('nové'),
  source: z.string().trim().min(1).max(80).optional().default('missed_call_demo'),
});

const updateStatusSchema = z.object({
  status: z.enum(['nové', 'volat zpět', 'rezervace', 'hotovo']),
});

function getPool(): pg.Pool | null {
  if (!env.DATABASE_URL) return null;
  if (pool) return pool;
  const poolConfig: pg.PoolConfig = { connectionString: env.DATABASE_URL, max: 3 };
  if (env.DATABASE_URL.includes('sslmode=require')) poolConfig.ssl = { rejectUnauthorized: false };
  pool = new Pool(poolConfig);
  return pool;
}

async function ensureCallLeadTable(): Promise<pg.Pool | null> {
  const selectedPool = getPool();
  if (!selectedPool) return null;
  if (tableReady) return selectedPool;
  await selectedPool.query(`
    CREATE TABLE IF NOT EXISTS call_leads (
      id TEXT PRIMARY KEY,
      business_slug TEXT NOT NULL DEFAULT 'studio-aurora',
      status TEXT NOT NULL DEFAULT 'nové',
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      service_name TEXT NOT NULL,
      message TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'missed_call',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_call_leads_business_created ON call_leads(business_slug, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_call_leads_status ON call_leads(status);
  `);
  tableReady = true;
  return selectedPool;
}

function publicLead(row: CallLeadRow) {
  return {
    id: row.id,
    businessSlug: row.business_slug,
    status: row.status,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    serviceName: row.service_name,
    message: row.message,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function notifyLead(row: CallLeadRow) {
  try {
    return await sendCallLeadEmail({
      id: row.id,
      businessSlug: row.business_slug,
      status: row.status,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      serviceName: row.service_name,
      message: row.message,
      source: row.source,
      createdAt: row.created_at,
    });
  } catch (error) {
    return {
      sent: false,
      skipped: false,
      reason: error instanceof Error ? error.message : 'email_failed',
    };
  }
}

export async function callLeadsRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/call-leads', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const businessSlug = safeBusinessSlug((request.query as { businessSlug?: string } | undefined)?.businessSlug || DEFAULT_BUSINESS_SLUG);
    const selectedPool = await ensureCallLeadTable();

    if (!selectedPool) {
      const leads = memoryLeads.filter((lead) => lead.business_slug === businessSlug).map(publicLead);
      return { ok: true, storage: 'memory', businessSlug, total: leads.length, leads };
    }

    const rows = await selectedPool.query<CallLeadRow>(
      'SELECT * FROM call_leads WHERE business_slug = $1 ORDER BY created_at DESC LIMIT 300',
      [businessSlug],
    );
    const leads = rows.rows.map(publicLead);
    return { ok: true, storage: 'postgres', businessSlug, total: leads.length, leads };
  });

  app.post('/api/call-leads', async (request, reply) => {
    const parsed = callLeadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }

    const businessSlug = safeBusinessSlug(parsed.data.businessSlug || DEFAULT_BUSINESS_SLUG);
    const now = new Date().toISOString();
    const row: CallLeadRow = {
      id: randomUUID(),
      business_slug: businessSlug,
      status: parsed.data.status,
      customer_name: parsed.data.customerName,
      customer_phone: parsed.data.customerPhone,
      service_name: parsed.data.serviceName,
      message: parsed.data.message,
      source: parsed.data.source,
      created_at: now,
      updated_at: now,
    };

    const selectedPool = await ensureCallLeadTable();
    if (!selectedPool) {
      memoryLeads = [row, ...memoryLeads].slice(0, 300);
      const notification = await notifyLead(row);
      return reply.code(201).send({ ok: true, storage: 'memory', lead: publicLead(row), notification });
    }

    await selectedPool.query(
      `INSERT INTO call_leads (
        id, business_slug, status, customer_name, customer_phone, service_name, message, source, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [row.id, row.business_slug, row.status, row.customer_name, row.customer_phone, row.service_name, row.message, row.source, row.created_at, row.updated_at],
    );

    const notification = await notifyLead(row);
    return reply.code(201).send({ ok: true, storage: 'postgres', lead: publicLead(row), notification });
  });

  app.patch('/api/call-leads/:id', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const id = (request.params as { id: string }).id;
    const parsed = updateStatusSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });

    const selectedPool = await ensureCallLeadTable();
    if (!selectedPool) {
      memoryLeads = memoryLeads.map((lead) => lead.id === id ? { ...lead, status: parsed.data.status, updated_at: new Date().toISOString() } : lead);
      const lead = memoryLeads.find((item) => item.id === id);
      if (!lead) return reply.code(404).send({ error: 'not_found' });
      return { ok: true, storage: 'memory', lead: publicLead(lead) };
    }

    const rows = await selectedPool.query<CallLeadRow>(
      `UPDATE call_leads SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [parsed.data.status, id],
    );
    const lead = rows.rows.at(0);
    if (!lead) return reply.code(404).send({ error: 'not_found' });
    return { ok: true, storage: 'postgres', lead: publicLead(lead) };
  });

  app.delete('/api/call-leads', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const businessSlug = safeBusinessSlug((request.query as { businessSlug?: string } | undefined)?.businessSlug || DEFAULT_BUSINESS_SLUG);
    const selectedPool = await ensureCallLeadTable();

    if (!selectedPool) {
      memoryLeads = memoryLeads.filter((lead) => lead.business_slug !== businessSlug);
      return { ok: true, storage: 'memory', businessSlug, total: 0, leads: [] };
    }

    await selectedPool.query('DELETE FROM call_leads WHERE business_slug = $1', [businessSlug]);
    return { ok: true, storage: 'postgres', businessSlug, total: 0, leads: [] };
  });
}
