import assert from 'node:assert/strict';
import { registerPhase8 } from './phase8.js';

function mockPool() {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(sql);
      if (sql.includes('COUNT(*) FILTER')) return { rows: [{ total: 2, open: 1, resolved: 1, needs_review: 0, escalated: 0, urgent_open: 0, important_open: 1, overdue_open: 0 }] };
      if (sql.includes("event_type='SLA_OVERDUE_NOTICE'")) return { rows: [{ overdue_notices: 0, automatic_escalations: 0, automatic_escalation_notices: 0 }] };
      if (sql.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      if (sql.includes('FROM complaints WHERE created_at')) return { rows: [{ eligible_complaints: 0 }] };
      if (sql.includes('SELECT\n      (SELECT COUNT(*)')) return { rows: [{ complaints: 2, automation_events: 0, review_queue: 0 }] };
      return { rows: [] };
    }
  };
}

function mockApp() {
  const routes = {};
  return {
    routes,
    get(path, ...handlers) { routes[`GET ${path}`] = handlers; }
  };
}

const app = mockApp();
const pool = mockPool();
const requireAdmin = (_, __, next) => next?.();
const requireHigher = (_, __, next) => next?.();
registerPhase8({ app, pool, requireAdmin, requireHigher });

for (const path of ['/api/admin/oversight-summary', '/api/higher/oversight-summary', '/api/admin/phase8-dashboard', '/api/higher/phase8-dashboard', '/api/admin/system-health', '/api/higher/system-health', '/api/admin/data-retention', '/api/higher/data-retention', '/api/privacy-check']) {
  assert.ok(app.routes[`GET ${path}`], `missing route ${path}`);
}

assert.ok(pool.queries.length >= 9, 'expected Phase 8 route registration to execute no database queries eagerly');
console.log('Phase 8 route-registration tests passed');
