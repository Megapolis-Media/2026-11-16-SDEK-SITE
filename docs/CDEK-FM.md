# CDEK FM

Сайт «На высоких скоростях!» включает 3D-прокрутку, радио, эфир, архив и чат. Приложение находится в `app/`, готовые ассеты в `public/visual/`, миграции в `drizzle/`.

## Локальный запуск

Понадобится Node.js 22.13 или новее.

```sh
npm run install:ci
npm run build
```

Для новой локальной D1 выполните команду ниже для каждого SQL-файла из `drizzle/` в порядке номеров, подставляя его имя в `--file`. Если база уже создана, примените только новые миграции.

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_nifty_strong_guy.sql
```

`npm run dev` запускает разработку с обновлением при изменении файлов. `npm start` запускает собранный Worker на локальном адресе.

Локальные значения из `.env.example` задаются в игнорируемом файле `.dev.vars`. Панель редакции находится по адресу `/admin`. Для доступа к ней используйте локальные переменные окружения Worker `CDEK_EDITOR_EMAILS` или `CDEK_ADMIN_PASSWORD_HASH`.

Раздел [технической поддержки](SUPPORT.md) описывает ленту заявок, почтовую доставку и API для helpdesk.

## Проверки

```sh
npm exec -- tsc --noEmit
npm run lint
npm run build
```

Правила веток и pull request описаны в [CONTRIBUTING.md](../CONTRIBUTING.md) и [AGENTS.md](../AGENTS.md).

Production-сборка для выделенного сервера и автодеплой из `master`: [DEPLOYMENT.md](DEPLOYMENT.md).
