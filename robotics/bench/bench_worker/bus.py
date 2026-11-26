"""The bus as the session sees it (BK-D05): SimBus now, SoemBus (pysoem) at K08. Objects are 'IIII:SS' strings; positions are 1-based like EtherCAT."""
from typing import Protocol


class BusPort(Protocol):
    def scan(self) -> list[dict]: ...                                   # {position, vendorId, productCode, revision, serial, name}
    def sdo_read(self, position: int, obj: str, size: int) -> int: ...
    def sdo_read_string(self, position: int, obj: str) -> str: ...     # a visible string (1008h, 1009h, 100Ah)
    def sdo_write(self, position: int, obj: str, value: int, size: int) -> None: ...
    def map_pdo(self, position: int, rx: list[str], tx: list[str]) -> None: ...
    def start(self, cycle_ms: int, sync: str) -> None: ...             # PRE-OP -> OP, or BenchError BENCH_NOT_OPERATIONAL
    def exchange(self, outputs: list[dict]) -> list[dict]: ...         # one bus cycle: {controlword, targetRaw} -> {statusword, positionRaw, velocityRaw, torqueRaw, errorCode, wkcOk}
    def silence(self, ms: int) -> dict: ...                            # {alState, alStatusCode, slaves: [{statusword, errorCode, positionRaw, velocityRaw}]}
    def close(self) -> None: ...
