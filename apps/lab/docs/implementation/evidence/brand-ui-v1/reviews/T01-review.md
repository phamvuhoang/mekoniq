# T01 independent review

Status: changes requested. Initial review covers Trial working tree against `2dd1066cd77b6fb810ef0ffa79b30ecbd713083e`; final committed SHA pending.

## Findings

1. **P1 — Enabled toolbar primary labels lose contrast.** `trial/data/public/setup.html:19`, `trial/data/public/map.html:13`: `.appbar .btn.primary` now overrides foreground with `var(--fg)` (Paper #F6F8F4), while `brand.css` fills primary buttons with Motion #B9FB75. This is about 1.15:1. Reproduce by editing configuration to enable Save or editing a map to enable Apply. Keep the Deep foreground for these enabled primary buttons and verify the enabled state. The default smoke matrix scans these buttons disabled, so it does not cover the failure.

2. **P2 — Robot quantity-plus control inherits white on green.** `trial/data/public/robot.html:109`: `.mi .q button.plus` sets Motion background but has no foreground override. With the new dark root text, its plus glyph inherits Paper, about 1.15:1. Reproduce by opening the robot ordering screen. Add the on-primary foreground and test that state.

3. **P2 — Inactive tray labels retain pale surfaces with new pale text.** `trial/data/public/robot.html:62`, affected by `trial/data/public/brand.css:182`: `.tray` keeps a 55% white surface over #dbe6e8 while `--gray` now maps to #A8C2C6. Inactive tray labels are low contrast (roughly 1.7:1), including the tray number and empty/assigned text. Active trays have their own Deep text and are unaffected. Move the inactive surface to dark semantic tokens or retain an appropriate dark foreground; verify partially occupied tray state.

## Validation and scope

- Reviewer ran `node scripts/test-brand.js`: pass; original favicon checksum and 22-file brand release validated.
- Reviewer ran `npm test`: pass, exit 0.
- Inspected all six HTML diffs, common.js identity helper, adapter CSS, export script, package changes and browser evidence matrix.
- The diff preserves business handlers, IDs, command payloads and routes. Artwork references use original exported PNG/icon; fonts are local.
- Existing `.brand-evidence/matrix.json` contains 36 default-screen results without serious/critical axe violations; this does not exercise the enabled toolbar, ordering or partially occupied tray states above.
- Existing export evidence says web-specific transport/index/showcase hashes were preserved and exported public files matched. Reviewer did not rerun export, start services, access a DB or production runtime.
- Preexisting layout/semantics are not reported as unrelated defects. Additional native/hardware acceptance remains outside this static review.

## Final re-review — 7a4a8969f627146ee5ce70097353dceea4e71faa

**Verdict: approved for T01 static UI scope. No remaining blocking findings identified in the final diff against 2dd1066.** The initial three findings above are resolved, retained as review history:

- Save and Apply use `var(--deep)` over Motion; robot quantity plus also explicitly uses Deep.
- Inactive tray surfaces now use semantic dark card/soft tokens with readable muted text.
- Browser script now exercises enabled Save, actual robot ordering, and partially occupied trays. All three corresponding JSON reports contain `[]`; inspected robot-trays screenshot confirms readable inactive labels and retained red Cancel/Stop semantics.
- Matrix now uses correct `robot=R1` and `t=T01` query names. Parsed all 36 matrix entries: zero recorded serious/critical violations. Compact station screenshot shows stacked panels and wrapped header; robot header uses automatic height, avoiding fixed-height wrap clipping.
- Menu input helper adds escaped accessible labels without modifying IDs, bindings, handlers or payloads. Final changes remain static UI, brand identity and tests.

Reviewer independently reran final-HEAD `node scripts/test-brand.js`, `git diff --check 2dd1066`, and `npm test`: all pass, exit 0. Inspected browser evidence rather than rerunning a service/browser session. Trial tracked working tree is clean; `.brand-evidence/` remains untracked evidence. Browser evidence does not independently establish native/hardware or usability acceptance, and this review authorizes no production rollout. T01 implementation report was not present at re-review time; this verdict is based on committed source plus inspected evidence.
