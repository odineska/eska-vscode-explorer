import { test } from "node:test";
import assert from "node:assert/strict";
import { bslContinuationRules } from "../out/language/bsl-newline.js";

test("BSL continuation uses the comment or string at the split point", () => {
  const examples = [
    ["\t// первая¦ часть", "// "],
    ["  //¦", "// "],
    ['// текст с незакрытой "кавычкой¦', "// "],
    ['Значение = "//"; // описание¦', "// "],
    ['\tТекст = "первая¦ вторая";', "|"],
    ['Текст = "¦";', "|"],
    ['\t|SELECT¦ 1', "|"],
    ['    |путь // и ""кавычки""¦', "|"],
    ['Текст = "/a" + "строка¦', "|"],
    ['  |последняя строка";¦', ""],
    ['Текст = "| //";¦', ""],
    ['Текст = "";¦', ""],
    ["Дата = '20261203';¦", ""],
    ["Число = 10 / 2;¦", ""],
    ["\t¦// строка", ""],
    ["/¦/ строка", ""],
    ["  ¦|строка", ""],
    ['  |закрывающая строка"; // комментарий¦', "// "],
    ['  |закрывающая строка" + "новая¦', "|"],
  ];
  for (const [source, expected] of examples) {
    const before = source.slice(0, source.indexOf("¦"));
    assert.equal(bslContinuationRules.find(rule => rule.beforeText.test(before))?.appendText ?? "", expected, source);
  }
});

test("inline comments preserve block-header indentation", () => {
  for (const source of ["Если Истина Тогда // описание", "Процедура Тест() // описание", "Async Procedure Test() // comment", "Else // comment"]) {
    assert.equal(bslContinuationRules.find(rule => rule.beforeText.test(source))?.indent, true, source);
  }
  for (const source of ["// Если Истина Тогда", 'Текст = "Если Истина Тогда"; // описание', "Значение = 1; // описание"]) {
    assert.notEqual(bslContinuationRules.find(rule => rule.beforeText.test(source))?.indent, true, source);
  }
});
