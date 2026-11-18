const lfsAttributes = ["filter=lfs", "diff=lfs", "merge=lfs", "-text"];
const attrsPattern = /^(?<indent>[ \t]*)(?<pattern>"(?:[^"\\]|\\.)*"|[^ \t"]+)(?=[ \t]|$)(?<attributes>.*)$/;

function splitFile(text) {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const body = bom ? text.slice(1) : text;
  const lines = Array.from(body.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g))
    .filter(match => match[0])
    .map(([, content, ending]) => ({ content, ending }));
  const eol = lines.find(line => line.ending)?.ending ?? "\n";
  return { bom, lines, eol };
}

function writeFile({ bom, lines }) {
  return bom + lines.map(({ content, ending }) => content + ending).join("");
}

function attributesRule(content) {
  const match = attrsPattern.exec(content);
  if (!match) return;
  const { indent, pattern, attributes } = match.groups;
  if (pattern.startsWith("#") || pattern.startsWith("!") || pattern.startsWith("[attr]")) return;
  const entries = Array.from(attributes.matchAll(/[ \t]+([^ \t]+)/g));
  return { indent, pattern, attributes, entries };
}

function lfsRule(content) {
  const rule = attributesRule(content);
  if (!rule) return;
  const filter = rule.entries.findLast(([, attribute]) => /^(?:[-!])?filter(?:=|$)/.test(attribute));
  if (filter?.[1] !== "filter=lfs") return;

  // A standalone -text may belong to the user's other settings.
  const standard = lfsAttributes.every(attribute => rule.entries.some(([, name]) => name === attribute));
  const managed = rule.entries.filter(([, name]) => lfsAttributes.includes(name) && (name !== "-text" || standard));
  let remaining = rule.attributes;
  for (const entry of managed.toReversed()) {
    remaining = remaining.slice(0, entry.index) + remaining.slice(entry.index + entry[0].length);
  }
  return {
    pattern: rule.pattern,
    prefix: rule.indent,
    managed: managed.map(([token]) => token).join(""),
    remaining: remaining.trim() ? rule.indent + rule.pattern + remaining : "",
  };
}

function parseRule(file, content) {
  if (file === "attributes") return lfsRule(content);
  if (content.trim() && !content.startsWith("#")) return { pattern: content };
}

export function gitRules(file, text) {
  return splitFile(text).lines.flatMap(({ content }, index) => {
    const rule = parseRule(file, content);
    return rule ? [{ index, pattern: rule.pattern, shared: !!rule.remaining }] : [];
  });
}

export function validGitPattern(file, pattern) {
  if (!pattern.trim() || /[\0\r\n]/.test(pattern)) return false;
  if (file === "ignore") return pattern !== "!" && !pattern.startsWith("#");
  const rule = attributesRule(pattern);
  return rule?.pattern === pattern && !rule.attributes;
}

export function updateGitRule(file, text, index, pattern) {
  const document = splitFile(text);
  const line = document.lines[index];
  const rule = line && parseRule(file, line.content);
  if (!rule || pattern === rule.pattern || pattern !== null && !validGitPattern(file, pattern)) return text;
  if (pattern === null) {
    if (rule.remaining) line.content = rule.remaining;
    else document.lines.splice(index, 1);
  } else if (file === "ignore") {
    line.content = pattern;
  } else if (rule.remaining) {
    document.lines.splice(index, 1,
      { content: rule.remaining, ending: line.ending || document.eol },
      { content: rule.prefix + pattern + rule.managed, ending: line.ending });
  } else {
    // With no unrelated attributes, preserve the original spelling except the pattern.
    line.content = rule.prefix + pattern + line.content.slice(rule.prefix.length + rule.pattern.length);
  }
  return writeFile(document);
}

export function appendGitRules(file, text, patterns) {
  const additions = patterns.filter(pattern => validGitPattern(file, pattern));
  if (!additions.length) return text;
  const document = splitFile(text);
  const last = document.lines.at(-1);
  const hasFinalEol = !last || !!last.ending;
  if (last && !last.ending) last.ending = document.eol;
  for (const [index, pattern] of additions.entries()) {
    document.lines.push({
      content: file === "ignore" ? pattern : pattern + " " + lfsAttributes.join(" "),
      ending: hasFinalEol || index < additions.length - 1 ? document.eol : "",
    });
  }
  return writeFile(document);
}

export function missingGitDefaults(file, text, defaults = []) {
  const existing = new Set();
  for (const { content } of splitFile(text).lines) {
    if (file === "ignore") {
      const rule = parseRule(file, content);
      if (rule) existing.add(rule.pattern.replace(/^!/, ""));
    } else {
      const rule = attributesRule(content);
      if (rule?.entries.some(([, attribute]) => /^(?:[-!])?filter(?:=|$)/.test(attribute))) {
        existing.add(rule.pattern);
        if (rule.pattern.startsWith('"') && !rule.pattern.includes("\\")) existing.add(rule.pattern.slice(1, -1));
      }
    }
  }
  return [...new Set(defaults)].filter(pattern => validGitPattern(file, pattern) && !existing.has(pattern));
}
