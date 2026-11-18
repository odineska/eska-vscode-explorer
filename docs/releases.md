# Версии и GitHub Release

Автоматизация добавлена по запросу пользователя отдельно от T76. Она работает
в `main`; локальная разработка на `feat/explorer` ничего не публикует автоматически.

## Процесс

1. Обычный PR проходит полный CI. После коммита в `main` Knope читает
   Conventional Commits после последнего тега и готовит изменения
   `package.json` и `CHANGELOG.md`. При отсутствии изменений PR не создаётся.
2. Для release PR от GitHub Actions CI проверяет источник и точный diff
   скриптом из доверенной базы `main`.
   Быстрая проверка доступна, когда дерево отличается от базы только
   повышением `package.json` version и новой секцией changelog. Если доказать
   эти условия не удалось, CI выполняет полный прогон.
3. После слияния release PR workflow `Release` проверяет дерево выпуска.
   Для метаданных версии использует результат полного CI, если успешный запуск
   соответствующего PR в этом репозитории проверил то же дерево приложения с
   теми же архивами ESKA и bsl-analyzer, Python bootstrap, эталонами форм и
   версиями Bun и Node. При отсутствии подтверждения, несовпадении входов или
   истечении срока хранения результата выполняется полный прогон.
   Workflow всегда собирает финальный VSIX, проверяет его состав и запускает
   установленное расширение с реальными Metadata API и LSP. Затем создаёт тег,
   GitHub Release и прикрепляет прошедший проверку VSIX. Начальная версия
   `0.0.0` считается неопубликованным каркасом.

Проверка состава, тест установленного расширения и загрузка используют один VSIX
на одном runner. Перед созданием тега workflow сверяет его SHA-256, а перед
загрузкой сверяет дерево тега с проверенным деревом.
[Локальная упаковка VSIX](packaging.md); publisher — `1c-tooling`.
После успешного задания `release` автоматически вызывается
[Publish Open VSX](publishing.md) с тем же VSIX. Ручной запуск сохранён для
восстановления после сбоя. Совпадающая по SHA-256 опубликованная версия
пропускается; несовпадающая вызывает ошибку. npm не используется.

В CI и Release отдельный шаг с токеном GitHub Actions получает описания
публичных версий ESKA и bsl-analyzer. Установщик использует эти описания и
сверяет скачанные файлы по размеру и SHA-256. В журнал попадают версии и
SHA-256 проверенных пакетов. Пока идут клиентские тесты,
на том же runner устанавливается проверочный VS Code. После успеха обоих
шагов команда `package:compiled` упаковывает уже собранный код для проверки
в установленном редакторе.

До создания тега CI и Release проверяют полный состав и байты собранного VSIX,
включая runtime-модули `resources/query/*.mjs`; ошибка показывает лишние
и отсутствующие файлы. Затем устанавливают проверяемый VSIX в отдельный
профиль VS Code 1.143.0 и выполняют `language-host.cjs` с реальным Metadata API
и upstream LSP. Дистрибутив редактора закреплён URL и SHA-256. Проверяются BSL,
hover, definition, completion, diagnostics и завершение принадлежащих профилю
процессов. Legacy-тест требует отдельного `ESKA_LEGACY_TEST_BINARY`; его пропуск
не подменяет обязательные проверки текущего project-компонента и анализатора.

Release PR использует новую ветку `release/eska-explorer-<version>-<base>-<tree>`.
Эта область имён зарезервирована за автоматизацией. Новый PR заменяет предыдущие
открытые release PR; старые закрываются, ветки сохраняются. Повторный запуск для
того же дерева использует существующую ветку. Force push и переписывания истории
нет. Версию вручную при обычной разработке не меняйте.

## Инструменты

- **Knope 0.23.0** — готовый Rust-бинарник для версии, changelog и GitHub Release.
  В отличие от release-plz, умеет работать непосредственно с `package.json`.
- **Bun 1.4.2** — зависимости, запуск компилятора и тестов; зависимости закреплены
  в `bun.lock`, установка выполняется с `--frozen-lockfile --ignore-scripts`.
- **GitHub CLI и Python из runner** — короткая обвязка release PR и его проверок.

Архивы Bun и Knope закреплены версиями и SHA-256 в `scripts/install-tools.sh`.
Rust toolchain не устанавливается, инструменты не компилируются. `setup-node` и
npm в workflow не используются. Стандартный `actions/checkout` использует свой
Node runtime внутри action; он закреплён по commit. Production-код расширения
по-прежнему работает в Node extension host VS Code.

Правила Knope до 1.0: `fix` и `feat` повышают patch, `!`/`BREAKING CHANGE` повышает
minor. После 1.0 действуют обычные patch/minor/major. Сообщения коммитов остаются
на русском с английскими type/scope; их описания входят в changelog.
Разделы changelog и GitHub Release заданы по-русски в `knope.toml`; исходные
сообщения коммитов не переводятся и не переписываются.

## Настройка GitHub

Для GitHub используется штатный `GITHUB_TOKEN`; отдельный GitHub PAT не требуется.
Для Open VSX нужен `OVSX_PAT` на уровне репозитория либо environment `openvsx`.
`Release` явно передаёт repository secret в reusable workflow. Задание публикации
использует environment `openvsx` и настроенные для него правила одобрения. Репозиторий должен
разрешать GitHub Actions создавать pull requests: Settings → Actions → General →
Workflow permissions → **Allow GitHub Actions to create and approve pull requests**.
Workflow задаёт `contents: write`, `pull-requests: write`, `actions: write` только
для релизного задания. Организационная политика может ограничить эти разрешения.

События PR, созданного через `GITHUB_TOKEN`, могут требовать ручного подтверждения
запуска workflow. Поэтому автоматизация явно запускает `CI` через `workflow_dispatch` на commit
release-ветки. Это позволяет использовать штатный токен без скрытой зависимости
от PAT. Branch protection и обязательные проверки автоматически не меняются.

Если запуск пропущен или завершился с ошибкой, следующий push в `main`
или ручной **Release** найдёт коммит, который ввёл текущую версию, по первым
родителям `main`. Если тег уже есть, а VSIX отсутствует, workflow проверит
коммит этого тега и прикрепит проверенный пакет. Затем он подготовит следующий
PR из актуальной `main`. При одновременной загрузке принимается только VSIX
с тем же SHA-256. Если завершённый VSIX уже прикреплён, workflow
переходит к публикации в Open VSX без пересборки. Для отдельного повтора Open VSX
также доступен ручной workflow **Publish Open VSX**. Незавершённый или пустой asset
вызывает ошибку. Если тег существует, но GitHub Release отсутствует или остался
draft, требуется отдельное восстановление. Теги не перемещаются.

## Проверки

`actionlint` проверяет YAML, `bash -n` — установщик; тесты в `test/release_test.py`
проверяют допустимые файлы PR, запрет локальной публикации, согласованность
версии с changelog, отсутствие изменений, реальное повышение версии через Knope
и повторную подготовку release-ветки с локальным bare origin и подменёнными вызовами GitHub.
Также проверяются сборка VSIX из тега вместо HEAD, запрет загрузки после ошибки
сборки/проверки и сохранение уже опубликованного asset.
Тестовые Git-репозитории создаются только в собственных временных каталогах
`ESKA_TEST_ROOT` внутри соседнего `eska-playground`.

`test/tool-installation.test.mjs` запускает сам `prepare-backends.mjs` через Node
с локальным архивом настоящего `eska-project` и бинарником bsl-analyzer. Проверяются
установка, receipts и пути в `GITHUB_ENV` для последующих шагов CI; такой тест
выявляет рассогласование скрипта с экспортами установщика.

```bash
ESKA_TEST_ROOT="$(realpath ../eska-playground)" \
KNOPE_TEST_BINARY="$(command -v knope)" \
python3 -m unittest discover -s test -p '*_test.py'
```

Создание PR и GitHub Release проверяются после push и слияния workflow; локальные
тесты не выполняют публикацию. Первый релиз `v0.0.1` уже создан через GitHub Actions.
Реальный IDE backend проверяется отдельно через `ESKA_TEST_BINARY`;
CI расширения не собирает соседний Rust-репозиторий и не запускает 1С.

Основания: [Knope: packages](https://knope.tech/reference/config-file/packages/),
[Knope: semantic versioning](https://knope.tech/reference/concepts/semantic-versioning/),
[Knope: Release](https://knope.tech/reference/config-file/steps/release/),
[Bun runtime](https://bun.sh/docs/runtime),
[GitHub: triggering a workflow](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow).

При необходимости добавить отсутствующий VSIX к уже опубликованной версии:

```sh
python3 scripts/release-vsix.py 0.0.1
```

Нужны локальный тег, Bun в PATH и авторизованный GitHub CLI с доступом к релизу.
Команда загружает файл в `1c-tooling/eska-vscode-explorer`; она не создаёт релиз,
не перемещает тег и не повышает версию.

Загрузка выполняется через [GitHub CLI release upload](https://cli.github.com/manual/gh_release_upload)
без `--clobber`.
