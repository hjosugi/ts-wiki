# Security policy

## Supported versions

The latest 1.x release receives security fixes. Pre-1.0 releases are no longer
supported after 1.0.0 is published.

## Reporting a vulnerability

Please use this repository's **Security → Report a vulnerability** private
reporting form. Do not open a public issue containing exploit details, secrets,
personal data, or an unpatched vulnerability.

Include affected versions, deployment assumptions, reproduction steps, impact,
and any suggested remediation. The maintainer will acknowledge a complete
report as soon as practical, coordinate validation and a fix privately, and
credit the reporter unless anonymity is requested.

For deployment hardening, use a unique `JWT_SECRET`, HTTPS, current immutable
image tags, regular tested backups, and leave private webhook targets disabled
unless the deployment explicitly requires them.
