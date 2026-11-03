# TIMELINE на одном VPS Timeweb Cloud — инструкция владельцу (V2.0B)

Подготовлено для уже созданного VPS **179.66.185.120**, Ubuntu 24.04, Docker,
**1 vCPU / 2 ГБ RAM / 30 ГБ NVMe**, закрытого пилота на 4 пользователя.
Команды ниже предназначены **для владельца после merge и публикации образа**.
Codex не подключается к VPS, не покупает услуги, не меняет DNS/настройки сервера.

## Что потребуется до первого запуска

1. Существующее доменное имя, уже направленное на этот VPS. Вход будет по
   `https://ВАШ_ДОМЕН`. Скрипт не меняет DNS. Если домена ещё нет или он указывает
   в другое место — остановитесь: сначала нужно отдельное решение владельца.
   Не используйте IP вместо домена и не отключайте проверку сертификата.
2. SMTP: адрес сервера, порт **587 (STARTTLS)** либо **465 (TLS)**, логин,
   пароль приложения и подтверждённый email отправителя. Значения даёт ваш почтовый
   провайдер; SPF/DKIM/DMARC должны быть настроены им/владельцем отдельно. Реальных
   секретов в репозитории нет. Письма не отправляются через тестовый MemoryMailer.
3. **Уже существующее внешнее S3-совместимое хранилище**, отдельное от VPS:
   HTTPS endpoint, bucket/префикс, Access Key и Secret Key. Доступ ограничьте этим
   bucket/префиксом: list/get/put/delete объектов (Restic нужен delete для retention).
   Создание или оплата хранилища этой задачей не выполняются. Без него запуск
   намеренно блокируется до первой проверенной внешней копии.
4. Пароль шифрования копий, минимум 20 символов, заранее сохранённый в вашем
   менеджере паролей **вне VPS**. Там же сохраните доступ к S3. Потеря пароля
   делает зашифрованные копии невосстановимыми; пароль не загружается в S3.
5. На стороне Timeweb разрешены входящие TCP **80/443** для HTTPS и выдачи
   сертификатов. SSH/консоль — только владельцу, по возможности с ограничением IP.
   Не открывайте **5432, 8080/8081, 2019, 2375/2376**. Docker может обходить правила UFW:
   используйте сетевой экран Timeweb и проверьте опубликованные Docker-порты.
   Скрипт не перенастраивает SSH/UFW/сетевой экран и не рискует закрыть вам доступ.

## Шаг 1. Получить готовый образ из GitHub

После защищённого merge откройте GitHub → TIMELINE → **Actions → «Образ TIMELINE
для VPS»**. Дождитесь зелёного результата. Внизу Summary скопируйте две строки:
**исходный commit** и **готовый образ `ghcr.io/messagetomedium/timeline@sha256:…`**.
Workflow использует GitHub `GITHUB_TOKEN`, собирает amd64-образ на runner и
публикует SHA-tag/digest. На VPS **нет** `docker build`, npm/Node-сборки или `npm ci`.
Ручной запуск workflow разрешён только для main; feature-ветка образ не выпускает.

Пакет GHCR по умолчанию может быть закрытым. Владелец может отдельно сделать
пакет публичным (код/образ не содержат секретов) либо выдать **только read:packages**
токен для VPS. Для закрытого пакета после входа в консоль выполните:

```sh
read -r -p 'GitHub логин: ' GHCR_LOGIN
read -r -s -p 'Токен только read:packages: ' GHCR_READ_TOKEN
printf '%s' "$GHCR_READ_TOKEN" | docker login ghcr.io --username "$GHCR_LOGIN" --password-stdin
unset GHCR_READ_TOKEN GHCR_LOGIN
```

Токен не попадает в историю команд. Docker сохраняет учётные данные в закрытом
root-каталоге `/root/.docker`; не копируйте его в git и не публикуйте. Для публичного
образа вход в GHCR не нужен. GitHub API 403 у Codex не означает, что образ уже выпущен:
до зелёного workflow и известного digest не продолжайте.

## Шаг 2. Открыть консоль Timeweb и скачать файлы

Откройте **консоль этого VPS** в Timeweb. Вставляйте блоки по очереди. После любой
ошибки остановитесь и сохраните текст ошибки без секретов; не продолжайте вслепую.

```sh
sudo -i
docker version
docker compose version
git --version
python3 --version
openssl version
```

Нужен Compose v2.24+ (в тестах используется v2.40). Если не хватает Git/Python/OpenSSL:
`apt-get update`, затем `apt-get install -y git python3 openssl util-linux`.
Если нет Docker Compose — передайте это сообщение администратору/Timeweb для установки
совместимого плагина; не заменяйте работающий Docker случайным установочным скриптом.

```sh
git clone https://github.com/messagetomedium/TIMELINE.git /opt/timeline
cd /opt/timeline
read -r -p 'Исходный commit из Summary образа: ' TIMELINE_RELEASE_SHA
git checkout "$TIMELINE_RELEASE_SHA"
unset TIMELINE_RELEASE_SHA
cd /opt/timeline/deploy/vps
bash timeline.sh init
```

Если `/opt/timeline` уже существует, не удаляйте его: переходите к разделу обновления.
`init` попросит по очереди digest, домен, ваш email для HTTPS, SMTP hostname/порт/логин,
email отправителя и скрытый SMTP-пароль. Вставьте значения из шага 1 и от почтового
провайдера. Логин SMTP поддерживает обычные email/буквы/цифры/`._+:-`; при другом
формате нужна адаптация проверки. Пароли PostgreSQL и Better Auth генерируются сами.
Повторный `init` откажется перезаписывать существующий каталог `state`.

`state` имеет режим 0700, файлы секретов 0400 и читаются только нужными контейнерами
через Compose secrets. Compose secrets в обычном Docker — защищённые bind-файлы,
**не** зашифрованный vault: root/Docker-администратор хоста имеет к ним доступ.
Не присылайте `state`, `.env`, вывод `docker inspect`/`env` или пароли в чат.
`state` исключён из git и Docker build context. Нет секретов в образе или frontend.

## Шаг 3. Установить БД и выполнить явную миграцию

```sh
bash timeline.sh install
```

Команда только скачивает готовые образы, запускает PostgreSQL, создаёт отдельные
роли и выполняет миграции отдельным контейнером. Приложение пока не опубликовано.
Роль `timeline_migrator` владеет БД/схемой; `timeline_app` имеет только CONNECT,
USAGE и DML, без SUPERUSER/CREATEDB/CREATEROLE/BYPASSRLS и без CREATE в public.
Успешный install помечается в state и повторно не выполняется: для новой версии
нужен update --migrate с копией и репетицией. Отдельный migrate допускает только
повтор уже совместимой версии после проверки status, не заменяет процедуру обновления.
Администратор PostgreSQL используется только внутри DB-контейнера для создания ролей
и пустых тестовых баз. Его секрет не передаётся приложению/оператору.

## Шаг 4. Подключить внешние копии и ежедневное расписание

```sh
bash timeline.sh backup-config
bash timeline.sh backup-init
bash timeline.sh backup
bash timeline.sh schedule
```

Введите адрес вида `s3:https://S3_HOST/BUCKET/timeline`, ключи от существующего
хранилища и пароль из менеджера паролей. Пароль вводится скрыто дважды. `backup-init`
инициализирует зашифрованный Restic-репозиторий в указанном префиксе; не используйте
чужой/общий префикс. Уже заданные ключи автоматически не перезаписываются.
Если репозиторий существовал раньше, не инициализируйте и не удаляйте его: нужна
процедура восстановления с прежними ключами/паролем.

Каждый `backup` делает согласованный dump + manifest существующим операторским
инструментом, шифрует/загружает их во внешнее хранилище, проверяет репозиторий,
**скачивает эту копию обратно и восстанавливает в новой пустой `*_restore_test` БД**.
С копией сохраняется `.image` с digest исходного образа: последующая проверка
использует соответствующий verifier, даже после новых миграций. Сверяются данные
всех таблиц и миграции; рабочая БД не перезаписывается. Только после
успеха применяется retention: 7 дневных, 4 недельных, 3 месячных точки. Новая тестовая
БД удаляется после успеха; при сбое остаётся для разбора, повтор создаёт другую.
Предыдущие копии не удаляются при ошибке upload/restore. Временные неудачные dump/drill
могут занимать диск: разберите причину прежде, чем удалять их вручную.

Systemd запускает задачу **ежедневно в 03:15 по Москве**, со случайной задержкой
до 10 минут и догоняющим запуском после простоя. Выполнение serial через flock:
backup и update не пересекаются. При сбое сервис завершается с ошибкой; оповещения
провайдера/мониторинга нужно подключить отдельно. Проверять состояние:

```sh
bash timeline.sh status
systemctl --no-pager status timeline-backup.timer
journalctl -u timeline-backup.service -n 50 --no-pager
```

Разовая повторная проверка последней внешней копии: `bash timeline.sh verify`.
`status` показывает время последней успешной внешней проверки; отсутствие/возраст
более суток требует внимания. Успешная локальная копия не считается внешней.

## Шаг 5. Запустить HTTPS и зарегистрировать владельца

```sh
bash timeline.sh start
bash timeline.sh status
```

`start` проверяет уже применённые миграции и первую внешнюю копию не старше суток.
**DDL при запуске приложения нет.** Контейнеры перезапускаются автоматически,
БД хранится в именованном постоянном volume, Caddy сохраняет сертификаты отдельно.
Публичны только 80/443; база находится в `internal: true` сети, app:8080 и admin API
Caddy недоступны снаружи (admin API отключён). Healthchecks есть у всех постоянных
сервисов. Caddy доверенный proxy с фиксированным IP; входящие поддельные forwarding
заголовки заменяются. Ошибка схемы/БД не выдаётся за успешное сохранение.

Откройте `https://ВАШ_ДОМЕН`, зарегистрируйтесь, подтвердите email. Затем в консоли:

```sh
read -r -p 'Ваш подтверждённый email: ' TIMELINE_OWNER_EMAIL
bash timeline.sh bootstrap "$TIMELINE_OWNER_EMAIL"
unset TIMELINE_OWNER_EMAIL
```

Обновите страницу и войдите. Новые регистрации сами не становятся участниками.
Для остальных трёх участников используйте существующий механизм приглашений API
с действующей сессией владельца; публичного назначения ролей и нового обхода доступа
этот пакет не добавляет. UI управления участниками не входит в этот этап.
Проверьте создание/изменение/F5, письма восстановления и вход с другого устройства.
GitHub Pages остаётся локальной IndexedDB-версией: данные туда/обратно не мигрируют.

## Обновление и действия при ошибке

Скопируйте новые commit/digest из зелёного workflow. В консоли root:

```sh
cd /opt/timeline
git fetch origin main
read -r -p 'Новый commit из Summary: ' TIMELINE_RELEASE_SHA
git checkout "$TIMELINE_RELEASE_SHA"
unset TIMELINE_RELEASE_SHA
cd /opt/timeline/deploy/vps
read -r -p 'Новый ghcr.io/messagetomedium/timeline@sha256:... : ' TIMELINE_NEW_IMAGE
bash timeline.sh update "$TIMELINE_NEW_IMAGE" --migrate
unset TIMELINE_NEW_IMAGE
```

`--migrate` — явное разрешение операторской миграции при обновлении, не фоновая
миграция HTTP-сервера. Скрипт скачивает образ, проверяет новую внешнюю копию,
репетирует миграцию нового образа на восстановленной отдельной БД, затем останавливает
app, применяет миграцию рабочей БД, обновляет grants и запускает новый образ.
Потерянные права не «исправляются» выдачей SUPERUSER. `state/previous-image` сохраняет
предыдущий digest, но автоматического отката схемы/рабочих данных нет.

Если миграция/запуск упали — app может остаться остановленным: сохраните БД и копии,
обратитесь за разбором. Не выполняйте `down -v`, `volume rm`, `initdb`, удаление state,
авто-down-migrate или восстановление поверх рабочей БД. Возврат старого образа
допустим только при совместимой схеме; иначе восстанавливают копию в новую БД
и отдельно согласуют переключение. Не удаляйте старый digest до успешного обновления. Образы в GHCR сохраняйте,
пока существуют резервные копии, ссылающиеся на них через `.image`.

При полном исчезновении VPS: на новом изолированном сервере установите тот же пакет,
восстановите защищённые конфигурацию/ключи из менеджера паролей, откройте прежний
Restic-репозиторий, скачайте snapshot (`restic snapshots`, `restic restore SNAPSHOT
--target /restore/recovery` через tools-контейнер). Создайте **другую пустую** БД с
суффиксом `_restore_test` и выполните существующий `build/server/backup.js verify`
с её RESTORE_DATABASE_URL, архивом и manifest **образом из файла `.image` этой копии**. Это проверка, а не автоматическое
переключение. Конкретные команды cutover требуют отдельного решения; SQL-роли/grants
и конфигурация хоста в pg_dump не включены, их заново создаёт операторский пакет.
Не запускайте `backup-init` и не удаляйте старое хранилище при аварии.

## Память, диск и границы применимости

Постоянные лимиты: app **512 MiB** (V8 heap 256), PostgreSQL **512 MiB**
(shared_buffers 128, work_mem 2, max_connections 30), Caddy **128 MiB**.
В локальном сценарии четырёх сеансов и обновления измерены пики cgroup до/после
перезапуска: app **148 MiB**, PostgreSQL **137 MiB**, Caddy **15 MiB**, без OOM.
Это измерения тестового сценария, не проверка самого VPS или любого будущего объёма данных.
Сумма постоянных лимитов **1152 MiB**. Миграция/restore или Restic добавляют до **256 MiB по очереди**;
теоретически для Ubuntu/Docker остаётся 640 MiB из 2 GiB (фактический MemTotal
у тарифа «2 ГБ» меньше, его нужно смотреть в status/free). CPU ограничен на сервис,
backup не конкурирует с миграцией. Это бюджет закрытого пилота, не гарантия любой
нагрузки: контролируйте `status`, диск, OOM и длительность копий. Скрипт проверяет
объём RAM (не менее 1800 MiB доступных ОС) и минимум 3 ГБ свободного диска; не создаёт
swap и не запускает тяжёлые сборки. Растущая БД/архивы потребуют пересмотра тарифа.
Старые образы автоматически не удаляются: не запускайте общий prune на сервере,
где могут быть чужие сервисы. Предыдущий образ и последние удачные пары dump/manifest
сохраняются; зашифрованные долгосрочные копии находятся вне VPS.

`DB_SSL_MODE=disable` в production допускается **только** вместе с
`DB_CONNECTION_SCOPE=docker-internal`, hostname **postgres**, портом 5432 и без
URL query-параметров, способных подменить адрес. Этот флаг — утверждение оператора
о данном Compose-размещении, а не автоматическое доказательство сетевой изоляции:
её обеспечивает закрытая сеть Compose. Для внешнего hostname/IP (даже приватного)
приложение, миграции и backup CLI требуют `verify-full`; CA/TLS-проверка сохраняются.
Не используйте флаг для удалённой/управляемой БД. Фиксированная ingress-сеть
172.30.86.0/28 не должна пересекаться с существующими Docker/VPN-сетями; если пересекается,
не меняйте доверие на `/0` — нужен согласованный другой subnet/IP proxy и /32 в app.

Локальный целевой тест (Linux, root или UID 1000; в CI запускается через sudo): после сборки готового образа
`TIMELINE_TEST_IMAGE=timeline:ci node --test tests/package/vps.test.mjs`.
Он использует реальную PostgreSQL 17, Caddy с тестовым CA, 4 авторизованных сеанса с конкурентными командами
(входы соблюдают существующий rate limit), лимиты памяти и зашифрованный тестовый Restic backend без реального S3,
SMTP, DNS или подключения к VPS. PR дополнительно выполняет полный обязательный CI.

---

Ниже сохранена документация альтернативного управляемого размещения и прежних
инструментов. Для этого задания используйте VPS-процедуру выше.

# V1.6B: release package and staging procedure

This stage prepares and tests a package. It creates no Timeweb resources, DNS,
production database or users. Obtain separate authorization before those actions.
V2.0A connects the existing frontend to this API. Fastify serves the built HTML
with `APP_STORAGE_MODE=server` (default); the unchanged static Pages build contains
`timeline-storage=local` and continues to use IndexedDB. No endpoint probing or
fallback selects a mode. Set `STATIC_ROOT` to the frontend build directory for a
same-origin server deployment; API cookies never go to another host. No Vite secret
or API URL is embedded in the bundle. `APP_STORAGE_MODE=local` is an explicit
operator choice for serving the local editor with Fastify.

Server mode provides registration, verification/resend, login/logout and password
reset through Better Auth. Use the existing operator bootstrap after verifying
the owner email; registration never grants workspace membership. Production needs
working SMTP and `APP_ORIGIN` set to the public HTTPS origin. Callback/reset links
return to `/`, and mail tokens are removed from the browser URL and kept only in
memory while the reset form is open.

All content uses the existing revisioned command endpoints. One unacknowledged
intent and unfinished text/date input survive reload in per-user **sessionStorage
in the current tab**, separate from IndexedDB; this is not a second project store
or offline edit queue. An uncertain outcome retries the identical command ID/body.
A definite revision conflict retains the draft for explicit reload, comparison and
reapplication. Closing the tab can remove that recovery draft; the browser warns
while input or an acknowledgement is outstanding. Resolve or copy the draft before
closing the tab. A failed API call never writes to IndexedDB or claims local save.

Existing server API has no safe compensating Undo/Redo or JSON-import command:
these controls are unavailable in server mode, with an explanation. JSON export
uses the existing reads. Local import/history remain unchanged. Project view
preferences use the existing per-user PUT endpoint; workspace/portfolio UI settings
have no existing API endpoint and last for the current signed-in session. There is
no automatic migration of local projects, realtime or new infrastructure.

## Build and local verification

Use Node from `.nvmrc`. The multi-stage image compiles Vite frontend and Node ESM
backend using the existing Vite toolchain, omits dev dependencies and unused optional peers from runtime,
runs as uid 1000, listens on 0.0.0.0:8080 and serves `/`, assets, `/api` and auth
from one origin. Hash navigation needs no arbitrary SPA fallback. PostgreSQL 17
client tools are included for controlled one-off operator commands.

```sh
docker build -t timeline:v1-6b .
TIMELINE_TEST_IMAGE=timeline:v1-6b npm run test:package
```

The smoke test starts only disposable local PostgreSQL/app containers, a dedicated
Docker network and backup volume, then removes them. It verifies a real TLS
connection (including rejected CA/hostname), migrations, least-privilege runtime,
verified fixture login/bootstrap, command API, static assets and traversal denial,
backup/restore, absence of fixture secrets in runtime files/history, DB-outage
readiness and graceful SIGTERM. It sends no external mail. `openssl` and Docker
are needed on the test host. The full unchanged frontend suite runs in PR CI.

In the managed Codex environment preserve the provided proxy/CA settings:

```sh
docker --host=unix:///var/run/docker.sock build \
  --secret id=proxy_ca,src="$CODEX_PROXY_CERT" \
  --secret id=system_ca,src=/etc/ssl/certs/ca-certificates.crt \
  -t timeline:v1-6b .
```

The CA mounts exist only during networked build steps. No auth/DB/SMTP secrets
are build args. `.env*`, keys, dumps and local artifacts are excluded from context.
Keep TLS validation enabled; do not bake a session proxy certificate into an image.

## Timeweb staging checklist (operator, after authorization)

1. Create a separate staging project in a compatible region, App Platform and
   PostgreSQL 17 in a private network. Select the network before first deployment.
   Do not expose the database publicly or put production data in staging.
2. Use provider controls to create a database and a migration/operator login that
   owns its schemas/tables. Create a different runtime login `timeline_app` without
   SUPERUSER, CREATEDB, CREATEROLE, BYPASSRLS or schema ownership. Set passwords in
   the provider/interactive `psql` prompt, not shell arguments, git or chat.
3. Mount the provider's PostgreSQL CA read-only, choose `DB_SSL_MODE=verify-full`
   and `DB_SSL_CA_FILE=/run/secrets/postgres-ca.pem`. Use the provider's documented
   TLS hostname and private route. The public CA file must be readable by uid 1000. Never `rejectUnauthorized=false` or no-verify.
   URL `ssl*` parameters are rejected so they cannot override verified TLS.
4. Supply runtime secrets through the platform's secret settings: DATABASE_URL
   with only the runtime role, a stable random BETTER_AUTH_SECRET (at least 32
   characters, e.g. generated by `openssl rand -base64 48`), exact HTTPS APP_ORIGIN,
   MAILER_MODE=smtp, SMTP_HOST/PORT/USER/PASSWORD and verified MAIL_FROM.
   The image sets NODE_ENV=production, HOST=0.0.0.0, PORT=8080, STATIC_ROOT=/app/dist.
   Never set VITE_* secrets. Do not supply MIGRATION_DATABASE_URL, backup credentials
   or BOOTSTRAP_OWNER_EMAIL to the long-running app.
5. Configure only the actual ingress IP/CIDR(s) in TRUST_PROXY if forwarding is
   required. Leave it unset until the platform's trusted proxy range is known;
   arbitrary client X-Forwarded-For remains untrusted. Do not use true, wildcard
   or /0. Externally terminate HTTPS; APP_ORIGIN stays the external HTTPS origin.
6. Run migrations as a controlled one-off job/console in the same private network
   using this exact release image and operator-only environment. If the platform
   cannot run one-off jobs, use an approved private-network runner. Do not grant
   the app role DDL or add a public database endpoint for convenience.

For a one-off container with an operator-only env file and mounted CA:

```sh
docker run --rm --env-file /secure/operator.env \
  --mount type=bind,src=/secure/postgres-ca.pem,dst=/run/secrets/postgres-ca.pem,readonly \
  timeline:v1-6b node build/server/cli.js migrate
docker run --rm --env-file /secure/operator.env \
  --mount type=bind,src=/secure/postgres-ca.pem,dst=/run/secrets/postgres-ca.pem,readonly \
  timeline:v1-6b node build/server/cli.js status
```

These examples require a runner already routed to the private database. On a local
Docker network add its name with `--network`; never use host networking to bypass
an access policy. The operator env file contains MIGRATION_DATABASE_URL and the
same DB_SSL_MODE/DB_SSL_CA_FILE, not the app's auth or SMTP secret. Migrations hold
an advisory lock and verify versions/checksums. The HTTP server never applies DDL.
Before a later production migration require authorization, a backup and a rehearsal.

After migrations, the migration/schema owner grants the runtime role (replace the
example database name with the actual staging database):

```sql
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE timeline_staging TO timeline_app;
GRANT USAGE ON SCHEMA public, drizzle TO timeline_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO timeline_app;
GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO timeline_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO timeline_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle GRANT SELECT ON TABLES TO timeline_app;
```

Start the app with runtime secrets only. `/health/live` reports process liveness;
`/health/ready` also checks the database and exact migration version. DB outages
return readiness 503, not false saving success. SIGTERM drains HTTP and closes the
pool, with a 10-second shutdown deadline. The runtime supports a read-only root
filesystem and tmpfs `/tmp`; backups use a separate operator volume.

Register the intended owner through Better Auth, confirm email via SMTP, then run
`node build/server/cli.js bootstrap` as a one-off operator with BOOTSTRAP_OWNER_EMAIL.
Repeat is safe for that same verified owner; no public bootstrap/first-signup
promotion exists. Remove bootstrap settings afterwards. Test email confirmation,
reset, revoked sessions/memberships and access denial to MEDIUM for a new account.
Do not claim the local frontend is saving to this API before V2.0 integration.

After technical-domain checks, use only the exact DNS record supplied by the
platform for the chosen subdomain. Preserve Tilda/site records, MX and existing NS.
Wait for HTTPS, update APP_ORIGIN, then verify origin/cookies and SMTP SPF/DKIM/DMARC
with the provider's actual values. No DNS changes are performed by this task.

## Backup, restore drill and rollback

Enable provider automated backups after authorization; initial policy: daily,
retain at least seven copies, plus a manual backup before each migration. Confirm
retention, private access and storage cost. Dumps contain private data and auth
records: keep the archive and its manifest encrypted/access controlled outside git
and ephemeral app storage. An archive without a successful restore is not verified.

The one-off operator needs a persistent `/backups` volume writable by uid 1000.
Use a new filename for every run. `BACKUP_FILE=/backups/<unique>.dump`, operator
MIGRATION_DATABASE_URL, verified DB TLS settings and the same release image:

```sh
node build/server/backup.js dump
node build/server/backup.js verify
# Or create and verify a fresh backup in one operation:
node build/server/backup.js dump-verify
```

For source development these are `npm run db:backup`, `npm run db:restore:verify`
and `npm run db:backup:verify`; PostgreSQL 17 `pg_dump`/`pg_restore` must be on PATH.
Provide env values via secret settings or a protected .env file, not CLI URLs.
The dump and JSON checksum manifest are mode 0600 and never overwrite prior files.
The source uses one exported repeatable-read snapshot for both pg_dump and data
checksums, so concurrent application edits do not produce a false comparison.

`RESTORE_DATABASE_URL` must name a different **empty** database ending in
`_restore_test`, created separately by the operator with sufficient restore rights.
Verification never drops/cleans a database. Restore is a single transaction, rejects
nonempty targets and compares all table contents and exact migration checksums.
A failed drill stays isolated; inspect it with authorized tools and create a new
empty target for another attempt. Archive/manifest are trusted operator artifacts,
not a public upload/import interface. Reapply the runtime grants above when an
operator later restores a real environment: ownership/ACLs are deliberately omitted.

For rollback keep the prior image digest and backup pair. Application rollback is
safe only if the old image supports the current schema; otherwise readiness refuses
startup. Do not automatically down-migrate or overwrite the working database.
Rehearse restoring into a separate database, verify contents, then seek explicit
authorization for any production cutover. Retain the original database for recovery.

## CI/CD safety and remaining administrator action

PRs run one `Проверки` workflow. Scope detection selects frontend, server/real-PG,
and packaging jobs; shared domain/commands select both suites, critical config or
an unknown diff selects all, docs skip expensive application tests. `checks` and
`server` names are preserved; the `checks` aggregate fails closed on selected errors.
Obsolete PR runs cancel; main runs are retained. Feature-branch pushes do not add
a duplicate run beside their PR.

`main` защищён ruleset `TIMELINE - Protect main` (подтверждён 03.11.2026):
PR обязателен, требуется агрегатор `checks`, обходов и прямого push нет. Полный CI
выполняется на PR; main/Pages его повторно не запускают. Pages собирает и публикует
актуальный main в локальном режиме. Workflow образа VPS только собирает и публикует
артефакт проверенного main в GHCR, не подключается к VPS и не запускает миграции.
При 403 Codex не повторяет API-запрос: PR/merge/CI/Pages завершает ChatGPT.

## V2.0A targeted development checks

After `npm ci` and `npm run build`, use a disposable PostgreSQL database whose name
ends in `_test` (the fixtures clear **only that database**):

```sh
npm run test -- src/infrastructure/remote/RemoteCommandService.test.ts
TEST_DATABASE_URL=postgresql://TEST_OPERATOR@127.0.0.1/timeline_server_test npm run server:test -- server/tests/frontend-api.test.ts server/tests/runtime.test.ts
```

Install Chromium with `npx playwright install chromium`, or set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing local Chromium. These browser
checks use real Fastify/Better Auth/PostgreSQL and record no screenshots or video.
Full required suites run on the protected PR; Pages deployment keeps local mode.
