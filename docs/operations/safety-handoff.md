# Safety handoff (software / controller boundary)

Applies to every non-simulated robot. No safety certification is claimed by this repository.

## Boundary

- **Hardware owns safety.** The E-stop must cut motion through a path independent of software, and the watchdog must run on a computer independent of the navigation computer. Commissioning records both (`ESTOP_NOT_INDEPENDENT`, `WATCHDOG_NOT_INDEPENDENT` block `hardware_validated`).
- **Software may only request STOP.** Cancel/STOP goes through the executor and Nav2/vendor interface and is best effort. A STOP request is not proof the robot stopped; only the robot's reported state, or a supervisor's observation, is.
- **Reset comes from the controller.** After an E-stop, bumper, cliff or watchdog fault, the robot is re-enabled only by a person at the robot or its hardware controller. There is no software reset in this repository and none must be added. A fault stays authoritative until the hardware says otherwise (W06-T02/T03 behaviour).
- **No automatic authority transfer.** Robot-control authority never moves on a timeout.

## Supervised testing rules

1. Active-motion tests run only with an explicit target robot, a named observer within reach of the hardware E-stop, and a cleared test area, all given at execution (`commissioning.py active-motion --target ... --observer ... --test-area ...`). Never from defaults, environment or committed config.
2. First run read-only (`validate`, topic/bus inspection) and only then motion, starting at the lowest speed with no payload.
3. Record actual payload, speed, stop distance and firmware for each run; results go into the commissioning record and are signed.
4. Stop the session on any unexpected motion and report; do not retry unattended.
5. The household vacuum profile (Valetudo) is never a substitute for a 20-30 kg chassis.

## Not provided here

Supplier E-stop wiring, reset procedure and safety rating are vendor documents that are not in this repository. Until a named person has measured and signed, every profile stays `integration_tested` and non-dispatchable at a venue.
