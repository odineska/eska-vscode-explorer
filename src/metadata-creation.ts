import type * as vscode from "vscode";
import { readFile, stat } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { ExplorerError, isRecord, MAX_RESPONSE } from "./protocol.js";
import { existingSource } from "./source.js";
import { message, type MessageKey } from "./messages.js";
import type { MetadataTree, TreeEntry } from "./tree.js";
import { creationSchema, creationPlan, creationPreview, type Caption, type CreateRequest, type CreateType,
  type CreationSchema, type CreationPlan, type CreationOption, type CreationKind } from "./metadata-creation-protocol.js";

const SCHEME = "eska-metadata-creation";
type Language = "ru-RU" | "en-US";
type Prompt = { token: vscode.CancellationToken; check(): void; language: Language };

/** The native wizard owns temporary views only; Rust owns validation, identities and source writes. */
export class MetadataCreation implements vscode.Disposable {
  private readonly documents = new Map<string, string>();
  private readonly provider: vscode.Disposable;
  private active: vscode.CancellationTokenSource | undefined;
  private serial = 0;
  private disposed = false;

  constructor(private readonly api: typeof vscode, private readonly readOnly: (document: vscode.TextDocument) => boolean) {
    this.provider = api.workspace.registerTextDocumentContentProvider(SCHEME, {
      provideTextDocumentContent: uri => {
        const text = this.documents.get(uri.toString());
        if (text === undefined) throw new ExplorerError("sourceMissing");
        return text;
      },
    });
  }

  /** A replaced backend cancels pending inputs before they can publish into a different project. */
  stale(): void { this.active?.cancel(); this.active = undefined; }
  dispose(): void { this.disposed = true; this.stale(); this.provider.dispose(); this.documents.clear(); }

  async run(tree: MetadataTree, entry: TreeEntry, current: () => MetadataTree | undefined, language: Language, initialKind?: CreationKind): Promise<string | undefined> {
    if (this.active) { void this.api.window.showInformationMessage(message(language, "creationBusy")); return; }
    if (!this.api.workspace.isTrusted || entry.node.id.kind !== "object") return;
    const scope = new this.api.CancellationTokenSource(); this.active = scope;
    const prompt: Prompt = { token: scope.token, language, check: () => {
      if (this.disposed || scope.token.isCancellationRequested || tree !== current()) throw new ExplorerError("cancelled");
      if (!this.api.workspace.isTrusted) throw new ExplorerError("untrusted");
    } };
    const uris: vscode.Uri[] = []; let committing = false;
    try {
      const schema = creationSchema(await tree.request(entry.project, "metadata/creationSchema", { owner: entry.node.id.objectId }), entry.node.id.objectId);
      prompt.check();
      if (!schema.writable) throw new ExplorerError("requestFailed", "property_read_only");
      const request = await this.gather(initialKind ? { ...schema, kinds: schema.kinds.filter(kind => kind === initialKind) } : schema, prompt);
      const plan = creationPlan(await tree.request(entry.project, "metadata/previewCreate", { request }));
      prompt.check();
      if (!isDeepStrictEqual(plan.prepared.request, request)) throw new ExplorerError("protocolInvalid");
      const path = await existingSource(entry.project.info.sourcePath, plan.source);
      const preview = await this.checkedPreview(path, plan);
      prompt.check();
      const key = ++this.serial;
      const before = this.api.Uri.from({ scheme: SCHEME, path: `/${key}/before.xml` });
      const after = this.api.Uri.from({ scheme: SCHEME, path: `/${key}/after.xml` });
      uris.push(before, after); this.documents.set(before.toString(), preview.before); this.documents.set(after.toString(), preview.after);
      await this.api.commands.executeCommand("vscode.diff", before, after, message(language, "creationReviewTitle", request.name), { preview: true });
      prompt.check();
      const apply = message(language, "creationApply");
      const selected = await this.api.window.showInformationMessage(message(language, "creationReviewNotice", request.name),
        apply, message(language, "propertyCancel"));
      prompt.check();
      if (selected !== apply || !this.reviewOpen(before, after)) return;
      await this.checkedPreview(path, plan); prompt.check();
      committing = true;
      // This call is never retried, including a lost acknowledgement after a successful write.
      const result = await tree.request(entry.project, "metadata/create", { prepared: plan.prepared });
      if (!isRecord(result) || result.changed !== true || result.objectId !== plan.objectId
        || result.uuid !== plan.prepared.identity.uuid || result.snapshot !== plan.prepared.expectedOutputSnapshot) throw new ExplorerError("protocolInvalid");
      if (tree === current() && !this.disposed) void this.api.window.showInformationMessage(message(language, "creationCreated", request.name));
      return result.objectId as string;
    } catch (error) {
      if (error instanceof ExplorerError && ["cancelled", "obsolete"].includes(error.code)) return;
      if (!this.disposed) void this.api.window.showErrorMessage(message(language, this.failure(error, committing)));
      return;
    } finally {
      if (this.active === scope) this.active = undefined;
      scope.dispose();
      await this.closeReview(uris);
    }
  }

  private async gather(schema: CreationSchema, prompt: Prompt): Promise<CreateRequest> {
    const caps = schema.capabilities, label = (key: string): string => this.caption(caps.fieldCaptions[key]!, prompt.language);
    const selected = schema.kinds.length === 1 ? schema.kinds[0]!
      : await this.option(schema.kindOptions.filter(option => schema.kinds.includes(option.value)), message(prompt.language, "creationKind"), prompt);
    const name = await this.input(label("name"), "", prompt, value => !value.trim() || value.length > caps.limits.nameUtf16Max
      ? message(prompt.language, "creationNameLength", String(caps.limits.nameUtf16Max)) : undefined);
    const types = selected === "attribute" ? await this.types(schema, prompt) : [];
    const synonyms: { language: string; content: string }[] = [];
    if (schema.languages.length) {
      const preferred = schema.languages.find(value => value.code === prompt.language.split("-")[0]) ?? schema.languages[0]!;
      const content = await this.input(schema.languages.length === 1 ? label("synonym") : `${label("synonym")} (${preferred.code})`, "", prompt);
      if (content) synonyms.push({ language: preferred.code, content });
    }
    const comment = await this.input(label("comment"), "", prompt);
    return { owner: schema.owner, snapshot: schema.snapshot, kind: selected, name, synonyms, comment, types };
  }

  private async types(schema: CreationSchema, prompt: Prompt): Promise<CreateType[]> {
    const caps = schema.capabilities;
    const items = [
      ...caps.primitiveTypes.map(value => ({ label: this.caption(value.caption, prompt.language), value: value.default })),
      ...schema.references.map(value => ({ label: this.caption(value.caption, prompt.language), description: value.name,
        value: { kind: "reference", object: value.object } as CreateType })),
    ];
    const picked = await this.api.window.showQuickPick(items, { title: this.caption(caps.fieldCaptions.type!, prompt.language),
      placeHolder: message(prompt.language, "creationTypes"), canPickMany: true, ignoreFocusOut: true, matchOnDescription: true }, prompt.token);
    prompt.check();
    if (!picked?.length) throw new ExplorerError("cancelled");
    const result: CreateType[] = [];
    for (const selected of picked) {
      const type = { ...selected.value };
      const label = (key: string): string => `${selected.label}: ${this.caption(caps.fieldCaptions[key]!, prompt.language)}`;
      if (type.kind === "string") {
        type.fixed = await this.option(caps.allowedLength, label("fixed"), prompt, type.fixed);
        type.length = await this.number(label("length"), type.fixed ? Math.max(type.length, caps.limits.stringFixedLengthMin) : type.length,
          type.fixed ? caps.limits.stringFixedLengthMin : caps.limits.stringLengthMin, type.fixed ? caps.limits.stringFixedLengthMax : caps.limits.stringLengthMax, prompt);
      } else if (type.kind === "number") {
        type.digits = await this.number(label("digits"), type.digits, caps.limits.numberDigitsMin, caps.limits.numberDigitsMax, prompt);
        type.fractionDigits = await this.number(label("fractionDigits"), Math.min(type.fractionDigits, type.digits), 0, type.digits, prompt);
        type.nonNegative = await this.option(caps.allowedSign, label("nonNegative"), prompt, type.nonNegative);
      } else if (type.kind === "date") type.fractions = await this.option(caps.dateFractions, label("fractions"), prompt, type.fractions);
      result.push(type);
    }
    return result;
  }

  private caption(value: Caption, language: Language): string { return value[language]; }

  private async option<T>(options: CreationOption<T>[], title: string, prompt: Prompt, initial?: T): Promise<T> {
    const values = [...options].sort((a, b) => Number(b.value === initial) - Number(a.value === initial)).map(value => ({ label: this.caption(value.caption, prompt.language), value: value.value, picked: value.value === initial }));
    const selected = await this.api.window.showQuickPick(values, { title, ignoreFocusOut: true }, prompt.token);
    prompt.check();
    if (!selected) throw new ExplorerError("cancelled");
    return selected.value;
  }

  private async input(title: string, value: string, prompt: Prompt, validateInput?: (value: string) => string | undefined): Promise<string> {
    const result = await this.api.window.showInputBox({ title, value, ignoreFocusOut: true, ...(validateInput ? { validateInput } : {}) }, prompt.token);
    prompt.check();
    if (result === undefined) throw new ExplorerError("cancelled");
    return result;
  }

  private async number(title: string, value: number, min: number, max: number, prompt: Prompt): Promise<number> {
    const result = await this.input(title, String(value), prompt, text => !/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))
      || Number(text) < min || Number(text) > max ? message(prompt.language, "creationNumberRange", String(min), String(max)) : undefined);
    return Number(result);
  }

  /** Unsaved buffers and native readonly rules are rechecked immediately before the write. */
  private async checkedPreview(path: string, plan: CreationPlan): Promise<{ before: string; after: string }> {
    if ((await stat(path)).size > MAX_RESPONSE) throw new ExplorerError("resourceLimit");
    const preview = creationPreview(await readFile(path), plan);
    const document = await this.api.workspace.openTextDocument(this.api.Uri.file(path));
    // VS Code normalizes mixed line endings in clean buffers; the byte snapshot above owns disk identity.
    if (document.isDirty) throw new ExplorerError("requestFailed", "creation_dirty_source");
    if (this.readOnly(document)) throw new ExplorerError("requestFailed", "property_read_only");
    return preview;
  }

  private reviewOpen(before: vscode.Uri, after: vscode.Uri): boolean {
    return this.api.window.tabGroups.all.some(group => group.tabs.some(tab => tab.input instanceof this.api.TabInputTextDiff
      && tab.input.original.toString() === before.toString() && tab.input.modified.toString() === after.toString()));
  }

  private async closeReview(uris: vscode.Uri[]): Promise<void> {
    const owned = new Set(uris.map(uri => uri.toString()));
    const tabs = this.api.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof this.api.TabInputTextDiff
      && owned.has(tab.input.original.toString()) && owned.has(tab.input.modified.toString()));
    try { if (tabs.length && !await this.api.window.tabGroups.close(tabs, true)) return; }
    catch { return; } // Keep snapshots readable if VS Code could not close the owned tab.
    for (const uri of owned) this.documents.delete(uri);
  }

  private failure(error: unknown, committing: boolean): MessageKey {
    if (!(error instanceof ExplorerError)) return committing ? "creationWriteUnknown" : "requestFailed";
    switch (error.domain) {
      case "creation_dirty_source": return "propertyDirtyXml";
      case "creation_collision": return "creationCollision";
      case "creation_unsupported_owner": return "creationUnsupported";
      case "creation_invalid_name": return "creationInvalidName";
      case "creation_invalid": case "property_invalid": return "propertyInvalid";
      case "creation_committed_refresh_required": return "creationCommitted";
      case "property_conflict": case "stale_generation": return "propertyConflict";
      case "property_read_only": return "propertyLocked";
      case "property_edit_busy": return "propertyBusy";
      case "property_recovery_required": return "propertyRecovery";
      default: return error.code === "sourceChanged" ? "propertyConflict" : committing ? "creationWriteUnknown" : error.code;
    }
  }
}
