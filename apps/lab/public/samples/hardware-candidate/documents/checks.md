<!-- bundle 848dde50570d91aa07e2963a3e2c8ad17101c3da5e465a04c027b560ed511a11 electrical-compiler/1 -->
# Checks

State: compiled. Blocking 0, warnings 1, unverified 65.

## blocking

None.

## warning

- `IOA_SIGNAL_UNALLOCATED` /signals/brake-release: brake-release has no I/O point: DIRECTION_MISMATCH (12), ELECTRICAL_MISMATCH (12), OUTPUT_OVERCURRENT (6), POINT_RESERVED (14), SAFETY_POINT_RESERVED (4)

## unverified

- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / 16-channel PNP input block, planning assumption
- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / 4-channel PNP output block, 0.5 A per channel, planning assumption
- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / CAN bus interface, planning assumption
- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / ampacity table is a planning assumption
- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / estimated from a 0.5 m chassis; measure on the first build
- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / planning estimate until a part is chosen
- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / planning limit of 3 % on a 24 V rail
- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / rated current of the fuse is 10 A (the rating is carried as the maximum current of this point)
- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / rated current of the fuse is 5 A (the rating is carried as the maximum current of this point)
- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / reference device battery-24v-pack: values are planning assumptions until a part is chosen
- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / reference device buzzer-24v: values are planning assumptions until a part is chosen
- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / reference device controller-ref: values are planning assumptions until a part is chosen
- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / reference device estop-button: values are planning assumptions until a part is chosen
- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / reference device fuse-10a: values are planning assumptions until a part is chosen
- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / reference device fuse-5a: values are planning assumptions until a part is chosen
- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / reference device io-module-can-ref: values are planning assumptions until a part is chosen
- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / reference device lamp-24v: values are planning assumptions until a part is chosen
- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / reference device safety-relay: values are planning assumptions until a part is chosen
- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / reference device sensor-pnp-24v: values are planning assumptions until a part is chosen
- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / reference device switch-dry-contact: values are planning assumptions until a part is chosen
- `UNVERIFIED_ASSUMED_SOURCE` /sources: assumed: r5-assumptions / voltage drop limit is a planning assumption
- `UNVERIFIED_BUS_EXPOSURE` /allocation/bumper-front: io-module/DI0 is exposed as cyclic on 6000:01 but no pinned description file confirms it
- `UNVERIFIED_BUS_EXPOSURE` /allocation/bumper-left: io-module/DI1 is exposed as cyclic on 6000:01 but no pinned description file confirms it
- `UNVERIFIED_BUS_EXPOSURE` /allocation/bumper-right: io-module/DI10 is exposed as cyclic on 6000:01 but no pinned description file confirms it
- `UNVERIFIED_BUS_EXPOSURE` /allocation/buzzer: io-module/DO0 is exposed as cyclic on 6200:01 but no pinned description file confirms it
- `UNVERIFIED_BUS_EXPOSURE` /allocation/charger-present: io-module/DI11 is exposed as cyclic on 6000:01 but no pinned description file confirms it
- `UNVERIFIED_BUS_EXPOSURE` /allocation/cliff-left: io-module/DI12 is exposed as cyclic on 6000:01 but no pinned description file confirms it
- `UNVERIFIED_BUS_EXPOSURE` /allocation/cliff-right: io-module/DI13 is exposed as cyclic on 6000:01 but no pinned description file confirms it
- `UNVERIFIED_BUS_EXPOSURE` /allocation/cover-switch: io-module/DI14 is exposed as cyclic on 6000:01 but no pinned description file confirms it
- `UNVERIFIED_BUS_EXPOSURE` /allocation/dock-detect: io-module/DI15 is exposed as cyclic on 6000:01 but no pinned description file confirms it
- `UNVERIFIED_BUS_EXPOSURE` /allocation/estop-status: io-module/DI2 is exposed as cyclic on 6000:01 but no pinned description file confirms it
- `UNVERIFIED_BUS_EXPOSURE` /allocation/lamp-status: io-module/DO1 is exposed as cyclic on 6200:01 but no pinned description file confirms it
- `UNVERIFIED_FIRMWARE` /devices/controller: controller (controller-ref-v1) has no pinned firmware; I/O mapping and PDO layout depend on it
- `UNVERIFIED_FIRMWARE` /devices/drive-left: drive-left (blvd-krd-v1) has no pinned firmware; I/O mapping and PDO layout depend on it
- `UNVERIFIED_FIRMWARE` /devices/drive-right: drive-right (blvd-krd-v1) has no pinned firmware; I/O mapping and PDO layout depend on it
- `UNVERIFIED_FIRMWARE` /devices/io-module: io-module (io-module-can-ref-v1) has no pinned firmware; I/O mapping and PDO layout depend on it
- `UNVERIFIED_PRICE` /bom/eld/drive/orientalmotor-blvd-krd:35e8b1c0: orientalmotor-blvd-krd has no quotation
- `UNVERIFIED_PRICE` /bom/eld/part/orientalmotor-blv-r-60w:38e9860c: orientalmotor-blv-r-60w has no quotation
- `UNVERIFIED_PRICE` /bom/eld/part/ref-battery-24v-pack:005b0563: ref-battery-24v-pack has no quotation
- `UNVERIFIED_PRICE` /bom/eld/part/ref-buzzer-24v:e114b3e8: ref-buzzer-24v has no quotation
- `UNVERIFIED_PRICE` /bom/eld/part/ref-controller-ref:0f558007: ref-controller-ref has no quotation
- `UNVERIFIED_PRICE` /bom/eld/part/ref-estop-button:af99cf79: ref-estop-button has no quotation
- `UNVERIFIED_PRICE` /bom/eld/part/ref-fuse-10a:4de14491: ref-fuse-10a has no quotation
- `UNVERIFIED_PRICE` /bom/eld/part/ref-fuse-5a:e6582950: ref-fuse-5a has no quotation
- `UNVERIFIED_PRICE` /bom/eld/part/ref-io-module-can-ref:9db73067: ref-io-module-can-ref has no quotation
- `UNVERIFIED_PRICE` /bom/eld/part/ref-lamp-24v:1d66e96f: ref-lamp-24v has no quotation
- `UNVERIFIED_PRICE` /bom/eld/part/ref-safety-relay:7559048e: ref-safety-relay has no quotation
- `UNVERIFIED_PRICE` /bom/eld/part/ref-sensor-pnp-24v:81878906: ref-sensor-pnp-24v has no quotation
- `UNVERIFIED_PRICE` /bom/eld/part/ref-switch-dry-contact:5cc95cdd: ref-switch-dry-contact has no quotation
- `UNVERIFIED_PRICE` /bom/mate/DFMC_0_5/14-ST-2_54__PHOENIX_CONTACT___AWG26_to_20: mating-DFMC_0_5/14-ST-2_54__PHOENIX_CONTACT___AWG26_to_20 has no quotation
- `UNVERIFIED_PRICE` /bom/mate/F32FSS-03V-KX_with_LF3F-41GF-P2.0_contacts__J.S.T.___cable_LC03D06A_sold_separately: mating-F32FSS-03V-KX_with_LF3F-41GF-P2.0_contacts__J.S.T.___cable_LC03D06A_sold_separately has no quotation
- `UNVERIFIED_PRICE` /bom/serve-caster:1:3a95e23a: serve-caster has no quotation
- `UNVERIFIED_PRICE` /bom/serve-chassis:1:ac075954: serve-chassis has no quotation
- `UNVERIFIED_PRICE` /bom/serve-lidar:1:ccb41c58: serve-lidar has no quotation
- `UNVERIFIED_PRICE` /bom/serve-support:1:4080c1c5: serve-support has no quotation
- `UNVERIFIED_PRICE` /bom/serve-tray:1:5590e4c9: serve-tray has no quotation
- `UNVERIFIED_PRICE` /bom/serve-wheel:1:53264351: serve-wheel has no quotation
- `UNVERIFIED_PRICE` /bom/wire/0.25mm2:black: wire-0.25mm2:black has no quotation
- `UNVERIFIED_PRICE` /bom/wire/0.25mm2:green: wire-0.25mm2:green has no quotation
- `UNVERIFIED_PRICE` /bom/wire/0.25mm2:white: wire-0.25mm2:white has no quotation
- `UNVERIFIED_PRICE` /bom/wire/0.25mm2:yellow: wire-0.25mm2:yellow has no quotation
- `UNVERIFIED_PRICE` /bom/wire/0.5mm2:black: wire-0.5mm2:black has no quotation
- `UNVERIFIED_PRICE` /bom/wire/0.5mm2:red: wire-0.5mm2:red has no quotation
- `UNVERIFIED_PRICE` /bom/wire/1mm2:black: wire-1mm2:black has no quotation
- `UNVERIFIED_PRICE` /bom/wire/1mm2:red: wire-1mm2:red has no quotation

_Tài liệu sinh tự động từ dữ liệu thiết kế; không thay thế đo điện hay đánh giá an toàn. / Generated from design data; it does not replace electrical measurement or a safety assessment._
