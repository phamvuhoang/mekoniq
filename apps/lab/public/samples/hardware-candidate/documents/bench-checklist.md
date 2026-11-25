<!-- bundle 848dde50570d91aa07e2963a3e2c8ad17101c3da5e465a04c027b560ed511a11 electrical-compiler/1 -->
# Bench checklist

Every item below is something this design relies on and no pinned document supports.


## controller

- [ ] `UNVERIFIED_FIRMWARE` controller (controller-ref-v1) has no pinned firmware; I/O mapping and PDO layout depend on it — record the firmware version on the unit and re-check the I/O mapping and PDO layout

## design

- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / 16-channel PNP input block, planning assumption — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / 4-channel PNP output block, 0.5 A per channel, planning assumption — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / CAN bus interface, planning assumption — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / ampacity table is a planning assumption — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / estimated from a 0.5 m chassis; measure on the first build — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / planning estimate until a part is chosen — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / planning limit of 3 % on a 24 V rail — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / rated current of the fuse is 10 A (the rating is carried as the maximum current of this point) — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / rated current of the fuse is 5 A (the rating is carried as the maximum current of this point) — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / reference device battery-24v-pack: values are planning assumptions until a part is chosen — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / reference device buzzer-24v: values are planning assumptions until a part is chosen — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / reference device controller-ref: values are planning assumptions until a part is chosen — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / reference device estop-button: values are planning assumptions until a part is chosen — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / reference device fuse-10a: values are planning assumptions until a part is chosen — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / reference device fuse-5a: values are planning assumptions until a part is chosen — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / reference device io-module-can-ref: values are planning assumptions until a part is chosen — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / reference device lamp-24v: values are planning assumptions until a part is chosen — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / reference device safety-relay: values are planning assumptions until a part is chosen — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / reference device sensor-pnp-24v: values are planning assumptions until a part is chosen — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / reference device switch-dry-contact: values are planning assumptions until a part is chosen — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_ASSUMED_SOURCE` assumed: r5-assumptions / voltage drop limit is a planning assumption — replace the assumed value with a pinned document value, or measure it
- [ ] `UNVERIFIED_BUS_EXPOSURE` io-module/DI0 is exposed as cyclic on 6000:01 but no pinned description file confirms it — read the point on the bus with the unit powered and confirm object, bit and update time
- [ ] `UNVERIFIED_BUS_EXPOSURE` io-module/DI1 is exposed as cyclic on 6000:01 but no pinned description file confirms it — read the point on the bus with the unit powered and confirm object, bit and update time
- [ ] `UNVERIFIED_BUS_EXPOSURE` io-module/DI10 is exposed as cyclic on 6000:01 but no pinned description file confirms it — read the point on the bus with the unit powered and confirm object, bit and update time
- [ ] `UNVERIFIED_BUS_EXPOSURE` io-module/DO0 is exposed as cyclic on 6200:01 but no pinned description file confirms it — read the point on the bus with the unit powered and confirm object, bit and update time
- [ ] `UNVERIFIED_BUS_EXPOSURE` io-module/DI11 is exposed as cyclic on 6000:01 but no pinned description file confirms it — read the point on the bus with the unit powered and confirm object, bit and update time
- [ ] `UNVERIFIED_BUS_EXPOSURE` io-module/DI12 is exposed as cyclic on 6000:01 but no pinned description file confirms it — read the point on the bus with the unit powered and confirm object, bit and update time
- [ ] `UNVERIFIED_BUS_EXPOSURE` io-module/DI13 is exposed as cyclic on 6000:01 but no pinned description file confirms it — read the point on the bus with the unit powered and confirm object, bit and update time
- [ ] `UNVERIFIED_BUS_EXPOSURE` io-module/DI14 is exposed as cyclic on 6000:01 but no pinned description file confirms it — read the point on the bus with the unit powered and confirm object, bit and update time
- [ ] `UNVERIFIED_BUS_EXPOSURE` io-module/DI15 is exposed as cyclic on 6000:01 but no pinned description file confirms it — read the point on the bus with the unit powered and confirm object, bit and update time
- [ ] `UNVERIFIED_BUS_EXPOSURE` io-module/DI2 is exposed as cyclic on 6000:01 but no pinned description file confirms it — read the point on the bus with the unit powered and confirm object, bit and update time
- [ ] `UNVERIFIED_BUS_EXPOSURE` io-module/DO1 is exposed as cyclic on 6200:01 but no pinned description file confirms it — read the point on the bus with the unit powered and confirm object, bit and update time
- [ ] `UNVERIFIED_PRICE` orientalmotor-blvd-krd has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` orientalmotor-blv-r-60w has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` ref-battery-24v-pack has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` ref-buzzer-24v has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` ref-controller-ref has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` ref-estop-button has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` ref-fuse-10a has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` ref-fuse-5a has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` ref-io-module-can-ref has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` ref-lamp-24v has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` ref-safety-relay has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` ref-sensor-pnp-24v has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` ref-switch-dry-contact has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` mating-DFMC_0_5/14-ST-2_54__PHOENIX_CONTACT___AWG26_to_20 has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` mating-F32FSS-03V-KX_with_LF3F-41GF-P2.0_contacts__J.S.T.___cable_LC03D06A_sold_separately has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` serve-caster has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` serve-chassis has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` serve-lidar has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` serve-support has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` serve-tray has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` serve-wheel has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` wire-0.25mm2:black has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` wire-0.25mm2:green has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` wire-0.25mm2:white has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` wire-0.25mm2:yellow has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` wire-0.5mm2:black has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` wire-0.5mm2:red has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` wire-1mm2:black has no quotation — obtain a quotation and add it to the catalog
- [ ] `UNVERIFIED_PRICE` wire-1mm2:red has no quotation — obtain a quotation and add it to the catalog

## drive-left

- [ ] `UNVERIFIED_FIRMWARE` drive-left (blvd-krd-v1) has no pinned firmware; I/O mapping and PDO layout depend on it — record the firmware version on the unit and re-check the I/O mapping and PDO layout

## drive-right

- [ ] `UNVERIFIED_FIRMWARE` drive-right (blvd-krd-v1) has no pinned firmware; I/O mapping and PDO layout depend on it — record the firmware version on the unit and re-check the I/O mapping and PDO layout

## io-module

- [ ] `UNVERIFIED_FIRMWARE` io-module (io-module-can-ref-v1) has no pinned firmware; I/O mapping and PDO layout depend on it — record the firmware version on the unit and re-check the I/O mapping and PDO layout

_Tài liệu sinh tự động từ dữ liệu thiết kế; không thay thế đo điện hay đánh giá an toàn. / Generated from design data; it does not replace electrical measurement or a safety assessment._
