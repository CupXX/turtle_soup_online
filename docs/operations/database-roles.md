# Database role provisioning

The web application and judge worker use separate non-login roles. The
migration creates the roles without passwords; credentials must be provisioned
through a secure administration channel and never committed to this repository.

## Provisioning

1. Generate two independent random passwords with the operator's secret manager.
2. Set the passwords for `game_web` and `judge_worker` in the Supabase SQL
   editor or another privileged administration channel.
3. Store the resulting connection strings only in the deployment secret store:
   - `GAME_WEB_DATABASE_URL` for Next.js route handlers.
   - `JUDGE_WORKER_DATABASE_URL` for the durable worker.
4. Use the transaction pooler for the web application with prepared statements
   disabled. Use a direct connection or session pooler for the persistent
   worker.
5. Rotate the two credentials independently and restart only the service that
   uses the rotated value.

Neither role receives DDL privileges. Browser code uses only the publishable
Supabase key and has no access to either role or the `private` schema.

## First playable loop privileges

`game_web` can read the public snapshot, create players, create or replace a
waiting preparation, accept normal-message and private final-answer receipts,
retry/cancel actions through the authenticated admin boundary, publish a
force-end event/reveal, and maintain only the request-idempotency, rate-limit,
and worker-health records needed by those routes. It cannot update message
verdicts, key-point claims, final-answer results, judge attempts, or worker
heartbeats. The final-answer submission table is insert-only for this role;
answer text is never selected by a browser route.

`judge_worker` can read the current secret input, fixed key points, and private
final-answer bodies; lease and complete extraction/actions, record first-hit
claims, update public verdict/score fields, publish final-answer events and
successful reveals, and inspect/upsert worker heartbeats. It cannot read player
identity mappings, admin audit events, request idempotency, or rate-limit
buckets. It has no insert/update permission on the private answer body itself
beyond marking the submission result complete.

The local pgTAP security suite checks both positive and negative table
privileges. The end-to-end acceptance script uses local `postgres` for the
HTTP server because the migration intentionally creates the runtime roles as
`NOLOGIN`; production provisioning must supply role-specific credentials
through the secret manager.
