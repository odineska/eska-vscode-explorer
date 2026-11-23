// Canonical TOML keys from upstream project-model for these releases.
// Diagnostic parameters come from the rules' settings readers.
export const analyzerCatalogVersion = '0.4.7';

const label = (ru, en) => ({ ru, en });
const field = (path, type, ru, en, options) => ({
  path: path.split('.'), label: label(ru, en), type, ...options
});
const group = (id, ru, en, fields) => ({ id, label: label(ru, en), fields });

const required = { required: true };
const natural = { min: 0 };
const managedByEska = { managedBy: 'eska' };
const managedByFormat = { managedBy: 'format' };
const baseline = 'search.baseline';
const embedding = `${baseline}.embedding`;
const postgres = `${baseline}.postgres`;

function baselineTarget(target) {
  const path = `${baseline}.${target}`;
  const policy = `${path}.policy`;
  return [
    field(`${path}.snapshot_id`, 'string', 'Снимок', 'Snapshot ID'),
    field(`${path}.branch`, 'string', 'Ветка', 'Branch'),
    field(`${path}.commit`, 'string', 'Коммит', 'Commit'),
    field(`${policy}.publish_branches`, 'string[]', 'Публикуемые ветки', 'Published branches'),
    field(`${policy}.branches`, 'array', 'Правила выбора веток', 'Branch selection rules', {
      itemFields: [
        field('match', 'string', 'Шаблон', 'Pattern', required),
        field('select_branch', 'string', 'Выбранная ветка', 'Selected branch', required),
        field('fallback_branch', 'string', 'Запасная ветка', 'Fallback branch')
      ]
    }),
    field(`${policy}.support.stale_after_days`, 'integer', 'Дней до устаревания', 'Days until stale', { ...natural, default: 21 }),
    field(`${policy}.support.expire_after_days`, 'integer', 'Дней до истечения', 'Days until expiry', { ...natural, default: 30 }),
    field(`${policy}.retention.develop_retention_days`, 'integer', 'Дней хранения снимков develop', 'Days to retain develop snapshots', { ...natural, default: 30 }),
    field(`${policy}.retention.vendor_keep_heads`, 'integer', 'Последних снимков поставщика', 'Recent vendor snapshots to retain', { ...natural, default: 2 }),
    field(`${policy}.retention.min_snapshots_per_branch`, 'integer', 'Минимум снимков на ветку', 'Minimum snapshots per branch', { ...natural, default: 1 })
  ];
}

export const analyzerGroups = [
  group('source', 'Исходники и платформа', 'Sources and platform', [
    field('source.exclude', 'string[]', 'Исключённые пути', 'Excluded paths', {
      default: [],
      hint: label('Пути относительно каталога конфигурации анализатора.', 'Paths relative to the analyzer configuration directory.')
    }),
    field('source.exclude_globs', 'string[]', 'Шаблоны исключений', 'Exclusion patterns', { default: [] }),
    field('min_platform_version', 'string', 'Минимальная версия платформы', 'Minimum platform version', {
      hint: label('Для диагностики API, добавленного в новых версиях.', 'Checks API introduced in newer versions.')
    }),
    field('target_platform_version', 'string', 'Целевая версия платформы', 'Target platform version', managedByEska),
    field('compatibility_mode', 'string', 'Режим совместимости', 'Compatibility mode', managedByEska),
    field('source.root', 'string', 'Корень исходников', 'Source root', managedByEska),
    field('source.configuration', 'object', 'Основная конфигурация', 'Base configuration', managedByEska),
    field('source.extensions', 'array', 'Расширения', 'Extensions', managedByEska),
    field('source.externals', 'array', 'Внешние объекты', 'External objects', managedByEska)
  ]),
  group('platform_help', 'Справка платформы', 'Platform help', [
    field('platform_help.source', 'enum', 'Источник справки', 'Help source', {
      choices: ['bundled', 'installed', 'external', 'auto', 'none'],
      choiceLabels: {
        bundled: label('Встроенная справка', 'Bundled help'),
        installed: label('Из установленной платформы', 'Installed platform'),
        external: label('Внешняя справка', 'External help'),
        auto: label('Автоматически', 'Automatic'),
        none: label('Отключена', 'Disabled')
      },
      hint: label('Для внешнего источника укажите путь или URL.', 'For an external source, enter a path or URL.')
    }),
    field('platform_help.path', 'string', 'Путь к справке', 'Help path', {
      visibleWhen: { path: ['platform_help', 'source'], values: ['installed', 'external'] }
    }),
    field('platform_help.url', 'string', 'URL внешней справки', 'External help URL', {
      visibleWhen: { path: ['platform_help', 'source'], values: ['external'] }
    })
  ]),
  group('analysis', 'Анализ', 'Analysis', [
    field('analysis.diff_base', 'string', 'Git-ссылка для сравнения', 'Git reference for comparison'),
    field('analysis.ignored_authors', 'string[]', 'Исключённые авторы Git', 'Ignored Git authors', {
      default: [],
      hint: label('Точные имена или адреса почты из Git blame.', 'Exact names or emails from Git blame.')
    }),
    field('diagnostics.ordinaryAppSupport', 'boolean', 'Проверки обычного приложения', 'Ordinary application checks', {
      hint: label('По умолчанию учитывается режим запуска конфигурации.', 'Defaults to the configuration’s application mode.')
    }),
    field('diagnostics.dataflowMaxIterations', 'integer', 'Лимит итераций анализа потока данных', 'Dataflow iteration limit', { ...natural, default: 10000 }),
    field('diagnostics.bsllsSuppressionCompat', 'boolean', 'Распознавать комментарии подавления BSLLS', 'Recognize BSLLS suppression comments', { default: true }),
    field('features.map_key_types', 'boolean', 'Типы значений соответствия по ключам', 'Map value types by key', {
      default: true, since: '0.4.7'
    }),
    field('features.type_narrowing', 'boolean', 'Уточнение типов', 'Type narrowing', { default: true }),
    field('features.workspace_diagnostics', 'enum', 'Диагностика рабочей области', 'Workspace diagnostics', {
      choices: ['off', 'extensions', 'all'],
      choiceLabels: { off: label('Отключена', 'Off'), extensions: label('Расширения', 'Extensions'), all: label('Все исходники', 'All sources') },
      default: 'off'
    }),
    field('features.checked_environments', 'string[]', 'Проверяемые окружения', 'Checked environments', {
      choices: ['Server', 'ThinClient', 'WebClient', 'MobileClient', 'ThickClientManagedApplication',
        'ThickClientOrdinaryApplication', 'ExternalConnection'],
      choiceLabels: {
        Server: label('Сервер', 'Server'),
        ThinClient: label('Тонкий клиент', 'Thin client'),
        WebClient: label('Веб-клиент', 'Web client'),
        MobileClient: label('Мобильный клиент', 'Mobile client'),
        ThickClientManagedApplication: label('Толстый клиент, управляемое приложение', 'Thick client, managed application'),
        ThickClientOrdinaryApplication: label('Толстый клиент, обычное приложение', 'Thick client, ordinary application'),
        ExternalConnection: label('Внешнее соединение', 'External connection')
      }
    })
  ]),
  group('diagnostics_baseline', 'Базовый список диагностик', 'Diagnostics baseline', [
    field('diagnostics.baseline.path', 'string', 'Путь к файлу списка', 'Baseline file path'),
    field('diagnostics.baseline.directory', 'string', 'Каталог списков', 'Baseline directory'),
    field('diagnostics.baseline.include', 'string[]', 'Включённые диагностики', 'Included diagnostics'),
    field('diagnostics.baseline.groups', 'array', 'Группы расширений', 'Extension groups', {
      itemFields: [
        field('name', 'string', 'Имя группы', 'Group name', required),
        field('extensions', 'string[]', 'Расширения', 'Extensions', required)
      ]
    })
  ]),
  group('editor', 'Редактор и вывод', 'Editor and output', [
    field('code_lens.show_cognitive_complexity', 'boolean', 'Подсказки о когнитивной сложности', 'Cognitive complexity code lens', { default: false }),
    field('code_lens.show_cyclomatic_complexity', 'boolean', 'Подсказки о цикломатической сложности', 'Cyclomatic complexity code lens', { default: false }),
    field('output.display_language', 'enum', 'Язык сообщений анализатора', 'Analyzer output language', {
      choices: ['ru', 'en'], choiceLabels: { ru: label('Русский', 'Russian'), en: label('Английский', 'English') }
    }),
    field('formatting.use_tabs', 'boolean', 'Отступы табуляцией', 'Indent with tabs', { ...managedByFormat, default: false }),
    field('formatting.indent_size', 'integer', 'Размер отступа', 'Indent size', { ...managedByFormat, ...natural, default: 4 })
  ]),
  group('search', 'Поисковый индекс', 'Search index', [
    field(`${baseline}.backend`, 'enum', 'Хранилище', 'Storage backend', {
      choices: ['sqlite', 'postgres'], choiceLabels: { sqlite: label('SQLite', 'SQLite'), postgres: label('PostgreSQL', 'PostgreSQL') }, default: 'sqlite'
    }),
    field(`${postgres}.host`, 'string', 'Хост PostgreSQL', 'PostgreSQL host'),
    field(`${postgres}.port`, 'integer', 'Порт PostgreSQL', 'PostgreSQL port', { min: 1, max: 65535 }),
    field(`${postgres}.dbname`, 'string', 'База данных PostgreSQL', 'PostgreSQL database'),
    field(`${postgres}.schema`, 'string', 'Схема PostgreSQL', 'PostgreSQL schema'),
    field(`${postgres}.vault_role_base`, 'string', 'Префикс роли Vault', 'Vault role base'),
    field(`${postgres}.credential_helper.program`, 'string', 'Программа для учётных данных', 'Credential helper program'),
    field(`${postgres}.credential_helper.args`, 'string[]', 'Аргументы программы', 'Credential helper arguments', { default: [] }),
    field(`${embedding}.model`, 'string', 'Модель эмбеддингов', 'Embedding model'),
    field(`${embedding}.dimension`, 'integer', 'Размерность эмбеддинга', 'Embedding dimension', { min: 1 }),
    field(`${embedding}.provider`, 'string', 'Провайдер эмбеддингов', 'Embedding provider'),
    field(`${embedding}.url`, 'string', 'URL эмбеддингов', 'Embedding URL'),
    field(`${embedding}.queryPrefix`, 'string', 'Префикс поискового запроса', 'Search query prefix'),
    field(`${embedding}.documentPrefix`, 'string', 'Префикс документа', 'Document prefix'),
    field(`${embedding}.maxInputTokens`, 'integer', 'Лимит токенов', 'Input token limit', { min: 1 }),
    field(`${embedding}.tokenizerFile`, 'string', 'Файл токенизатора', 'Tokenizer file'),
    field(`${embedding}.tokenizerSha256`, 'string', 'SHA-256 файла токенизатора', 'Tokenizer SHA-256')
  ]),
  group('search_workspace', 'Поиск по рабочему коду', 'Workspace code search', baselineTarget('workspace_code')),
  group('search_reference', 'Поиск по эталонному коду', 'Reference code search', baselineTarget('reference'))
];

// Each rule is a boolean or a table of its parameters. A table enables the rule.
const diagnosticRows = [
  ["AtClientAtServerFormMethod", "Недоступный метод формы с директивой &НаКлиентеНаСервере", "Unreachable form method with &AtClientAtServer", true],
  ["PostingWhileDataExchangeLoading", "Проведение при загрузке данных", "Posting while data exchange is loading", true],
  ["UnboundFormEventHandler", "Непривязанный обработчик события формы", "Unbound form event handler", true],
  ["FormEventHandlerDirective", "Несовместимая директива обработчика события формы", "Incompatible form event handler directive", true],
  ["StructureKeyIsNotIdentifier", "Ключ структуры не является идентификатором", "Structure key is not an identifier", true],
  ["MultilingualStringHasEmptyTranslation", "Пустой перевод объявленного языка в НСтр", "Empty translation of a declared language in NStr", true],
  ["FormDataHasNoMetadataMethod", "Вызов Метаданные() у данных формы", "Metadata() called on form data", true],
  ["ValueIsFilledOfBoolean", "ЗначениеЗаполнено от Булево", "ValueIsFilled of Boolean", true],
  ["TypeNameComparedAsText", "Сравнение имени типа как текста", "Type name compared as text", false],

  ["OrdinaryFormDialogUnread", "Не удалось прочитать диалог обычной формы", "Ordinary form dialog could not be read", true],
  ["BuiltinFunctionNameAsDeclaration", "Имя встроенной функции в объявлении", "Built-in function name in a declaration", true],
  ["LocalCallWithQueryInCycle", "Вызов локального метода с запросом в цикле", "Local method with a query called inside a loop", true],
  ["PossiblyUndefinedValue", "Возможно неопределённое значение", "Possibly undefined value", true],
  ["UnknownQueryFunction", "Неизвестная функция запроса", "Unknown query function", true],
  ["UnavailableAliasInQuery", "Недоступный псевдоним в запросе", "Unavailable alias in a query", true],
  ["ObjectModifiedInOnWrite", "Изменение объекта в обработчике ПриЗаписи", "Object modified in OnWrite handler", true],
  ["RegisterRecorderFieldInQuery", "Чтение реквизита регистратора в запросе", "Register recorder field in a query", true],
  ["QueryOrderByDocumentDate", "Упорядочивание по дате документа", "Ordering by document date", true],
  ["QueryConditionWithoutIndex", "Условие виртуальной таблицы без опоры на индекс", "Virtual table condition without index coverage", true],
  ["UnknownSuppressionCode", "Неизвестный код подавления", "Unknown suppression code", true, true],
  ["SuppressionWithoutCode", "Подавление без кода", "Suppression without a code", true, true],
  ["ParseError", "Ошибка разбора исходного кода", "Source code parse error", true, true],
  ["CanonicalSpellingKeywords", "Каноническое написание ключевых слов", "Canonical keyword writing", true, true],
  ["ConsecutiveEmptyLines", "Подряд идущие пустые строки", "Consecutive Empty Lines", true, true],
  ["MultilinePreprocessorInstruction", "Инструкция препроцессора разорвана переводом строки", "Preprocessor instruction split across lines", true],
  ["LineLength", "Ограничение на длину строки", "Line Length limit", true, true],
  ["MissingSpace", "Пропущены пробелы слева или справа от операторов `+ - * / = % < > <> <= >=`, от ключевых слов, а так же справа от `,` и `;`", "Missing spaces to the left or right of operators + - * / = % < > <> <= >=, keywords, and also to the right of , and ;", true, true],
  ["OneStatementPerLine", "Одно выражение в одной строке", "One statement per line", true, true],
  ["SemicolonPresence", "Выражение должно заканчиваться символом \";\"", "Statement should end with semicolon symbol \";\"", true, true],
  ["SpaceAtStartComment", "Пробел в начале комментария", "Space at the beginning of the comment", true, true],
  ["IncorrectLineBreak", "Неправильный перенос выражения", "Incorrect expression line break", true, true],
  ["IncorrectUseOfStrTemplate", "Неверное использование \"СтрШаблон\"", "Incorrect use of \"StrTemplate\"", true, true],
  ["ExtraCommas", "Запятые без указания параметра в конце вызова метода", "Commas without a parameter at the end of a method call", true, true],
  ["CommentedCode", "Закомментированный фрагмент кода", "Commented out code", true, true],
  ["EmptyCodeBlock", "Пустой блок кода", "Empty code block", true, true],
  ["EmptyRegion", "Область не должна быть пустой", "The region should not be empty", true, true],
  ["EmptyStatement", "Пустой оператор", "Empty statement", true, true],
  ["UnreachableCode", "Недостижимый код", "Unreachable Code", true, true],
  ["CodeBlockBeforeSub", "Определения методов должны размещаться перед операторами тела модуля", "Method definitions must be placed before the module body operators", true, true],
  ["CodeOutOfRegion", "Код расположен вне области", "Code out of region", true, true],
  ["MagicNumber", "Магические числа", "Magic numbers", true, true],
  ["MagicDate", "Магические даты", "Magic dates", true, true],
  ["YoLetterUsage", "Использование буквы \"ё\" в текстах модулей", "Using Russian character \"yo\" (\"ё\") in code", true, true],
  ["LatinAndCyrillicSymbolInWord", "Смешивание латинских и кириллических символов в одном идентификаторе", "Mixing Latin and Cyrillic characters in one identifier", true, true],
  ["InvalidCharacterInFile", "Недопустимый символ", "Invalid character", true, true],
  ["DoubleNegatives", "Двойные отрицания", "Double negatives", true, true],
  ["NestedTernaryOperator", "Вложенный тернарный оператор", "Nested ternary operator", true, true],
  ["PostfixAccessOnExpression", "Обращение к результату выражения в скобках, оператора Новый или литерала", "Member access on a parenthesised expression, `Новый` or a literal", true],
  ["NonExportMethodsInApiRegion", "Неэкспортные методы в областях ПрограммныйИнтерфейс и СлужебныйПрограммныйИнтерфейс", "Non-export methods in API regions", true, true],
  ["TernaryOperatorUsage", "Использование тернарного оператора", "Ternary operator usage", false, false],
  ["UnaryPlusInConcatenation", "Унарный плюс в конкатенации строк", "Unary Plus sign in string concatenation", true, true],
  ["UselessTernaryOperator", "Бесполезный тернарный оператор", "Useless ternary operator", true, true],
  ["BadWords", "Запрещённые слова", "Prohibited words", false, false],
  ["DuplicateStringLiteral", "Повторное использование строкового литерала", "Duplicate string literal", true, true],
  ["DuplicateRegion", "Повторяющиеся разделы модуля", "Duplicate regions", true, true],
  ["NonStandardRegion", "Нестандартные разделы модуля", "Non-standard region of module", true, true],
  ["DuplicatedInsertionIntoCollection", "Повторное добавление/вставка значений в коллекцию", "Duplicate adding or pasting a value to a collection", true, true],
  ["ExcessiveAutoTestCheck", "Избыточная проверка параметра АвтоТест", "Excessive AutoTest Check", true, true],
  ["IdenticalExpressions", "Одинаковые выражения по обе стороны оператора", "Identical expressions on both sides of an operator", true, true],
  ["IfElseDuplicatedCodeBlock", "Повторяющиеся блоки кода в синтаксической конструкции Если...Тогда...ИначеЕсли...", "Duplicated code blocks in If...Then...ElseIf... statements", true, true],
  ["IfElseDuplicatedCondition", "Повторяющиеся условия в синтаксической конструкции Если...Тогда...ИначеЕсли...", "Duplicated conditions in If...Then...ElseIf... statements", true, true],
  ["IfElseIfEndsWithElse", "Использование синтаксической конструкции Если...Тогда...ИначеЕсли...", "If...Then...ElseIf... chains should end with Else", true, true],
  ["MultilingualStringHasAllDeclaredLanguages", "Есть локализованный текст для всех заявленных в конфигурации языков", "There is a localized text for all languages declared in the configuration", true, true],
  ["MultilingualStringUsingWithTemplate", "Частично локализованный текст используется в функции СтрШаблон", "Partially localized text is used in the StrTemplate function", true, true],
  ["NestedConstructorsInStructureDeclaration", "Использование конструкторов с параметрами при объявлении структуры", "Nested constructors with parameters in structure declaration", true, true],
  ["NestedFunctionInParameters", "Инициализация параметров методов и конструкторов вызовом вложенных методов", "Initialization of method and constructor parameters by calling nested methods", true, true],
  ["Typo", "Опечатка", "Typo", false, false],
  ["AllFunctionPathMustHaveReturn", "Все возможные пути выполнения функции должны содержать оператор Возврат", "All execution paths of a function must have a Return statement", true, true],
  ["FunctionShouldHaveReturn", "Функция должна содержать возврат", "The function should have return", true, true],
  ["ProcedureReturnsValue", "Процедура не должна возвращать значение", "Procedure should not return value", true, true],
  ["FunctionReturnsSamePrimitive", "Функция всегда возвращает одно и то же примитивное значение", "The function always returns the same primitive value", true, true],
  ["FunctionNameStartsWithGet", "Имя функции не должно начинаться с \"Получить\"", "Function name shouldn't start with \"Получить\"", false, false],
  ["TooManyReturns", "Метод не должен содержать много возвратов", "Methods should not have too many return statements", false, false],
  ["NumberOfParams", "Ограничение на количество параметров метода", "Number of parameters in method", true, true],
  ["NumberOfOptionalParams", "Ограничение на количество необязательных параметров метода", "Limit number of optional parameters in method", true, true],
  ["NumberOfValuesInStructureConstructor", "Ограничение на количество значений свойств, передаваемых в конструктор структуры", "Limit on the number of property values passed to the structure constructor", true, true],
  ["OrderOfParams", "Порядок параметров метода", "Order of parameters in method", true, true],
  ["MissedRequiredParameter", "Пропущен обязательный параметр метода", "Missed a required method parameter", true, true],
  ["FunctionOutParameter", "Исходящий параметр функции", "Out function parameter", false, false],
  ["UnusedParameters", "Неиспользуемый параметр", "Unused parameter", true, true],
  ["MissingParameterDescription", "Отсутствует описание параметров метода", "Method parameters description are missing", true, true],
  ["MissingReturnedValueDescription", "Отсутствует описание возвращаемого значения функции", "Function returned values description is missing", true, true],
  ["ReservedParameterNames", "Зарезервированные имена параметров", "Reserved parameter names", true, true],
  ["ReservedWordAsMethodName", "Использование зарезервированного слова как имени процедуры/функции", "Reserved word used as procedure/function name", true, true],
  ["RewriteMethodParameter", "Перезапись параметров метода", "Rewrite method parameter", true, true],
  ["UnusedLocalVariable", "Неиспользуемая локальная переменная", "Unused local variable", true, true],
  ["UnusedLocalMethod", "Неиспользуемый локальный метод", "Unused local method", true, true],
  ["ExportVariables", "Запрет экспортных глобальных переменных модуля", "Ban export global module variables", true, true],
  ["MissingVariablesDescription", "Все объявления переменных должны иметь описание", "All variables declarations must have a description", true, true],
  ["SelfAssign", "Присвоение переменной самой себе", "Variable is assigned to itself", true, true],
  ["ThisObjectAssign", "Присвоение значения свойству ЭтотОбъект", "ThisObject assign", true, true],
  ["CyclomaticComplexity", "Цикломатическая сложность", "Cyclomatic Complexity", true, true],
  ["CognitiveComplexity", "Когнитивная сложность", "Cognitive complexity", true, true],
  ["NestedStatements", "Управляющие конструкции не должны быть вложены слишком глубоко", "Control flow statements should not be nested too deep", true, true],
  ["MethodSize", "Ограничение на размер метода", "Method size", true, true],
  ["IfConditionComplexity", "Использование сложных выражений в условии оператора \"Если\"", "Usage of complex expressions in the \"If\" condition", true, true],
  ["MissingCodeTryCatchEx", "Блок «Исключение» подавляет ошибку", "Exception block silently swallows the error", true, true],
  ["MissingTempStorageDeletion", "Отсутствует удаление данных из временного хранилища после использования", "Missing temporary storage data deletion after using", false, false],
  ["MissingTemporaryFileDeletion", "Отсутствует удаление временного файла после использования", "Missing temporary file deletion after using", true, true],
  ["MisplacedLoopControl", "Оператор Прервать или Продолжить вне цикла", "Break or Continue outside a loop", true, true],
  ["UseLessForEach", "Бесполезный перебор коллекции", "Useless collection iteration", true, true],
  ["IteratorCollidesCollection", "Итератор совпадает с коллекцией", "Iterator collides with collection", true],
  ["UsingGoto", "Оператор \"Перейти\" не должен использоваться", "\"goto\" statement should not be used", true, true],
  ["BeginTransactionBeforeTryCatch", "Нарушение правил работы с транзакциями для метода 'НачатьТранзакцию'", "Violating transaction rules for the 'BeginTransaction' method", true, true],
  ["CodeAfterAsyncCall", "После вызова асинхронного метода есть строки кода", "Lines of code after the asynchronous method call", false, false],
  ["CommitTransactionOutsideTryCatch", "Нарушение правил работы с транзакциями для метода 'ЗафиксироватьТранзакцию'", "Violating transaction rules for the 'CommitTransaction' method", true, true],
  ["CompilationDirectiveLost", "Директивы компиляции методов", "Missing Compilation Directive on a Method", true, true],
  ["CompilationDirectiveNeedLess", "Лишняя директива компиляции", "Redundant Compilation Directive", true, true],
  ["CreateQueryInCycle", "Выполнение запроса в цикле", "Query Execution Inside a Loop", true, true],
  ["ImplicitDatabaseReadInCycle", "Неявное чтение из базы в цикле", "Implicit Database Read Inside a Loop", true],
  ["DataExchangeLoading", "Отсутствует проверка признака ОбменДанными.Загрузка в обработчике событий объекта", "Missing DataExchange.Load Check in an Object Event Handler", true, true],
  ["DeletingCollectionItem", "Удаление элемента при обходе коллекции посредством оператора \"Для каждого ... Из ... Цикл\"", "Deleting an Item While Iterating a Collection", true, true],
  ["SelfInsertion", "Вставка коллекции в саму себя", "Insert a collection into itself", true, true],
  ["SeveralCompilerDirectives", "Ошибочное указание нескольких директив компиляции", "Erroneous indication of several compilation directives", true, true],
  ["StyleElementConstructors", "Конструктор элемента стиля", "Style element constructor", true, true],
  ["DeprecatedPlatformApi", "Устаревший API платформы", "Deprecated platform API", true, true],
  ["DeprecatedMethodCall", "Устаревшие методы не должны использоваться", "Deprecated methods should not be used", true, true],
  ["DisableSafeMode", "Отключение безопасного режима", "Disable safe mode", true, true],
  ["ExecuteExternalCode", "Выполнение произвольного кода на сервере", "Executing of external code on the server", true, true],
  ["ExecuteExternalCodeInCommonModule", "Выполнение произвольного кода в общем модуле на сервере", "Executing of external code in a common module on the server", true, true],
  ["ExternalAppStarting", "Запуск внешних приложений", "External applications starting", true, true],
  ["FileSystemAccess", "Доступ к файловой системе", "File system access", false, false],
  ["OSUsersMethod", "Использование метода ПользователиОС", "Using method OSUsers", true, true],
  ["TempFilesDir", "Вызов функции КаталогВременныхФайлов()", "TempFilesDir() method call", true, true],
  ["FormDataToValue", "Использование метода ДанныеФормыВЗначение", "FormDataToValue method call", true, true],
  ["GetFormMethod", "Использование метода ПолучитьФорму", "GetForm method call", true, true],
  ["GlobalContextMethodCollision8312", "Конфликт имен методов с методами глобального контекста", "Global context method names collision", true, true],
  ["GlobalContextMethodConflict", "Конфликт имени метода формы с глобальной функцией", "Form method name conflicts with a global function", true],
  ["InternetAccess", "Обращение к Интернет-ресурсам", "Referring to Internet resources", false, false],
  ["IsInRoleMethod", "Использование метода РольДоступна", "IsInRole global method call", true, true],
  ["PairingBrokenTransaction", "Нарушение парности использования методов \"НачатьТранзакцию()\" и \"ЗафиксироватьТранзакцию()\" / \"ОтменитьТранзакцию()\"", "Violation of pairing using methods \"BeginTransaction()\" & \"CommitTransaction()\" / \"RollbackTransaction()\"", true, true],
  ["WrongUseOfRollbackTransactionMethod", "Некорректное использование метода ОтменитьТранзакцию()", "Not recommended using of RollbackTransaction method", true, true],
  ["TimeoutsInExternalResources", "Таймауты при работе с внешними ресурсами", "Timeouts when working with external resources", true, true],
  ["TryNumber", "Приведение к числу в попытке", "Cast to number of try catch block", true, true],
  ["UnknownPreprocessorSymbol", "Неизвестный символ препроцессора", "Unknown preprocessor symbol", true, true],
  ["UnsafeSafeModeMethodCall", "Небезопасное использование функции БезопасныйРежим()", "Unsafe SafeMode method call", true, true],
  ["UsageWriteLogEvent", "Неверное использование метода \"ЗаписьЖурналаРегистрации\"", "Incorrect use of the method \"WriteLogEvent\"", true, true],
  ["UseSystemInformation", "Использование системной информации", "Use of system information", false, false],
  ["UsingCancelParameter", "Работа с параметром \"Отказ\"", "Using parameter \"Cancel\"", true, true],
  ["UsingExternalCodeTools", "Использование возможностей выполнения внешнего кода", "Using external code tools", true, true],
  ["UsingFindElementByString", "Использование методов \"НайтиПоНаименованию\", \"НайтиПоКоду\" и \"НайтиПоНомеру\"", "Using FindByName, FindByCode and FindByNumber", true, true],
  ["UsingHardcodeNetworkAddress", "Хранение ip-адресов в коде", "Using hardcode ip addresses in code", true, true],
  ["UsingHardcodePath", "Хранение путей к файлам в коде", "Using hardcode file paths in code", true, true],
  ["UsingHardcodeSecretInformation", "Хранение конфиденциальной информации в коде", "Storing confidential information in code", true, true],
  ["UsingModalWindows", "Использование модальных окон", "Using modal windows", true, true],
  ["UsingObjectNotAvailableUnix", "Использование объектов недоступных в Unix системах", "Using unavailable in Unix objects", true, true],
  ["UsingSynchronousCalls", "Использование синхронных вызовов", "Using synchronous calls", true, true],
  ["UsingServiceTag", "Использование служебных тегов", "Using service tags", true, true],
  ["UsingThisForm", "Использование устаревшего свойства \"ЭтаФорма\"", "Using deprecated property \"ThisForm\"", true, true],
  ["WrongUseFunctionProceedWithCall", "Некорректное использование функции ПродолжитьВызов()", "Wrong use of ProceedWithCall function", true, true],
  ["WrongHttpServiceHandler", "Неверно задан обработчик метода http-сервиса", "Missing handler for http service", true, true],
  ["WrongWebServiceHandler", "Неверно задан обработчик операции web-сервиса", "Wrong handler for web service", true, true],
  ["WrongDataPathForFormElements", "У полей формы не указан путь к данным", "Form fields do not have a data path", true, true],
  ["PublicMethodsDescription", "Все методы программного интерфейса должны иметь описание", "All public methods must have a description", true, true],
  ["CachedPublic", "Кеширование программного интерфейса", "Cached public methods", true, true],
  ["CommandModuleExportMethods", "Экспортные методы в модулях команд и общих команд", "Export methods in command and general command modules", true, true],
  ["CommonModuleAssign", "Присвоение общему модулю", "CommonModuleAssign", true, true],
  ["CommonModuleInvalidType", "Общий модуль недопустимого типа", "Common module invalid type", true, true],
  ["CommonModuleMissingAPI", "Общий модуль должен иметь программный интерфейс", "Common module should have a programming interface", true, true],
  ["CommonModuleNameCached", "Пропущен постфикс \"ПовтИсп\"", "Missed postfix \"Cached\"", true, true],
  ["CommonModuleNameClient", "Пропущен постфикс \"Клиент\"", "Missed postfix \"Client\"", true, true],
  ["CommonModuleNameClientServer", "Пропущен постфикс \"КлиентСервер\"", "Missed postfix \"ClientServer\"", true, true],
  ["CommonModuleNameFullAccess", "Пропущен постфикс \"ПолныеПрава\"", "Missed postfix \"FullAccess\"", true, true],
  ["CommonModuleNameGlobal", "Пропущен постфикс \"Глобальный\"", "Missing \"Global\" Postfix", true, true],
  ["CommonModuleNameGlobalClient", "Глобальный модуль с постфиксом \"Клиент\"", "Global Module with \"Client\" Postfix", true, true],
  ["CommonModuleNameServerCall", "Пропущен постфикс \"ВызовСервера\"", "Missing \"ServerCall\" Postfix", true, true],
  ["CommonModuleNameWords", "Нерекомендуемое имя общего модуля", "Unrecommended Common Module Name", true, true],
  ["DenyIncompleteValues", "Запрет незаполненных значений у измерений регистров", "Deny Incomplete Values for Register Dimensions", false, false],
  ["ForbiddenMetadataName", "Объекту метаданных присвоено запрещенное имя", "Metadata object has a forbidden name", true, true],
  ["MetadataObjectNameLength", "Имена объектов метаданных не должны превышать допустимой длины наименования", "Metadata object names must not exceed the allowed length", true, true],
  ["MissingCommonModuleMethod", "Обращение к отсутствующему методу общего модуля", "Calling a missing common module method", true, true],
  ["MissingEventSubscriptionHandler", "Отсутствует обработчик подписки на событие", "Event subscription handler missing", true, true],
  ["MissingFormEventHandler", "Обработчик формы не найден в модуле формы", "Form handler is missing from the form module", true],
  ["OrdinaryAppSupport", "Поддержка обычного приложения", "Ordinary application support", true, true],
  ["PrivilegedModuleMethodCall", "Обращение к методам привилегированных модулей", "Accessing privileged module methods", true, true],
  ["ProtectedModule", "Защищенные модули", "Protected modules", true, true],
  ["RedundantAccessToObject", "Избыточное обращение к объекту", "Redundant access to an object", true, true],
  ["SameMetadataObjectAndChildNames", "Совпадает имя объекта метаданного и его дочернего", "Same metadata object and child name", true, true],
  ["ScheduledJobHandler", "Обработчик регламентного задания", "Scheduled job handler", true, true],
  ["ServerCallsInFormEvents", "Серверные вызовы в событиях форм", "Server calls in form events", true, true],
  ["ServerSideExportFormMethod", "Серверный экспортный метод формы", "Server-side export form method", true, true],
  ["SetPermissionsForNewObjects", "Флажок \"Устанавливать права для новых объектов\" должен быть установлен только у роли ПолныеПрава", "The check box «Set permissions for new objects» should only be selected for the FullAccess role", true, true],
  ["SetPrivilegedMode", "Использование привилегированного режима", "Using privileged mode", true, true],
  ["TransferringParametersBetweenClientAndServer", "Передача параметров между клиентом и сервером", "Transferring parameters between the client and the server", true, true],
  ["UnsafeFindByCode", "Небезопасное использование метода НайтиПоКоду()", "Unsafe FindByCode() method usage", true, true],
  ["WeavingAnnotationNotApplicable", "Неприменимая аннотация перехвата", "Weaving annotation not applicable", true, true],
  ["WeavingSignatureMismatch", "Несоответствие сигнатуры перехватчика", "Interceptor signature mismatch", true, true],
  ["UnresolvedName", "Неопределённое имя", "Unresolved name", false, false],
  ["UnresolvedMethodCall", "Вызов неразрешённого метода", "Call to an unresolved method", true, true],
  ["UnresolvedBareCall", "Вызов неопределённой процедуры или функции", "Call to an undefined procedure or function", true],
  ["MismatchedArgCount", "Несовпадение количества аргументов", "Mismatched argument count", true, true],
  ["TypeMismatch", "Несоответствие типов", "Type mismatch", true, true],
  ["TypeMismatchByDocComment", "Несоответствие типов по описанию", "Type mismatch by doc-comment", false, false],
  ["UnresolvedField", "Обращение к неизвестному полю", "Access to an unknown field", true, true],
  ["UnresolvedMetadataPath", "Строка называет отсутствующий объект метаданных", "String names a missing metadata object", true],
  ["ReadOnlyPropertyAssignment", "Присваивание значения свойству, доступному только для чтения", "Assignment to a read-only property", true, true],
  ["GlobalPropertyNotWritable", "Присваивание свойству глобального контекста", "Assignment to a Global-context property", true, true],
  ["UnknownTypeInNew", "Неизвестный тип в конструкторе", "Unknown type in a constructor", true],
  ["UnavailableInEnvironment", "Обращение к API, недоступному в контексте исполнения", "Access to API unavailable in the execution environment", true, true],
  ["PlatformMemberNewerThanMinVersion", "Элемент платформы новее минимальной версии проекта", "Platform member newer than the project's minimum platform", true],
  ["PlatformMemberHiddenByCompatibilityMode", "Элемент платформы скрыт режимом совместимости", "Platform member hidden by the compatibility mode", true],
  ["ModuleAccessibility", "Обращение к коду, недоступному в контексте исполнения", "Access to user code unavailable in the execution environment", true, true],
  ["UninitializedLocalVariable", "Неинициализированная локальная переменная", "Uninitialized Local Variable", true],
  ["AmbiguousFieldInQuery", "Неоднозначное поле в запросе", "Ambiguous field in query", true],
  ["AssignAliasFieldsInQuery", "Назначение псевдонимов выбранным полям в запросе", "Assigning aliases to selected fields in a query", true, true],
  ["CalculationRegisterVirtualTableWithoutRecorder", "Виртуальная таблица регистра расчёта без отбора по регистратору", "Calculation register virtual table without a recorder filter", true],
  ["DuplicateAliasInQuery", "Повторный псевдоним источника запроса", "Duplicate query source alias", true],
  ["FieldsFromJoinsWithoutIsNull", "Отсутствие проверки на NULL для полей из присоединяемых таблиц", "No NULL checks for fields from joined tables", true, false],
  ["FullOuterJoinQuery", "Использование конструкции \"ПОЛНОЕ ВНЕШНЕЕ СОЕДИНЕНИЕ\" в запросах", "Using of \"FULL OUTER JOIN\" in queries", true, true],
  ["IncorrectUseLikeInQuery", "Некорректное использование 'ПОДОБНО'", "Incorrect use of 'LIKE'", true, true],
  ["InvalidVirtualTableParameters", "Неверные параметры виртуальной таблицы", "Invalid virtual table parameters", true],
  ["JoinWithSubQuery", "Соединение с вложенными запросами", "Join with sub queries", true, true],
  ["JoinWithVirtualTable", "Соединение с виртуальными таблицами", "Join with virtual table", true, true],
  ["LogicalOrInJoinQuerySection", "Логическое 'ИЛИ' в соединениях запроса", "Logical 'OR' in 'JOIN' query section", true, true],
  ["LogicalOrInTheWhereSectionOfQuery", "Использование логического \"ИЛИ\" в секции \"ГДЕ\" запроса", "Using a logical \"OR\" in the \"WHERE\" section of a query", true, true],
  ["MultilineStringInQuery", "Многострочный литерал в запросе", "Multi-line literal in query", true, true],
  ["QueryNestedFieldsByDot", "Разыменование ссылочных полей запроса через точку", "Getting objects nested fields data by dot in database query text", true, true],
  ["QueryParseError", "Ошибка разбора текста запроса", "Query text parsing error", true, true],
  ["QueryToMissingMetadata", "Обращение к несуществующим метаданным в запросе", "Using non-existent metadata in the query", true, true],
  ["QueryParameterSourceWithoutInto", "Выборка из параметра-источника без ПОМЕСТИТЬ", "Selecting from a parameter source without INTO", true],
  ["QueryTotalsInValueTableInto", "ИТОГИ при помещении таблицы значений во временную таблицу", "TOTALS while putting a value table into a temporary table", true],
  ["UnknownFieldInQuery", "Поле не найдено в таблице запроса", "Unknown field in a query table", true, true],
  ["UnlimitedLengthStringUsageInQuery", "Поле неограниченной длины в недопустимой позиции запроса", "Unlimited-length string field in a restricted query position", true, true],
  ["RefOveruse", "Избыточное использование \"Ссылка\" в запросе", "Overuse \"Reference\" in a query", true, true],
  ["SelectTopWithoutOrderBy", "Использование 'ВЫБРАТЬ ПЕРВЫЕ' без 'УПОРЯДОЧИТЬ ПО'", "Using 'SELECT TOP' without 'ORDER BY'", true, true],
  ["UnionAll", "Использование ключевого слова \"ОБЪЕДИНИТЬ\" в запросах", "Using keyword \"UNION\" in queries", true, true],
  ["UsingLikeInQuery", "Использование 'ПОДОБНО' в запросе", "Using 'LIKE' in query", false, false],
  ["VirtualTableCallWithoutParameters", "Обращение к виртуальной таблице без параметров", "Virtual table call without parameters", true, true],
];

const diagnosticParameters = {
  ConsecutiveEmptyLines: [
    field("allowedEmptyLinesCount", "integer", "Допустимо пустых строк", "Allowed consecutive blank lines", {"default": 1, "min": 0, "managedBy": "format"}),
  ],
  LineLength: [
    field("checkMethodDescription", "boolean", "Проверять описание метода", "Check method descriptions", {"default": true}),
    field("maxLineLength", "integer", "Максимальная длина строки", "Maximum line length", {"default": 120, "min": 0, "managedBy": "format"}),
    field("excludeTrailingComments", "boolean", "Пропускать комментарии в конце строки", "Skip trailing comments", {"default": false}),
  ],
  MissingSpace: [
    field("listForCheckLeft", "string", "Проверка пробела слева", "Check spacing before", {"default": ""}),
    field("listForCheckRight", "string", "Проверка пробела справа", "Check spacing after", { default: ", ;" }),
    field("listForCheckLeftAndRight", "string", "Проверка пробелов с обеих сторон", "Check spacing on both sides", {"default": "+ - * / = % < > <> <= >="}),
    field("checkSpaceToRightOfUnary", "boolean", "Проверять пробел после унарного оператора", "Check space after unary operators", {"default": false}),
    field("allowMultipleCommas", "boolean", "Разрешить запятые подряд", "Allow consecutive commas", {"default": false}),
  ],
  CommentedCode: [
    field("exclusionPrefixes", "string", "Исключаемые префиксы", "Excluded prefixes", {"default": ""}),
    field("skipSupported", "boolean", "Пропускать объекты на поддержке", "Skip objects under vendor support", {"default": false, "since": "0.4.2"}),
  ],
  MagicNumber: [
    field("authorizedNumbers", "string", "Разрешённые числа", "Allowed numbers", {"default": "-1,0,1,24,60,3600,86400"}),
    field("allowMagicIndexes", "boolean", "Разрешить числа в индексах", "Allow numbers in indexes", {"default": true}),
    field("excludedConstructors", "string", "Исключённые конструкторы", "Excluded constructors", {"default": "КвалификаторыЧисла,КвалификаторыСтроки,NumberQualifiers,StringQualifiers,Цвет,Color"}),
  ],
  MagicDate: [
    field("authorizedDates", "string", "Разрешённые даты", "Allowed dates", {"default": "00010101,00010101000000,000101010000"}),
  ],
  LatinAndCyrillicSymbolInWord: [
    field("excludeWords", "string", "Исключённые слова", "Excluded words"),
    field("allowTrailingPartsInAnotherLanguage", "boolean", "Разрешать окончания на другом алфавите", "Allow trailing text in another alphabet", {"default": true}),
  ],
  NonExportMethodsInApiRegion: [
    field("skipAnnotatedMethods", "boolean", "Пропускать методы с аннотациями", "Skip annotated methods", {"default": false}),
  ],
  BadWords: [
    field("badWords", "string", "Запрещённые слова", "Disallowed words", {"default": ""}),
    field("findInComments", "boolean", "Искать в комментариях", "Search comments", {"default": true}),
  ],
  DuplicateStringLiteral: [
    field("allowedNumberCopies", "integer", "Допустимое число повторов", "Allowed copies", {"default": 2, "min": 0}),
    field("analyzeFile", "boolean", "Проверять весь файл", "Check the entire file", {"default": false}),
    field("caseSensitive", "boolean", "Учитывать регистр", "Match case", {"default": false}),
    field("minTextLength", "integer", "Минимальная длина текста", "Minimum text length", {"default": 5, "min": 0}),
    field("excludedMethods", "string[]", "Исключённые методы", "Excluded methods"),
  ],
  DuplicatedInsertionIntoCollection: [
    field("isAllowedMethodADD", "boolean", "Разрешить метод «Добавить»", "Allow the Add method", {"default": true}),
  ],
  IdenticalExpressions: [
    field("popularDivisors", "string", "Типовые делители", "Common divisors", { default: "60, 1024" }),
  ],
  MultilingualStringHasAllDeclaredLanguages: [
    field("declaredLanguages", "string", "Языки через запятую", "Comma-separated languages", {"default": "ru"}),
  ],
  MultilingualStringUsingWithTemplate: [
    field("declaredLanguages", "string", "Языки через запятую", "Comma-separated languages", {"default": "ru"}),
  ],
  NestedFunctionInParameters: [
    field("allowOneliner", "boolean", "Разрешить однострочные функции", "Allow single-line functions", {"default": true}),
    field("allowedMethodNames", "string", "Разрешённые методы", "Allowed methods", {"default": "НСтр,NStr,ПредопределенноеЗначение,PredefinedValue"}),
  ],
  Typo: [
    field("minWordLength", "integer", "Минимальная длина слова", "Minimum word length", { min: 0, default: 3 }),
    field("userWordsToIgnore", "string", "Игнорируемые слова", "Ignored words", {"default": ""}),
    field("caseInsensitive", "boolean", "Игнорировать регистр", "Ignore case", {"default": false}),
  ],
  TooManyReturns: [
    field("maxReturnsCount", "integer", "Максимум возвратов", "Maximum return statements", {"default": 3, "min": 0}),
  ],
  NumberOfParams: [
    field("maxParamsCount", "integer", "Максимум параметров", "Maximum parameters", {"default": 7, "min": 0}),
  ],
  NumberOfOptionalParams: [
    field("maxOptionalParamsCount", "integer", "Максимум необязательных параметров", "Maximum optional parameters", {"default": 3, "min": 0}),
  ],
  NumberOfValuesInStructureConstructor: [
    field("maxValuesCount", "integer", "Максимум значений", "Maximum values", {"default": 3, "min": 0}),
  ],
  UnusedParameters: [
    field("attachableMethodPrefixes", "string", "Префиксы подключаемых методов", "Attachable method prefixes", {"default": "подключаемый_,attachable_"}),
  ],
  MissingParameterDescription: [
    field("allowShortDescriptionParameters", "boolean", "Разрешить краткое описание параметров", "Allow short parameter descriptions", {"default": true}),
  ],
  MissingReturnedValueDescription: [
    field("allowShortDescriptionReturnValues", "boolean", "Разрешить краткое описание возврата", "Allow short return descriptions", {"default": true}),
  ],
  ReservedParameterNames: [
    field("reservedWords", "string[]", "Зарезервированные слова", "Reserved words"),
  ],
  UnusedLocalVariable: [
    field("analyzeForLoopVariables", "boolean", "Проверять переменные цикла", "Check loop variables", {"default": true}),
  ],
  UnusedLocalMethod: [
    field("attachableMethodPrefixes", "string", "Префиксы подключаемых методов", "Attachable method prefixes", {"default": "подключаемый_,attachable_"}),
    field("checkObjectModule", "boolean", "Проверять модуль объекта", "Check object module", {"default": false}),
  ],
  CyclomaticComplexity: [
    field("complexityThreshold", "integer", "Порог сложности", "Complexity threshold", {"default": 20, "min": 0}),
  ],
  CognitiveComplexity: [
    field("complexityThreshold", "integer", "Порог сложности", "Complexity threshold", {"default": 15, "min": 0}),
  ],
  NestedStatements: [
    field("maxAllowedLevel", "integer", "Допустимый уровень вложенности", "Maximum nesting depth", {"default": 4, "min": 0}),
  ],
  MethodSize: [
    field("maxMethodSize", "integer", "Максимальный размер метода", "Maximum method size", {"default": 200, "min": 0}),
  ],
  IfConditionComplexity: [
    field("maxIfConditionComplexity", "integer", "Максимальная сложность условия", "Maximum condition complexity", {"default": 3, "min": 0}),
  ],
  MissingCodeTryCatchEx: [
    field("commentAsCode", "boolean", "Считать комментарий кодом", "Count comments as code", {"default": false}),
  ],
  MissingTemporaryFileDeletion: [
    field("searchDeleteFileMethod", "string", "Шаблон методов удаления файлов", "File deletion method pattern", {"default": "УдалитьФайлы|DeleteFiles|НачатьУдалениеФайлов|BeginDeletingFiles|ПереместитьФайл|MoveFile"}),
  ],
  DataExchangeLoading: [
    field("findFirst", "boolean", "Ограничиться первым результатом", "Stop after the first finding", {"default": false}),
    field("guardWrappers", "string[]", "Обёртки для проверки обмена", "Data exchange guard wrappers"),
  ],
  DeprecatedPlatformApi: [
    field("exclude", "string[]", "Исключённые имена API", "Excluded API names", {"since": "0.4.2"}),
  ],
  PairingBrokenTransaction: [
    field("maxTransactionLevel", "integer", "Максимальный уровень вложенности транзакций", "Maximum transaction nesting", {"default": 32, "min": 0}),
  ],
  TimeoutsInExternalResources: [
    field("analyzeInternetMailProfileZeroTimeout", "boolean", "Проверять нулевой тайм-аут почтового профиля", "Check zero mail profile timeout", {"default": true}),
  ],
  UsingHardcodeNetworkAddress: [
    field("searchWordsExclusion", "string", "Шаблон исключаемых слов", "Excluded words pattern", {"default": "Верси|Version|ЗапуститьПриложение|RunApp|Пространств|Namespace|Драйвер|Driver"}),
    field("searchPopularVersionExclusion", "string", "Шаблон исключаемых номеров версий", "Excluded version numbers pattern"),
  ],
  UsingHardcodePath: [
    field("searchWordsStdPathsUnix", "string", "Шаблон стандартных путей Unix", "Standard Unix paths pattern"),
  ],
  UsingHardcodeSecretInformation: [
    field("searchWords", "string", "Шаблон для поиска", "Search pattern", {"default": "Пароль|Password"}),
  ],
  UsingServiceTag: [
    field("serviceTags", "string", "Служебные метки", "Service tags"),
  ],
  PublicMethodsDescription: [
    field("checkAllRegion", "boolean", "Проверять все области", "Check all regions", {"default": false}),
  ],
  CommonModuleNameWords: [
    field("words", "string", "Шаблон слов в имени", "Name words pattern"),
  ],
  MetadataObjectNameLength: [
    field("maxMetadataObjectNameLength", "integer", "Максимальная длина имени", "Maximum name length", { min: 0, default: 80 }),
  ],
  PrivilegedModuleMethodCall: [
    field("validateNestedCalls", "boolean", "Проверять вложенные вызовы", "Check nested calls", {"default": true}),
  ],
  RedundantAccessToObject: [
    field("checkObjectModule", "boolean", "Проверять модуль объекта", "Check object module", {"default": true}),
    field("checkFormModule", "boolean", "Проверять модуль формы", "Check form module", {"default": true}),
    field("checkRecordSetModule", "boolean", "Проверять модуль набора записей", "Check record set module", {"default": true}),
  ],
  SetPermissionsForNewObjects: [
    field("namesFullAccessRole", "string", "Имена ролей полного доступа", "Full-access role names", {"default": "FullAccess,ПолныеПрава"}),
  ],
  CalculationRegisterVirtualTableWithoutRecorder: [
    field("onlyInModulesWritingRegister", "boolean", "Только в модулях, записывающих регистр", "Only in modules that write to the register", {"default": false, "since": "0.4.2"}),
  ],
  QueryNestedFieldsByDot: [
    field("minPathDepth", "integer", "Минимальная глубина пути", "Minimum path depth", {"default": 3, "min": 0}),
  ],
  SelectTopWithoutOrderBy: [
    field("skipSelectTopOne", "boolean", "Пропускать запросы «ПЕРВЫЕ 1»", "Skip SELECT TOP 1", {"default": true}),
  ],
};

export const diagnosticCatalog = diagnosticRows.map(([id, ru, en, defaultEnabled, legacyEnabled]) => ({
  id,
  label: label(ru, en),
  defaultEnabled,
  legacyEnabled,
  parameters: diagnosticParameters[id] ?? []
}));

// Upstream 0.2.67 reads a smaller project-model TOML contract. The default data
// above tracks 0.4.7. Version-specific fields are gated below.
const fieldsUnavailableIn0267 = new Set([
  'source.exclude', 'source.exclude_globs', 'min_platform_version', 'compatibility_mode',
  'source.configuration', 'source.externals', 'platform_help.source', 'platform_help.path',
  'platform_help.url', 'diagnostics.baseline.path', 'diagnostics.baseline.directory',
  'diagnostics.baseline.include', 'diagnostics.baseline.groups',
  `${embedding}.queryPrefix`, `${embedding}.documentPrefix`, `${embedding}.maxInputTokens`,
  `${embedding}.tokenizerFile`, `${embedding}.tokenizerSha256`
]);
// Introduction versions follow DiagnosticCode and activated_by_default in the published tags.
const introduced = {
  IteratorCollidesCollection: '0.4.1', UnknownTypeInNew: '0.4.1', UninitializedLocalVariable: '0.4.1',
  CalculationRegisterVirtualTableWithoutRecorder: '0.4.2',
  OrdinaryFormDialogUnread: '0.4.3',
  BuiltinFunctionNameAsDeclaration: '0.4.4',
  LocalCallWithQueryInCycle: '0.4.4',
  PossiblyUndefinedValue: '0.4.4',
  UnknownQueryFunction: '0.4.4',
  UnavailableAliasInQuery: '0.4.4',
  ObjectModifiedInOnWrite: '0.4.5',
  RegisterRecorderFieldInQuery: '0.4.5',
  QueryOrderByDocumentDate: '0.4.6',
  QueryConditionWithoutIndex: '0.4.6',
  AtClientAtServerFormMethod: '0.4.7',
  PostingWhileDataExchangeLoading: '0.4.7',
  UnboundFormEventHandler: '0.4.7',
  FormEventHandlerDirective: '0.4.7',
  StructureKeyIsNotIdentifier: '0.4.7',
  MultilingualStringHasEmptyTranslation: '0.4.7',
  FormDataHasNoMetadataMethod: '0.4.7',
  ValueIsFilledOfBoolean: '0.4.7',
  TypeNameComparedAsText: '0.4.7',
};

export const analyzerCatalogVersions = Object.freeze([
  '0.2.67', '0.4.0', '0.4.1', '0.4.2', '0.4.3', '0.4.4', '0.4.5', '0.4.6', '0.4.7'
]);

// Only these presentation levels affect findings; upstream grade/type are not effective overrides.
export function diagnosticSeverityField(id) {
  return field(`diagnostics.metadataOverrides.${id}.lspSeverity`, 'enum', 'Уровень диагностики', 'Diagnostic severity', {
    choices: ['error', 'warning', 'information', 'hint'],
    choiceLabels: {
      error: label('Ошибка', 'Error'), warning: label('Предупреждение', 'Warning'),
      information: label('Информация', 'Information'), hint: label('Подсказка', 'Hint')
    },
    hint: label('Наследовать — использовать уровень анализатора. Не включает выключенное правило.',
      'Inherit uses the analyzer level. Does not enable a disabled rule.')
  });
}

export function analyzerCatalogForVersion(version) {
  if (!analyzerCatalogVersions.includes(version)) return undefined;
  if (version === analyzerCatalogVersion) return { analyzerGroups, diagnosticCatalog, severityOverrides: true };

  if (version === '0.2.67') {
    return {
      severityOverrides: false,
      analyzerGroups: analyzerGroups.map(group => ({
        ...group,
        fields: group.fields.filter(field => !field.since && !fieldsUnavailableIn0267.has(field.path.join('.')))
      })).filter(group => group.fields.length > 0),
      diagnosticCatalog: diagnosticCatalog.filter(rule => rule.legacyEnabled !== undefined).map(rule => ({
        ...rule,
        defaultEnabled: rule.legacyEnabled,
        parameters: rule.parameters.filter(parameter => !parameter.since)
      }))
    };
  }

  return {
    severityOverrides: analyzerCatalogVersions.indexOf(version) >= analyzerCatalogVersions.indexOf('0.4.4'),
    analyzerGroups: analyzerGroups.map(group => ({
      ...group,
      fields: group.fields.filter(field => !field.since
        || analyzerCatalogVersions.indexOf(version) >= analyzerCatalogVersions.indexOf(field.since))
    })),
    diagnosticCatalog: diagnosticCatalog.filter(({ id }) =>
      !introduced[id] || analyzerCatalogVersions.indexOf(version) >= analyzerCatalogVersions.indexOf(introduced[id])
    ).map(rule => rule.id === 'FieldsFromJoinsWithoutIsNull' && ['0.4.0', '0.4.1'].includes(version)
      ? { ...rule, defaultEnabled: false }
      : rule)
  };
}
