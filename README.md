# ESKA: 1C Explorer

Расширение для работы с конфигурациями, расширениями, обработками и отчётами 1С в VS Code и VSCodium. Откройте выгрузку Designer XML в виде дерева метаданных. Из карточки объекта можно перейти к модулю, из формы открыть обработчик события, а из строки BSL вынести запрос в отдельную вкладку.

Проект в активной разработке. [Установить из Open VSX](https://open-vsx.org/extension/1c-tooling/eska-explorer) · [Скачать VSIX](https://github.com/odineska/eska-vscode-explorer/releases) · [Пошаговое руководство](https://odineska.tech/eska/docs/explorer/)

## Пять действий в редакторе

Каждый ролик снят на двух копиях «Демонстрационного приложения» 2.0.0.21 для платформы 8.5.4.2072. Сначала показан интерфейс «Такси», затем «Воздушный». Нажмите на изображение, чтобы открыть видео с паузой и перемоткой.

### Посмотреть тип стандартного реквизита

В справочнике «Товары» раскройте стандартные реквизиты. В свойствах реквизита «Код» видны тип «Строка» и длина 9.

[![Посмотреть тип стандартного реквизита. Скринкаст без звука](https://raw.githubusercontent.com/odineska/odineska.github.io/main/assets/demos/2026-11-26/explorer-standard-attributes.gif)](https://odineska.tech/eska/docs/#demo-standard-attributes)

### Перейти от свойства к его записи в XML

В карточке справочника «Товары» перейдите от свойства «Имя» к его определению в XML.

[![Перейти от свойства к его записи в XML. Скринкаст без звука](https://raw.githubusercontent.com/odineska/odineska.github.io/main/assets/demos/2026-11-26/explorer-properties.gif)](https://odineska.tech/eska/docs/#demo-properties)

### Изменить заголовок поля на форме заказа

Измените заголовок «Покупатель» на «Клиент» в редакторе формы. Посмотрите, как меняется предпросмотр, затем отмените правку.

[![Изменить заголовок поля на форме заказа. Скринкаст без звука](https://raw.githubusercontent.com/odineska/odineska.github.io/main/assets/demos/2026-11-26/explorer-form-edit.gif)](https://odineska.tech/eska/docs/#demo-form-edit)

### Отредактировать запрос внутри модуля BSL

Откройте запрос из общего модуля «Пользователи», добавьте сортировку по наименованию и сохраните её в исходном BSL.

[![Отредактировать запрос внутри модуля BSL. Скринкаст без звука](https://raw.githubusercontent.com/odineska/odineska.github.io/main/assets/demos/2026-11-26/explorer-query.gif)](https://odineska.tech/eska/docs/#demo-query)

### Различить два изменённых файла ObjectModule.bsl

В панели Git откройте изменения модулей справочников «Контрагенты» и «Товары».

[![Различить два изменённых файла ObjectModule.bsl. Скринкаст без звука](https://raw.githubusercontent.com/odineska/odineska.github.io/main/assets/demos/2026-11-26/explorer-scm.gif)](https://odineska.tech/eska/docs/#demo-scm)

## Первый проект

1. Установите расширение в VS Code или VSCodium версии 1.109.0 или новее. Если скачали VSIX, выберите **Extensions → Install from VSIX…**.
2. Выполните **Подготовить project, форматтер и языковой компонент** в палитре команд. Для просмотра дерева достаточно `eska-project`.
3. Откройте папку с `eska.toml` в доверенной рабочей области. Для готовой выгрузки без манифеста вызовите **Начать проект 1С** и выберите подключение исходников Designer XML.

[Дерево и свойства](https://odineska.tech/eska/docs/explorer/#tree) · [Запросы](https://odineska.tech/eska/docs/explorer/#queries) · [Запуск и отладка](https://odineska.tech/eska/docs/explorer/#runtime) · [Соответствующие команды CLI](https://odineska.tech/eska/docs/cli/)

Спасибо команде [bsl-analyzer](https://github.com/itrous/bsl-analyzer) за открытый анализатор BSL. Его языковой сервер даёт Explorer переходы к определениям, подсказки и диагностику. Тот же анализатор проверяет код при запуске `eska check`. [Выпуски bsl-analyzer](https://github.com/itrous/bsl-analyzer/releases)

В предпросмотре форм используются два значка БСП из 1C:Jet, © 2024 ООО «1С-Софт», CC BY 4.0. [Источники и лицензии](https://github.com/odineska/eska-vscode-explorer/blob/main/resources/forms/jet/NOTICE.md)

[English setup](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/setup.md) · [Код ESKA](https://github.com/odineska/eska) · [Разработка расширения](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/development.md) · [Apache-2.0](https://github.com/odineska/eska-vscode-explorer/blob/main/LICENSE)
