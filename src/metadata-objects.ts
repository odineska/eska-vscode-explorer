import type * as vscode from "vscode";
import { isDeepStrictEqual } from "node:util";
import { ApplyReview } from "./apply-review.js";
import { ExplorerError, isRecord } from "./protocol.js";
import { message, type MessageKey } from "./messages.js";
import type { MetadataTree, TreeEntry, NodeId } from "./tree.js";
import { objectPlan, objectSchema, type ObjectOperation, type ObjectPlan, type ObjectRequest, type ObjectSchema, type InitialField } from "./metadata-object-protocol.js";
import { objectReview, verifyObjectSources } from "./metadata-object-review.js";

type Language = "ru-RU" | "en-US";
type Prompt = { language: Language; token: vscode.CancellationToken; check(): void };
type ObjectValues = Extract<ObjectRequest, { operation: "create" | "copy" }>;

/** Native selection and review reuse Rust schemas; no metadata writer or object registry lives here. */
export class MetadataObjects implements vscode.Disposable {
  private readonly review: ApplyReview;
  private active: vscode.CancellationTokenSource | undefined;
  private disposed = false;

  constructor(private readonly api: typeof vscode, private readonly readOnly: (uri: vscode.Uri) => boolean) {
    this.review = new ApplyReview(api);
  }

  stale(): void { this.active?.cancel(); this.review.dispose(); }
  dispose(): void { this.disposed = true; this.stale(); }

  async run(tree: MetadataTree, entry: TreeEntry, operation: ObjectOperation, current: () => MetadataTree | undefined,
    language: Language): Promise<NodeId | undefined> {
    if (this.active) { void this.api.window.showInformationMessage(message(language, "creationBusy")); return; }
    if (!this.api.workspace.isTrusted || entry.node.id.kind === "module") return;
    const scope = new this.api.CancellationTokenSource(); this.active = scope;
    const prompt: Prompt = { language, token: scope.token, check: () => {
      if (this.disposed || scope.token.isCancellationRequested || current() !== tree) throw new ExplorerError("cancelled");
      if (!this.api.workspace.isTrusted) throw new ExplorerError("untrusted");
    } };
    let committing = false;
    try {
      const selected = operation === "create" ? await this.createRequest(tree, entry, prompt)
        : this.existingRequest(entry, operation, language);
      if (selected === undefined) return;
      let request = selected;
      if (request.operation === "copy") request.name = await this.name(request.name, prompt);
      let plan: ObjectPlan;
      while (true) {
        try {
          plan = objectPlan(await this.api.window.withProgress({ location: this.api.ProgressLocation.Notification,
            title: message(language, "objectCalculating"), cancellable: false }, () => {
            prompt.check();
            return tree.request(entry.project, "metadata/previewObject", { request });
          }));
          prompt.check();
          if (!isDeepStrictEqual(plan.prepared.request, request)) throw new ExplorerError("protocolInvalid");
          break;
        } catch (error) {
          prompt.check();
          if (request.operation === "delete" || request.operation === "create-module" || !(error instanceof ExplorerError)
            || !["creation_collision", "creation_invalid_name", "object_invalid", "object_property_conflict"].includes(error.domain ?? "")) throw error;
          const conflict = error.domain === "object_property_conflict" && typeof error.details?.property === "string"
            && typeof error.details.value === "string" ? { property: error.details.property, value: error.details.value } : undefined;
          if (error.domain === "object_property_conflict" && (!conflict || !conflict.property)) throw new ExplorerError("protocolInvalid");
          const fields = request.operation === "create" && !request.template && error.domain === "object_invalid";
          const schema = conflict || fields ? await this.correctionSchema(tree, entry, request, prompt) : undefined;
          prompt.check();
          const title = conflict ? schema?.propertyCaptions[conflict.property]?.[language] ?? conflict.property : "";
          const edit = message(language, conflict || fields ? "objectEditFields" : "objectEditName");
          const notice = conflict ? message(language, "objectPropertyConflict", title, conflict.value) : message(language, this.failure(error, false));
          if (await this.api.window.showErrorMessage(notice, edit, message(language, "propertyCancel")) !== edit) return;
          prompt.check();
          if (conflict && schema) {
            const field = schema.initialFields?.find(field => field.property === conflict.property);
            const kind = schema.kindOptions.find(kind => kind.value === schema.selectedKind)?.key;
            if (!kind) throw new ExplorerError("protocolInvalid");
            const required = schema.requiredProperties[kind]?.includes(conflict.property) === true;
            const corrected = field ? await this.initialProperty(request, field, title, prompt, conflict.value)
              : await this.scalarProperty(request, conflict.property, title, prompt, conflict.value, required);
            if (!corrected) return;
          } else if (fields && request.operation === "create" && schema) {
            if (!await this.requiredProperties(request, schema, prompt)) return;
          } else request.name = await this.name(request.name, prompt);
        }
      }
      await verifyObjectSources(this.api, entry.project.info.sourcePath, plan, this.readOnly, prompt.check); prompt.check();
      const title = message(language, operation === "create" ? "objectCreate" : operation === "copy" ? "objectCopy" : "objectDelete");
      const accept = message(language, operation === "delete" ? plan.references.length ? "objectDeleteWithReferences" : "objectDeleteApply" : "creationApply");
      if (operation !== "create" && !await this.review.show(title, objectReview(plan, language), accept, message(language, "propertyCancel"))) return;
      prompt.check();
      if (request.operation === "delete" && plan.references.length) {
        request = { ...request, force: true };
        const forced = objectPlan(await this.api.window.withProgress({ location: this.api.ProgressLocation.Notification,
          title: message(language, "objectCalculating"), cancellable: false }, () => {
          prompt.check();
          return tree.request(entry.project, "metadata/previewObject", { request });
        }));
        prompt.check();
        if (!isDeepStrictEqual(forced.prepared.request, request) || !isDeepStrictEqual(forced.files, plan.files)
          || !isDeepStrictEqual(forced.references, plan.references) || !isDeepStrictEqual(forced.inputs, plan.inputs)) throw new ExplorerError("sourceChanged");
        plan = forced;
      }
      const result = await this.api.window.withProgress({ location: this.api.ProgressLocation.Notification,
        title: message(language, "objectWriting"), cancellable: false }, async () => {
        // Recheck buffers and scope after entering the write phase, before the only publication call.
        await verifyObjectSources(this.api, entry.project.info.sourcePath, plan, this.readOnly, prompt.check); prompt.check();
        committing = true;
        // A lost acknowledgement cannot authorize replay of an object or form mutation.
        return tree.request(entry.project, "metadata/applyObject", { prepared: plan.prepared });
      });
      if (!isRecord(result) || result.schemaVersion !== 1 || result.changed !== true || result.objectId !== plan.objectId
        || result.snapshot !== plan.prepared.expectedOutputSnapshot) throw new ExplorerError("protocolInvalid");
      if (current() === tree && !this.disposed) void this.api.window.showInformationMessage(request.operation === "create-module"
        ? message(language, "objectModuleCreated") : message(language, operation === "delete" ? "objectDeleted" : "creationCreated",
          request.operation === "delete" ? this.label(entry, language) : request.name));
      if (operation === "delete" || !plan.objectId) return;
      return request.operation === "create-module" ? { kind: "module", owner: plan.objectId, role: request.role }
        : { kind: "object", objectId: plan.objectId };
    } catch (error) {
      if (error instanceof ExplorerError && ["cancelled", "obsolete"].includes(error.code)) return;
      if (!this.disposed) void this.api.window.showErrorMessage(message(language, this.failure(error, committing)));
      return;
    } finally {
      if (this.active === scope) this.active = undefined;
      scope.dispose();
    }
  }

  private existingRequest(entry: TreeEntry, operation: "copy" | "delete", language: Language): ObjectRequest {
    if (entry.node.id.kind !== "object" || entry.node.id.objectId === entry.project.info.root.objectId) throw new ExplorerError("selectionInvalid");
    return operation === "delete" ? { operation, object: entry.node.id.objectId, force: false }
      : { operation, source: entry.node.id.objectId, name: `${this.label(entry, language)}${message(language, "objectCopySuffix")}`, parent: null, propertyValues: {}, propertyReferences: {}, propertyTypes: {} };
  }

  private async createRequest(tree: MetadataTree, entry: TreeEntry, prompt: Prompt): Promise<ObjectRequest | undefined> {
    const id = entry.node.id;
    if (id.kind === "module" || id.kind === "collection" && !["metadata", "modules"].includes(id.collection.kind)) return;
    const owner = id.kind === "object" ? id.objectId : id.owner;
    const parent = this.metadataParent(entry, owner);
    const schema = await this.schema(tree, entry, parent, prompt);
    if (!schema.operations.includes("create")) throw new ExplorerError("requestFailed", "property_read_only");
    const indicated = id.kind === "collection" && id.collection.kind === "metadata" ? id.collection.metadataKind : undefined;
    const kinds = id.kind === "collection" && id.collection.kind === "modules" ? []
      : indicated ? schema.kindOptions.filter(option => option.key === indicated) : schema.kindOptions;
    const modules = indicated ? [] : schema.moduleOptions ?? [];
    const options = [
      ...kinds.map(kind => ({ label: kind.caption[prompt.language], description: kind.key, metadata: kind, role: undefined })),
      ...modules.map(module => ({ label: module.caption[prompt.language], description: module.role, metadata: undefined, role: module.role })),
    ];
    if (!options.length) { void this.api.window.showInformationMessage(message(prompt.language, "objectNothingToAdd")); return; }
    const picked = options.length === 1 ? options[0] : await this.api.window.showQuickPick(options,
      { title: message(prompt.language, "objectKind"), matchOnDescription: true, ignoreFocusOut: true }, prompt.token);
    prompt.check();
    if (!picked) return;
    if (picked.role) return { operation: "create-module", owner, role: picked.role };
    if (!picked.metadata) throw new ExplorerError("protocolInvalid");
    const request: Extract<ObjectRequest, { operation: "create" }> = { operation: "create", kind: picked.metadata.value,
      name: await this.name("", prompt), parent, template: null, propertyValues: {}, propertyReferences: {}, propertyTypes: {} };
    if ((schema.requiredProperties[picked.metadata.key]?.length ?? 0) > 0) {
      const selectedSchema = await this.schema(tree, entry, parent, prompt, picked.metadata.value);
      if (!await this.requiredProperties(request, selectedSchema, prompt)) return;
    }
    return request;
  }

  private async schema(tree: MetadataTree, entry: TreeEntry, parent: string | null, prompt: Prompt, kind?: string): Promise<ObjectSchema> {
    const value = await tree.request(entry.project, "metadata/objectSchema", { parent, ...(kind ? { kind } : {}) });
    prompt.check();
    return objectSchema(value, parent, kind);
  }

  private metadataParent(entry: TreeEntry, owner: string): string | null {
    return owner === entry.project.info.root.objectId && entry.project.info.type === "configuration" ? null : owner;
  }

  /** Copy keeps its original owner; tree identities remain opaque and are never split into paths. */
  private async correctionSchema(tree: MetadataTree, entry: TreeEntry, request: ObjectValues, prompt: Prompt): Promise<ObjectSchema> {
    if (request.operation === "create") return this.schema(tree, entry, request.parent, prompt, request.kind);
    const node = entry.node.parent;
    if (!node || node.kind === "module") throw new ExplorerError("protocolInvalid");
    const parent = this.metadataParent(entry, node.kind === "object" ? node.objectId : node.owner);
    const schema = await this.schema(tree, entry, parent, prompt);
    const kind = schema.kindOptions.find(kind => kind.key === entry.node.metadataKind)?.value;
    if (!kind) throw new ExplorerError("protocolInvalid");
    return this.schema(tree, entry, parent, prompt, kind);
  }

  private async requiredProperties(request: Extract<ObjectRequest, { operation: "create" }>, schema: ObjectSchema, prompt: Prompt): Promise<boolean> {
    const kind = schema.kindOptions.find(kind => kind.value === request.kind)?.key;
    if (!kind) throw new ExplorerError("protocolInvalid");
    for (const property of schema.requiredProperties[kind] ?? []) {
      const title = schema.propertyCaptions[property]?.[prompt.language] ?? property;
      const field = schema.initialFields?.find(field => field.property === property);
      if (field) {
        if (!await this.initialProperty(request, field, title, prompt)) return false;
      } else {
        if (schema.referenceProperties[kind]?.includes(property) || schema.typeProperties[kind]?.includes(property)) throw new ExplorerError("protocolInvalid");
        if (!await this.scalarProperty(request, property, title, prompt)) return false;
      }
    }
    return true;
  }

  /** Unique-property conflicts correct the backend-named field without discarding other input. */
  private async scalarProperty(request: ObjectValues, property: string, title: string, prompt: Prompt, initial = "", required = true): Promise<boolean> {
    const value = await this.api.window.showInputBox({ title, value: request.propertyValues[property] ?? initial,
      prompt: message(prompt.language, required ? "objectPropertyValue" : "objectPropertyOptionalValue", title), ignoreFocusOut: true,
      validateInput: value => required && !value.trim() ? message(prompt.language, "propertyInvalid") : undefined }, prompt.token);
    prompt.check();
    if (value === undefined) return false;
    request.propertyValues = { ...request.propertyValues, [property]: value };
    return true;
  }

  /** Initial selections use backend choices and the same identities as the property editor. */
  private async initialProperty(request: ObjectValues, field: InitialField, title: string, prompt: Prompt, initial?: string): Promise<boolean> {
    if (!field.options.length) {
      void this.api.window.showInformationMessage(message(prompt.language, "objectNoChoices", title));
      return false;
    }
    const settings = { title, ignoreFocusOut: true, matchOnDescription: true };
    if (field.kind === "types") {
      const current = request.propertyTypes[field.property] ?? [];
      const options = field.options.map(option => ({ label: option.caption[prompt.language],
        description: option.key.name, key: option.key,
        picked: current.some(key => key.name === option.key.name && key.namespace === option.key.namespace),
      }));
      const selected = await this.api.window.showQuickPick(options, { ...settings, canPickMany: true }, prompt.token);
      prompt.check();
      if (!selected?.length) return false;
      request.propertyTypes[field.property] = selected.map(option => option.key);
    } else {
      const current = field.multiple ? request.propertyReferences[field.property] ?? [] : [request.propertyValues[field.property] ?? initial];
      const options = field.options.map(option => ({ label: option.caption[prompt.language], value: option.value,
        description: option.value, picked: current.includes(option.value),
      }));
      if (!field.multiple) options.sort((left, right) => Number(right.picked) - Number(left.picked));
      const selected = field.multiple ? await this.api.window.showQuickPick(options, { ...settings, canPickMany: true }, prompt.token)
        : await this.api.window.showQuickPick(options, settings, prompt.token);
      prompt.check();
      if (!selected || Array.isArray(selected) && !selected.length) return false;
      if (Array.isArray(selected)) request.propertyReferences[field.property] = selected.map(option => option.value);
      else request.propertyValues[field.property] = selected.value;
    }
    return true;
  }

  private async name(value: string, prompt: Prompt): Promise<string> {
    const result = await this.api.window.showInputBox({ title: message(prompt.language, "objectName"), value, ignoreFocusOut: true,
      validateInput: text => text.trim() ? undefined : message(prompt.language, "creationInvalidName") }, prompt.token);
    prompt.check();
    if (result === undefined) throw new ExplorerError("cancelled");
    return result;
  }

  private label(entry: TreeEntry, language: Language): string {
    return entry.node.label.kind === "name" ? entry.node.label.text : entry.node.label.translations[language];
  }

  private failure(error: unknown, committing: boolean): MessageKey {
    if (!(error instanceof ExplorerError)) return committing ? "objectWriteUnknown" : "requestFailed";
    switch (error.domain) {
      case "creation_dirty_source": return "propertyDirtyXml";
      case "creation_collision": return "creationCollision";
      case "creation_invalid_name": return "creationInvalidName";
      case "object_unsupported": return "objectUnsupported";
      case "object_invalid": return error.details?.field === "role" ? "objectModuleUnavailable" : "propertyInvalid";
      case "object_property_conflict": return "propertyInvalid";
      case "object_references": return "objectReferencesNotice";
      case "object_committed_refresh_required": return "creationCommitted";
      case "property_conflict": case "stale_generation": return "propertyConflict";
      case "property_read_only": return "propertyLocked";
      case "property_edit_busy": return "propertyBusy";
      case "property_recovery_required": return "propertyRecovery";
      default: return error.code === "sourceChanged" ? "propertyConflict" : committing ? "objectWriteUnknown" : error.code;
    }
  }
}
