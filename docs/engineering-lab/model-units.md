# Engineering model units

The model validators reject incompatible unit labels before a model enters a runnable catalog. They do not convert values or rewrite model documents. Numeric values and content digests remain unchanged by validation.

| Model field | Accepted unit | Numeric constraint |
| --- | --- | --- |
| Actuator `torqueConstantNmPerA` | `N*m/A` | Positive |
| Process reservoir `capacityMl` | `mL`, legacy `1` | Positive |
| Process reservoir `initialMl` | `mL`, legacy `1` | Nonnegative, at most capacity |
| Process `flowMlPerSec` | `mL/s`, legacy `1` | Positive |
| Process `densityKgPerM3` | `kg/m^3`, legacy `1` | Positive |
| Process temperature `initialC`, `targetC` | `degC`, legacy `1` | Finite, at least -273.15 Celsius |

The `1` compatibility convention applies only to these named process fields: it means the numeric unit already stated in the field name. For example, `flowMlPerSec: {value: 20, unit: "1", ...}` means 20 mL/s. This preserves `tests/fixtures/engineering/process-200ml.json` and existing archive content. It does not permit `1` for an actuator torque constant. `L`, `L/s`, `g/cm^3`, Kelvin, and arbitrary labels are refused. Capacity and initial volume are compared only when both have the accepted mL interpretation, including a mixture of `mL` and legacy `1`.

A generic sensor declares its measurement unit through `range.min.unit`. The `range.max` and `noise.stddev` units must match it exactly. Approved measurement units are `1`, `m`, `kg`, `kg*m^2`, `rad`, `rad/s`, `rad/s^2`, `m/s`, `m/s^2`, `N`, `N*m`, `V`, `A`, `Ah`, `Wh`, `W`, `Ohm`, `s`, `Hz`, `N*m/A`, `mL`, `mL/s`, `kg/m^3`, and `degC`. Here `1` denotes an explicitly dimensionless sensor measurement. No implicit process-field interpretation applies to sensors. Range endpoints must be finite and increasing; noise standard deviation must be nonnegative. Signed measurements are allowed.

Existing rate, time, probability, transmission, current, voltage, torque-speed and wheel-geometry checks remain in force. The shipped catalog's two actuator models do not declare a torque constant; their content and digests remain unchanged. The separate Python actuator reference vector now labels its existing 0.05 torque constant as `N*m/A` instead of `N*m`, with no numeric change.

The Python plant consumes already validated model numbers in the named field units. These validators establish the boundary; direct Python calls do not perform unit conversion or provide a second model-document validation layer.
