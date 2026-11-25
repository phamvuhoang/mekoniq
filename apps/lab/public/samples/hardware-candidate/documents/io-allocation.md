<!-- bundle 848dde50570d91aa07e2963a3e2c8ad17101c3da5e465a04c027b560ed511a11 electrical-compiler/1 -->
# I/O allocation

## Assigned

| Signal | Device | Point | Pin | Bus | Exposure | Pinned |
|---|---|---|---|---|---|---|
| bumper-front | io-module | DI0 | IO/DI0 | can0 | cyclic | no |
| bumper-left | io-module | DI1 | IO/DI1 | can0 | cyclic | no |
| bumper-right | io-module | DI10 | IO/DI10 | can0 | cyclic | no |
| buzzer | io-module | DO0 | IO/DO0 | can0 | cyclic | no |
| charger-present | io-module | DI11 | IO/DI11 | can0 | cyclic | no |
| cliff-left | io-module | DI12 | IO/DI12 | can0 | cyclic | no |
| cliff-right | io-module | DI13 | IO/DI13 | can0 | cyclic | no |
| cover-switch | io-module | DI14 | IO/DI14 | can0 | cyclic | no |
| dock-detect | io-module | DI15 | IO/DI15 | can0 | cyclic | no |
| estop-status | io-module | DI2 | IO/DI2 | can0 | cyclic | no |
| lamp-status | io-module | DO1 | IO/DO1 | can0 | cyclic | no |

## Not allocated

- brake-release: DIRECTION_MISMATCH (12), ELECTRICAL_MISMATCH (12), OUTPUT_OVERCURRENT (6), POINT_RESERVED (14), SAFETY_POINT_RESERVED (4)

## Spare points

- io-module/DI3
- io-module/DI4
- io-module/DI5
- io-module/DI6
- io-module/DI7
- io-module/DI8
- io-module/DI9
- io-module/DO2
- io-module/DO3

## Reserved points

- drive-left/EDM: edm
- drive-left/HWTO1: safety:safe_input
- drive-left/HWTO2: safety:safe_input
- drive-left/IN0: ID-SEL0
- drive-left/IN1: ID-SEL1
- drive-left/IN2: STOP
- drive-left/IN3: FREE
- drive-left/OUT0: COMM-PWR
- drive-left/OUT1: ALM-B
- drive-right/EDM: edm
- drive-right/HWTO1: safety:safe_input
- drive-right/HWTO2: safety:safe_input
- drive-right/IN0: ID-SEL0
- drive-right/IN1: ID-SEL1
- drive-right/IN2: STOP
- drive-right/IN3: FREE
- drive-right/OUT0: COMM-PWR
- drive-right/OUT1: ALM-B
- fuse-drive-left/RATED: protection_rating
- fuse-drive-right/RATED: protection_rating
- fuse-logic/RATED: protection_rating

_Tài liệu sinh tự động từ dữ liệu thiết kế; không thay thế đo điện hay đánh giá an toàn. / Generated from design data; it does not replace electrical measurement or a safety assessment._
