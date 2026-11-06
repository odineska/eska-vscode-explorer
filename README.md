# ESKA: 1C Explorer

Дерево метаданных Designer XML, свойства, запросы и BSL в VS Code / VSCodium.
Исходники остаются обычными XML, BSL и ресурсами проекта. Расширение использует
`eska-project`; платформа 1С для просмотра дерева не нужна.

[Полное руководство на сайте](https://odineska.github.io/eska/docs/) ·
[Практический пример с БСП](https://odineska.github.io/eska/docs/#practice) ·
[Справочник документации](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/README.md)

Просмотр управляемых форм 1С 8.3.27 на SolidJS доступен как **beta**:
дерево, свойства, живое обновление XML и отдельное окно изображения.
[Возможности и ограничения beta](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/form-preview.md). Визуальная приёмка
продолжается; выполнение BSL и графическое редактирование не входят в просмотр.

## Возможности

- Ленивое дерево конфигураций, расширений, обработок и отчётов; поиск, переход
  от файла, сортировка, фильтры, файловые группы и Git-декорации.
- Типизированные свойства Designer XML, выбор типов и ссылок, изображения,
  проверенное переименование объектов и связанных исходников.
- Правила поддержки 1С и защищённый просмотр исходников.
- Отдельные SDBL-вкладки для запросов XML и BSL, восстановление черновиков,
  конструктор по образцу 1С с темой VS Code, пакетами, соединениями, итогами и UNION.
- Просмотр управляемых форм на SolidJS: дерево, свойства, реквизиты и команды,
  живое обновление XML и отдельное окно предпросмотра. Визуальная приёмка
  полного профиля 8.3.27 ещё выполняется. [Возможности и ограничения](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/form-preview.md).
- BSL Analyzer: completion, hover, переходы, диагностика, подсказки параметров,
  безопасные правки; точное выравнивание многострочных аргументов.
- Форматирование BSL и запросов через `eska-fmt`, со стилем из `eska.toml`.
- Приложения workspace, внешняя база БСП из `~/.eska/lib`, отключение подпроектов
  с освобождением их индексов и единым выбранным языковым контекстом.
- Подготовка, проверка, обновление и восстановление управляемых компонентов.

## Быстрый старт

1. Установите VSIX **ESKA: 1C Explorer** в VS Code / VSCodium 1.109.0 или новее.
   Идентификатор — `1c-tooling.eska-explorer`; репозитории проекта — в `odineska`.
2. Установите `eska-project`. Общий CLI, Git и 1С для дерева необязательны.
   Для BSL нужен совместимый `bsl-analyzer-app`, для форматирования — `eska-fmt`.
3. Для существующей выгрузки без manifest выполните:

   ```sh
   eska-project init ./my-project --source src
   ```

4. Откройте папку с `eska.toml` в доверенном workspace и раскройте
   **ESKA: 1C Explorer**. При необходимости задайте абсолютные пути:

   ```json
   {
     "eska.explorer.executable": "/path/to/eska-project",
     "eska.explorer.analyzerExecutable": "/path/to/bsl-analyzer-app",
     "eska.explorer.formatterExecutable": "/path/to/eska-fmt"
   }
   ```

Пути относятся к машине проекта, включая Remote. Стандартные имена ищутся
в управляемой установке и PATH. Команда **Подготовить project, форматтер и
языковой компонент** помогает установить отсутствующие инструменты.
[Пошаговая настройка](docs/setup.ru.md) · [English setup](docs/setup.md).

Описание относится к текущим исходникам. Возможности согласуются по Metadata API:
минимум для дерева — 1.12; текущий API — 1.41. Совместимость старого backend
не означает доступность всех новых функций. [Контракты](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/cli-management.md).

Библиотеки, группы подпроектов, подсказки и активность прошли
[повторную native-приёмку Windows в ru/en](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/windows-review-2026-10-31.md)
на VS Code 1.144 и bsl-analyzer 0.4.2. macOS и VSCodium для активности
workspace требуют отдельной native-приёмки.

## Документация

[Дерево и активность](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/usage.md) · [Запросы и конструктор](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/query-editing.md) ·
[BSL и выравнивание подсказок](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/language-service.md) ·
[Компоненты и обновление](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/component-setup.md) · [Поддержка](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/support-policy.md).

Все настройки и команды перечислены в
[полном руководстве](https://odineska.github.io/eska/docs/#settings).
Редактирование форм, СКД, отладка и запуск приложения не заменяются Explorer;
изменения свойств ограничены поддержанными существующими узлами Designer XML.

[Разработка и проверки](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/development.md) · [Упаковка VSIX](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/packaging.md) ·
[Публикация](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/publishing.md) · [Релизы](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/releases.md) ·
[Apache License 2.0](https://github.com/odineska/eska-vscode-explorer/blob/main/LICENSE).

## Эталоны форм в тестах

Локальные тесты используют соседний checkout `../eska`. Другой каталог эталонов
задаётся абсолютным путём `ESKA_TEST_REFERENCE_ROOT`. Штатная подготовка CI
загружает исходники из точного тега установленного выпуска `eska-project`
в собственный каталог playground и передаёт этот путь последующим проверкам.
Существующий checkout разработчика не изменяется. Отсутствующие или не совпавшие
с тегом эталоны останавливают проверку; тесты визуального совпадения не пропускаются.
