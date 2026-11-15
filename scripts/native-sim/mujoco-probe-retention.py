"""Separately hashed observer of the frozen recipe. No engine import or dynamics changes.
Snapshots every 100 completed ticks and on warning/exception/finalization; the last
128 commands/samples are bounded diagnostics. Nonfinite numbers use explicit strings.
Observer copying/I/O cost is outside the recipe's engine-step timer, inside wall time.
"""
from collections import deque
import json
import math
from pathlib import Path


def plain(value):
    if hasattr(value, 'tolist'):
        return plain(value.tolist())
    if isinstance(value, dict):
        return {str(k): plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    if isinstance(value, float) and not math.isfinite(value):
        return 'NaN' if math.isnan(value) else ('Infinity' if value > 0 else '-Infinity')
    return value


def state(data):
    return {key: plain(list(getattr(data, key))) for key in ('qpos', 'qvel', 'qacc', 'ctrl')}


class Retention:
    def __init__(self, out, identity):
        self.out, self.identity = Path(out), identity
        self.out.mkdir(parents=True, exist_ok=True)
        self.sim, self.completed, self.attempted = None, 0, 0
        self.inputs, self.samples = deque(maxlen=128), deque(maxlen=128)
        self.failed = False

    def save(self, name, value):
        target = self.out / name
        temporary = target.with_suffix(target.suffix + '.partial')
        temporary.write_text(json.dumps(plain(value), allow_nan=False, separators=(',', ':')) + '\n')
        temporary.replace(target)

    def snapshot(self, reason):
        data = getattr(self.sim, 'd', None)
        if data is None:
            self.save('retention.json', {'scope': 'observer_instrumented_frozen_recipe', 'identity': self.identity,
                                       'reason': reason, 'stateAvailable': False, 'attemptedTicks': self.attempted})
            return
        warnings = [int(w.number) for w in data.warning]
        captured = {'state': state(data), 'warnings': warnings, 'engineTimeS': float(data.time),
                    'attemptedTicks': self.attempted, 'completedTicks': self.completed, 'reason': reason}
        self.save('last-state.json', captured)
        if not self.failed and (any(warnings) or reason.endswith('exception')):
            self.save('first-failure-state.json', captured)
            self.failed = True
        self.save('retention.json', {'scope': 'observer_instrumented_frozen_recipe', 'identity': self.identity,
                                   'reason': reason, 'stateAvailable': True, 'attemptedTicks': self.attempted,
                                   'completedTicks': self.completed, 'checkpointEveryTicks': 100,
                                   'sampleLimit': 128, 'inputs': list(self.inputs), 'samples': list(self.samples)})

    def finish(self, reason):
        self.snapshot(reason)


def install_retention(recipe, out, identity):
    capture, original = Retention(out, identity), recipe.Sim

    class ObservedSim(original):
        def __init__(self, parameters, q0, grip0=0.0):
            capture.sim = self
            capture.save('nominal-inputs.json', {'identity': identity, 'parameters': parameters, 'q0': q0, 'grip0': grip0})
            (capture.out / 'nominal-compiled.xml').write_text(recipe.scene.build(parameters))
            try:
                super().__init__(parameters, q0, grip0)
            except BaseException:
                capture.snapshot('constructor_exception')
                raise
            capture.snapshot('initialized')

        def tick(self, command, label=''):
            capture.attempted += 1
            capture.inputs.append({'attempt': capture.attempted, 'command': plain(command), 'label': label})
            try:
                result = super().tick(command, label)
            except BaseException:
                capture.snapshot('tick_exception')
                raise
            capture.completed += 1
            if self.log:
                capture.samples.append(plain(self.log[-1]))
            if capture.completed % 100 == 0 or any(w.number for w in self.d.warning):
                capture.snapshot('warning' if any(w.number for w in self.d.warning) else 'periodic')
            return result

    recipe.Sim = ObservedSim
    return capture
