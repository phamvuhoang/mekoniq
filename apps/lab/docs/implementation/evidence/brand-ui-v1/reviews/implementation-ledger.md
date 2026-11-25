# SDD ledger — plan: docs/plans/2026-11-06-brand-ui-unification/README.md

Baseline source 5c86337, lab 357d669, trial 6298f83. Branch feat/brand-ui-v1 each repo, current workspace retained to honor existing user workflow; unrelated source artifacts preserved.
Ruling: in-place feature branches instead of linked worktrees — existing three-repo workspace and user current-branch preference — cost: explicit scoped staging needed.
Ruling: implementation request does not itself request another production rollout; prepare builds/evidence, no new production publish. Earlier deployment requests were completed.

| Pair/task | Interface audit | Decision |
|---|---|---|
| F01/F02 | canonical inputs vs release sourceCommit | commit inputs first; release excludes generated files |
| F02/L01/S01/S02/T01 | generated brand dirs | root owns export; app workers must not edit generated content |
| L01/S01/S02/T01 | independent app layouts, shared token contract | preserve behavior and semantic colors |
| Q01/app tasks | baseline before implementation | capture before each migration, final tests on actual changes |
| Q02/F02 | offline assets, runtime pin | no runtime re-pin for branding |
| F01 | token values and CSS scopes agree | proceed |
| F02 | consumer checker and export safety | tests tamper/unknown/path traversal |
| L01 | hash routes and labels | preserve localization |
| S01 | native fields need CSS | preserve auth/layout guard |
| S02 | tablet native browser profile | qualify separately |
| T01 | rsync export destructive target | use temporary sibling clone only |
| Q01 | tests and acceptance distinct | evidence exact scope |
| Q02 | production permissions task-specific | prepare; don't publish production |

Tasks: F01/F02 in progress; L01/S01/S02/T01/Q01/Q02 pending.

F01/F02 implementation complete: source a918c0f/526d500; lab4686006; trial94a9e07. Foundation review in progress. Version reuse guard added after root review. Baseline55screens captured; lab188pass1skip; trial npmtest pass; source contracts check0. L01 in progress via brand_lab.

Foundation task review:3P2 found and fixed. Source3f31af9/b50e971, canonical brand1.0.1. Whitespace aliases,canonical build guard,44pxcheckbox label.7tests pass;gallery axe4.14.0 zero violations. Lab/trial export waiting Labtestsstop. Source lint0;pre-fixwholeunit134pass. Android actualpreflight exit2:missing twoenrolleddevices.
Ruling:fix existing Node24 JSON import attribute collection errors to enable required Lab E2E; schema bytes/runtime semantics remainunchanged.

Task L01 complete: bbdc236 (Node24 import attributes/test expectations),3007163 (UI),root c806dcc (review/a11y fixes). Independent L01reviewapproved. Final187? corrected:188unitpass1skip,27browserpass12runtime-dependent skips,7pairedmockpassed,offlineBV01package1passed. 12previewroutesize axe scans zeroviolations;incompletecanvascontrastmanual. Q02 macarm64offlinebundle built73files. Lab/trialbrand1.0.1 e4d9c8c/2dd1066.
Task S01/S02 inprogress brand_source; localSupabaseactive. Stopped rootbaselineTrialheldservices beforeT01 because smoke-review copies staticfiles atstartup.

Q02 Lab preview READY: dpl_GCMxdN65ZPfmVBEsiJF7S64o83xr, code c806dcc. Authenticated CLI HTTP200 home/release; release bytes identical 1.0.1. Local browser validated; remote browser sees Vercel Login. Protection and production unchanged. Source agent full E2E34pass1hardware skip,unit137pass; final checks ongoing.

Task F01/F02: complete (source a918c0f..b50e971, lab e4d9c8c, trial 2dd1066; review clean).
Task S01/S02: implementation af7505c/d9ebd82; review 1P2 cancellation button semantic colors, plus minor ordinary links. Pending source worker fix after Trial implementation ends. 137 unit,34 E2E passed;1 hardware skip.
Task T01: implementation in progress, isolated Node-RED; expanded common.js BRAND template only to preserve original artwork rather than synthetic text.

Task T01: complete (2dd1066..7a4a896; 3 contrast findings fixed, task review clean). 36 valid matrix +3 activated scans, unit7integration6browser18policy, package/export/rollback verified.
Q02 protected remote browser passed for Lab6routes,Cloudhome/login/anonymousadminredirect; bothpreviewsREADY andmanifestidentical. No hostedDB mutation.

Task S01/S02: complete (af7505c..8a52cb6; review clean). 8 targeted E2E on finalfix, contracts/typecheck/lint/build, refreshed Android APK build allpassed. NativeAndroidblocked. Cloudpreview d9ebd82 sameClouddependencytree (fixonlyTabletscreens/style/test).
Final wholebranchreview: 1P2 Trial armedReset/defaultsforeground; singlefixwave dispatched brand_trial. Allotherreviewsresolved.

Final singlefixwave: Trial23cc7ce, armedconfirmationon-dangerforeground. Realclick red→green2states, unitand7integrationpass. Scopedfinalreviewapproved, noopenfindings.
Task Q01: implementation qualification evidence complete for recorded browser profiles; fullmanual200%zoom/dialog/usability notrun, nohumanacceptedclaim.
Task Q02: localoffline/package,APKbuild,protectedpreviews,Lab/Triallocalrollbackverified; Androiddeviceblockedexternal andproductionnotrun.

Final whole-branch review approved lab c806dcc / source 8a52cb6 / trial23cc7ce. All code findings resolved. Evidence278screens withhashes; localSupabase stoppedwithbackup, testportsfree. Productionnotchanged.
