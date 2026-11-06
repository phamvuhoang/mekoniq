# HMI acceptance — `hmi/mekoniq_arm` (QtVCP)

The HMI is a client of the bridge arbiter: every button sends `arm.command.v1` over the local socket with the operator's `local_operator`
lease; nothing in the handler calls `linuxcnc.command()`, opens an `error_channel` (the bridge service is its only consumer) or wires a stock
QtVCP `ACTION.*` write (`BLOCKED_STOCK_ACTIONS` in the handler; `tests/test_hmi_actions.py` greps for them). Role UI is **not** a safety
boundary: E-stop, guards and enabling devices are an independent circuit and the simulator proves nothing about them. The HMI has **no
software E-stop button**; its emergency path is the physical circuit, and `revoke` (stop, then reconcile) is the software take-over.

## Software checks (this host)

`python3 -m unittest discover -s tests -p 'test_hmi_actions.py'` — the pure action policy (jog/home only for the local owner in an allowed
state; no resume after a fault; acquire only when nobody owns and nothing is unknown), the handler against a real arbiter with a fake
controller (a restarted HMI never acquires or starts; jog/home/run/stop go through the arbiter; a lab owner is revoked through the stop
policy), and static checks of the `.ui`/`.qss`/labels (vi/ja/en, navy/lime, touch-sized controls).

## GUI smoke (Linux runtime only) — `blocked_external` on the recorded host

Run from `source/integrations/arm-controller/` on the Linux host with the pinned LinuxCNC and `python3-pyqt5`:

```sh
bash scripts/smoke-sim.sh --profile configs/sim/puma560/mekoniq.ini --evidence-dir /tmp/mekoniq-arm-hmi-evidence --gui
python3 bridge/run.py --profile configs/sim/puma560/profile.json --journal /tmp/mekoniq-arm-hmi-evidence/journal.jsonl   # in a second terminal
```

The INI's `DISPLAY = qtvcp -f mekoniq_arm` opens the HMI fullscreen. Record (screenshot per step into the evidence dir, named `hmi-<step>-<lang>.png`):

1. **Passive start** — owner `none`, every motion button disabled, freshness shows an age; the HMI sent nothing (bridge journal has no `owner` row).
2. **Take local control** — `acquire_local`; owner shows `local_operator (hmi:<user>)`; jog buttons enable only with `task on`, interpreter idle, no fault.
3. **Jog / home** — press-and-hold jog moves one joint (status table: actual and commanded columns both change); `home_all` homes.
4. **Stage → run → pause → resume → stop** — each reply shown in `lastReply`; `run` enabled only when homed and a program is staged.
5. **Concurrent Lab client** — with the Lab (or `tests/test_bridge_protocol.py`'s client) holding `lab_simulation` on `bridge.sock`, the HMI (on `local.sock`) offers only revoke; `revoke` cancels, drops the owner and requires reconcile before anything moves.
6. **Fault** — `halcmd sets mekoniq-fault-inject true`: fault label red, no resume offered, reconcile required; clearing the fault does not resume.
7. **Freshness** — stop the bridge: freshness goes `STALE <age> ms`, jog/run/resume disable; restart the bridge: the HMI stays passive (no acquire).
8. **Translation / touch / fullscreen** — repeat the start screen with `MEKONIQ_HMI_LANG=vi|ja|en`; controls ≥ 56 px high; the window is fullscreen (`-f`).

Each run records: LinuxCNC version, package versions from `packaging/dependencies.lock.json`, profile/model hashes, the bridge journal and
screenshots. Exit: steps 1–8 observed with screenshots and the bridge journal showing every action as a journaled command. On this macOS host the
GUI smoke was **not executed**; A04 is software-checked only and the GUI steps are `blocked_external`.

## Debian ARM64 VM candidate

For UTM Debian12 ARM64 use `--dependencies-lock packaging/dependencies.arm64-vm.lock.json` with the smoke command. The separate lock is **candidate**, with no installed inventory or compatibility verdict. `scripts/runtime-inventory.py` records installed Debian package versions and resolved LinuxCNC/Qt/Python executable/module hashes; smoke embeds this inventory even when prerequisites are missing. A hash of the candidate is not a verification result. Keep terminal and GUI evidence in separate directories; re-run all eight GUI steps on the actual UTM desktop. Use the amd64 lock and repeat qualification on the release target later.
