/* This renderer owns presentation only. ESKA supplies metadata, bindings, syntax and every accepted model. */
import { iconElement } from '../../webview/ui/icons.mjs';
import { ConstructorLayout } from './layout.mjs';
import { itemTable } from './items.mjs';
import { expressionTools } from './expression.mjs';
import { predicateForm, emptyPredicate } from './predicates.mjs';
import { modifierForm } from './modifiers.mjs';
import { markedText, mountDialog, textEditor } from './text.mjs';

export function createDesignerController(api, root, changed) {
  const layout = new ConstructorLayout(api, root);
  let errorText = "", renderingPane = false, localRevision = 0, activeSource = "", chosenTable;
  layout.transfer = transfer;
  const basePages = ["tablesFields", "joins", "group", "conditions"];
  let state, totalSection = 0, totalScope = -1, selected = 0, page = layout.page(0), editing, pendingEdit, search = "", chosenField = "";
  let locationSerial=-1;
  const expanded = new Set(layout.preferences.expanded), itemSelections = new Map(), cellDrafts = new Map(), matrixSelections = new Map();

  /** Every intention is bound to the revision actually displayed in this webview. */
  function post(message) {
    const revision=state?.model.revision;
    if (state) {
      layout.capture(); state={...state,busy:true}; root.setAttribute('aria-busy','true'); render(false);
    }
    api.postMessage({revision,...message});
  }

  /** Untrusted names and expressions are always text nodes, never markup. */
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  /** The selected statement controls query spelling independently of the interface locale. */
  function name(value) { return statement()?.russian ? value.russian : value.english; }

  /** Selection is presentation state; the model and its indices come exclusively from ESKA. */
  function statement(kind) {
    const owner = state?.model.statements[selected];
    if (["order", "totals", "totalGroups", "index"].includes(kind) && owner?.scope !== undefined) return state.model.statements[state.model.scopes[owner.scope].result];
    return owner;
  }

  /** Scope edges are supplied by ESKA and keep navigation inside this one modal editor. */
  function navigate(index) { editing = undefined; chosenField = ""; post({ type: "select", statement: index }); }

  /** Eligibility reasons are supplied by the backend for this exact model revision. */
  function unavailable(kind) { const owner = statement(kind); return owner?.append.find(option => option.kind === kind)?.unavailable ?? (owner?.unavailable || null); }

  /** All buttons preserve native busy/paused state, with explicit backend explanations for disabled actions. */
  function button(label, action, reason, className) {
    const node = element("button", label, className); node.type = "button";
    const accessible = label === "↑" ? state.labels.up : label === "↓" ? state.labels.down : label === "+" ? state.labels.add : label;
    node.title = accessible; node.setAttribute("aria-label", accessible);
    const glyph = label === state.labels.editPredicate ? 'edit' : label === state.labels.showInText ? 'locate' : label === state.labels.nested ? 'nested' : label === '+' || label === state.labels.add ? 'add' : label === state.labels.edit ? 'edit' : label === state.labels.remove ? 'remove' : label === '↑' ? 'up' : label === '↓' ? 'down' : label === state.labels.copy ? 'copy' : null;
    if (glyph) { node.replaceChildren(iconElement(glyph)); node.classList.add('eska-icon-button', 'eska-button--quiet'); }
    const child=!!state.preview||!!state.diff||!!editing?.textBuffer,childButton=/^(preview-|text-|diff-)/.test(className??'');
    node.disabled=!!reason||!renderingPane&&(state.busy||state.paused&&!['preview-cancel','text-cancel','diff-close','comments-close'].includes(className)||child&&!childButton);
    if (reason) node.title = `${accessible}: ${state.reasons[reason] ?? reason}`;
    const revision=state.model.revision;node.addEventListener("click",()=>{if(revision===state.model.revision)action();}); return node;
  }

  /** A user intention cannot supply a session, source path or constructor identity. */
  function send(action) {
    if (state.features.totalSections && action.kind === "append" && ["totals", "totalGroups"].includes(action.clause)) {
      const section = activeTotal();
      if (section) action = { kind: "appendTotal", statement: action.statement, section: section.index, clause: action.clause, text: action.text };
    }
    pendingEdit = editing ? structuredClone(editing) : undefined;
    editing = undefined; post({ type: "action", action });
  }

  /** Typed expressions are formatted and validated by ESKA, including language-specific keywords. */
  function compose(expression, selection = null) {
    const kind = expression.kind === "totalField" ? "totals" : ["totalGroup", "overall"].includes(expression.kind) ? "totalGroups" : expression.kind;
    const section = state.features.totalSections && ["totals", "totalGroups"].includes(kind) ? activeTotal() : undefined;
    send({ kind: section ? "composeTotal" : "compose", statement: selection?.statement ?? statement(kind).index, ...(section ? { section: section.index } : {}), selection, expression });
  }

  /** Free expression editing remains available for nodes outside the recognized structured subset. */
  function begin(action, expression, initial = "") {
    editing = { action, expression: expression ? structuredClone(expression) : undefined, initial, raw: !state.visual || !expression }; render();
    if (["virtualSource", "virtualJoin"].includes(expression?.kind) && !new Map(state.metadata.details).has(expression.table)) post({ type: "catalog", table: expression.table });
  }

  /** Empty forms contain values only; their corresponding query syntax is never built in the webview. */
  function blank(kind, expression = chosenField) {
    if (kind === "index") return undefined;
    if (kind === "sources") return { kind: "source", table: "", alias: "" };
    if (kind === "joins") return { kind: "join", table: "", alias: "", join: "left", left: expression, comparison: "equal", right: "" };
    if (kind === "conditions" || kind === "having") return { kind: kind === "having" ? "having" : "condition", left: expression, comparison: "equal", right: "" };
    if (kind === "group") return { kind: "group", expression };
    if (kind === "order") return { kind: "order", expression, descending: false };
    if (kind === "totals") return { kind: "totalField", expression, alias: "", aggregate: "sum" };
    if (kind === "totalGroups") return { kind: "totalGroup", expression, alias: "", hierarchy: "none", period: null };
    return { kind: "field", expression, alias: "", aggregate: null };
  }

  /** Section ownership and clause references come from ESKA; selection is presentation state only. */
  function activeTotal() {
    const owner = statement("totals");
    if (!state.features.totalSections || !owner) return undefined;
    if (totalScope !== owner.scope) { totalScope = owner.scope; totalSection = 0; }
    totalSection = Math.min(totalSection, Math.max(0, owner.totalSections.length - 1));
    return owner.totalSections[totalSection];
  }

  /** A clause row's indices are immutable until the backend returns its next revision. */
  function rows(kind) {
    const owner = statement(kind);
    const section = state.features.totalSections && ["totals", "totalGroups"].includes(kind) ? activeTotal() : undefined;
    return (owner?.clauses ?? []).filter(clause => clause.kind === kind && (!section || clause.index === (kind === "totals" ? section.fields : section.groups))).flatMap(clause => clause.items.map(item => ({
      clause, item, selection: { statement: owner.index, clause: clause.index, item: item.index }
    })));
  }

  /** Create one titled panel without changing the statement model. */
  function panel(title, className) {
    const node = element("section", undefined, className), heading = element("div", undefined, "section-title");
    heading.append(element("h2", title)); node.append(heading); return node;
  }

  /** Row controls operate on backend selections; no SQL token is inspected in this renderer. */
  function controls(row) {
    const { clause, item, selection } = row, l = state.labels, node = element("div", undefined, "controls");
    node.append(button(l.edit, () => begin({ kind: "replace", selection }, item.visual, item.expression ?? ""), item.unavailable.replace));
    node.append(button(l.remove, () => send({ kind: "remove", selection }), item.unavailable.remove));
    for (const child of item.children ?? []) node.append(button(l.editNested, () => navigate(state.model.scopes[child].branches[0]), null, "edit-nested"));
    node.append(button("↑", () => send({ kind: "move", selection, to: item.index - 1 }), item.moveUp === false || item.index === 0 ? "single_item" : item.unavailable.move));
    node.append(button("↓", () => send({ kind: "move", selection, to: item.index + 1 }), item.moveDown === false || item.index + 1 === clause.items.length ? "single_item" : item.unavailable.move));
    return node;
  }

  /** Acknowledged rows remain readable even when their syntax has no structured projection. */
  function list(kind, title, filter) {
    const l = state.labels, node = panel(title), add = button(l.add, () => { const value = blank(kind); if (page === "group" && kind === "fields") value.aggregate = "sum"; begin({ kind: "append", statement: statement(kind).index, clause: kind }, value); }, unavailable(kind), "action-add");
    node.dataset.section = kind; node.querySelector(".section-title").append(add);
    if (kind === "joins" && state.features.nestedQueries) node.querySelector(".section-title").append(button(l.nested, () => begin({ kind: "append", statement: selected, clause: kind }, { kind: "subqueryJoin", alias: "", join: "left", left: chosenField, comparison: "equal", right: "" }), unavailable(kind), "add-nested"));
    if(state.features.predicates&&['conditions','having'].includes(kind))node.querySelector('.section-title').append(button(l.editPredicate,()=>{const clause=statement(kind).clauses.find(clause=>clause.kind===kind);editing={predicate:structuredClone(clause?.predicate??emptyPredicate()),action:{kind:'setPredicate',statement:statement(kind).index,clause:kind,selection:null}};render();},unavailable(kind),'edit-predicate'));
    const entries = rows(kind).filter(row => !filter || filter(row.item));
    if (state.features.bulkItems && !["joins", "conditions", "having"].includes(kind)) { node.append(table(entries, kind)); return node; }
    const tabular = ['joins','conditions','having'].includes(kind);
    const grid = tabular ? element('table',undefined,'clause-table') : undefined, body = tabular ? element('tbody') : node;
    if (grid) {
      grid.setAttribute('aria-label',title);
      const head=element('thead'), line=element('tr');
      for (const label of kind==='joins' ? [l.leftTable,l.rightTable,l.joinKind,l.expression,l.edit] : [l.leftField,l.comparison,l.rightValue,l.edit]) line.append(element('th',label));
      head.append(line);grid.append(head,body);node.append(grid);
    }
    for (const row of entries) {
      const item = element(tabular?'tr':'div',undefined,tabular?'clause-row':'row'), text=element('pre',row.item.preview), commands=controls(row);
      text.title=row.item.preview;
      if (kind==='joins') {
        const relation=row.clause.join;
        item.append(element('td',relation?.left.join(', ')??''),element('td',relation?.right??''));
        const type=element('td');
        if (relation) {
          const picker=element('select');picker.name='joinKind';picker.setAttribute('aria-label',l.joinKind);
          for (const kind of ['inner','left','right','full']) { const option=element('option',l[kind]);option.value=kind;picker.append(option); }
          picker.value=relation.kind;picker.disabled=!state.model.writable;
          picker.addEventListener('change',()=>send({kind:'setJoinKind',selection:row.selection,join:picker.value}));type.append(picker);
        }
        const preview=element('td');preview.append(text);item.append(type,preview);
        if(state.features.predicates)commands.append(button(l.editPredicate,()=>{editing={predicate:structuredClone(row.clause.predicate??emptyPredicate()),action:{kind:'setPredicate',statement:row.selection.statement,clause:'joins',selection:row.selection}};render();},row.item.unavailable.replace,'edit-predicate'));
      } else if (tabular) {
        const value=row.item.visual;
        if (value && ['condition','having'].includes(value.kind)) {
          for (const valueText of [value.left,new Map(comparisonOptions()).get(value.comparison),value.right]) item.append(element('td',valueText,'eska-code'));
        } else { const preview=element('td');preview.colSpan=3;preview.append(text);item.append(preview); }
        if(state.features.predicates)commands.append(button(kind==='conditions'?l.moveHaving:l.moveWhere,()=>send({kind:'movePredicate',selection:row.selection,target:kind==='conditions'?'having':'conditions'}),row.item.unavailable.remove,'move-predicate'));
      } else item.append(text);
      const actions=tabular?element('td'):item;actions.append(commands);if(tabular)item.append(actions);body.append(item);
    }
    if (!entries.length) node.append(element("p", l.noRows, "empty"));
    return node;
  }

  /** This component stores selection only; the backend returns the resulting identities. */
  function table(entries, kind) {
    const key = entries.length ? `${entries[0].selection.statement}:${entries[0].selection.clause}` : '', selection = itemSelections.get(key) ?? { items: [], anchor: -1 };
    return itemTable(entries, { element, button, cells: cellDrafts, reasonLabel: reason => state.reasons[reason] ?? reason, labels: state.labels, selected: selection.items, anchor: selection.anchor,
      writable: state.model.writable && !state.paused, busy: state.busy, simple: page === "tablesFields" && state.features.unions, kind,
      choose: (items, anchor = selection.anchor, redraw = true) => { itemSelections.set(key, {items, anchor}); if(redraw)render();else layout.grid();const row=entries.find(row=>row.item.index===anchor);if(row&&layout.preferences.previewOpen&&state.features.linkedText)post({type:'locate',target:{kind:'item',selection:row.selection},navigate:false}); },
      locate: row => post({type:'locate',target:{kind:'item',selection:row.selection},navigate:false}),
      comments: row => post({type:'comments',selection:row.selection}), linkedText:state.features.linkedText,
      run: (operation, items = selection.items) => { if(entries.length)send({kind:'editItems', statement:entries[0].selection.statement, clause:entries[0].selection.clause, items, operation}); },
      edit: row => begin({kind:'replace',selection:row.selection},row.item.visual,row.item.expression??''), compose,
      navigate: child => navigate(state.model.scopes[child].branches[0]) });
  }

  /** Transfer strips reuse checked actions; table/field highlights are presentation state only. */
  function transfer(left, right) {
    if (page !== 'tablesFields') return undefined;
    const l = state.labels, strip = element('div', undefined, 'pane-transfer eska-toolbar');
    strip.setAttribute('role', 'toolbar'); strip.setAttribute('aria-label', l.selection);
    if (left.classList.contains('database')) {
      strip.append(button('›', () => chooseTable(chosenTable), !chosenTable ? 'single_item' : unavailable('sources'), 'transfer-add-table'));
      const row = [...rows('sources'), ...rows('joins')].find(row => `${row.selection.clause}:${row.selection.item}` === activeSource);
      strip.append(button('‹', () => send({kind:'remove',selection:row.selection}), row?.item.unavailable.remove ?? (!row ? 'single_item' : null), 'transfer-remove-table'));
    } else if (right.dataset.section === 'fields') {
      strip.append(button('›', () => compose(blank('fields')), !chosenField ? 'single_item' : unavailable('fields'), 'transfer-add-field'));
      const source = state.metadata.fields.find(source => `${source.clause}:${source.item}` === activeSource);
      if (source?.fields.length) strip.append(button('»', () => send({kind:'appendFields',statement:selected,fields:source.fields.map(name)}), source.fields.length > 512 ? 'model_limit' : unavailable('fields'), 'transfer-add-fields'));
      const entries = rows('fields'), key = entries.length ? `${entries[0].selection.statement}:${entries[0].selection.clause}` : '', items = itemSelections.get(key)?.items ?? [];
      const reason = !items.length ? 'single_item' : entries.filter(row => items.includes(row.item.index)).map(row => row.item.unavailable.remove).find(Boolean);
      strip.append(button('‹', () => send({kind:'editItems',statement:entries[0].selection.statement,clause:entries[0].selection.clause,items,operation:{kind:'remove'}}), reason, 'transfer-remove-field'));
    }
    for (const control of strip.children) {
      const remove = control.textContent === '‹';
      control.setAttribute('aria-label', remove ? l.remove : control.textContent === '»' ? l.allFields : l.add);
      control.title = control.getAttribute('aria-label');
    }
    return strip.children.length ? strip : undefined;
  }

  /** A virtual table selection opens positional value controls; ESKA builds the eventual call. */
  function chooseTable(table) {
    const path = name(table);
    if (!table.virtualTable) { compose({ kind: "source", table: path, alias: "" }); return; }
    begin({ kind: "append", statement: selected, clause: "sources" }, { kind: "virtualSource", table: path, alias: "", parameters: [] });
  }

  /** Database tables are paged by ESKA; only explicitly expanded descriptors are requested. */
  function database() {
    const l = state.labels, node = panel(l.database, "database"), toolbar = element("form", undefined, "search");
    const input = element("input"); input.name = "catalogSearch"; input.type = "search"; input.value = search; input.placeholder = l.search; input.setAttribute("aria-label", l.search);
    input.addEventListener("input", () => { search = input.value; });
    toolbar.append(input, button(l.find, () => post({ type: "catalog", search, offset: 0 })));
    toolbar.addEventListener("submit", event => { event.preventDefault(); if (!state.busy) post({ type: "catalog", search, offset: 0 }); }); node.append(toolbar);
    if (!state.visual) { node.append(element("p", l.metadataUnavailable, "notice")); return node; }
    if (state.metadata.failed) node.append(element("p", l.metadataFailed, "error"));
    const catalog = state.metadata.catalog, groups = new Map();
    for (const table of [...catalog?.tables ?? [], ...(catalog?.temporaryTables ?? []).map(table => ({ ...table, category: "TemporaryTable", russian: table.name, english: table.name, alias: table.name }))]) {
      if (!groups.has(table.category)) groups.set(table.category, []);
      groups.get(table.category).push(table);
    }
    const details = new Map(state.metadata.details);
    for (const [category, tables] of groups) {
      const group = element("details", undefined, "metadata-group"); group.open = true;
      group.dataset.category = category;
      group.append(element("summary", l[`category${category}`] ?? category));
      for (const table of tables) {
        const row = element("div", undefined, "metadata-table"), path = name(table);
        const expand = button(expanded.has(path) ? "▾" : "▸", () => {
          if (expanded.has(path)) { expanded.delete(path); render(); }
          else { expanded.add(path); if (!details.has(path)) post({ type: "catalog", table: path }); else render(); }
          layout.preferences.expanded = [...expanded]; layout.save();
        }); expand.title = `${l.toggleTable} ${table.name}`; expand.setAttribute("aria-label", expand.title);
        const label = button(table.name, () => { chosenTable = table;
          for (const other of node.querySelectorAll(".table-name")) other.setAttribute("aria-selected", String(other === label));
          layout.grid();
        }, null, "table-name eska-tree-item");
        label.setAttribute("aria-selected", String(chosenTable && name(chosenTable) === path)); label.title = path;
        label.addEventListener("dblclick", () => { if (!label.disabled && !unavailable("sources")) chooseTable(table); });
        const add = button("+", () => chooseTable(table), unavailable("sources"), "table-add"); add.setAttribute("aria-label", `${l.add} ${table.name}`);
        row.append(expand, label, add); group.append(row);
        if (expanded.has(path) && state.features.addSourceFields && !table.virtualTable) for (const field of details.get(path)?.fields ?? []) {
          const pick = button(`${l.addSourceField} · ${name(field)}`, () => send({kind:'addSourceFields',statement:selected,source:{kind:'source',table:path,alias:''},fields:[name(field)]}), unavailable('fields') || unavailable('sources'), 'add-source-field'); group.append(pick);
        }
        if (expanded.has(path)) for (const child of details.get(path)?.tables ?? []) {
          const childButton = button(child.name, () => chooseTable(child), unavailable("sources"), "tabular-section");
          childButton.title = name(child); childButton.dataset.table = name(child); group.append(childButton);
        }
      }
      node.append(group);
    }
    if (!catalog?.tables.length && !catalog?.temporaryTables?.length && !state.busy) node.append(element("p", l.noTables, "empty"));
    if (catalog?.nextOffset !== null && catalog?.nextOffset !== undefined) node.append(button(l.more,
      () => post({ type: "catalog", search, offset: catalog.nextOffset })));
    if (catalog?.limitedContext) node.append(element("p", l.limitedContext, "notice"));
    return node;
  }

  /** Source trees share already qualified field choices from the backend. */
  function sourceFields(choose) {
    const l = state.labels, node = panel(l.tables, "source-fields");
    for (const source of state.metadata.fields) {
      const tree = element("details", undefined, "source-tree"); tree.open = source.loaded;
      tree.dataset.source = source.alias;
      tree.addEventListener("toggle", () => { if (tree.open && !source.loaded && !state.busy) post({ type: "fields", table: source.table, alias: source.alias, clause: source.clause, item: source.item }); });
      tree.append(element("summary", source.alias), element("small", source.table));
      if(state.features.packageTree&&source.temporaryDefinition!==null&&source.temporaryDefinition!==undefined)tree.append(button(l.openDefinition,()=>navigate(source.temporaryDefinition),null,'temporary-definition'));
      if (choose === "fields" && source.fields.length) {
        tree.append(button(l.allFields, () => send({ kind: "appendFields", statement: selected, fields: source.fields.map(name) }),
          source.fields.length > 512 ? "model_limit" : unavailable("fields"), "all-fields"));
      }
      for (const field of source.fields) {
        const value = name(field), pick = button(value, () => { chosenField = value;
          for (const other of root.querySelectorAll(".field-choice")) other.setAttribute("aria-selected", String(other === pick));
          layout.grid();
        }, unavailable(choose === "fields" ? "fields" : choose), "field-choice eska-tree-item");
        pick.setAttribute("aria-selected", String(chosenField === value));
        pick.addEventListener("dblclick", () => {
          if (pick.disabled) return;
          chosenField = value;
          if (choose === "fields" || choose === "group") compose(blank(choose, value));
          else begin({ kind: "append", statement: selected, clause: choose }, blank(choose, value));
        }); tree.append(pick);
      }
      if (!source.found || !source.fields.length) tree.append(element("p", l.noFields, "empty"));
      node.append(tree);
    }
    if (!state.metadata.fields.length) node.append(element("p", l.noFields, "empty"));
    return node;
  }

  /** Table properties and metadata field trees stay together, as in a query wizard's middle pane. */
  function sources() {
    const node = sourceFields('fields'), l = state.labels, choices = [...rows('sources'), ...rows('joins')];
    const key = row => `${row.selection.clause}:${row.selection.item}`;
    if (!choices.some(row => key(row) === activeSource)) activeSource = choices[0] ? key(choices[0]) : '';
    const selectedRow = () => choices.find(row => key(row) === activeSource);
    const toolbar = element('div', undefined, 'source-toolbar eska-toolbar');
    const editable = operation => !selectedRow() ? 'single_item' : selectedRow().item.unavailable[operation];
    const edit = button(l.edit, () => { const row = selectedRow(); begin({kind:'replace',selection:row.selection},row.item.visual,row.item.expression??''); }, editable('replace'));
    const remove = button(l.remove, () => send({kind:'remove',selection:selectedRow().selection}), editable('remove'));
    toolbar.append(edit, remove,
      button(l.add, () => begin({kind:'append',statement:selected,clause:'sources'},blank('sources')),unavailable('sources')));
    if (state.features.nestedQueries) toolbar.append(button(l.nested, () => compose({kind:'subquerySource',alias:''}),unavailable('sources'),'add-nested'));
    node.querySelector('.section-title').append(toolbar);
    for (const row of choices) {
      const represented = state.metadata.fields.some(source => source.clause === row.selection.clause && source.item === row.selection.item);
      if (represented) continue;
      const tree = element('details', undefined, 'source-tree'); tree.dataset.clause = String(row.selection.clause); tree.dataset.item = String(row.selection.item);
      tree.append(element('summary',row.item.preview)); node.append(tree);
    }
    for (const tree of node.querySelectorAll('.source-tree')) {
      const source = state.metadata.fields.find(source => source.alias === tree.dataset.source);
      const row = choices.find(row => source ? row.selection.clause === source.clause && row.selection.item === source.item : String(row.selection.clause) === tree.dataset.clause && String(row.selection.item) === tree.dataset.item);
      if (!row) continue;
      for (const child of row.item.children ?? []) tree.append(button(l.editNested, () => navigate(state.model.scopes[child].branches[0]), null, 'edit-nested'));
      const summary = tree.querySelector('summary'); summary.classList.toggle('source-selected', key(row) === activeSource);
      summary.addEventListener('click', () => {
        activeSource = key(row); layout.grid();
        for (const other of node.querySelectorAll('summary')) other.classList.toggle('source-selected', other === summary);
        edit.disabled = !!editable('replace'); remove.disabled = !!editable('remove');
      });
      summary.addEventListener('dblclick', () => { if (!editable('replace')) { activeSource = key(row); begin({kind:'replace',selection:row.selection},row.item.visual,row.item.expression??''); } });
    }
    return node;
  }

  /** Result aliases and wildcard expansion are resolved by ESKA for the scope, independently of its selected branch. */
  function resultFields(kind) {
    const l = state.labels, node = panel(l.selectedFields, "result-fields");
    for (const field of state.metadata.resultFields) {
      const value = name(field), pick = button(value, () => { chosenField = value;
          for (const other of root.querySelectorAll(".field-choice")) other.setAttribute("aria-selected", String(other === pick));
          layout.grid();
        }, unavailable(kind), "field-choice eska-tree-item");
        pick.setAttribute("aria-selected", String(chosenField === value));
      pick.addEventListener("dblclick", () => { if (!pick.disabled) begin({ kind: "append", statement: statement(kind).index, clause: kind }, blank(kind, value)); }); node.append(pick);
    }
    if (!state.metadata.resultFields.length) node.append(element("p", l.noFields, "empty"));
    return node;
  }

  /** Branch controls only pass ESKA's statement identities and an explicit duplicate policy. */
  function unions() {
    const l = state.labels, node = panel(l.unions, "union-branches"), scope = state.model.scopes[statement().scope];
    node.querySelector(".section-title").append(button(l.addUnion, () => send({ kind: "addUnion", statement: selected, all: true }), statement().unavailable, "add-union"));
    const matrix=state.features.unionMatrix&&state.model.statements[scope.branches[0]].unionMatrix;
    if(matrix){
      const chosen=matrixSelections.get(matrix.scope)??0, selection=matrix.columns[chosen]?.cells.find(Boolean), toolbar=node.querySelector('.section-title');
      const preview=action=>post({type:'preview',action});
      toolbar.append(button(l.alignUnion,()=>preview({kind:'alignUnion',statement:selected}),matrix.canAlign&&!state.busy?null:'unsupported','align-union'));
      for(const [label,to] of [['↑',chosen-1],['↓',chosen+2]])toolbar.append(button(label,()=>preview({kind:'editItems',statement:selection.statement,clause:selection.clause,items:[selection.item],operation:{kind:'move',to}}),!selection||chosen===0&&to<0||to>matrix.columns.length||matrix.canAlign?'unsupported':null,'matrix-move'));
      const table=element('table',undefined,'union-matrix'), head=element('tr');head.append(element('th',l.alias));
      for(const id of matrix.branches)head.append(element('th',`${l.branch} ${state.model.statements[id].branch+1}`));table.append(head);
      for(const column of matrix.columns){
        const row=element('tr');row.dataset.column=String(column.index);row.setAttribute('aria-selected',String(chosen===column.index));
        const name=element('td'),pick=button(column.alias??String(column.index+1),()=>{matrixSelections.set(matrix.scope,column.index);render();},null,'matrix-column');name.append(pick);row.append(name);
        for(const cell of column.cells){const td=element('td');if(cell){const item=state.model.statements[cell.statement].clauses[cell.clause].items[cell.item];td.append(button(item.preview,()=>begin({kind:'replace',selection:cell},item.visual,item.expression??''),item.unavailable.replace,'matrix-cell'));}else td.append(element('span','—'));row.append(td);}table.append(row);
      }
      node.append(table);
    }
    for (const [index, id] of scope.branches.entries()) {
      const owner = state.model.statements[id], row = element("div", undefined, "row"); row.dataset.branch = String(id);
      row.append(button(`${l.branch} ${index + 1}`, () => navigate(id)), element("pre", owner.columns.join(", ")));
      if (index) {
        const policy = select(row, l.unions, "all", { all: scope.unions[index - 1].all ? "yes" : "no" }, [["yes", l.unionAll], ["no", l.unionDistinct]]);
        policy.disabled ||= state.paused || !state.model.writable || !!owner.unavailable;
        policy.addEventListener("change", () => send({ kind: "setUnion", statement: id, all: policy.value === "yes" }));
      }
      if (scope.branches.length > 1) row.append(button(l.remove, () => send({ kind: "removeUnion", statement: id }), !state.model.writable ? "read_only" : owner.unavailable, "remove-union"));
      node.append(row);
    }
    return node;
  }

  /** Package controls transmit destinations and operator intentions; ESKA owns lifetimes, dependencies and syntax. */
  function packages() {
    const l = state.labels, node = panel(l.packages, "package-settings"), owner = statement(), permissions = owner.package;
    if (!permissions) return node;
    node.querySelector(".section-title").append(button(l.addStatement, () => send({ kind: "addStatement", statement: selected, operation: "select", name: null }), !permissions.add ? "unsupported" : null, "add-statement"));
    for (const scope of state.model.scopes.filter(scope => scope.parent === null)) {
      const value = state.model.statements[scope.branches[0]], row = element("div", undefined, "row"), controls = value.package;
      row.append(button(`${l.statement} ${controls.position + 1}`, () => navigate(value.index)), element("pre", value.preview));
      if(state.features.copyStatement)row.append(button(l.copy,()=>post({type:'preview',action:{kind:'copyStatement',statement:value.index}}),controls.copy?null:'unsupported','copy-statement'));
      row.append(button(l.remove, () => send({ kind: "removeStatement", statement: value.index }), !controls.remove ? "required_item" : null, "remove-statement"));
      for (const [key, label] of [["moveUp", "↑"], ["moveDown", "↓"]]) row.append(button(label, () => send({ kind: "moveStatement", statement: value.index, to: controls[key] }), controls[key] === null ? "unsupported" : null));
      node.append(row);
      if(state.features.packageTree)node.append(packageChildren(scope));
    }
    if (permissions.operation === "select") {
      const form = element("form", undefined, "temporary-destination"), value = { name: permissions.destination ?? "" };
      input(form, l.destination, "name", value, { required: false });
      const submit = button(l.setDestination, () => {}, !permissions.setInto ? "unsupported" : null, "set-destination"); submit.type = "submit";
      form.addEventListener("submit", event => { event.preventDefault(); if (!state.busy && !state.paused && form.reportValidity()) send({ kind: "setInto", statement: selected, name: value.name.trim() || null }); });
      form.append(submit); node.append(form, list("index", l.index));
    }
    if (permissions.operation === "destroy") node.append(list("destroy", l.destroyTable));
    const drop = element("form", undefined, "temporary-drop"), value = { name: permissions.destination ?? state.metadata.catalog?.temporaryTables?.[0]?.name ?? "" };
    input(drop, l.temporaryTable, "dropName", { dropName: value.name });
    const submit = button(l.destroyTable, () => {}, !permissions.add ? "unsupported" : null, "add-destroy"); submit.type = "submit";
    drop.addEventListener("submit", event => { event.preventDefault(); if (!state.busy && !state.paused && drop.reportValidity()) send({ kind: "addStatement", statement: selected, operation: "destroy", name: drop.querySelector("input").value }); });
    drop.append(submit); node.append(drop); return node;
  }

  /** ESKA supplies the scope graph; this tree follows edges without reconstructing query ownership. */
  function packageChildren(scope){
    const list=element('ul',undefined,'package-tree');
    for(const id of scope.branches){
      const owner=state.model.statements[id],row=element('li');
      row.append(button(`${state.labels.branch} ${owner.branch+1} · ${owner.preview.slice(0,70)}`,()=>navigate(id),null,'tree-branch'));
      for(const child of state.model.scopes.filter(child=>child.parent===id)){const nested=element('details');nested.dataset.scope=String(child.index);nested.open=true;nested.append(element('summary',state.labels.nested),packageChildren(child));row.append(nested);}
      list.append(row);
    }
    return list;
  }

  /** Overall totals and ordinary groups share one backend-owned section. */
  function totals() {
    const l = state.labels, node = element("div", undefined, "total-settings"), groups = list("totalGroups", l.totalGroups);
    const overall = rows("totalGroups").find(row => row.item.visual?.kind === "overall");
    groups.querySelector(".section-title").append(button(l.overall, () => overall ? send({ kind: "remove", selection: overall.selection }) : compose({ kind: "overall" }), unavailable("totalGroups"), "overall"));
    groups.querySelector(".overall").setAttribute("aria-pressed", String(!!overall));
    const fields = list("totals", l.aggregateFields);
    const section = activeTotal(), owner = statement("totals"), clause = section ? owner.clauses[section.fields] : owner.clauses.find(clause => clause.kind === "totals");
    if (clause && !clause.items.length) fields.append(element("p", l.autoTotals, "notice"));
    if (state.features.totalSections) {
      const toolbar = panel(l.totalSection, "total-sections");
      if (owner.totalSections.length) {
        const picker = select(toolbar, l.totalSection, "totalSection", { totalSection: String(totalSection) }, owner.totalSections.map(value => [String(value.index), `${l.totalSection} ${value.index + 1}`]));
        picker.addEventListener("change", () => { totalSection = Number(picker.value); editing = undefined; render(); });
      }
      toolbar.append(button(l.addTotalSection, () => send({ kind: "addTotals", statement: owner.index, after: section?.index ?? null }), !owner.addTotals ? "unsupported" : null, "add-total-section"));
      if (section) {
        toolbar.append(button(l.remove, () => send({ kind: "removeTotals", statement: owner.index, section: section.index }), !section.remove ? "unsupported" : null, "remove-total-section"));
        for (const [key, label] of [["moveUp", "↑"], ["moveDown", "↓"]].filter(([key]) => section[key] !== null)) toolbar.append(button(label, () => send({ kind: "moveTotals", statement: owner.index, section: section.index, to: section[key] }), section[key] === null ? "unsupported" : null, `total-section-${key}`));
      }
      node.append(toolbar);
    }
    node.append(fields, groups); return node;
  }

  /** DCS positions, previews and permissions are projected by ESKA over the canonical query. */
  function dcs() {
    const l = state.labels, view = statement().dcs, node = panel(l.dcs, "dcs-settings");
    node.append(element("p", l.dcsNotice, "notice"));
    for (const [target, allowed] of [["select", view.addSelect], ["where", view.addWhere]]) {
      node.append(button(l.add + " · " + l[`dcs${target[0].toUpperCase()}${target.slice(1)}`], () => {
        editing = { dcs: { node: null, target, enabled: true, values: [{ kind: "field", expression: "", children: false, alias: "" }] } }; render();
      }, !allowed ? "unsupported" : null, `dcs-add-${target}`));
    }
    for (const value of view.nodes) {
      const row = element("div", undefined, "row dcs-node"); row.dataset.kind = value.kind; row.dataset.index = String(value.index);
      row.append(element("h3", l[`dcs${value.kind[0].toUpperCase()}${value.kind.slice(1)}`]), element("pre", value.preview));
      const reason = !value.editable || !state.model.writable ? "unsupported" : null;
      if (value.kind === "optionalSource") row.append(button(l.dcsEnabled, () => send({ kind: "setDcs", statement: selected, node: value.index, target: value.kind, values: [], enabled: !value.enabled }), reason, "dcs-toggle"));
      else row.append(button(l.edit, () => { editing = { dcs: { node: value.index, target: value.kind, values: structuredClone(value.values), enabled: true } }; render(); }, reason, "dcs-edit"));
      if (value.enabled && ["select", "where", "virtualFilter"].includes(value.kind)) row.append(button(l.remove, () => send({ kind: "setDcs", statement: selected, node: value.index, target: value.kind, values: [], enabled: false }), reason, "dcs-remove"));
      if (value.kind === "optionalSource") row.lastChild.setAttribute("aria-pressed", String(value.enabled));
      node.append(row);
    }
    return node;
  }

  /** Lists are edited as typed values; no braces, separators or query keywords are generated in the renderer. */
  function dcsForm() {
    const l = state.labels, value = editing.dcs, form = element("form", undefined, "expression dcs-expression");
    form.append(element("h2", l[`dcs${value.target[0].toUpperCase()}${value.target.slice(1)}`]));
    if (value.target === "parameter") {
      input(form, l.parameters, "name", value.values[0]);
      const label = element("label", l.dcsEnabled), check = element("input"); check.type = "checkbox"; check.name = "enabled"; check.checked = value.enabled;
      check.addEventListener("change", () => { value.enabled = check.checked; }); label.append(check); form.append(label);
    } else {
      for (const [index, entry] of value.values.entries()) {
        const row = element("fieldset"); row.dataset.value = String(index);
        if (entry.kind === "condition") condition(row, entry, false);
        else {
          input(row, l.expression, "expression", entry);
          if (value.target !== "select") input(row, l.alias, "alias", entry, { required: false });
          const label = element("label", l.dcsChildren), check = element("input"); check.type = "checkbox"; check.name = "children"; check.checked = entry.children;
          check.addEventListener("change", () => { entry.children = check.checked; }); label.append(check); row.append(label);
        }
        row.append(button(l.remove, () => { value.values.splice(index, 1); render(); })); form.append(row);
      }
      form.append(button(l.add + " · " + l.fields, () => { value.values.push({ kind: "field", expression: "", children: false, alias: "" }); render(); }, value.values.length >= 128 ? "model_limit" : null, "dcs-add-field"));
      if (value.target !== "select") form.append(button(l.add + " · " + l.conditions, () => { value.values.push({ kind: "condition", left: "", comparison: "equal", right: "" }); render(); }, value.values.length >= 128 ? "model_limit" : null, "dcs-add-condition"));
    }
    const accept = button(l.submit, () => {}); accept.type = "submit"; accept.dataset.action = "submit";
    form.addEventListener("submit", event => { event.preventDefault(); if (!state.busy && !state.paused && form.reportValidity()) send({ kind: "setDcs", statement: selected, ...structuredClone(value) }); });
    form.append(accept, button(l.close, () => { editing = undefined; render(); })); root.append(form);
  }

  /** Pages group domain clauses and scopes; selecting a page never changes query text. */
  function renderPage(container) {
    const l = state.labels;
    if (page === "dcs") { container.append(dcs()); }
    else if (page === "packages") { container.append(packages()); }
    else if (page === "tablesFields") {
      container.classList.add("three-panes"); container.append(database(), sources(), list("fields", l.selectedFields));
    } else if (page === "joins") {
      container.append(list("joins", l.joins));
    } else if (page === "group") {
      container.classList.add("two-panes"); const groups = element("div", undefined, "group-settings"); groups.append(list("group", l.groupFields), list("fields", l.aggregateFields, item => !!item.visual?.aggregate));
      container.append(sourceFields("group"), groups);
    } else if (page === "conditions") {
      const filters = element("div", undefined, "filter-settings"); filters.append(list("conditions", l.conditions));
      if (state.features.having) filters.append(list("having", l.having));
      container.classList.add("two-panes"); container.append(sourceFields("conditions"), filters);
    } else if (page === "order") {
      container.classList.add("two-panes"); container.append(state.features.totals ? resultFields("order") : sourceFields("order"), list("order", l.order));
    } else if (page === "unions") container.append(unions());
    else if (page === "totals") {
      container.classList.add("two-panes"); container.append(resultFields("totalGroups"), totals());
    }
  }

  /** Input values persist across busy model publications without becoming a second query document. */
  function input(form, label, key, data, options = {}) {
    const wrapper = element("label", label), node = element("input"); node.name = key; node.value = data[key] ?? "";
    node.required = options.required !== false; node.disabled = state.busy; node.maxLength = state.maxExpression;
    if (options.list) node.setAttribute("list", options.list);
    node.addEventListener("input", () => { data[key] = node.value; }); wrapper.append(node); form.append(wrapper); return node;
  }

  /** Select values are stable enum identifiers, never generated query keywords. */
  function select(form, label, key, data, options) {
    const wrapper = element("label", label), node = element("select"); node.name = key; node.disabled = state.busy;
    for (const [value, text] of options) { const item = element("option", text); item.value = value; node.append(item); }
    node.value = data[key] ?? ""; node.addEventListener("change", () => { data[key] = node.value; }); wrapper.append(node); form.append(wrapper); return node;
  }

  /** Populate datalists with core-provided choices while preserving manual expressions for complex cases. */
  function choices(form) {
    const fields = element("datalist"); fields.id = "query-fields";
    const values = ["order", "totalField", "totalGroup"].includes(editing?.expression?.kind) ? state.metadata.resultFields : state.metadata.fields.flatMap(source => source.fields);
    for (const field of values) { const option = element("option"); option.value = name(field); fields.append(option); }
    const tables = element("datalist"); tables.id = "query-tables";
    for (const table of state.metadata.catalog?.tables ?? []) { const option = element("option"); option.value = name(table); tables.append(option); }
    for (const [, detail] of state.metadata.details) for (const table of detail.tables) { const option = element("option"); option.value = name(table); tables.append(option); }
    const joined = element("datalist"); joined.id = "query-join-fields";
    for (const field of new Map(state.metadata.details).get(editing?.expression?.table)?.fields ?? []) { const option = element("option"); option.value = name(field); joined.append(option); }
    form.append(fields, tables, joined);
  }

  /** Parameter descriptors and keyword spellings come from the backend; empty positional values remain distinct. */
  function parameters(form, value) {
    const l = state.labels, detail = new Map(state.metadata.details).get(value.table);
    form.append(element("h3", l.parameters));
    if (!detail) return;
    if (!detail.parameters?.length) form.append(element("p", l.noParameters, "notice"));
    const table=element('table',undefined,'virtual-parameters');
    for (const [index, parameter] of (detail.parameters ?? []).entries()) {
      const row=element('tr'),position=element('td',String(index+1)),cell=element('td');row.append(position,cell);table.append(row);
      const data = { value: value.parameters[index] ?? "" }, list = `parameter-choices-${index}`;
      const node = input(cell, l[`parameter${parameter.key[0].toUpperCase()}${parameter.key.slice(1)}`] ?? parameter.key, `parameter-${index}`, { [`parameter-${index}`]: data.value }, { required: parameter.required, list });
      node.addEventListener("input", () => { while (value.parameters.length <= index) value.parameters.push(""); value.parameters[index] = node.value; });
      const choices = element("datalist"); choices.id = list;
      for (const choice of parameter.choices ?? []) { const option = element("option"); option.value = name(choice); choices.append(option); } cell.append(choices);
    }
    form.append(table);
  }

  /** Hierarchy and period options remain enum/value DTOs; ESKA enforces their mutual exclusion. */
  function totalGroup(form, value) {
    const l = state.labels;
    input(form, l.alias, "alias", value, { required: false });
    const hierarchy = select(form, l.hierarchy, "hierarchy", value, [["none", l.noHierarchy], ["hierarchy", l.hierarchy], ["onlyHierarchy", l.onlyHierarchy]]);
    hierarchy.addEventListener("change", () => { if (value.hierarchy !== "none") value.period = null; render(); });
    const units = ["second", "minute", "hour", "day", "week", "tenDays", "month", "quarter", "halfYear", "year"];
    const unit = select(form, l.periods, "periodUnit", { periodUnit: value.period?.unit ?? "" }, [["", l.noPeriods], ...units.map(unit => [unit, l[unit]])]);
    unit.disabled ||= value.hierarchy !== "none";
    unit.addEventListener("change", () => { value.period = unit.value ? { unit: unit.value, begin: value.period?.begin ?? null, end: value.period?.end ?? null } : null; render(); });
    if (value.period) {
      for (const [key, label] of [["begin", l.periodBegin], ["end", l.periodEnd]]) {
        const node = input(form, label, key, value.period, { required: false }); node.addEventListener("input", () => { value.period[key] = node.value || null; });
      }
    }
  }

  /** Display labels for typed operators are shared by the grid and the input form. */
  function comparisonOptions() {
    const l=state.labels;
    return [['equal','='],['notEqual','<>'],['less','<'],['lessOrEqual','<='],['greater','>'],['greaterOrEqual','>='],['like',l.comparisonLike],['in',l.comparisonIn],['inHierarchy',l.comparisonInHierarchy]];
  }

  /** A condition editor separates operands and operator without assembling any SQL in JavaScript. */
  function condition(form, expression, join) {
    const l = state.labels;
    input(form, l.leftField, "left", expression, { list: "query-fields" });
    select(form, l.comparison, "comparison", expression, comparisonOptions());
    input(form, join ? l.rightField : l.rightValue, "right", expression, { list: join ? "query-join-fields" : "query-fields" });
  }

  /** Structured controls edit source, field, join, condition, grouping and order values through one common backend action. */
  function visualForm(form) {
    const l = state.labels, value = editing.expression; choices(form);
    if (["source", "join", "virtualSource", "virtualJoin"].includes(value.kind)) {
      const table = input(form, l.tables, "table", value, { list: "query-tables" });
      form.append(button(l.find, () => post({ type: "catalog", search: table.value, offset: 0 })));
      table.addEventListener("change", () => { post({ type: "catalog", table: table.value }); });
    }
    if (["source", "join", "virtualSource", "virtualJoin", "subquerySource", "subqueryJoin"].includes(value.kind)) input(form, l.alias, "alias", value, { required: false });
    if (["source", "join"].includes(value.kind) && new Map(state.metadata.details).get(value.table)?.parameters?.length) { value.kind = value.kind === "join" ? "virtualJoin" : "virtualSource"; value.parameters = []; }
    if (["virtualSource", "virtualJoin"].includes(value.kind)) parameters(form, value);
    if (["field", "group", "order", "totalField", "totalGroup"].includes(value.kind)) input(form, l.expression, "expression", value, { list: "query-fields" });
    if (["field", "totalField"].includes(value.kind)) {
      input(form, l.alias, "alias", value, { required: false });
      select(form, l.aggregate, "aggregate", value, [["", l.noAggregate], ["sum", l.sum], ["count", l.count], ["minimum", l.minimum], ["maximum", l.maximum], ["average", l.average]]);
    }
    if (["join", "virtualJoin", "subqueryJoin"].includes(value.kind)) select(form, l.joins, "join", value, [["inner", l.inner], ["left", l.left], ["right", l.right], ["full", l.full]]);
    if (["join", "virtualJoin", "subqueryJoin", "condition", "having"].includes(value.kind)) condition(form, value, !(["condition", "having"].includes(value.kind)));
    if (value.kind === "totalGroup") totalGroup(form, value);
    if (value.kind === "order") {
      const node = select(form, l.direction, "descending", { descending: value.descending ? "yes" : "no" }, [["no", l.ascending], ["yes", l.descending]]);
      node.addEventListener("change", () => { value.descending = node.value === "yes"; });
    }
  }

  /** Expression mode is an explicit escape hatch; switching modes never reparses text in the renderer. */
  function renderEditor() {
    if(editing.textBuffer){
      const dialog=textEditor(editing.textBuffer,{element,button,labels:state.labels,maxBytes:state.features.maxTextBytes,busy:state.busy,
        close:()=>{editing=undefined;render();},submit:(text,revision)=>post({type:'preview',revision,action:{kind:'setText',text,editorNormalized:true}})});
      mountDialog(root,dialog,()=>{editing=undefined;render();});return;
    }
    if(editing.modifiers){
      const form=element('form',undefined,'expression modifier-expression');form.append(element('h2',state.labels.settings));
      modifierForm(form,editing.modifiers,{element,button,labels:state.labels,close:()=>{editing=undefined;render();},submit:modifiers=>post({type:'preview',action:{kind:'setModifiers',statement:selected,modifiers}})});root.append(form);return;
    }
    if(editing.predicate){
      const form=element('form',undefined,'expression predicate-expression');
      predicateForm(form,editing.predicate,{element,button,input,select,labels:state.labels,draw:render,update:value=>{editing.predicate=value;}});
      const accept=button(state.labels.submit,()=>{});accept.type='submit';form.append(accept,button(state.labels.close,()=>{editing=undefined;render();}));
      form.addEventListener('submit',event=>{event.preventDefault();if(!state.busy&&!state.paused&&form.reportValidity())send({...editing.action,predicate:structuredClone(editing.predicate)});});
      expressionTools(form,{element,button,labels:state.labels,fields:[...new Set(state.metadata.fields.flatMap(source=>source.fields.map(name)))],state:editing.fieldPicker??={}});root.append(form);return;
    }
    if (editing.dcs) { dcsForm(); return; }
    const l = state.labels, form = element("form", undefined, "expression"); form.append(element("h2", l.edit));
    if (editing.raw) {
      const text = element("textarea"); text.name = "raw"; text.value = editing.initial; text.rows = 4;
      text.required = true; text.setAttribute("aria-label", l.expression); text.addEventListener("input", () => { editing.initial = text.value; }); form.append(text);
      if (editing.action.kind === "append" && editing.action.clause === "joins") {
        select(form, l.joins, "join", editing.action, [["inner", l.inner], ["left", l.left], ["right", l.right], ["full", l.full]]);
      }
    } else visualForm(form);
    const accept = button(l.submit, () => {}); accept.type = "submit"; accept.dataset.action = "submit";
    form.addEventListener("submit", event => {
      event.preventDefault(); if (state.busy || state.paused || !form.reportValidity()) return;
      if (editing.raw) {
        const text = form.querySelector("textarea").value;
        if (new TextEncoder().encode(text).length > state.maxExpression) { form.querySelector("textarea").setCustomValidity(state.reasons.expression_too_large); form.reportValidity(); return; }
        send({ ...editing.action, text });
      } else {
        const expression = structuredClone(editing.expression);
        if (["field", "totalField"].includes(expression.kind)) expression.aggregate ||= null;
        compose(expression, editing.action.selection ?? null);
      }
    });
    form.append(accept, button(l.close, () => { editing = undefined; render(); }));
    if (editing.expression) form.append(button(editing.raw ? l.visualEditor : l.rawExpression, () => { editing.raw = !editing.raw; render(); }));
    expressionTools(form, {element,button,labels:l,fields:[...new Set(state.metadata.fields.flatMap(source=>source.fields.map(name)))],state:editing.fieldPicker??={}});
    root.append(form);
  }

  /** The backend snapshot remains the sole query model; Solid owns the persistent frame. */
  function pages() {
    return [...basePages, ...((state.features.modifiers || state.features.dcs) ? ['settings'] : []),
      ...(state.features.unions ? ['unions'] : []), 'order',
      ...(state.features.packages ? ['index'] : []), ...(state.features.totals ? ['totals'] : []),
      ...(state.features.packages && !statement()?.nested ? ['packages'] : []), 'text'];
  }

  function activate(target) {
    if (!pages().includes(target)) return;
    layout.select(selected, target); page = target; editing = undefined; render();
  }

  function render(local = true) {
    if (local) localRevision++;
    if (!state) return;
    const previous = selected;
    selected = Math.min(state.statement ?? selected, Math.max(0, state.model.statements.length - 1));
    if (selected !== previous) page = layout.page(selected, state.model.scopes?.[statement()?.scope]?.parent != null ? 'tablesFields' : page);
    if (page === 'dcs') page = 'settings';
    if (statement()?.package?.operation === 'destroy') page = 'packages';
    if (!pages().includes(page)) page = 'tablesFields';
    changed({ state, page, selected, pages: pages(), error: errorText, editing: !!editing,
      child: !!state.preview || !!state.diff || !!editing, scope: statement(),
      bodyKey: [state.model.revision, state.metadataRevision, selected, page, state.model.writable, state.paused, localRevision].join(':') });
  }

  function settings() {
    const l = state.labels, pane = panel(l.settings, 'query-settings-pane');
    if (state.features.modifiers && statement()?.modifiers) {
      const form = element('form', undefined, 'query-modifiers');
      modifierForm(form, structuredClone(statement().modifiers), { element, button, labels:l,
        close: () => activate('tablesFields'),
        submit: modifiers => post({ type:'preview', action:{kind:'setModifiers',statement:selected,modifiers} }) });
      pane.append(form);
    }
    if (state.features.dcs) {
      const details = element('details', undefined, 'query-dcs-settings');
      details.append(element('summary', l.dcs), dcs()); pane.append(details);
    }
    return pane;
  }

  function panes() {
    renderingPane = true;
    try {
    const container = element('div');
    if (!statement()) container.append(element('p', state.labels.empty));
    else if (statement().unavailable && !['settings','text'].includes(page)) container.append(element('p', state.reasons[statement().unavailable] ?? state.labels.empty, 'notice'));
    else if (page === 'settings') container.append(settings());
    else if (page === 'index') container.append(sourceFields('index'), list('index', state.labels.index));
    else if (page !== 'text') renderPage(container);
    return [...container.children];
    } finally { renderingPane = false; }
  }

  /** Dialogs reuse the checked command adapters and retain pending form values after a rejection. */
  function overlays() {
    const l = state.labels;
    for (const child of [...root.children]) if (!child.classList.contains('constructor-shell')) child.remove();
    const shell = root.querySelector('.constructor-shell'); if (shell) shell.inert = false;
    if (editing) renderEditor();
    if(state.comments){
      const comments=element('section',undefined,'comment-list eska-dialog');comments.setAttribute('role','region');comments.setAttribute('aria-label',l.comments);comments.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();post({type:'closeComments'});}});comments.append(element('h2',l.comments));
      for(const comment of state.comments.comments)comments.append(button(state.model.text.slice(comment.utf16.start,comment.utf16.end),()=>post({type:'locate',target:{kind:'range',range:comment.range},navigate:true}),comment.statement===null?'unsupported':null,'query-comment'));
      if(state.comments.offset)comments.append(button(l.previousFragment,()=>post({type:'comments',offset:Math.max(0,state.comments.offset-128),selection:state.comments.selection})));
      if(state.comments.nextOffset!==null)comments.append(button(l.more,()=>post({type:'comments',offset:state.comments.nextOffset,selection:state.comments.selection})));
      comments.append(button(l.close,()=>post({type:'closeComments'}),null,'comments-close'));root.append(comments);
    }
    if(editing?.textBuffer)for(const child of root.querySelectorAll(':scope > *'))if(!child.classList.contains('text-editor'))child.inert=true;
    if(state.preview||state.diff){
      const dialog=element('section',undefined,'action-preview');dialog.setAttribute('aria-label',l.previewChanges);dialog.append(element('h2',state.preview?l.previewChanges:l.diff));
      const panes=element('div',undefined,'preview-diff');for(const [label,value,range]of [[l.beforeChanges,state.diff?.original??state.model.text,state.diff?.change?.beforeUtf16],[l.afterChanges,state.preview?.text??state.model.text,state.diff?.change?.afterUtf16]]){const pane=element('div'),pre=element('pre');pre.tabIndex=0;markedText(pre,value,range);pane.append(element('h3',label),pre);panes.append(pane);}dialog.append(panes);
      if(state.preview)dialog.append(button(l.acceptChanges,()=>{pendingEdit=editing?structuredClone(editing):undefined;editing=undefined;post({type:'applyPreview'});},null,'preview-accept'));
      const close=()=>post({type:state.preview?'cancelPreview':'cancelDiff'});dialog.append(button(l.close,close,null,state.preview?'preview-cancel':'diff-close'));mountDialog(root,dialog,close);
    }

    for (const dialog of root.querySelectorAll(':scope > .expression, :scope > .text-editor, :scope > .action-preview')) dialog.classList.add('eska-dialog');
    const form = root.querySelector(':scope > .expression');
    if (form) { mountDialog(root, form, () => { editing = undefined; render(); }); }
  }

  function receive(event) {
    if (event.data?.type === "model") {
      if (event.data.busy && !state?.busy) layout.capture();
      if (state && state.model.revision !== event.data.model.revision) {
        locationSerial=-1;
        pendingEdit = undefined;
        itemSelections.clear(); cellDrafts.clear();
        for (const focus of event.data.model.itemFocus ?? []) {
          const key = `${focus.statement}:${focus.clause}`, selection = itemSelections.get(key) ?? {items:[],anchor:focus.item};
          selection.items.push(focus.item); itemSelections.set(key,selection);
        }
        if (event.data.model.totalFocus !== undefined && event.data.model.totalFocus !== null) totalSection = event.data.model.totalFocus;
      }
      if(state?.preview&&!event.data.preview&&!editing)pendingEdit=undefined;
      state = event.data;
      if(state.location&&state.location.serial!==locationSerial){
        localRevision++;
        locationSerial=state.location.serial;layout.preferences.previewOpen=true;const preview=root.querySelector('.query-preview');if(preview)preview.open=true;
        if(state.location.navigate&&state.location.selection){const selection=state.location.selection,kind=state.model.statements[selection.statement].clauses[selection.clause].kind;
          const target={fields:'tablesFields',sources:'tablesFields',joins:'joins',conditions:'conditions',having:'conditions',group:'group',order:'order',totals:'totals',totalGroups:'totals',index:'index',into:'packages',destroy:'packages'}[kind]??'tablesFields';
          layout.select(state.statement,target);page=target;itemSelections.set(`${selection.statement}:${selection.clause}`,{items:[selection.item],anchor:selection.item});
        }
      }
      root.setAttribute("aria-busy", String(state.busy));
      render(false);
    } else if (event.data?.type === "error") {
      if (state) { state={...state,busy:false}; root.setAttribute("aria-busy","false"); }
      if (pendingEdit) { editing = pendingEdit; render(); }
      errorText = event.data.text; render();
    }
  }
  return {
    layout, panes, overlays, name, statement, rows, unavailable, chooseTable, send, begin, blank,
    element, button, table, sourceFields, resultFields,
    activate, navigate, post,
    paintText(node) { markedText(node, state.model.text, state.location?.utf16); },
    editText() { editing = {textBuffer:{text:state.model.text,revision:state.model.revision}}; render(); },
    clearError() { errorText = ''; render(); },
    selectField(value) { chosenField = value; },
    start() { window.addEventListener('message', receive); post({type:'ready'}); },
    dispose() { window.removeEventListener('message', receive); }
  };
}
