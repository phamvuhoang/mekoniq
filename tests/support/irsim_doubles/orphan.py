"""Test double: leaves a grandchild in its own session that inherits this worker's stdout/stderr and lives on after the worker is killed.
A recording hung for ~15 minutes four times because the client waited for the stdio 'close' event, which such a survivor withholds."""
import subprocess
import sys
import time

subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"], start_new_session=True)  # escapes the worker's process group, keeps the pipes
sys.stdin.buffer.readline()  # the first request; never answered, so the client's deadline and group kill decide
time.sleep(600)
