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
