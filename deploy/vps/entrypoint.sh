#!/bin/sh
set -eu
# Compose mounts only the secrets needed by this particular service. Never echo them.
for name in DATABASE_URL MIGRATION_DATABASE_URL RESTORE_DATABASE_URL BETTER_AUTH_SECRET SMTP_PASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY RESTIC_REPOSITORY; do
  file="/run/secrets/$name"
  if [ -f "$file" ]; then
    value=$(cat "$file")
    export "$name=$value"
  fi
done
exec "$@"
