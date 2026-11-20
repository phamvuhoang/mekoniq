# Worker protocol corpus

Captured from `faee938d` on macOS 26.5 (Darwin arm64), Python 3.11.15 and MuJoCo 3.17.0. Each response stream includes create, start, 40 steps and getState. The test runs the worker CLI against the recorded requests and scene documents, then compares its NDJSON bytes with the capture. Only the per-process `bootId` value is replaced, under the explicit `bootId` key. No cross-platform byte equivalence is asserted.

Both mobile cases use the center-cup load. The no-drive case uses velocity commands. The CIL case overlays its recorded navigation scene and nominal drive documents on the mobile bundle and sends fresh sequences. The arm uses joint and gripper targets with a cup placement and reuses the repository's content-addressed arm blobs.
