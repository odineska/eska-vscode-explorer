# ESKA: 1C Explorer

Расширение для Designer XML в VS Code и VSCodium. **Проект в активной разработке.** Для дерева и редактирования исходников нужен `eska-project`. Платформа 1С требуется для запуска клиента, обновления базы и отладки.

[Руководство на сайте](https://odineska.github.io/eska/docs/) · [Настройки и команды](https://odineska.github.io/eska/docs/#settings) · [Быстрый старт](#быстрый-старт)

## Метаданные и управляемые формы

В дереве доступны поиск, переход от файла к объекту, свойства, предопределённые элементы и стандартные реквизиты. **Добавить…** предлагает допустимые объекты, формы и отсутствующие модули для выбранного владельца. Копирование назначает новые UUID. Перед удалением можно проверить затронутые файлы и ссылки. [Действия в дереве](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/usage.md#создание-копирование-и-удаление-объектов)

Редактор управляемых форм позволяет менять свойства, типы и условное оформление, добавлять и перетаскивать элементы, открывать или создавать обработчики BSL. Правки автоматически сохраняются в исходники. Отмена и повтор действуют в основном и откреплённом окнах. Предпросмотр интерфейса «Такси» 8.3.27 имеет статус beta. [Работа с формой](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/form-preview.md)

Для стандартной картинки «Провести» и команды «Пометить на удаление» в меню
таблицы предпросмотр использует значки из 1C:Jet. Источник — Библиотека стандартных подсистем, © 2024 ООО «1С-Софт»,
лицензия CC BY 4.0. [Исходные файлы и лицензии](resources/forms/jet/NOTICE.md)

## Запуск и отладка 1С

Через **Настройки проекта → Настроить проект** заполните профиль `test` или `prod`. В панели **Запуск и отладка** доступны запуск клиента и подключение к HTTP-серверу отладки 1С. Для тестовой базы можно предварительно просмотреть и подтвердить обновление проекта или приложения, установить или удалить расширение. Адаптер поддерживает условные точки, логпоинты, стек, переменные, Watch, Debug Console и **Set Value**. [Настройка запуска](https://github.com/odineska/eska/blob/main/docs/run-debug.md)

## Git и изменения объектов

В панели **Система управления версиями → ESKA: изменения 1С** файлы модулей и XML подписаны именами объектов. Можно открыть diff или версию из HEAD, индексировать отдельные файлы и группы, снять их с индекса и создать коммит. Для работы панели требуется встроенное расширение Git. [Команды панели](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/usage.md#изменения-в-обозначениях-1с)

## Запросы, BSL и рабочая область

- Отдельные SDBL-вкладки для запросов XML и BSL с сохранением в исходник через **Ctrl+S**, визуальный конструктор с таблицами, соединениями, условиями, группировками, UNION, пакетами и итогами. [Работа с запросами](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/query-editing.md)
- Автодополнение, диагностика, переходы, ссылки, подсказки параметров, переименование и текстовые правки через BSL Analyzer. Форматирование BSL и SDBL выполняет `eska-fmt` по настройкам `eska.toml`. [Языковой сервис](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/language-service.md) · [Форматирование](https://odineska.github.io/eska/docs/formatting/)
- Выбор приложения для анализа, подключение БСП и отключение подпроектов. Источники под поддержкой открываются с учётом прав на изменение. [Рабочая область](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/usage.md) · [Правила поддержки](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/support-policy.md)

## Explorer в работе

Скринкасты записаны в VS Code с Explorer 0.1.23 и ESKA 0.32.0. Нажмите на изображение, чтобы открыть видео с элементами управления.

<details>
<summary>Настроить проводник</summary>

[![Настроить проводник — скринкаст без звука](https://raw.githubusercontent.com/odineska/odineska.github.io/main/assets/demos/2026-11-18/explorer-setup.gif)](https://odineska.github.io/eska/docs/#demo-setup)

</details>

<details>
<summary>Найти объект и открыть модуль</summary>

[![Найти объект и открыть модуль — скринкаст без звука](https://raw.githubusercontent.com/odineska/odineska.github.io/main/assets/demos/2026-11-18/explorer-tree.gif)](https://odineska.github.io/eska/docs/#demo-tree)

</details>

<details>
<summary>Перейти из свойств к XML</summary>

[![Перейти из свойств к XML — скринкаст без звука](https://raw.githubusercontent.com/odineska/odineska.github.io/main/assets/demos/2026-11-18/explorer-properties.gif)](https://odineska.github.io/eska/docs/#demo-properties)

</details>

<details>
<summary>Открыть управляемую форму</summary>

[![Открыть управляемую форму — скринкаст без звука](https://raw.githubusercontent.com/odineska/odineska.github.io/main/assets/demos/2026-11-18/explorer-forms.gif)](https://odineska.github.io/eska/docs/#demo-forms)

</details>

<details>
<summary>Изменить заголовок поля формы</summary>

[![Изменить заголовок поля формы — скринкаст без звука](https://raw.githubusercontent.com/odineska/odineska.github.io/main/assets/demos/2026-11-18/explorer-form-edit.gif)](https://odineska.github.io/eska/docs/#demo-form-edit)

</details>

<details>
<summary>Сравнить изменения модулей по именам объектов</summary>

[![Сравнить изменения модулей по именам объектов — скринкаст без звука](https://raw.githubusercontent.com/odineska/odineska.github.io/main/assets/demos/2026-11-18/explorer-scm.gif)](https://odineska.github.io/eska/docs/#demo-scm)

</details>

<details>
<summary>Изменить запрос и сохранить через Ctrl+S</summary>

[![Изменить запрос и сохранить через Ctrl+S — скринкаст без звука](https://raw.githubusercontent.com/odineska/odineska.github.io/main/assets/demos/2026-11-18-query/explorer-query.gif)](https://odineska.github.io/eska/docs/#demo-query)

</details>

## Быстрый старт

1. Установите VSIX **ESKA: 1C Explorer** в VS Code / VSCodium 1.109.0 или новее.
   Идентификатор — `1c-tooling.eska-explorer`; репозитории проекта — в `odineska`.
2. Установите `eska-project`. Общий CLI, Git и 1С для дерева необязательны.
   Для BSL нужен совместимый `bsl-analyzer-app`, для форматирования — `eska-fmt`,
   для отладки — `eska-debug`. Команда **Обновить все компоненты ESKA и BSL Analyzer** устанавливает
   отладчик и при обновлении старой установки. Нативные компоненты скачиваются
   отдельно и не увеличивают размер VSIX. Перед обновлением завершите сессии отладки ESKA.
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

Возможности зависят от версии `eska-project`. Для дерева требуется Metadata API 1.12, для редактирования формы — 1.53, для создания обработчиков, стандартных реквизитов и обозначений Git — 1.54. [Совместимость компонентов](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/cli-management.md)

## Документация

[Дерево и активность](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/usage.md) · [Запросы и конструктор](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/query-editing.md) ·
[BSL и выравнивание подсказок](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/language-service.md) ·
[Компоненты и обновление](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/component-setup.md) · [Поддержка](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/support-policy.md).

[Все настройки и команды](https://odineska.github.io/eska/docs/#settings) · [Видео и руководство](https://odineska.github.io/eska/docs/#explorer).

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
