"""MEKONIQ bench worker: the only process that opens the bus (spec B1 §3). Standard library only."""


class BenchError(Exception):
    """A refusal with a code of contracts §3 (or a DRIVE_* command refusal of drive-io); `detail` is for people."""

    def __init__(self, code, detail=""):
        super().__init__(f"{code}: {detail}")
        self.code, self.detail = code, str(detail)[:1000]
