# Synthetic sensor byte streams and their pinned protocol sources

`ld19-synth.bin` (100 LD19 frames, 4700 bytes) and `wit-synth.bin` (300 WitMotion frames, 3300 bytes) are written by `../make_bytes.py` and are **generator output, never a
measurement** (record label `generator`). A test regenerates them and compares byte for byte. The sensors role replays them in a loop on the simulated backend.

## Pinned sources

Downloaded 2026-11-26 with one `curl -sL` each (nothing sent but the URL). The files are kept **outside every repository** (licence not reviewed), under
`robot/docs/2026-11-26-hardware-bench/research/vendor-documents/`; only their hashes are here.

| Document | URL | File | SHA-256 |
|---|---|---|---|
| LDROBOT LD19 Development Manual V2.3 (30 pages) | https://www.elecrow.com/download/product/SLD06360F/LD19_Development%20Manual_V2.3.pdf | `ldrobot-ld19/LD19_Development_Manual_V2.3.pdf` | `a21792ea21d08bea4fb4e7e298d32fb3c58461073ee5e9e810cb1d4c133b7c78` |
| WitMotion SDK `REG.h` | https://raw.githubusercontent.com/WITMOTION/WitStandardProtocol_JY901/main/Linux_C/normal/REG.h | `witmotion/REG.h` | `879ffb2f5f5a899e0eade123becbabd25038f907da7ece972333784bc189a9a8` |
| WitMotion SDK `wit_c_sdk.c` | https://raw.githubusercontent.com/WITMOTION/WitStandardProtocol_JY901/main/Linux_C/normal/wit_c_sdk.c | `witmotion/wit_c_sdk.c` | `4685bb1cd6cb9096aaf7496c1c86c9de9105cb83e582c3093d9dd7f9b7fb2d8e` |
| WitMotion SDK demo `main.c` | https://raw.githubusercontent.com/WITMOTION/WitStandardProtocol_JY901/main/Linux_C/normal/main.c | `witmotion/main.c` | `d12fed83aaf644ecf88dfa38ec39c31de61cc19ae69d6f94e6b19ded52ab8809` |

The WitMotion files come from the `main` branch of `WITMOTION/WitStandardProtocol_JY901`; GitHub reported its head as `e8f4e3afc02263e2ef15052dc758f45efaebe12f` when they were downloaded
(the files were fetched by branch name, so that commit is the head at that moment, not a checked-out pin; the hashes above are the pin).

## Where each constant comes from

Page numbers are the PDF's own (the footer number and the page index agree). Text was extracted with `pdftotext -layout`.

| Constant | Value | Source |
|---|---|---|
| LD19 header, VerLen | 0x54, 0x2C (type 1 in the upper 3 bits, 12 points in the lower 5) | manual p.7 |
| LD19 frame | speed u16 deg/s, start angle u16 0.01 deg, 12 x (distance u16 mm, intensity u8), end angle u16 0.01 deg, timestamp u16 ms (max 30000, then wraps), CRC8; 47 bytes | manual p.7-8 (`LiDARFrameTypeDef`), p.10 (units) |
| LD19 CRC8 table (256 entries) | copied from the manual | manual p.8-9 (`CrcTable`); it equals CRC-8 with polynomial 0x4D, which a test recomputes |
| LD19 CRC range | all bytes before the CRC byte (46) | manual p.7 ("all the previous data except itself"), p.9 (`CalCRC8`) |
| LD19 point angle | `step = (end - start) / (len - 1)`, `angle = start + step * i` | manual p.10; the wrap past 360 degrees is this code's reading (end < start means one turn was crossed), the manual does not say |
| LD19 worked example (CRC 0x50, speed 2152, start 324.27, end 334.7) | a test frame | manual p.11; its table says 200 mm for the second point, but the bytes (0xDC) give 220 |
| LD19 rotation and points | 10 +/- 0.1 Hz, 4500 measurements a second | manual p.3 |
| LD19 UART | 230400 baud, 8 data bits, 1 stop bit, no parity | manual p.6 |
| LD19 coordinate system | left-handed, 0 deg at the front, angle grows clockwise | manual p.12 |
| LD19 measuring range | **not in the manual text**; `toLidarScan` callers pass `rangeMinM`/`rangeMaxM`, the bench case uses 0.03 / 12 m, both `assumed` (the research notes give 12 m for the LD19 and 0.03 m for the STL-19P from secondary sources) until KSN02 measures them | `bench-stack.md` section 4 |
| WitMotion frame | 0x55, type, four little-endian int16, checksum = low byte of the sum of the first 10 | `wit_c_sdk.c` `WitSerialDataIn` lines 137-170 (`__CaliSum` line 78), little-endian data lines 163-166 |
| WitMotion resynchronisation | a wrong first byte or a wrong checksum drops ONE byte and tries again | `wit_c_sdk.c` lines 148-161 |
| WitMotion types | 0x50 time, 0x51 acceleration, 0x52 gyro, 0x53 angle, 0x59 quaternion, 0x5F register value | `REG.h` lines 200-211 |
| WitMotion scales | acceleration raw / 32768 x 16 (g), gyro raw / 32768 x 2000 (deg/s), angle raw / 32768 x 180 (deg) | `main.c` lines 67-69; 1 g = 9.80665 m/s2 is the standard value, not from the SDK |
| WitMotion write command | `FF AA reg lo hi` (not sent in this task; `imuConfigure` only records) | `wit_c_sdk.c` lines 287-291 |
| WitMotion unlock, rate and baud codes | `KEY` 0x69 = `KEY_UNLOCK` 0xB588 (bytes 88 B5), `RRATE` 0x03 (0x09 = 100 Hz), `BAUD` 0x04 (6 = 115200), `AXIS6` 0x24 (1 = 6-axis) | `REG.h` lines 126, 271, 13-14, 237, 46, 174-175, 248 (for the later task that writes them) |

Not pinned and therefore not used: the WitMotion 0x50 time packet layout (`sensorTime` stays `null`), any LD19 invalid-distance convention (a zero distance is below the minimum range
like any other short one), the official WitMotion protocol document (it redirects to a login page).
