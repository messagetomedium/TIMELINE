# TIMELINE

Текущий frontend: `npm ci`, `npm run dev`. GitHub Pages продолжает работать
локально через IndexedDB. V2.0A подключает этот же интерфейс к существующим API и
PostgreSQL при серверном размещении (`APP_STORAGE_MODE=server`, Fastify + `STATIC_ROOT`).
Режим задаётся явно в HTML при размещении; автоматического переноса локальных проектов
или переключения на IndexedDB при ошибке API нет. Дизайн и локальная история сохранены.

Готовый пакет для одного VPS (Compose, HTTPS, роли, обновления, внешние копии):
[пошаговая инструкция владельцу](docs/STAGING.md). На VPS используются только готовые образы из GitHub Actions.

## Сервер V1.6A локально

Нужны Node из `.nvmrc` и PostgreSQL 17. Версии Fastify, Drizzle и Better Auth
зафиксированы в lockfile. Проверены официальные [Fastify LTS](https://github.com/fastify/fastify/blob/main/docs/Reference/LTS.md),
[Better Auth / Fastify](https://www.better-auth.com/docs/integrations/fastify)
и [Drizzle adapter](https://www.better-auth.com/docs/adapters/drizzle).
Docker-пакет, staging, backup/restore и CI описаны в [docs/STAGING.md](docs/STAGING.md). Настройка режимов, авторизации, восстановления черновиков и ограничения серверного интерфейса V2.0A описаны там же.

1. Создать пустую БД `timeline`, отдельную учётку оператора миграций (владелец
   БД/таблиц) и runtime-роль `timeline_app` с LOGIN, без SUPERUSER, CREATEDB,
   CREATEROLE, BYPASSRLS. Пароли задаются интерактивно через `psql` / `\password`,
   не сохраняются в репозитории. Runtime-роль не должна владеть БД/таблицами.
2. `cp .env.example .env`. Указать свои подключения, точный `APP_ORIGIN` без
   завершающего `/` и случайный `BETTER_AUTH_SECRET` (например,
   `openssl rand -base64 48`). Файл `.env` игнорируется git; никаких `VITE_*` секретов.
3. `npm ci`, `npm run db:migrate`, `npm run db:status`.
   Миграции применяются явно оператором, под advisory lock; повтор безопасен.
   Неверные версии/checksum останавливают запуск. Runtime не выполняет DDL.
4. После миграций оператор выполняет в БД `timeline`:

```sql
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE timeline TO timeline_app;
GRANT USAGE ON SCHEMA public, drizzle TO timeline_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO timeline_app;
GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO timeline_app;
-- Для следующих миграций; выполнять от владельца таблиц:
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO timeline_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle GRANT SELECT ON TABLES TO timeline_app;
```

5. `npm run server:start` (или `npm run server:dev` с перезапуском).
   `GET /health/live` и `/health/ready` отвечают HTTP 200, при недоступности БД
   или несовместимых миграциях readiness — 503. SIGINT/SIGTERM закрывают HTTP и пул.
   Неверная конфигурация, миграции и привилегированная runtime-роль запрещают запуск.

`MAILER_MODE=memory` — внедряемый `MemoryMailer.messages` для локальных программных
проверок и тестов: письма не отправляются, токены не выводятся в лог и не доступны
через публичный endpoint. Для ручных email-процессов задать SMTP-адаптер
(`MAILER_MODE=smtp`, SMTP_*); он требует TLS. В HTTPS cookies имеют
Secure/HttpOnly/SameSite=Lax; production требует HTTPS и SMTP.
Сервер не доверяет proxy/IP-заголовкам клиента. Настройка доверенного ingress — V1.6B.

## Вход, владелец и команды

Auth API Better Auth: `POST /api/auth/sign-up/email` (`name,email,password`, минимум
12 символов), ссылка подтверждения из письма, затем `POST /api/auth/sign-in/email`.
Восстановление: `/request-password-reset` и `/reset-password` под `/api/auth`.
Callback/redirect URL ограничены `APP_ORIGIN`. При сбросе пароля старые сессии отзываются.

Регистрация не даёт членства. После подтверждения email оператор указывает
`BOOTSTRAP_OWNER_EMAIL` и выполняет `npm run server:bootstrap`. Команда повторно
безопасна для того же владельца и откажет другому; публичного bootstrap API нет.
Убрать email и операторский URL из runtime-окружения после настройки.

Запросы изменения требуют `Origin: <APP_ORIGIN>`, JSON и сессионную cookie.
`actorId` определяет сервер. HTTP-body ограничен 256 KiB, строки — 20 000 символов;
auth, приглашения и гостевой обмен ограничены по частоте. Логи запросов/SQL
отключены; ошибки возвращают безопасный код, без параметров и секретов.

Рабочие маршруты под `/api/v1`:

| Метод / путь | Назначение |
|---|---|
| GET `/workspaces/current` | MEDIUM, роль, ревизии и лимиты |
| GET `/projects?limit=40&offset=0` | Лёгкие summary, workspaceRevision, nextOffset |
| POST `/projects` | Шаблон: commandId, version=1, workspaceId, expectedRevision пространства, name, description, startDate |
| GET `/projects/:id` | Выбранный V2-проект из нормализованных таблиц |
| POST `/projects/:id/commands` | Существующий CommandEnvelope и domain planner |
| GET `/people`, POST `/people/commands` | Каталог и PeopleEnvelope с его expectedRevision |
| POST `/workspace/commands` | ArchiveProject (archived true/false), ReorderProjects (order), DuplicateProject (id, expectedProjectRevision); envelope как у создания, плюс command |
| PUT `/projects/:id/view` | Устаревший совместимый endpoint: проверяет workspaceId/value и возвращает `{value}` с Deprecation; SQL не изменяет. V2.0C хранит вид локально в сессии вкладки |
| GET `/team` | Только участникам MEDIUM: роли, действующие участники, статусы/сроки приглашений, лимиты; без токенов |
| POST `/invitations`, POST `/invitations/accept` | email / token; подтверждённый email, одно использование, 7 дней, лимит owner+3 admins |
| DELETE `/invitations/:id`, DELETE `/members/:id` | Отзыв; участника отзывает owner, owner удалить нельзя |
| GET/POST `/projects/:id/guest-links`, DELETE `/guest-links/:id` | Метаданные без токенов / выдача / отзыв. UI «Поделиться просмотром»; raw token только при выпуске |
| POST `/guest/exchange`, GET `/guest/project` | Обмен token на часовую ограниченную cookie; только чтение, лимит 6 сессий |

Пример содержательной команды (UUID/ревизии берутся из ответов API):

```json
{
  "commandId": "11111111-1111-4111-8111-111111111111",
  "version": 1,
  "workspaceId": "00000000-0000-4000-8000-000000000001",
  "projectId": "22222222-2222-4222-8222-222222222222",
  "expectedRevision": 0,
  "command": { "type": "ShiftProject", "days": 2 }
}
```

Ответ — commandId, projectId, revision, workspaceRevision, peopleRevision, changed;
после commit читать актуальную проекцию через GET. Повторять потерянный ответ с тем
же commandId и payload; другой payload с тем же ID отклоняется. Ошибки:
401 session, 403 access/Origin, 404 scope, 400 validation, 409 revision/ID/limit,
422 domain/constraint, 429 rate limit, 503 unavailable. Конфликт требует нового
чтения и осознанного повторения намерения. Snapshot-upload и серверного Undo
загрузкой старого документа нет. Сервер не переключается на локальные записи.

Invite и guest-link — разные случайные токены, в БД только hashes. Секреты ссылок
передаются во fragment; будущий UI должен обменять их и удалить fragment из адреса.
Гостевая проекция не содержит каталог, назначения, контакты, заметки, private
описания и auth. Отзыв ссылки/создателя, архив проекта проверяются при каждом запросе.

## Проверки

```sh
npm run lint
npm run build
# Отдельная PostgreSQL, имя БД обязательно заканчивается на _test:
TEST_DATABASE_URL='postgresql://TEST_OPERATOR:TEST_PASSWORD@127.0.0.1:5432/timeline_server_test' npm run server:test
```

Тестовый оператор должен иметь права миграций и создания временной LOGIN-роли
(локально/CI допустим superuser). Suite очищает **только указанную выделенную
тестовую БД**, создаёт ограниченную runtime-роль и удаляет её после проверки.
Не указывать пользовательскую/рабочую БД. Реальные интеграции покрывают HTTP,
миграции/checksum, вход/email/reset, scope/revocation, idempotency, конкурентные
конфликты/лимиты, SQL rollback, рестарт и гостевые ограничения. SMTP не нужен.
CI содержит PostgreSQL 17 service; прежние frontend-проверки сохранены.
