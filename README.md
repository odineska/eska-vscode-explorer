# ESKA: 1C Explorer

Расширение для работы с конфигурациями, расширениями, обработками и отчётами 1С в VS Code и VSCodium. Откройте выгрузку Designer XML в виде дерева метаданных. Из карточки объекта можно перейти к модулю, из формы открыть обработчик события, а из строки BSL вынести запрос в отдельную вкладку.

Проект в активной разработке. [Установить из Open VSX](https://open-vsx.org/extension/1c-tooling/eska-explorer) · [Скачать VSIX](https://github.com/odineska/eska-vscode-explorer/releases) · [Пошаговое руководство](https://odineska.tech/eska/docs/explorer/)

## Пять действий в редакторе

Нажмите на изображение для просмотра с паузой и перемоткой. В первом ролике показаны Explorer 0.1.32 и ESKA 0.38.0, в остальных четырёх — Explorer 0.1.23 и ESKA 0.32.0.

### Посмотреть тип стандартного реквизита

В справочнике «Товары» раскройте стандартные реквизиты. В свойствах «Пометки удаления» виден тип «Булево» и доступность поля для редактирования.

[![Посмотреть тип стандартного реквизита. Скринкаст без звука](https://raw.githubusercontent.com/odineska/odineska.github.io/main/assets/demos/2026-11-21/explorer-standard-attributes.gif)](https://odineska.tech/eska/docs/#demo-standard-attributes)

### Перейти от свойства к его записи в XML

Выберите свойство «Имя» в карточке документа и откройте его определение в выгрузке.

[![Перейти от свойства к его записи в XML. Скринкаст без звука](https://raw.githubusercontent.com/odineska/odineska.github.io/main/assets/demos/2026-11-21/explorer-properties.gif)](https://odineska.tech/eska/docs/#demo-properties)

### Переименовать поле на форме и увидеть результат

Измените заголовок «Покупатель» на «Клиент» в редакторе формы. В ролике видно, как меняется предпросмотр при правке, отмене и повторе.

[![Переименовать поле на форме и увидеть результат. Скринкаст без звука](https://raw.githubusercontent.com/odineska/odineska.github.io/main/assets/demos/2026-11-21/explorer-form-edit.gif)](https://odineska.tech/eska/docs/#demo-form-edit)

### Отредактировать запрос внутри модуля BSL

Откройте текст запроса в отдельной вкладке, измените сортировку и нажмите Ctrl+S. Изменение появится в строковом литерале модуля.

[![Отредактировать запрос внутри модуля BSL. Скринкаст без звука](https://raw.githubusercontent.com/odineska/odineska.github.io/main/assets/demos/2026-11-21/explorer-query.gif)](https://odineska.tech/eska/docs/#demo-query)

### Различить два изменённых файла ObjectModule.bsl

Панель Git показывает имена объектов 1С. Выберите объект и откройте изменения именно его модуля.

[![Различить два изменённых файла ObjectModule.bsl. Скринкаст без звука](https://raw.githubusercontent.com/odineska/odineska.github.io/main/assets/demos/2026-11-21/explorer-scm.gif)](https://odineska.tech/eska/docs/#demo-scm)

## Первый проект

1. Установите расширение в VS Code или VSCodium версии 1.109.0 или новее. Если скачали VSIX, выберите **Extensions → Install from VSIX…**.
2. Выполните **Подготовить project, форматтер и языковой компонент** в палитре команд. Для просмотра дерева достаточно `eska-project`.
3. Откройте папку с `eska.toml` в доверенной рабочей области. Для готовой выгрузки без манифеста вызовите **Начать проект 1С** и выберите подключение исходников Designer XML.

[Дерево и свойства](https://odineska.tech/eska/docs/explorer/#tree) · [Запросы](https://odineska.tech/eska/docs/explorer/#queries) · [Запуск и отладка](https://odineska.tech/eska/docs/explorer/#runtime) · [Соответствующие команды CLI](https://odineska.tech/eska/docs/cli/)

Спасибо команде [bsl-analyzer](https://github.com/itrous/bsl-analyzer) за открытый анализатор BSL. Его языковой сервер даёт Explorer переходы к определениям, подсказки и диагностику. Тот же анализатор проверяет код при запуске `eska check`. [Выпуски bsl-analyzer](https://github.com/itrous/bsl-analyzer/releases)

В предпросмотре форм используются два значка БСП из 1C:Jet, © 2024 ООО «1С-Софт», CC BY 4.0. [Источники и лицензии](https://github.com/odineska/eska-vscode-explorer/blob/main/resources/forms/jet/NOTICE.md)

[English setup](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/setup.md) · [Код ESKA](https://github.com/odineska/eska) · [Разработка расширения](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/development.md) · [Apache-2.0](https://github.com/odineska/eska-vscode-explorer/blob/main/LICENSE)
