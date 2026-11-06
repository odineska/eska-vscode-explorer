# Подключение проекта к ESKA Explorer

## Установить компоненты

Установите VSIX через **Extensions → Install from VSIX…**. Идентификатор —
`1c-tooling.eska-explorer`, минимальная версия VS Code API — **1.109.0**.
Репозитории и опубликованные файлы проекта находятся в организации `odineska`.
[Упаковка](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/packaging.md) · [Установка ESKA](https://odineska.github.io/eska/).

По умолчанию запускается `eska-project serve --stdio`. Для дерева нужны только
Explorer и `eska-project`; Git, полная ESKA, платформа и Analyzer необязательны.
Для языкового сервиса установите совместимый `bsl-analyzer-app`, для форматирования —
`eska-fmt`. Команда **Подготовить project, форматтер и языковой компонент**
проверяет их по очереди и предлагает установить отсутствующие инструменты.
Состав доступных архивов проверяется в выбранном релизе, архитектура не подменяется.
[Установка и обновление](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/component-setup.md).

Для сборки из checkout ESKA используйте `cargo build -p eska-project` и задайте
абсолютный путь к полученному executable. Доступны три независимых настройки:

```json
{
  "eska.explorer.executable": "/path/to/eska-project",
  "eska.explorer.analyzerExecutable": "/path/to/bsl-analyzer-app",
  "eska.explorer.formatterExecutable": "/path/to/eska-fmt"
}
```

Это шаблон путей машины проекта. При стандартных именах поиск начинается
в `~/.eska/bin` для ESKA, в частном namespace для Analyzer, затем идёт по
абсолютным каталогам PATH. Явный путь не имеет fallback.
В Remote SSH, WSL и Dev Containers компоненты нужны на workspace host.
Виртуальные workspace, browser-only host и недоверенные папки не поддерживаются.

## Подготовить проект

Если у существующей выгрузки Designer XML нет `eska.toml`:

```sh
eska-project init ./my-project --source src
eska-project --project-dir ./my-project validate --format json
```

Каталог `src` должен содержать реальные XML. Если исходники уже в корне, укажите
`--source .`. Поддерживаются `configuration`, `extension`, `processing`, `report`;
обычно тип выводится из корневого XML. `init` не создаёт формы и XML из пустоты,
не инициализирует Git и не запускает платформу. Не запускайте его поверх
существующего manifest. Для EPF/ERF с БСП после подключения можно выполнить
`eska add ssl_3_1`: библиотека хранится в пользовательской `~/.eska/lib`.
[Проекты и workspace](https://odineska.github.io/eska/docs/#workspace).

Откройте папку с manifest и раскройте **ESKA: 1C Explorer**. При нескольких
независимых папках выберите одну командой **Выбрать проект и подключиться**.
После изменения пути к backend используйте **Перезапустить подключение**.
Изменение manifest отслеживается автоматически; расширение не выполняет init
или сборку без команды пользователя.

## Включить язык и форматирование

BSL/SDBL-подсветка доступна без Analyzer. При открытии BSL запускается
собственный языковой клиент. `eska.explorer.languageFeatures = false` отключает
его, сохраняя дерево. При конфликте с другим BSL-расширением сначала выберите,
какой клиент использовать. [Язык, config и lease](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/language-service.md).

Стиль задаётся в `[format]` файла `eska.toml`; отступы редактора его не заменяют.
Используйте стандартные Format Document / Format Selection с ESKA как formatter.
`eska.explorer.formatOnSave` по умолчанию выключен. Отсутствующий `eska-fmt`
не подменяется форматированием через Analyzer.
[Все параметры](https://odineska.github.io/eska/docs/formatting/).

С API 1.34 многострочные строковые аргументы получают точное выравнивание:
связанные подписи и отступы используют шрифт редактора. Независимые однострочные
подсказки сохраняют обычный вид. Нужен `editor.inlayHints.enabled = "on"`;
conditional modes, explicit accessibility и actionable hints сохраняют native-вид.
[Границы выравнивания](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/language-service.md#многострочные-аргументы-и-подсказки-параметров).

## Проверить совместимость и активность

Текущий Metadata API — **1.35**, минимальный контракт дерева — **1.12**.
Запросы/сессии, BSL-литералы, расширенный конструктор, форматирование,
выравнивание и активность требуют соответствующих capabilities.
Наличие старого дерева не гарантирует новые операции.
[Матрица](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/cli-management.md#версии-пользовательских-возможностей).

В workspace можно отключать подпроекты. Индексы и watchers освобождаются,
но общий выбранный LSP остаётся, пока есть активный потребитель. Отключённая зависимость
сохраняется в семантическом контексте, пока нужна активному потребителю. Фильтр «показывать/скрывать
отключённые» меняет только дерево. [Подробности](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/usage.md#активность-подпроектов).

## Без сети и диагностика

Установленные компоненты работают без сети. Выключите `checkForUpdates`,
`checkForAnalyzerUpdates`, `checkForFormatterUpdates`, чтобы убрать фоновые
запросы. Явные пути нужны, если программы не доступны стандартным поиском.

Индикатор ESKA показывает состояния и версии; нажатие обновляет все управляемые
компоненты. Для отдельного действия используйте **Управление компонентами**.
При ошибке откройте журнал подключения и Output языкового сервиса.
Legacy `eska ide` выбирается только явно через `backend = "legacy"` и путь `eska`.
[Обновление, receipt и recovery](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/component-setup.md) · [Выбор backend](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/cli-management.md).
