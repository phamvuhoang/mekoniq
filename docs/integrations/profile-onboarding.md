# Onboarding an integration profile

A profile (`integrations/profiles/catalog.json`, schema `profile.schema.json`) is one provider / API version, one protocol version or one SDK + firmware. It is **data with evidence**, not a switch. Nothing is guessed: a missing document, version or signature rule means the profile stays `draft` and disabled.

## States

| status | meaning | may run |
|---|---|---|
| `draft` | named, inputs still missing (`requiredInputs` lists them) | never |
| `contract_tested` | our adapter passes the contract tests against our own emulator (`mode: simulation`) or recorded vectors | development / sandbox venue only, tagged non-production |
| `sandbox_verified` | the provider's own sandbox / the vendor's emulator or hardware accepted it; `evidence.sandbox` links the report | sandbox venue |
| `production_approved` | `mode: production`, both evidence records present, merchant / venue acceptance done | release builds |

An emulator (`mode: simulation`) can **never** be `sandbox_verified` or `production_approved`: it proves our code, not a provider.

## Steps

1. Get the **official** documentation for the exact API / protocol version. Record `provider.name`, `docsUrl` (https), `apiVersion`, `docsRetrievedAt`.
2. Write down from that documentation (not from memory): how a webhook is signed (`webhook.signatureScheme`, `signedFields`, `timestampToleranceSeconds`, `eventIdField`), the idempotency key and the query endpoint used after a timeout (`idempotency`), and the credential **names** (`credentialRefs` — environment / secret-store names, never values).
3. Implement the adapter at `adapter` (`path#export`) behind the connector / provider port; run the kind's contract suite (`tests/providers`, `tests/adapters`).
4. Record fixtures under `tests/fixtures/providers/` as `{provenance:{kind:"recorded"|"emulated",redacted:true,sha256,source},body}`; the rig refuses a fixture whose hash does not match.
5. Run the sandbox, attach the report to `docs/implementation/evidence/`, put its path, `sha256` and date in `evidence.sandbox`, and set `sandbox_verified`.
6. After the merchant / venue acceptance, set `mode: production`, `production_approved` and `evidence.production`. `pnpm test:contracts -- tests/contracts/provider-profile.test.ts` rejects a profile that skips a step.

`loadEnabledProfiles(catalog, 'release')` returns only production-approved profiles; `'sandbox'` also returns contract-tested simulation / sandbox profiles for development.
