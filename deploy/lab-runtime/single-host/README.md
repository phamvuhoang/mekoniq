# Persistent single-host simulation runtime

This profile is reviewable deployment configuration, not a deployment or qualification. Follow [the operations runbook](../../../docs/operations/lab-runtime-single-host.md). Set operator-owned environment values (runtime image digest, nginx image digest, access key, exact public Host and HTTPS Origin), and provide `tls/fullchain.pem` and `tls/privkey.pem` readable by uid 101. Never commit certificates, private keys or an environment file.

The runtime has one local named volume at `/data/runs`, no published port, no devices or Docker socket, and no automatic restart. A second instance sharing the volume refuses startup while the first holds its SQLite lease. The TLS proxy forwards only the configured exact Host, disables SSE buffering, and serves `/lab/v2/` only. `docker compose config --quiet` validates interpolation without printing secrets. Running `up` is an external deployment step requiring the assigned destination and authorization.

Use a trusted nginx image containing `envsubst`, `/bin/sh`, nginx and uid 101; pin its digest in `LAB_PROXY_IMAGE`. The proxy profile is untested until an actual image/TLS destination is assigned. Local Docker on a Mac would qualify only that Linux VM architecture, never native amd64 or public HTTPS.
