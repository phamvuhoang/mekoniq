# final-recording/raw removed from the tree

The 242 files of the superseded Source 981 / Lab d4 `final-recording/raw/` directory (121 `*.tar.gz` archives plus their 121 `*.members.json` member indexes, 1068997604 archive bytes) were removed from the working tree to keep the checkout small. They are not lost: the last `main` commit that still contains `raw/` is

```
ca550d05ed2bfc7700796cef038169189d6465d8
```

Retrieve one file byte-exactly (example):

```sh
git show ca550d05ed2bfc7700796cef038169189d6465d8:docs/implementation/evidence/web-lab-to-physical/final-recording/raw/981-d4-r2b-web.tar.gz > 981-d4-r2b-web.tar.gz
```

Restore the whole directory into an empty destination:

```sh
git archive ca550d05ed2bfc7700796cef038169189d6465d8 docs/implementation/evidence/web-lab-to-physical/final-recording/raw | tar -x -C /new/empty/dir
```

Every archive's sha256 and every member index's sha256 remain in [`index.json`](index.json) (`archives[].archiveSha256`, `archives[].memberIndexSha256`; `archiveCount` 121, `archiveBytes` 1068997604; `publishedArchive`/`publishedMemberIndex` give the former `raw/` paths). All 242 values were checked against the files at that commit before removal (0 mismatches). Verify a retrieved file with `shasum -a 256 <file>` against that entry, then extract it with the safe helper described in [reproduce-final-recording.md](../../../web-lab-to-physical/reproduce-final-recording.md).

`index.json`, `archive-receipts/`, `public-readbacks/`, `images/`, `privacy-derivatives/` and `privacy-exclusions.json` stay in the tree unchanged. Historical audit JSON that names `raw/` paths (for example under `retention/`) is left byte-identical.
