#!/usr/bin/env bash
# Operator tool: local Docker only. No SSH, builds, automatic schema rollback or volume deletion.
set -euo pipefail
umask 077
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
STATE="$ROOT/state"
fail() { printf '%s\n' "$*" >&2; exit 1; }
d() { docker --host=unix:///var/run/docker.sock "$@"; }
dc() {
  local files=(-f "$ROOT/compose.yaml")
  # Explicit local test/operator override; production instructions use only compose.yaml.
  if [[ -n ${TIMELINE_COMPOSE_OVERRIDE:-} ]]; then files+=(-f "$TIMELINE_COMPOSE_OVERRIDE"); fi
  d compose --project-directory "$ROOT" --env-file "$STATE/config.env" "${files[@]}" "$@"
}
secret() { if [[ -e $STATE/secrets/$1 ]]; then chmod 0600 "$STATE/secrets/$1"; fi; printf '%s' "$2" > "$STATE/secrets/$1"; chmod 0400 "$STATE/secrets/$1"; chown 1000:1000 "$STATE/secrets/$1"; }
ask() { read -r -p "$2: " "$1" || fail 'Ввод отменён'; }
hidden() { IFS= read -r -s -p "$2: " "$1" || fail 'Ввод отменён'; printf '\n'; }
image_ok() { [[ $1 =~ ^ghcr\.io/messagetomedium/timeline@sha256:[a-f0-9]{64}$ || $1 =~ ^sha256:[a-f0-9]{64}$ ]]; }
load() {
  [[ -f $STATE/config.env ]] || fail 'Сначала выполните init.'
  while IFS='=' read -r key value; do
    case "$key" in APP_IMAGE|DOMAIN|TLS_EMAIL|SMTP_HOST|SMTP_PORT|SMTP_USER|MAIL_FROM) export "$key=$value";; *) fail 'Неизвестное поле config.env';; esac
  done < "$STATE/config.env"
  image_ok "$APP_IMAGE" || fail 'Нужен неизменяемый digest образа из GitHub Actions.'
}
lock() { exec 9> "$STATE/operation.lock"; flock -n 9 || fail 'Другая операция уже выполняется. Дождитесь её завершения.'; }
preflight() {
  command -v docker >/dev/null; command -v python3 >/dev/null; command -v openssl >/dev/null; command -v flock >/dev/null
  d compose version >/dev/null
  [[ $(uname -m) == x86_64 ]] || fail 'Образ рассчитан на amd64. Не запускайте сборку на VPS.'
  awk '/MemTotal/ {exit ($2 < 1843200)}' /proc/meminfo || fail 'Нужно не менее 1800 MiB доступной ОС физической RAM (тариф 2 ГБ).'
  [[ $(df -Pk "$STATE" | awk 'END {print $4}') -gt 3145728 ]] || fail 'Освободите минимум 3 ГБ диска. Данные/образы автоматически не удаляются.'
}
init() {
  [[ ! -e $STATE ]] || fail 'Каталог state уже существует. Секреты не перезаписываются. Используйте status/инструкцию обновления.'
  ask APP_IMAGE 'Digest образа из GitHub Actions (ghcr.io/messagetomedium/timeline@sha256:...)'
  image_ok "$APP_IMAGE" || fail 'Неверный digest. Теги latest/main не используются.'
  ask DOMAIN 'Уже настроенное доменное имя (без https://, порта и пути)'
  [[ $DOMAIN =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ && $DOMAIN != *..* ]] || fail 'Нужно доменное имя для HTTPS, не IP. DNS скрипт не изменяет.'
  ask TLS_EMAIL 'Ваш email для уведомлений о HTTPS'
  ask SMTP_HOST 'SMTP hostname'; ask SMTP_PORT 'SMTP порт (587 или 465)'
  ask SMTP_USER 'SMTP логин'; ask MAIL_FROM 'Подтверждённый email отправителя'
  [[ $TLS_EMAIL =~ ^[a-zA-Z0-9._+%-]+@[a-zA-Z0-9.-]+$ && $MAIL_FROM =~ ^[a-zA-Z0-9._+%-]+@[a-zA-Z0-9.-]+$ ]] || fail 'Неверный email'
  [[ $SMTP_HOST =~ ^[a-zA-Z0-9.-]+$ && $SMTP_USER =~ ^[a-zA-Z0-9@._+:-]+$ && $SMTP_PORT =~ ^(465|587)$ ]] || fail 'Проверьте поля SMTP'
  hidden smtp_password 'Пароль приложения SMTP (ввод скрыт)'
  [[ -n $smtp_password ]] || fail 'SMTP пароль не задан'
  mkdir -m 0700 "$STATE" "$STATE/secrets" "$STATE/backups" "$STATE/restore"
  chown 1000:1000 "$STATE/backups" "$STATE/restore"
  for key in APP_IMAGE DOMAIN TLS_EMAIL SMTP_HOST SMTP_PORT SMTP_USER MAIL_FROM; do printf '%s=%s\n' "$key" "${!key}"; done > "$STATE/config.env"
  secret postgres_password "$(openssl rand -hex 32)"
  local migrator_password app_password
  migrator_password=$(openssl rand -hex 32); app_password=$(openssl rand -hex 32)
  secret migrator_password "$migrator_password"; secret app_password "$app_password"
  secret MIGRATION_DATABASE_URL "postgresql://timeline_migrator:$migrator_password@postgres:5432/timeline"
  secret DATABASE_URL "postgresql://timeline_app:$app_password@postgres:5432/timeline"
  secret BETTER_AUTH_SECRET "$(openssl rand -hex 48)"; secret SMTP_PASSWORD "$smtp_password"
  for key in RESTORE_DATABASE_URL RESTIC_REPOSITORY restic_password AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do secret "$key" ''; done
  printf '%s\n' 'Конфигурация создана. Секреты не выводятся. Далее: install, backup-config, backup-init, backup, schedule, start.'
}
admin_sql() {
  dc exec -T --user 0 postgres sh -eu -c 'export PGPASSWORD="$(cat /run/secrets/postgres_password)"; exec psql -X -q -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1'
}
roles() {
  admin_sql <<'SQL'
\set migrator_password `cat /run/secrets/migrator_password`
\set app_password `cat /run/secrets/app_password`
SELECT format('CREATE ROLE timeline_migrator LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS', :'migrator_password') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='timeline_migrator') \gexec
SELECT format('CREATE ROLE timeline_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS', :'app_password') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='timeline_app') \gexec
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('timeline_app','timeline_migrator') AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls)) OR EXISTS (SELECT FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN ('timeline_app','timeline_migrator'))) THEN RAISE EXCEPTION 'Unsafe existing roles'; END IF;
END $$;
SELECT 'CREATE DATABASE timeline OWNER timeline_migrator' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='timeline') \gexec
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname='timeline' AND r.rolname='timeline_migrator') THEN RAISE EXCEPTION 'Unexpected database owner'; END IF;
END $$;
REVOKE ALL ON DATABASE timeline FROM PUBLIC;
GRANT CONNECT ON DATABASE timeline TO timeline_app;
SQL
}
operator() { dc run --rm --no-deps -T operator node "$@"; }
grants() {
  # Run as the schema owner. No password in psql arguments or command output.
  dc run --rm --no-deps -T operator sh -eu -c 'export PGPASSWORD="$(cat /run/secrets/MIGRATION_DATABASE_URL | sed -n "s|postgresql://timeline_migrator:\([^@]*\)@.*|\1|p")"; exec psql -X -q -h postgres -U timeline_migrator -d timeline -v ON_ERROR_STOP=1' <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public, drizzle TO timeline_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO timeline_app;
GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO timeline_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO timeline_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle GRANT SELECT ON TABLES TO timeline_app;
SQL
}
migrate() { operator build/server/cli.js migrate; grants; }
pull_app() {
  if [[ $APP_IMAGE == ghcr.io/* ]]; then dc pull app operator; else d image inspect "$APP_IMAGE" >/dev/null; fi
}
restic() { dc run --rm --no-deps -T restic "$@"; }
backup_config() {
  ask repository 'Существующее внешнее S3-хранилище (s3:https://HOST/BUCKET/timeline)'
  [[ $repository =~ ^s3:https://[a-zA-Z0-9.-]+/[a-zA-Z0-9._/-]+$ ]] || fail 'Нужен HTTPS S3 endpoint с bucket/префиксом.'
  local endpoint=${repository#s3:https://}; endpoint=${endpoint%%/*}
  [[ $endpoint != "$DOMAIN" && $endpoint != 179.66.185.120 && $endpoint != localhost && ! $endpoint =~ ^[0-9.]+$ && $endpoint == *.* ]] || fail 'Хранилище должно быть вне VPS, у провайдера S3.'
  [[ ! -s $STATE/secrets/RESTIC_REPOSITORY ]] || fail 'Хранилище уже задано. Смена ключей/репозитория требует отдельной процедуры; старые копии не изменяются.'
  hidden access 'S3 Access Key'; hidden password 'S3 Secret Key'
  hidden encryption 'Пароль шифрования из вашего менеджера паролей (не менее 20 символов)'
  hidden confirmation 'Повторите пароль шифрования'
  [[ -n $access && -n $password && ${#encryption} -ge 20 && $encryption == "$confirmation" ]] || fail 'Проверьте ключи/пароль'
  secret RESTIC_REPOSITORY "$repository"; secret AWS_ACCESS_KEY_ID "$access"; secret AWS_SECRET_ACCESS_KEY "$password"; secret restic_password "$encryption"
  printf '%s\n' 'Сохраните пароль шифрования и S3-доступ вне VPS! Без них восстановление на новом сервере невозможно. Далее backup-init.'
}
backup_ready() { [[ -s $STATE/secrets/RESTIC_REPOSITORY && -s $STATE/secrets/restic_password ]] || fail 'Сначала backup-config и backup-init.'; }
restore_verify() {
  local file=$1 rehearsal=${2:-} target
  target="timeline_$(date -u +%Y%m%d%H%M%S)_$(openssl rand -hex 4)_restore_test"
  [[ $target =~ ^timeline_[0-9]{14}_[a-f0-9]{8}_restore_test$ ]] || fail 'Неверное имя тестовой БД'
  admin_sql <<< "CREATE DATABASE $target OWNER timeline_migrator TEMPLATE template0;"
  local password; password=$(cat "$STATE/secrets/migrator_password")
  secret RESTORE_DATABASE_URL "postgresql://timeline_migrator:$password@postgres:5432/$target"
  dc run --rm --no-deps -T -e "BACKUP_FILE=$file" operator node build/server/backup.js verify
  if [[ -n $rehearsal ]]; then
    # The new release rehearses DDL only against the newly created restored DB.
    APP_IMAGE="$rehearsal" dc run --rm --no-deps -T operator sh -eu -c 'export MIGRATION_DATABASE_URL="$RESTORE_DATABASE_URL"; exec node build/server/cli.js migrate'
  fi
  admin_sql <<< "DROP DATABASE $target;"
  secret RESTORE_DATABASE_URL ''
}
backup() {
  backup_ready
  local name="timeline_$(date -u +%Y%m%dT%H%M%SZ)_$(openssl rand -hex 4).dump" snapshot drill
  dc run --rm --no-deps -T -e "BACKUP_FILE=/backups/$name" operator node build/server/backup.js dump
  printf '%s\n' "$APP_IMAGE" > "$STATE/backups/$name.image"
  chown 1000:1000 "$STATE/backups/$name.image"; chmod 0400 "$STATE/backups/$name.image"
  restic backup --host timeline-vps --tag timeline-vps --pack-size 8 --json "/backups/$name" "/backups/$name.json" "/backups/$name.image" > "$STATE/upload.json"
  snapshot=$(python3 - "$STATE/upload.json" <<'PY'
import json,sys
for line in open(sys.argv[1]):
    row=json.loads(line)
    if row.get('message_type')=='summary': print(row['snapshot_id'])
PY
)
  [[ $snapshot =~ ^[a-f0-9]{64}$ ]] || fail 'Нет подтверждённого snapshot во внешнем хранилище. Локальный dump сохранён.'
  restic check
  drill="drill-$(openssl rand -hex 8)"
  restic restore "$snapshot" --target "/restore/$drill"
  restore_verify "/restore/$drill/backups/$name"
  # Prune only after the encrypted external copy has been downloaded and restored.
  restic forget --host timeline-vps --tag timeline-vps --group-by host,tags --keep-daily 7 --keep-weekly 4 --keep-monthly 3 --prune
  printf '%s\n' "$snapshot" > "$STATE/last-backup-snapshot"
  date +%s > "$STATE/last-backup-success"
  printf '%s\n' "$name" > "$STATE/last-backup-name"
  printf '%s\n' "$APP_IMAGE" > "$STATE/last-backup-image"
  # Keep the last successful local pair for a migration rehearsal; remove only older successful pairs.
  if [[ -f $STATE/previous-backup-name ]]; then
    local old; old=$(cat "$STATE/previous-backup-name")
    [[ $old =~ ^timeline_[0-9TZ]+_[a-f0-9]{8}\.dump$ ]] && rm -f -- "$STATE/backups/$old" "$STATE/backups/$old.json" "$STATE/backups/$old.image"
  fi
  printf '%s\n' "$name" > "$STATE/previous-backup-name"
  rm -rf -- "$STATE/restore/$drill"
  printf '%s\n' 'Внешняя зашифрованная копия скачана и восстановлена в отдельной тестовой БД: OK.'
}
verify_latest() {
  backup_ready
  local drill="drill-$(openssl rand -hex 8)" name verifier
  [[ -f $STATE/last-backup-snapshot && -f $STATE/last-backup-name ]] || fail 'Нет успешной копии этой установки.'
  name=$(cat "$STATE/last-backup-name")
  [[ $name =~ ^timeline_[0-9TZ]+_[a-f0-9]{8}\.dump$ ]] || fail 'Неверное имя архива'
  local snapshot; snapshot=$(cat "$STATE/last-backup-snapshot"); [[ $snapshot =~ ^[a-f0-9]{64}$ ]] || fail 'Неверный snapshot'
  restic restore "$snapshot" --target "/restore/$drill"
  verifier=$(cat "$STATE/restore/$drill/backups/$name.image")
  image_ok "$verifier" || fail 'Неверный digest образа в metadata копии'
  APP_IMAGE="$verifier" pull_app
  APP_IMAGE="$verifier" restore_verify "/restore/$drill/backups/$name"
  rm -rf -- "$STATE/restore/$drill"
}
start() {
  backup_ready
  [[ -f $STATE/last-backup-success ]] || fail 'До запуска нужна первая проверенная внешняя копия: backup.'
  local stamp; stamp=$(cat "$STATE/last-backup-success")
  [[ $stamp =~ ^[0-9]+$ && $(( $(date +%s) - stamp )) -lt 86400 ]] || fail 'Внешняя копия старше суток. Сначала backup.'
  operator build/server/cli.js status # Validation only. Never DDL on app start.
  dc up -d --wait --wait-timeout 120 app proxy
}
update() {
  local next=${1:-}; image_ok "$next" || fail 'update DIGEST --migrate'
  [[ ${2:-} == --migrate ]] || fail 'Нужно явно подтвердить операторскую миграцию: update DIGEST --migrate'
  APP_IMAGE="$next" pull_app
  backup
  local name; name=$(cat "$STATE/last-backup-name")
  # Rehearse with the current verifier, then run the new migration image on that DB.
  restore_verify "/backups/$name" "$next"
  dc stop app
  printf '%s\n' "$APP_IMAGE" > "$STATE/previous-image"
  APP_IMAGE="$next" migrate
  # Config changes only after a successful migration. A failure leaves app stopped for explicit recovery.
  sed "s|^APP_IMAGE=.*|APP_IMAGE=$next|" "$STATE/config.env" > "$STATE/config.env.next"
  mv "$STATE/config.env.next" "$STATE/config.env"
  APP_IMAGE="$next" start
}
schedule() {
  [[ $EUID -eq 0 ]] || fail 'Для systemd выполните через sudo.'
  [[ $ROOT =~ ^/[a-zA-Z0-9_./-]+$ ]] || fail 'Путь установки не должен содержать пробелы/спецсимволы'
  backup_ready
  cat > /etc/systemd/system/timeline-backup.service <<UNIT
[Unit]
Description=TIMELINE encrypted offsite backup and restore drill
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target
[Service]
Type=oneshot
UMask=0077
ExecStart=/bin/bash $ROOT/timeline.sh backup
TimeoutStartSec=45min
Nice=10
IOSchedulingClass=idle
UNIT
  cat > /etc/systemd/system/timeline-backup.timer <<'UNIT'
[Unit]
Description=Daily TIMELINE backup (Moscow time)
[Timer]
OnCalendar=*-*-* 03:15:00 Europe/Moscow
RandomizedDelaySec=10m
Persistent=true
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now docker.service timeline-backup.timer
}
command=${1:-help}; shift || true
if [[ $command == init ]]; then init; exit; fi
if [[ $command == help ]]; then printf '%s\n' 'init | install | migrate | backup-config | backup-init | backup | verify | schedule | start | update DIGEST --migrate | bootstrap EMAIL | status'; exit; fi
load
if [[ $command == status ]]; then
  dc ps; df -h "$STATE"; d stats --no-stream $(dc ps -q) || true
  if [[ -f $STATE/last-backup-success ]]; then printf 'Последняя проверенная внешняя копия: '; date -d "@$(cat "$STATE/last-backup-success")" --iso-8601=seconds; fi
  systemctl --no-pager list-timers timeline-backup.timer 2>/dev/null || true
  exit
fi
if [[ $command == install && -f $STATE/installed ]]; then
  fail 'Первоначальная установка уже выполнена. Для новой версии используйте update DIGEST --migrate.'
fi
lock
preflight
case "$command" in
  install) pull_app; dc pull postgres proxy restic; dc up -d --wait --wait-timeout 120 postgres; roles; migrate; printf '%s\n' "$APP_IMAGE" > "$STATE/installed";;
  migrate) operator build/server/cli.js status; migrate;; # New schema versions require update --migrate and its backup/rehearsal.
  backup-config) backup_config;;
  backup-init) backup_ready; restic init;;
  backup) backup;;
  verify) verify_latest;;
  schedule) schedule;;
  start) start;;
  update) update "$@";;
  bootstrap) [[ ${1:-} =~ ^[a-zA-Z0-9._+%-]+@[a-zA-Z0-9.-]+$ ]] || fail 'Нужен email подтверждённого пользователя'; dc run --rm --no-deps -T -e "BOOTSTRAP_OWNER_EMAIL=$1" operator node build/server/cli.js bootstrap;;
  *) fail 'Неизвестная команда. Используйте help.';;
esac
