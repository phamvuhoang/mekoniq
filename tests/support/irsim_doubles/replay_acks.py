"""Test double: answers request n with line n of the ACK file given as argv[1], bound to that request's requestId."""
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    acks = [json.loads(line) for line in f if line.strip()]
for ack in acks:
    request = json.loads(sys.stdin.buffer.readline())
    print(json.dumps({**ack, "requestId": request["requestId"]}, separators=(",", ":")), flush=True)
sys.stdin.buffer.readline()
