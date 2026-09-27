# auth.henriz.dev

Private, Passkey-first SSO for Henri Z administration apps. The implementation follows [`docs/HENRIZ_AUTH_SPEC.md`](docs/HENRIZ_AUTH_SPEC.md).

## Local setup

1. Copy `.env.example` to `.env.local` and replace every placeholder with independent random values.
2. Set `DIRECT_URL` for migrations and pooled `DATABASE_URL` for the app.
3. Run `pnpm db:deploy`, then the one-time bootstrap command below.
4. Start with `pnpm dev` and open `https://localhost` through a trusted local HTTPS proxy, or use localhost's secure-context exception while keeping the `__Host-` cookies enabled.

Generate keys with `openssl rand -base64 32`. Never commit them.

## One-time bootstrap

Set `ADMIN_TOTP_SECRET` to the existing Base32 TOTP seed and optionally provide client registrations:

```sh
ADMIN_TOTP_SECRET='…' \
CLIENTS_JSON='[{"clientId":"edit-page-admin_xxx","name":"Edit Page","secret":"high-entropy-secret","redirectUris":["https://example.com/auth/callback"]}]' \
pnpm db:seed
```

The seed script refuses to run after an Admin exists and never prints secrets. Visit `/recovery`, verify the existing TOTP, and immediately register two independent Passkeys.

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Do not connect Vercel preview deployments to the production database. See the specification for deployment, client integration, recovery, and incident procedures.
