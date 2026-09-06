export type ClientActivityAction =
  | 'client_created'
  | 'client_updated'
  | 'client_restored'
  | 'client_deleted';

export type ClientActivityEntry = {
  id: string;
  createdAt: string;
  action: ClientActivityAction;
  businessSlug: string;
  companyName: string;
  message: string;
  details?: Record<string, unknown>;
};

const MAX_ACTIVITY_ITEMS = 300;
let clientActivityLog: ClientActivityEntry[] = [];

function activityId(action: ClientActivityAction, businessSlug: string): string {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 17);
  const random = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${action}-${businessSlug}-${random}`;
}

export function recordClientActivity(input: {
  action: ClientActivityAction;
  businessSlug: string;
  companyName: string;
  message: string;
  details?: Record<string, unknown>;
}): ClientActivityEntry {
  const entry: ClientActivityEntry = {
    id: activityId(input.action, input.businessSlug),
    createdAt: new Date().toISOString(),
    action: input.action,
    businessSlug: input.businessSlug,
    companyName: input.companyName,
    message: input.message,
  };
  if (input.details) entry.details = input.details;
  clientActivityLog = [entry, ...clientActivityLog].slice(0, MAX_ACTIVITY_ITEMS);
  return entry;
}

export function listClientActivity(businessSlug?: string): ClientActivityEntry[] {
  const slug = businessSlug?.trim();
  const entries = slug ? clientActivityLog.filter((entry) => entry.businessSlug === slug) : clientActivityLog;
  return entries.slice(0, MAX_ACTIVITY_ITEMS);
}
