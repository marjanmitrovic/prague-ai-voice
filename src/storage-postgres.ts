import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { env } from './config/env.js';

const { Pool } = pg;

export const DEFAULT_BUSINESS_SLUG = 'studio-aurora';
export const SECONDARY_DEMO_SLUG = 'barber-nova';

export type ProfileRow = { slug: string; profile_json: string; updated_at: string };
export type BusinessSummary = { slug: string; companyName: string; description: string; servicesCount: number; updatedAt?: string };
export type BookingRow = {
  id: string;
  business_slug: string;
  status: string;
  service_name: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  date: string;
  time: string;
  note: string | null;
  start_minutes: number | null;
  end_minutes: number | null;
  duration_minutes: number | null;
  created_at: string;
  updated_at: string;
};

let pool: pg.Pool | null = null;
let profileJsonCache = new Map<string, string>();
let bookingsCache: BookingRow[] = [];
let initialized = false;
let mode: 'postgres' | 'json-memory' = 'json-memory';

function defaultProfilePath(): string {
  return resolve(process.cwd(), 'data', 'business-profile.json');
}

function legacyBookingsPath(): string {
  return resolve(process.cwd(), 'data', 'bookings.json');
}

function normalizeSlug(input: string | undefined | null): string {
  const raw = String(input || DEFAULT_BUSINESS_SLUG).toLowerCase().trim();
  const slug = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || DEFAULT_BUSINESS_SLUG;
}

export function safeBusinessSlug(input?: string | null): string {
  return normalizeSlug(input);
}

function loadSeedProfileJson(): string {
  const path = defaultProfilePath();
  if (!existsSync(path)) throw new Error(`Business profile seed file not found: ${path}`);
  return withBusinessSlug(readFileSync(path, 'utf8'), DEFAULT_BUSINESS_SLUG);
}

function withBusinessSlug(profileJson: string, slug: string): string {
  const parsed = JSON.parse(profileJson) as Record<string, unknown>;
  parsed.businessSlug = normalizeSlug(String(parsed.businessSlug || slug));
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function createSecondaryDemoProfileJson(seedProfileJson: string): string {
  const profile = JSON.parse(seedProfileJson) as Record<string, any>;
  profile.businessSlug = SECONDARY_DEMO_SLUG;
  profile.companyName = 'Barber Nova Praha';
  profile.assistantName = 'Nova AI';
  profile.description = 'Testovací barber shop pro ukázku více firem v jedné aplikaci.';
  profile.address = 'Testovací barber adresa, Praha';
  profile.services = [
    {
      name: 'Pánský střih',
      description: 'Klasický pánský střih včetně úpravy detailů.',
      price: '550 Kč',
      spokenPrice: 'pět set padesát korun',
      duration: '40 minut',
      durationMinutes: 40,
      bookingEnabled: true,
    },
    {
      name: 'Úprava vousů',
      description: 'Tvarování vousů a kontur.',
      price: '350 Kč',
      spokenPrice: 'tři sta padesát korun',
      duration: '25 minut',
      durationMinutes: 25,
      bookingEnabled: true,
    },
    {
      name: 'Střih a vousy',
      description: 'Kompletní balíček střihu a úpravy vousů.',
      price: '850 Kč',
      spokenPrice: 'osm set padesát korun',
      duration: '70 minut',
      durationMinutes: 70,
      bookingEnabled: true,
    },
  ];
  return `${JSON.stringify(profile, null, 2)}\n`;
}

function legacyBookingsFromJson(): BookingRow[] {
  const path = legacyBookingsPath();
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as { bookings?: Array<Record<string, unknown>> };
  const bookings = Array.isArray(parsed.bookings) ? parsed.bookings : [];
  return bookings.map((booking) => {
    const createdAt = String(booking.createdAt ?? new Date().toISOString());
    return {
      id: String(booking.id),
      business_slug: safeBusinessSlug(String(booking.businessSlug || DEFAULT_BUSINESS_SLUG)),
      status: String(booking.status ?? 'requested'),
      service_name: String(booking.serviceName),
      customer_name: String(booking.customerName),
      customer_phone: String(booking.customerPhone),
      customer_email: booking.customerEmail == null ? null : String(booking.customerEmail),
      date: String(booking.date),
      time: String(booking.time),
      note: booking.note == null ? '' : String(booking.note),
      start_minutes: typeof booking.startMinutes === 'number' ? booking.startMinutes : null,
      end_minutes: typeof booking.endMinutes === 'number' ? booking.endMinutes : null,
      duration_minutes: typeof booking.durationMinutes === 'number' ? booking.durationMinutes : null,
      created_at: createdAt,
      updated_at: new Date().toISOString(),
    };
  });
}

function ensureCacheLoaded(): void {
  if (!profileJsonCache.has(DEFAULT_BUSINESS_SLUG)) {
    profileJsonCache.set(DEFAULT_BUSINESS_SLUG, loadSeedProfileJson());
  }
}

function businessSummaryFromJson(slug: string, profileJson: string, updatedAt?: string): BusinessSummary {
  const profile = JSON.parse(profileJson) as { companyName?: string; description?: string; services?: unknown[] };
  const summary: BusinessSummary = {
    slug,
    companyName: profile.companyName || slug,
    description: profile.description || '',
    servicesCount: Array.isArray(profile.services) ? profile.services.length : 0,
  };
  if (updatedAt !== undefined) summary.updatedAt = updatedAt;
  return summary;
}

export function getStorageInfo() {
  return {
    mode,
    databaseUrlConfigured: Boolean(env.DATABASE_URL),
    initialized,
    businessesCount: profileJsonCache.size,
  };
}

export async function initializeStorage(): Promise<void> {
  if (initialized) return;

  const seed = loadSeedProfileJson();
  profileJsonCache = new Map([[DEFAULT_BUSINESS_SLUG, seed]]);
  bookingsCache = legacyBookingsFromJson();

  if (!env.DATABASE_URL) {
    profileJsonCache.set(SECONDARY_DEMO_SLUG, createSecondaryDemoProfileJson(seed));
    mode = 'json-memory';
    initialized = true;
    return;
  }

  const poolConfig: pg.PoolConfig = { connectionString: env.DATABASE_URL, max: 5 };
  if (env.DATABASE_URL.includes('sslmode=require')) poolConfig.ssl = { rejectUnauthorized: false };
  pool = new Pool(poolConfig);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS business_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      profile_json TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS business_profiles (
      slug TEXT PRIMARY KEY,
      profile_json TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      business_slug TEXT NOT NULL DEFAULT 'studio-aurora',
      status TEXT NOT NULL DEFAULT 'requested',
      service_name TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_email TEXT,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      note TEXT,
      start_minutes INTEGER,
      end_minutes INTEGER,
      duration_minutes INTEGER,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS business_slug TEXT NOT NULL DEFAULT 'studio-aurora';
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_email TEXT;

    CREATE INDEX IF NOT EXISTS idx_bookings_business_date_status ON bookings(business_slug, date, status);
    CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at);
  `);

  const legacyProfile = await pool.query<{ profile_json: string }>('SELECT profile_json FROM business_profile WHERE id = 1');
  const initialDefaultProfile = legacyProfile.rowCount ? withBusinessSlug(legacyProfile.rows[0]?.profile_json ?? seed, DEFAULT_BUSINESS_SLUG) : seed;

  await pool.query(
    `INSERT INTO business_profiles (slug, profile_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (slug) DO NOTHING`,
    [DEFAULT_BUSINESS_SLUG, initialDefaultProfile],
  );
  await pool.query(
    `INSERT INTO business_profiles (slug, profile_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (slug) DO NOTHING`,
    [SECONDARY_DEMO_SLUG, createSecondaryDemoProfileJson(seed)],
  );

  const count = await pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM bookings');
  if (Number(count.rows[0]?.count ?? 0) === 0 && bookingsCache.length > 0) {
    for (const booking of bookingsCache) await insertBookingRowInPostgres(booking);
  }

  const profileRows = await pool.query<ProfileRow>('SELECT slug, profile_json, updated_at FROM business_profiles ORDER BY slug');
  profileJsonCache = new Map(profileRows.rows.map((row) => [row.slug, withBusinessSlug(row.profile_json, row.slug)]));

  const rows = await pool.query<BookingRow>('SELECT * FROM bookings ORDER BY date DESC, time DESC, created_at DESC');
  bookingsCache = rows.rows;
  mode = 'postgres';
  initialized = true;
}

export async function closeStorage(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
  initialized = false;
}

export function readProfileJson(businessSlug = DEFAULT_BUSINESS_SLUG): string {
  ensureCacheLoaded();
  const slug = safeBusinessSlug(businessSlug);
  const profile = profileJsonCache.get(slug) || profileJsonCache.get(DEFAULT_BUSINESS_SLUG);
  if (!profile) throw new Error('Business profile not loaded');
  return profile;
}

export async function writeProfileJson(profileJson: string, businessSlug = DEFAULT_BUSINESS_SLUG): Promise<void> {
  ensureCacheLoaded();
  const slug = safeBusinessSlug(businessSlug);
  const normalizedProfile = withBusinessSlug(profileJson, slug);
  profileJsonCache.set(slug, normalizedProfile);
  if (!pool) return;
  await pool.query(
    `INSERT INTO business_profiles (slug, profile_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (slug) DO UPDATE SET profile_json = EXCLUDED.profile_json, updated_at = NOW()`,
    [slug, normalizedProfile],
  );
}

export function listBusinessSummaries(): BusinessSummary[] {
  ensureCacheLoaded();
  return [...profileJsonCache.entries()].map(([slug, profileJson]) => businessSummaryFromJson(slug, profileJson)).sort((a, b) => a.companyName.localeCompare(b.companyName));
}

export function listBookingRows(businessSlug?: string): BookingRow[] {
  const slug = businessSlug ? safeBusinessSlug(businessSlug) : undefined;
  const rows = slug ? bookingsCache.filter((booking) => booking.business_slug === slug) : bookingsCache;
  return [...rows].sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));
}

export function listBookingRowsForDate(date: string, businessSlug = DEFAULT_BUSINESS_SLUG): BookingRow[] {
  const slug = safeBusinessSlug(businessSlug);
  return bookingsCache
    .filter((booking) => booking.business_slug === slug && booking.date === date && booking.status === 'requested')
    .sort((a, b) => a.time.localeCompare(b.time));
}

async function insertBookingRowInPostgres(row: BookingRow): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO bookings (
      id, business_slug, status, service_name, customer_name, customer_phone, customer_email, date, time, note,
      start_minutes, end_minutes, duration_minutes, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    ON CONFLICT (id) DO NOTHING`,
    [
      row.id,
      row.business_slug,
      row.status,
      row.service_name,
      row.customer_name,
      row.customer_phone,
      row.customer_email,
      row.date,
      row.time,
      row.note,
      row.start_minutes,
      row.end_minutes,
      row.duration_minutes,
      row.created_at,
      row.updated_at,
    ],
  );
}

export async function insertBookingRow(row: BookingRow): Promise<void> {
  const normalized = { ...row, business_slug: safeBusinessSlug(row.business_slug) };
  bookingsCache = [normalized, ...bookingsCache.filter((booking) => booking.id !== normalized.id)];
  await insertBookingRowInPostgres(normalized);
}

export async function resetDemoDataFromJsonSeed(businessSlug?: string): Promise<void> {
  const slug = businessSlug ? safeBusinessSlug(businessSlug) : undefined;
  const seed = loadSeedProfileJson();
  if (slug) {
    const profile = slug === SECONDARY_DEMO_SLUG ? createSecondaryDemoProfileJson(seed) : withBusinessSlug(seed, slug);
    profileJsonCache.set(slug, profile);
    bookingsCache = bookingsCache.filter((booking) => booking.business_slug !== slug);
    if (!pool) return;
    await pool.query('DELETE FROM bookings WHERE business_slug = $1', [slug]);
    await pool.query(
      `INSERT INTO business_profiles (slug, profile_json, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (slug) DO UPDATE SET profile_json = EXCLUDED.profile_json, updated_at = NOW()`,
      [slug, profile],
    );
    return;
  }

  profileJsonCache = new Map([
    [DEFAULT_BUSINESS_SLUG, seed],
    [SECONDARY_DEMO_SLUG, createSecondaryDemoProfileJson(seed)],
  ]);
  bookingsCache = [];
  if (!pool) return;
  await pool.query('DELETE FROM bookings');
  await pool.query(
    `INSERT INTO business_profiles (slug, profile_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (slug) DO UPDATE SET profile_json = EXCLUDED.profile_json, updated_at = NOW()`,
    [DEFAULT_BUSINESS_SLUG, seed],
  );
  await pool.query(
    `INSERT INTO business_profiles (slug, profile_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (slug) DO UPDATE SET profile_json = EXCLUDED.profile_json, updated_at = NOW()`,
    [SECONDARY_DEMO_SLUG, createSecondaryDemoProfileJson(seed)],
  );
}
