Block 00 — Persona & Workflow
You are a senior full-stack engineer (20 years). Work in small commits. Execute one block at a time (in order). After each block: append to docs/progress/module_auth_clerk.md under Done / Pending / Errors / Notes / Commit. If something is unclear, choose the safest default, document it, and proceed.

Block 01 — Scope (what this module delivers)
Add Clerk authentication to the frontend, create User / Organization / Membership models in Postgres via Prisma, protect upload/dashboard routes, and attach userId/orgId to jobs. No billing/UI redesign in this module.

Block 02 — Acceptance Criteria

Users can sign in/up via Clerk on the frontend.

Protected pages (dashboard/upload) require auth.

On first authenticated visit, a User record exists; an Organization is created or linked; a Membership ties them.

New uploads save userId and orgId on the Job.

/api/upload rejects unauthenticated requests (401).

Progress log updated after each block.

Block 03 — Env & Config
Add to frontend .env.local.example:

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SIGN_IN_URL=/sign-in
CLERK_SIGN_UP_URL=/sign-up


Add to backend .env.example:

CLERK_JWT_ISSUER= (if using JWT templates)
CLERK_JWKS_URL=   (or use Clerk SDK verify)


Config: Production frontend must still point API to https://api.firmflow.in.

Block 04 — Prisma models (run migrate)
Extend schema.prisma:

User (id: string pk, email, name, createdAt)

Organization (id: string pk, name, createdAt)

Membership (id, userId fk, orgId fk, role: enum['owner','member'])

Add to Job: userId String?, orgId String? (FKs).
Run: npx prisma migrate dev -n auth_org_models
✅ Update progress file.

Block 05 — Frontend: Clerk wiring (minimal)

Install Clerk React SDK.

Wrap app root with <ClerkProvider>.

Add /sign-in & /sign-up routes (Clerk components).

Protect /dashboard and upload page with <SignedIn> / redirect unauthenticated users.
✅ Validate: you can sign up/in locally; protected page requires auth.
✅ Update progress file.

Block 06 — Backend: auth middleware

Add Clerk verification middleware (verify session/JWT).

Protect /api/upload and any write endpoints: if no valid user → 401.

Extract userId into req.auth.userId.
✅ Test with a request missing auth → 401.
✅ Update progress file.

Block 07 — User bootstrap & Org linkage

Add backend endpoint /api/me/bootstrap (or run on first authed call):

If no User row → create from Clerk claims (id/email/name).

If user has no org → create Organization (name from email domain or “Personal Workspace”) and a Membership as owner.

Return { userId, orgId }.

Frontend: on first authed dashboard load, call /api/me/bootstrap, cache {userId, orgId} in app state.
✅ Update progress file.

Block 08 — Attach ownership to Jobs

In /api/upload, after auth + rate limits + validations, set job.userId = req.auth.userId and job.orgId = derived orgId.

Update GET /api/status/:jobId to include userId and orgId (read-only).
✅ Upload a doc; verify DB row has userId/orgId.
✅ Update progress file.

Block 09 — Minimal UI indicators

In navbar/dashboard, show signed-in user avatar/name from Clerk.

Show org name (from bootstrap).

If no org, display small banner: “No org found — created personal workspace.”
✅ Update progress file.

Block 10 — Quick Validation Checklist

Anonymous visit to upload → redirected to sign-in (or 401 for API call).

Signed-in user hits dashboard → bootstrap runs → user/org rows exist.

Upload → Job row includes userId/orgId.

Progress file updated for each block.

Block 11 — Handover Note

Document any env keys required on Vercel (frontend) and VPS (backend).

Note remaining items for a future “Org Management” module (invite members, roles).

Confirm no secrets are in the repo.
✅ Final update to progress file.

Appendix — Progress File Location
docs/progress/module_auth_clerk.md — Trae must update after every block:

# Module: Auth + Clerk Progress
## Done
- ...
## Pending
- ...
## Errors/Blockers
- ...
## Notes
- ...
## Commits/PRs
- ...