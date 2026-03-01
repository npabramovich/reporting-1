# Security Audit Report

_Audited: March 1, 2026_

---

## CRITICAL

| # | Issue | Location |
|---|-------|----------|
| 1 | **No authorization on `/api/emails/[id]` PATCH** — any authenticated user can reassign any email's company across fund boundaries using the admin client | `app/api/emails/[id]/route.ts` |
| 2 | **No ownership check on `/api/companies/[id]/summary`** — all 3 handlers (GET/DELETE/POST) allow cross-fund access to AI summaries | `app/api/companies/[id]/summary/route.ts` |
| 3 | **No webhook signature verification** — inbound email webhook uses a query-string token instead of Postmark's HMAC signature header | `app/api/inbound-email/route.ts` |
| 4 | **`credentials.json` on disk** — Google OAuth client secret in the project root (gitignored but risky) | `credentials.json` |

## HIGH

| # | Issue | Location |
|---|-------|----------|
| 5 | **Open redirect in auth callback** — `next` query param used in redirect with no validation | `app/auth/callback/route.ts:9` |
| 6 | **Open redirect in Google OAuth** — `return_to` state param not validated | `app/api/auth/google/callback/route.ts:30` |
| 7 | **No security headers** — empty `next.config.mjs`, no CSP, HSTS, X-Frame-Options, X-Content-Type-Options | `next.config.mjs` |
| 8 | **No rate limiting anywhere** — auth endpoints, Claude API proxies, email sending all unprotected | Codebase-wide |
| 9 | **`postmarkWebhookToken` exposed to all fund members** — should be admin-only | `app/api/settings/route.ts:34` |
| 10 | **Outdated Next.js 14.2.0** — missing 2 years of security patches (SSRF, middleware bypass, server action vulns) | `package.json` |
| 11 | **No 2FA** — no multi-factor authentication option exists | Auth system |

## MEDIUM

| # | Issue | Location |
|---|-------|----------|
| 12 | **No admin role check on settings routes** — any fund member can add/delete authorized senders, change Drive settings, change Postmark config | `app/api/settings/senders/`, `app/api/settings/drive/` |
| 13 | **RLS too permissive** — `fund_settings` writable by any member, `fund_members` INSERT/DELETE not restricted to admins | `supabase/migrations/*_rls.sql` |
| 14 | **No CSRF tokens** — relies solely on `SameSite=Lax` cookies + JSON content-type | Codebase-wide |
| 15 | **Mass assignment / no input validation** — enum fields (`value_type`, `status`, `reporting_cadence`) not validated on PATCH routes | `app/api/metrics/[id]/`, `app/api/companies/[id]/` |
| 16 | **Supabase error messages leaked to clients** — 20+ routes return raw `error.message`, exposing table/column names | Codebase-wide |
| 17 | **`postmark_webhook_token` stored in plain text** — other secrets use envelope encryption, this one doesn't | `fund_settings` table |
| 18 | **Signup whitelist is client-side only** — calling Supabase auth API directly bypasses the check | `app/auth/signup/page.tsx` |
| 19 | **Webhook token in query string** — logged by proxies, CDNs, access logs | `app/api/inbound-email/route.ts` |
| 20 | **API routes bypass middleware auth** — every route must self-enforce auth; missing check = public endpoint | `middleware.ts:35` |

## LOW

| # | Issue | Location |
|---|-------|----------|
| 21 | **Email enumeration** via unauthenticated `/api/auth/check-email` | `app/api/auth/check-email/route.ts` |
| 22 | **Auth error messages reveal user existence** ("User not found" vs "Invalid password") | `app/auth/page.tsx` |
| 23 | **Google OAuth state not signed** — base64 JSON, could be tampered (partially mitigated by fund_id check) | `app/api/auth/google/route.ts` |

---

## What's Good

- **Encryption at rest**: AES-256-GCM envelope encryption for Claude API keys, Google secrets, refresh tokens (`lib/crypto.ts`)
- **No SQL injection**: all queries use Supabase query builder (parameterized)
- **No XSS**: zero `dangerouslySetInnerHTML`, React auto-escapes everything
- **No `eval`/dynamic code execution**
- **No sensitive data in localStorage** (only UI preferences)
- **`NEXT_PUBLIC_` env vars** properly limited to public keys
- **Layout-level auth enforcement** for all `(app)` pages
- **No GET mutations**
- **Sidebar/auth flow** well-structured

---

## Detailed Findings

### 1. Missing Authorization — `/api/emails/[id]` PATCH

The PATCH handler authenticates the user but then updates the `inbound_emails` record using `createAdminClient()` with only `eq('id', params.id)`. There is no check that the email belongs to the user's fund. An authenticated user could update `company_id` on any email in any fund.

**Fix:** Add a `fund_members` lookup to verify the email belongs to the user's fund before updating.

### 2. Missing Ownership Check — `/api/companies/[id]/summary`

All three handlers (GET, DELETE, POST) use the admin client to query `company_summaries` by `company_id` without verifying the company belongs to the user's fund.

**Fix:** Add fund_members ownership verification for all three handlers.

### 3. No Webhook Signature Verification

The inbound email webhook at `/api/inbound-email` uses a simple bearer token in a query parameter (`?token=...`) rather than Postmark's HMAC-based `X-Postmark-Signature` header verification. Query parameter tokens can be logged by proxies, CDNs, and application logs.

**Fix:** Implement Postmark webhook signature verification using HMAC. Move token out of query string.

### 4. Open Redirects

**Auth callback** (`app/auth/callback/route.ts:9`):
```typescript
const next = searchParams.get('next') ?? '/'
return NextResponse.redirect(`${origin}${next}`)
```
The `next` parameter is taken directly from the URL with no validation. An attacker could set `next=//evil.com`.

**Google OAuth** (`app/api/auth/google/callback/route.ts:30`):
```typescript
if (state.return_to) returnTo = state.return_to
return NextResponse.redirect(new URL(`${returnTo}...`, req.url))
```
The `return_to` value is not validated to be a relative path.

**Fix:** Validate that redirect targets start with `/` and do not start with `//`.

### 5. No Security Headers

`next.config.mjs` is completely empty. No security headers are configured:
- No `Content-Security-Policy` (CSP)
- No `Strict-Transport-Security` (HSTS)
- No `X-Frame-Options` (clickjacking)
- No `X-Content-Type-Options`
- No `Referrer-Policy`
- No `Permissions-Policy`

**Fix:** Add security headers in `next.config.mjs`:
```javascript
headers: async () => [{
  source: '/:path*',
  headers: [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  ],
}]
```

### 6. No Rate Limiting

No rate limiting is implemented on any endpoint. High-risk unprotected endpoints:
- `/api/inbound-email` — unauthenticated webhook, triggers Claude API calls
- `/api/test-claude-key` — makes real Anthropic API calls
- `/api/import` — triggers Claude API calls for data parsing
- `/api/companies/[id]/summary` — triggers Claude API calls
- `/api/emails/[id]/reprocess` — re-triggers entire processing pipeline
- `/api/auth/check-email` — information disclosure
- `/api/requests/send` — sends real emails via Gmail

**Fix:** Add rate limiting middleware, at minimum to auth and AI endpoints.

### 7. Missing Admin Role Checks

Several settings routes check for fund membership but not admin role:
- `app/api/settings/senders/route.ts` (POST) — any fund member can add authorized senders
- `app/api/settings/senders/[id]/route.ts` (DELETE) — any fund member can delete senders
- `app/api/settings/drive/route.ts` (PATCH/DELETE) — any fund member can change Drive settings
- `app/api/onboarding/postmark/route.ts` (PATCH) — any fund member can change Postmark settings

**Fix:** Add `membership.role === 'admin'` check to these routes.

### 8. RLS Policy Gaps

- `fund_settings` uses a single `FOR ALL` policy — any fund member can read/write settings directly via Supabase client
- `fund_members` allows any fund member to INSERT/DELETE other members
- No RLS policies found for `company_summaries` table

**Fix:** Restrict write policies to admin role. Add RLS for `company_summaries`.

### 9. Input Validation Gaps

Several PATCH routes accept enum fields without validation:
- `app/api/metrics/[id]/route.ts` — `value_type`, `reporting_cadence`, `unit_position` not validated
- `app/api/companies/[id]/route.ts` — `status` cast to `CompanyStatus` without checking the value
- `app/api/settings/route.ts` — `claudeModel` trimmed but not validated against known models

**Fix:** Add enum validation for all constrained fields.

### 10. Error Message Leakage

20+ API routes return raw Supabase `error.message` to clients, potentially exposing table names, column names, and constraint names.

Affected files (non-exhaustive):
- `app/api/metrics/[id]/route.ts`
- `app/api/companies/[id]/route.ts`
- `app/api/companies/route.ts`
- `app/api/settings/route.ts`
- `app/api/requests/route.ts`

**Fix:** Return generic error messages in production. Log detailed errors server-side only.

### 11. Outdated Next.js

Running Next.js 14.2.0 (April 2024). Multiple security patches released since, addressing:
- Server action vulnerabilities
- SSRF issues
- Middleware bypasses

**Fix:** Upgrade to latest Next.js 14.x or 15.x.

---

## Route-by-Route Summary

| Route | Auth | Authz | Issues |
|-------|------|-------|--------|
| `auth/logout` POST | None (ok) | N/A | None |
| `auth/check-email` POST | **NONE** | **NONE** | Unauthenticated, email enumeration |
| `auth/branding` GET | **NONE** | **NONE** | Public endpoint (intentional) |
| `auth/google` GET | Yes | fund_members | None |
| `auth/google/callback` GET | Yes | fund_members | Open redirect |
| `inbound-email` POST | Token-based | Sender check | No HMAC verification |
| `demo/seed` POST | Yes | **No role check** | No admin check |
| `metrics/[id]` PATCH/DELETE | Yes | fund_members | No enum validation |
| `metric-values/[id]` PATCH/DELETE | Yes | fund_members | None |
| `companies` GET/POST | Yes | RLS + fund_members | None |
| `companies/[id]` GET/PATCH | Yes | fund_members | Weak enum validation |
| `companies/[id]/summary` GET/DELETE/POST | Yes | **NO ownership check** | Cross-fund access |
| `companies/[id]/notes` GET/POST | Yes | RLS | None |
| `companies/[id]/notes/[noteId]` PATCH/DELETE | Yes | Owner/admin | None |
| `emails` GET | Yes | RLS | None |
| `emails/[id]` GET/PATCH | Yes | RLS (GET) / **NONE (PATCH)** | PATCH no authz |
| `emails/[id]/reprocess` POST | Yes | RLS | None |
| `emails/[id]/reviews` GET/POST | Yes | RLS | None |
| `review` GET | Yes | RLS | None |
| `review/[id]/resolve` POST | Yes | RLS | None |
| `requests` GET/POST | Yes | fund_members | No recipient validation |
| `requests/send` POST | Yes | fund_members + admin | None |
| `settings` GET/PATCH/DELETE | Yes | fund_members + admin | Webhook token exposed to all |
| `settings/senders` POST | Yes | fund_members | **No admin role check** |
| `settings/senders/[id]` DELETE | Yes | fund_members | **No admin role check** |
| `settings/members` GET | Yes | fund_members | None |
| `settings/members/[id]` PATCH | Yes | fund_members + admin | None |
| `settings/whitelist` GET/POST | Yes | admin | None |
| `settings/whitelist/[id]` DELETE | Yes | admin | None |
| `settings/drive` PATCH/DELETE | Yes | fund_members | No admin check |
| `settings/drive/folders` GET/POST | Yes | fund_members | None |
| `dashboard/table-data` GET | Yes | fund_members | None |
| `dashboard/notes` GET/POST | Yes | fund_members | None |
| `dashboard/notes/[noteId]` PATCH/DELETE | Yes | fund_members + owner/admin | None |
| `import` POST | Yes | fund_members | Well-protected (has sanitize()) |

---

## TODO

- [ ] Fix `/api/emails/[id]` PATCH — add fund ownership check
- [ ] Fix `/api/companies/[id]/summary` — add fund ownership check to all handlers
- [ ] Implement Postmark HMAC webhook signature verification
- [ ] Remove `credentials.json` from project root
- [ ] Fix open redirects in auth callback and Google OAuth callback
- [ ] Add security headers to `next.config.mjs`
- [ ] Add rate limiting (auth endpoints, AI endpoints, email sending)
- [ ] Restrict `postmarkWebhookToken` to admin-only in settings GET
- [ ] Upgrade Next.js to latest version
- [ ] Add 2FA / multi-factor authentication
- [ ] Add admin role checks to senders, drive, postmark settings routes
- [ ] Tighten RLS policies (fund_settings writes, fund_members INSERT/DELETE)
- [ ] Add enum validation on PATCH routes (metrics, companies, settings)
- [ ] Replace raw error.message responses with generic errors in production
- [ ] Encrypt `postmark_webhook_token` at rest
- [ ] Enforce signup whitelist server-side (Supabase auth hook)
- [ ] Move webhook token from query string to Authorization header
- [ ] Sign Google OAuth state parameter
