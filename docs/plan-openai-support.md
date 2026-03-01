# Add OpenAI Support

## Context
Currently the app only supports Anthropic Claude for all AI operations (email parsing, metric extraction, company identification, AI summaries, bulk import). The goal is to add OpenAI as an alternative provider so fund admins can configure either (or both) API keys and choose which provider/model to use. The provider choice should also be available at the point of use — specifically in the AI Analyst summary card on company pages.

---

## Current Architecture (Reference)

**AI call sites** (all use Anthropic SDK directly):
- `lib/claude/identifyCompany.ts` — company identification from emails
- `lib/claude/extractMetrics.ts` — metric extraction from reports (supports PDF/image blocks)
- `app/api/companies/[id]/summary/route.ts` — AI summary generation (supports PDF/image blocks)
- `app/api/import/route.ts` — bulk data parsing
- `app/api/test-claude-key/route.ts` — API key validation
- `app/api/claude-models/route.ts` — model list from Anthropic API

**Settings storage:**
- `fund_settings.claude_api_key_encrypted` — encrypted with envelope encryption (`lib/crypto.ts`)
- `fund_settings.encryption_key_encrypted` — per-fund DEK
- `fund_settings.claude_model` — text, default `'claude-sonnet-4-5'`

**Key helpers** (`lib/pipeline/processEmail.ts`):
- `getClaudeApiKey(supabase, fundId)` — decrypts and returns API key
- `getClaudeModel(supabase, fundId)` — returns model string

---

## 1. Database Migration
**New file:** `supabase/migrations/20260301000001_openai_support.sql`

```sql
-- Add OpenAI credentials and default provider
ALTER TABLE fund_settings
  ADD COLUMN openai_api_key_encrypted text,
  ADD COLUMN openai_model text NOT NULL DEFAULT 'gpt-4o',
  ADD COLUMN default_ai_provider text NOT NULL DEFAULT 'anthropic';
  -- default_ai_provider: 'anthropic' | 'openai'
```

The OpenAI key reuses the same per-fund DEK (`encryption_key_encrypted`) for envelope encryption — no new encryption columns needed.

## 2. TypeScript Types
**Modify:** `lib/types/database.ts`

Add `openai_api_key_encrypted`, `openai_model`, and `default_ai_provider` to the `fund_settings` Row/Insert/Update types.

## 3. Unified AI Abstraction Layer
**New file:** `lib/ai/provider.ts`

A thin abstraction that normalizes Anthropic and OpenAI into a shared interface for text-based chat completions:

```typescript
export type AIProvider = 'anthropic' | 'openai'

export interface AIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | AIContentBlock[]
}

export interface AIContentBlock {
  type: 'text' | 'image_url' | 'document'
  // text blocks: text field
  // image blocks: base64 data + media type
  // document blocks: base64 data + media type (Anthropic-only, converted to text extraction note for OpenAI)
}

export interface AICompletionOptions {
  provider: AIProvider
  apiKey: string
  model: string
  maxTokens: number
  system?: string
  messages: AIMessage[]
}

export interface AICompletionResult {
  text: string
}

export async function createCompletion(options: AICompletionOptions): Promise<AICompletionResult>
```

**Implementation notes:**
- For Anthropic: wraps the existing `@anthropic-ai/sdk` calls, converts `AIMessage` to Anthropic's `MessageParam` format, handles `system` as a top-level param
- For OpenAI: uses `openai` npm package, converts `AIMessage` to OpenAI's chat completion format, puts `system` in the messages array
- **PDF/image handling:** Anthropic supports native PDF document blocks and image blocks. OpenAI supports image URLs/base64 via `image_url` content parts but does NOT support native PDF blocks. For OpenAI, PDFs will be skipped (the extracted text is already included as text content, so PDFs are supplementary). Images will be converted to OpenAI's `image_url` format with base64 data URLs.

## 4. Refactor AI Call Sites

**Modify:** `lib/claude/identifyCompany.ts`
- Rename to `lib/ai/identifyCompany.ts` (or keep in place and update imports)
- Replace direct `Anthropic` client usage with `createCompletion()` from the provider abstraction
- Accept `provider: AIProvider` and `apiKey: string` instead of just `claudeApiKey`
- Text-only prompts — works identically on both providers

**Modify:** `lib/claude/extractMetrics.ts`
- Rename to `lib/ai/extractMetrics.ts` (or keep in place)
- Replace direct `Anthropic` client usage with `createCompletion()`
- Accept `provider: AIProvider` and `apiKey: string`
- For PDF blocks: include with Anthropic, skip for OpenAI (text extraction is already in the prompt)
- For image blocks: convert to OpenAI's `image_url` base64 format when using OpenAI

**Modify:** `app/api/companies/[id]/summary/route.ts`
- Replace `Anthropic` client with `createCompletion()`
- Get provider + API key + model from fund settings (or from request body if overridden)
- Same PDF/image handling as extractMetrics

**Modify:** `app/api/import/route.ts`
- Replace `Anthropic` client with `createCompletion()`
- Text-only prompts — works identically on both providers

**Modify:** `lib/pipeline/processEmail.ts`
- Add `getAIProvider(supabase, fundId)` helper alongside existing helpers
- Add `getOpenAIApiKey(supabase, fundId)` helper using same `decryptApiKey` pattern
- Update `runPipeline` to pass provider info to `identifyCompany` and `extractMetrics`

## 5. New API Routes

**New file:** `app/api/test-openai-key/route.ts`
- POST: Validates OpenAI API key by making a minimal chat completion call
- Pattern: identical to `test-claude-key` but using `openai` SDK

**New file:** `app/api/openai-models/route.ts`
- GET: Fetches available models from OpenAI API using the stored key
- Filters to GPT models only (filter by `id` containing `gpt` or `o1` or `o3` or similar)
- Returns `{ id, name }[]` sorted by creation date

**Modify:** `app/api/settings/route.ts`
- GET: Add `hasOpenAIKey`, `openaiModel`, `defaultAIProvider` to response
- PATCH: Handle `openaiApiKey`, `openaiModel`, `defaultAIProvider` fields
  - `openaiApiKey` encrypted using same DEK pattern as Claude key
  - Admin-only fields

## 6. Settings Page UI
**Modify:** `app/(app)/settings/page.tsx`

Add a new section below (or alongside) the existing Claude Key section:

**Option A — Combined "AI Providers" section:**
- Rename "Claude API key" section to "AI Providers"
- Two sub-sections side by side or stacked: Anthropic and OpenAI
- Each has: API key input, test button, save button, model selector dropdown
- Below both: "Default provider" radio/toggle (Anthropic or OpenAI)
- Default provider is used for email processing, imports, and as the initial selection for summaries

**OpenAI Key Section** (mirrors `ClaudeKeySection` pattern):
- Password input for `sk-...` style OpenAI keys
- Test button → `POST /api/test-openai-key`
- Save button → `PATCH /api/settings` with `openaiApiKey`
- Model dropdown populated from `GET /api/openai-models` (shown after key is configured)

**Default Provider Toggle:**
- Simple two-option selector: "Anthropic" / "OpenAI"
- Only shows options that have a configured API key
- Saves via `PATCH /api/settings` with `defaultAIProvider`

## 7. AI Analyst Provider Choice (Company Summary)
**Modify:** `app/(app)/companies/[id]/company-summary.tsx`

- Add a small provider selector next to the "Generate summary" / regenerate button
- Only shown if both providers are configured (fund has both API keys)
- If only one provider is configured, use that provider without showing the selector
- Selector: small segmented control or dropdown showing "Claude" / "GPT" (or the model names)
- Passes the selected provider to `POST /api/companies/{id}/summary` via request body: `{ provider?: 'anthropic' | 'openai' }`

**Modify:** `app/api/companies/[id]/summary/route.ts`
- Accept optional `{ provider }` in POST body
- If provided, use that provider's API key + model; otherwise use fund default
- Response unchanged

## 8. NPM Dependency
**Modify:** `package.json`

Add `openai` package:
```bash
npm install openai
```

---

## Files Summary

| File | Action |
|------|--------|
| `supabase/migrations/20260301000001_openai_support.sql` | New — add columns to fund_settings |
| `lib/types/database.ts` | Modify — add OpenAI fields to fund_settings types |
| `lib/ai/provider.ts` | New — unified AI abstraction layer |
| `lib/claude/identifyCompany.ts` | Modify — use provider abstraction |
| `lib/claude/extractMetrics.ts` | Modify — use provider abstraction |
| `lib/pipeline/processEmail.ts` | Modify — add OpenAI helpers, pass provider to AI calls |
| `app/api/companies/[id]/summary/route.ts` | Modify — accept provider param, use abstraction |
| `app/api/import/route.ts` | Modify — use provider abstraction |
| `app/api/test-openai-key/route.ts` | New — validate OpenAI key |
| `app/api/openai-models/route.ts` | New — list OpenAI models |
| `app/api/settings/route.ts` | Modify — handle OpenAI settings fields |
| `app/(app)/settings/page.tsx` | Modify — add OpenAI key section + default provider |
| `app/(app)/companies/[id]/company-summary.tsx` | Modify — provider selector in AI Analyst card |
| `package.json` | Modify — add `openai` dependency |

## Key Considerations

- **PDF support gap:** Anthropic supports native PDF document blocks; OpenAI does not. The extracted text from PDFs (via the existing parsing pipeline) is always included as text content, so the data is still available to OpenAI — it just can't "see" the raw PDF. This is an acceptable tradeoff. Images work on both providers.
- **Prompt compatibility:** The prompts are plain text with JSON response instructions. They work on both providers without modification. The system prompts and retry logic translate directly.
- **Encryption reuse:** The existing envelope encryption pattern (master KEK → per-fund DEK → API key) is reused for the OpenAI key. No new encryption infrastructure needed.
- **Backward compatible:** `default_ai_provider` defaults to `'anthropic'`, so existing deployments continue working with zero changes.

## Verification
- Admin can add OpenAI API key in Settings, test it, select a model
- Default provider toggle appears when both keys are configured
- Email processing uses the default provider for parsing
- AI Analyst card on company pages shows provider selector (if both configured)
- Generating a summary with OpenAI selected works and persists
- Existing Anthropic-only deployments continue working unchanged
- `npx next build` passes
