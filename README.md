# auth.henriz.dev

Private, Passkey-first SSO for Henri Z administration apps. The implementation follows [`docs/HENRIZ_AUTH_SPEC.md`](docs/HENRIZ_AUTH_SPEC.md).

## Local setup

1. Copy `.env.example` to `.env.local` and replace every placeholder with independent random values.
2. Set Neon `DATABASE_URL_UNPOOLED` (or the alias `DIRECT_URL`) for migrations and pooled `DATABASE_URL` for the app. Prisma CLI reads these from `.env`; Next.js also reads `.env.local` at runtime.
3. Run `pnpm db:deploy`, then the one-time bootstrap command below.
4. Start with `pnpm dev` and open `https://localhost` through a trusted local HTTPS proxy, or use localhost's secure-context exception while keeping the `__Host-` cookies enabled.

Generate keys with `openssl rand -base64 32`. Never commit them.

## One-time bootstrap

Set `ADMIN_TOTP_SECRET` to the existing Base32 TOTP seed and optionally provide client registrations. The script automatically reads the other secrets from the project-root `.env` file:

```sh
ADMIN_TOTP_SECRET='…' \
CLIENTS_JSON='[{"clientId":"edit-page-admin_xxx","name":"Edit Page","secret":"high-entropy-secret","redirectUris":["https://example.com/auth/callback"]}]' \
pnpm db:seed
```

The seed script refuses to run after an Admin exists and never prints secrets. Sign in at `/login` (Passkey or 6-digit code, either one) or `/recovery`, then immediately register two independent Passkeys.

The TOTP seed must be Base32 with at least 128 bits (26+ characters); legacy 80-bit seeds (16 characters) are rejected by `otplib` with `SecretTooShortError` and can never verify.

## TOTP reset (seed lost or too short)

`pnpm db:reset-totp --dry-run` prints the current Admin state without writing anything. Drop the flag to apply the reset: it replaces the TOTP credential, revokes every central session, clears pending challenges/codes, and sets the Admin back to `BOOTSTRAP_REQUIRED` when no Passkey remains.

```sh
pnpm db:reset-totp                              # generates a new 160-bit seed and prints an otpauth:// URI
ADMIN_TOTP_SECRET='<base32 secret or otpauth:// URI>' pnpm db:reset-totp   # keep your own seed, nothing printed
```

Enroll the new seed in the authenticator app, sign in at `/login` or `/recovery`, then register two independent Passkeys in `/security`. Lost Passkeys **and** TOTP remain an offline, human-verified recovery (spec §14.3).

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Do not connect Vercel preview deployments to the production database. See the specification for deployment, client integration, recovery, and incident procedures.
