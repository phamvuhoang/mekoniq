# Electrical drafting brief (for an agent that edits designs)

A language model is outside the trust path. You edit JSON; the compiler and its rules decide. Nothing in the product calls a model.

## You may

- Edit files under `robotics/catalog/electrical/` (designs, wiring policy) and `robotics/catalog/devices/` (device profiles).
- Re-generate with `pnpm exec tsx scripts/generate-electrical-fixture.mts` and `pnpm exec tsx scripts/author-device-catalog.mts`; those two scripts are the source of the committed files, so change the script, not only its output.

## You must

1. Give every value that comes from a manufacturer a `locator` into a document that is pinned in `robotics/catalog/documents/<sha256>` and declared in the profile. If you cannot, the source is `assumed`. Never fill a value from memory, from the web or from a model's answer.
2. After every change run `node scripts/lab-hardware.mjs check --design <file>` and paste its output in your message. Exit 0 compiled, 1 blocked (the reasons are printed), 2 refused.
3. Leave the sealing to the scripts: `digest` fields are computed, never typed. There is no field for an evidence level, a safety level or a verified state; do not add one.

## You must never

- Write a `safety_chain` signal's allocation, pin it to a point, or invent a safety claim or a safety requirement. The register `serve-safety-requirements-v1.json` and every `SafetyClaim` are written by the person responsible for safety, verbatim from a pinned document.
- Write `accepted: true`, `hardwareValidated: true` or `controlAuthority: true` anywhere.
- Describe any output as safe, compliant or certified.

## Done means

A design is done when its author has read `checks.md` (`node scripts/lab-hardware.mjs docs --design <file> --out <dir>`). A green `check` says the paper design is consistent, nothing more: it does not replace measuring the wiring, testing the stop functions or a safety assessment.
