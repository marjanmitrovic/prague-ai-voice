import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import { env } from '../config/env.js';
import { sendCallLeadEmail } from '../email/call-lead-email.js';
import { DEFAULT_BUSINESS_SLUG, safeBusinessSlug } from '../storage-postgres.js';

const { Pool } = pg;

export type CallLeadStatus = 'nové' | 'volat zpět' | 'rezervace' | 'hotovo';

export type CallLeadInput = {
  businessSlug?: string;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  message: string;
  ownerNote?: string;
  status?: CallLeadStatus;
  source?: string;
};

type CallLeadRow = {
  id: string;
  business_slug: string;
  status: CallLeadStatus;
  customer_name: string;
  customer_phone: string;
  service_name: string;
  message: string;
  owner_note: string | null;
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
  ownerNote: z.string().trim().max(2000).optional().default(''),
  status: z.enum(['nové', 'volat zpět', 'rezervace', 'hotovo']).optional().default('nové'),
  source: z.string().trim().min(1).max(80).optional().default('missed_call_demo'),
});

const updateLeadSchema = z.object({
  status: z.enum(['nové', 'volat zpět', 'rezervace', 'hotovo']).optional(),
  ownerNote: z.string().trim().max(2000).optional(),
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
      owner_note TEXT,
      source TEXT NOT NULL DEFAULT 'missed_call',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE call_leads ADD COLUMN IF NOT EXISTS owner_note TEXT;
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
    ownerNote: row.owner_note || '',
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

export async function createCallLead(input: CallLeadInput) {
  const businessSlug = safeBusinessSlug(input.businessSlug || DEFAULT_BUSINESS_SLUG);
  const now = new Date().toISOString();
  const row: CallLeadRow = {
    id: randomUUID(),
    business_slug: businessSlug,
    status: input.status || 'nové',
    customer_name: input.customerName,
    customer_phone: input.customerPhone,
    service_name: input.serviceName,
    message: input.message,
    owner_note: input.ownerNote || '',
    source: input.source || 'missed_call',
    created_at: now,
    updated_at: now,
  };

  const selectedPool = await ensureCallLeadTable();
  if (!selectedPool) {
    memoryLeads = [row, ...memoryLeads].slice(0, 300);
    const notification = await notifyLead(row);
    return { storage: 'memory', lead: publicLead(row), notification };
  }

  await selectedPool.query(
    `INSERT INTO call_leads (
      id, business_slug, status, customer_name, customer_phone, service_name, message, owner_note, source, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      row.id,
      row.business_slug,
      row.status,
      row.customer_name,
      row.customer_phone,
      row.service_name,
      row.message,
      row.owner_note,
      row.source,
      row.created_at,
      row.updated_at,
    ],
  );

  const notification = await notifyLead(row);
  return { storage: 'postgres', lead: publicLead(row), notification };
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

    const result = await createCallLead(parsed.data);
    return reply.code(201).send({ ok: true, ...result });
  });

  app.patch('/api/call-leads/:id', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    const id = (request.params as { id: string }).id;
    const parsed = updateLeadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });

    if (parsed.data.status === undefined && parsed.data.ownerNote === undefined) {
      return reply.code(400).send({ error: 'invalid_request', message: 'Není co uložit.' });
    }

    const selectedPool = await ensureCallLeadTable();
    if (!selectedPool) {
      memoryLeads = memoryLeads.map((lead) => lead.id === id
        ? {
            ...lead,
            status: parsed.data.status ?? lead.status,
            owner_note: parsed.data.ownerNote ?? lead.owner_note,
            updated_at: new Date().toISOString(),
          }
        : lead);
      const lead = memoryLeads.find((item) => item.id === id);
      if (!lead) return reply.code(404).send({ error: 'not_found' });
      return { ok: true, storage: 'memory', lead: publicLead(lead) };
    }

    const rows = await selectedPool.query<CallLeadRow>(
      `UPDATE call_leads
       SET status = COALESCE($1, status), owner_note = COALESCE($2, owner_note), updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [parsed.data.status ?? null, parsed.data.ownerNote ?? null, id],
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
