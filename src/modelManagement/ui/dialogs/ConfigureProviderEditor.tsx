import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchBar } from "@/components/ui/SearchBar";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { t, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { normalizeBaseUrlForProtocol } from "@/modelManagement/catalog/providerCapability";
import type { ModelInfo, ProviderType } from "@/modelManagement/types/catalog";
import { formatContextWindow } from "@/modelManagement/ui/utils/formatModelMetadata";
import {
  Check,
  ChevronDown,
  Hexagon,
  HelpCircle,
  Loader2,
  Lock,
  Plus,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  createModelDraft,
  modelDraftInfo,
  orderReasoningEfforts,
  parseTokenCount,
  type ModelDraft,
  type ProviderDraft,
} from "./providerDraft";

const FORMATS: readonly {
  id: string;
  type: ProviderType;
  responses: boolean;
  label: MessageKey;
}[] = [
  { id: "chat", type: "openai-compatible", responses: false, label: "ui.byok.formatChat" },
  { id: "responses", type: "openai-compatible", responses: true, label: "ui.byok.formatResponses" },
  { id: "anthropic", type: "anthropic", responses: false, label: "ui.byok.formatAnthropic" },
  { id: "google", type: "google", responses: false, label: "ui.byok.formatGoogle" },
];

export interface ConfigureProviderEditorProps {
  initialDraft: ProviderDraft;
  requiresApiKey: boolean;
  editing?: boolean;
  defaultBaseUrl: (type: ProviderType, responses: boolean) => string;
  catalogModels: readonly ModelInfo[];
  onTestModel: (draft: ProviderDraft, model: ModelInfo, signal: AbortSignal) => Promise<void>;
  resolveModelInfo?: (id: string) => Promise<Partial<ModelInfo> | undefined>;
  supportsMaxEffort?: (id: string) => boolean;
  onSave: (draft: ProviderDraft) => Promise<void>;
  onClose: () => void;
  onRemove?: () => void;
}

export function ConfigureProviderEditor({
  initialDraft,
  requiresApiKey,
  editing = false,
  defaultBaseUrl,
  catalogModels,
  onTestModel,
  resolveModelInfo,
  supportsMaxEffort,
  onSave,
  onClose,
  onRemove,
}: ConfigureProviderEditorProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const [testing, setTesting] = useState<ReadonlySet<string>>(() => new Set());
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(() => new Set());
  const busyTests = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const requests = busyTests.current;
    return () => {
      for (const controller of requests.values()) controller.abort();
      requests.clear();
    };
  }, []);
  // 初次打开帮助时也要挂在当前模态内，避免浮层落到遮罩后方。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const cardNodes = useRef(new Map<string, HTMLElement>());
  useLayoutEffect(() => {
    let cancelled = false;
    for (const model of draft.models) {
      if (!deleting.has(model.key)) continue;
      const remove = (): void => {
        if (cancelled) return;
        setDraft((current) => ({
          ...current,
          models: current.models.filter((entry) => entry.key !== model.key),
        }));
        setDeleting((current) => {
          const next = new Set(current);
          next.delete(model.key);
          return next;
        });
        setToast(t("ui.byok.modelDeleted", { model: model.info.id || t("ui.byok.unsetId") }));
      };
      // 等待实际动画完成；用户关闭动画时直接删除，避免保存仍在退出的模型：https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
      const animations = cardNodes.current.get(model.key)?.getAnimations?.() ?? [];
      if (animations.length > 0)
        void Promise.allSettled(animations.map((animation) => animation.finished)).then(remove);
      else remove();
    }
    return () => {
      cancelled = true;
    };
  }, [deleting, draft.models]);
  const catalogButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const patch = (next: Partial<ProviderDraft>): void => {
    setDraft((current) => ({ ...current, ...next }));
    setError("");
  };
  const patchModel = (key: string, update: Partial<ModelDraft>): void => {
    setDraft((current) => ({
      ...current,
      models: current.models.map((model) => (model.key === key ? { ...model, ...update } : model)),
    }));
  };
  const format = FORMATS.find(
    (item) =>
      item.type === draft.providerType &&
      (item.type !== "openai-compatible" ||
        item.responses === Boolean(draft.extras.useResponsesApi))
  )!;
  const invalidIds = draft.models.some(
    (model) =>
      !model.info.id.trim() ||
      draft.models.filter((other) => other.info.id.trim() === model.info.id.trim()).length > 1
  );
  const invalidCounts = draft.models.some(
    (model) => parseTokenCount(model.context) === null || parseTokenCount(model.output) === null
  );
  const validBaseUrl = Boolean(normalizeBaseUrlForProtocol(draft.baseUrl, draft.providerType));
  const canSave =
    Boolean(draft.displayName.trim()) &&
    validBaseUrl &&
    (!requiresApiKey || Boolean(draft.apiKey.trim())) &&
    !invalidIds &&
    !invalidCounts &&
    !draft.models.some((model) => deleting.has(model.key));
  const addModel = (): void => {
    const model = createModelDraft({ id: "", displayName: "" }, true, true);
    patch({ models: [...draft.models, model] });
    setToast(t("ui.byok.modelAdded"));
  };
  const testModel = async (model: ModelDraft): Promise<void> => {
    if (busyTests.current.has(model.key)) return;
    const controller = new AbortController();
    busyTests.current.set(model.key, controller);
    setTesting(new Set(busyTests.current.keys()));
    try {
      // 目录存在不代表模型能回复；用未保存的草稿执行真实请求。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
      await onTestModel(draft, modelDraftInfo(model), controller.signal);
      if (!controller.signal.aborted)
        setToast(
          t(
            model.info.toolCall === false ? "ui.byok.testConnectionSuccess" : "ui.byok.testSuccess",
            { model: model.info.id }
          )
        );
    } catch (reason) {
      if (!controller.signal.aborted) {
        const message = reason instanceof Error ? reason.message : String(reason);
        // 通用连接错误不能直接定性为跨域；只对 Google 网络失败补充可核对的条件。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
        const networkHelp =
          draft.providerType === "google" &&
          /Failed to fetch|Connection error|NetworkError|fetch failed/i.test(message)
            ? ` ${t("ui.byok.googleNetworkFailure")}`
            : "";
        setToast(t("ui.byok.testUnknown", { reason: `${message}${networkHelp}` }));
      }
    } finally {
      busyTests.current.delete(model.key);
      if (!controller.signal.aborted) setTesting(new Set(busyTests.current.keys()));
    }
  };
  const save = async (): Promise<void> => {
    if (!canSave || saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave({
        ...draft,
        models: draft.models.map((model) => ({
          ...model,
          info: modelDraftInfo({
            ...model,
            info: {
              ...model.info,
              reasoningEfforts: model.info.reasoningEfforts?.filter(
                (effort) =>
                  effort !== "max" ||
                  draft.providerType === "openai-compatible" ||
                  (draft.providerType === "anthropic" && supportsMaxEffort?.(model.info.id))
              ),
            },
          }),
        })),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={setPortalContainer}
      className="tw-relative tw-flex tw-h-full tw-min-h-0 tw-min-w-0 tw-flex-col tw-gap-4 tw-text-normal tw-@container/byok"
    >
      <header className="tw-space-y-1">
        <h2 className="tw-m-0 tw-text-lg tw-font-semibold">{t("ui.byok.title")}</h2>
        <p className="tw-m-0 tw-text-sm tw-text-muted">{t("ui.byok.subtitle")}</p>
        <p className="tw-m-0 tw-text-xs tw-text-muted">{t("ui.model.catalogSource")}</p>
      </header>
      <div className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto tw-rounded-xl tw-border tw-border-solid tw-border-border tw-bg-secondary">
        <div className="tw-flex tw-items-center tw-gap-3 tw-border-b tw-border-border tw-p-3 @[561px]/byok:tw-p-4">
          <Hexagon className="tw-size-6 tw-shrink-0 tw-text-muted" />
          <Input
            aria-label={t("ui.model.displayName")}
            value={draft.displayName}
            onChange={(event) => patch({ displayName: event.target.value })}
            className="tw-font-semibold"
          />
        </div>
        <div className="tw-space-y-4 tw-p-3 @[561px]/byok:tw-p-4">
          <FormField
            label={t("ui.model.baseUrl")}
            error={!validBaseUrl}
            errorMessage={t("ui.byok.requiredBaseUrl")}
            description={
              draft.providerType === "google" ? t("ui.byok.googleNetworkHelp") : undefined
            }
          >
            <Input
              aria-label={t("ui.model.baseUrl")}
              value={draft.baseUrl}
              onChange={(event) => patch({ baseUrl: event.target.value })}
              className="tw-font-mono"
            />
          </FormField>
          <FormField label={t("ui.byok.apiFormat")}>
            <DropdownMenu open={formatOpen} onOpenChange={setFormatOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  className="tw-w-full tw-justify-between tw-border tw-border-solid tw-border-border"
                  aria-label={t("ui.byok.apiFormat")}
                >
                  {t(format.label)}
                  <ChevronDown
                    className={cn(
                      "tw-size-4 tw-transition-transform",
                      formatOpen && "tw-rotate-180"
                    )}
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                container={portalContainer}
                className="tw-z-[100] tw-w-72"
                data-provider-layer-close="menu"
                onClick={(event) => {
                  if (event.target === event.currentTarget) setFormatOpen(false);
                }}
              >
                {FORMATS.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    onSelect={() => {
                      const oldDefault = defaultBaseUrl(
                        draft.providerType,
                        Boolean(draft.extras.useResponsesApi)
                      );
                      patch({
                        providerType: item.type,
                        extras: Object.fromEntries(
                          Object.entries({
                            ...draft.extras,
                            useResponsesApi: item.responses,
                          }).filter(
                            ([key]) => item.type === "openai-compatible" || key !== "openAIOrgId"
                          )
                        ),
                        baseUrl:
                          draft.baseUrl === oldDefault
                            ? defaultBaseUrl(item.type, item.responses)
                            : draft.baseUrl,
                      });
                      setToast(t("ui.byok.formatChanged", { format: t(item.label) }));
                    }}
                  >
                    {t(item.label)}
                    {format.id === item.id && <Check className="tw-ml-auto tw-size-4" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </FormField>
          <FormField label={t("ui.model.apiKey")}>
            <PasswordInput
              ariaLabel={t("ui.model.apiKey")}
              inputClassName={cn("tw-font-mono")}
              value={draft.apiKey}
              onChange={(apiKey) => patch({ apiKey })}
              placeholder={t("ui.model.pasteApiKey")}
              className="tw-font-mono"
            />
            {editing && draft.apiKey && (
              <Button variant="ghost2" size="sm" onClick={() => patch({ apiKey: "" })}>
                {t("ui.model.clear")}
              </Button>
            )}
            {requiresApiKey && !draft.apiKey.trim() && (
              <p className="tw-m-0 tw-text-xs tw-text-muted">
                {t("ui.model.apiKeyRequiredForProvider")}
              </p>
            )}
          </FormField>
          <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2 tw-pt-2">
            <span className="tw-text-sm tw-font-medium">{t("ui.model.models")}</span>
            <div className="tw-flex tw-flex-wrap tw-gap-2">
              <Button
                ref={catalogButton}
                variant="secondary"
                size="sm"
                className="tw-border tw-border-solid tw-border-border"
                onClick={() => setSelectOpen(true)}
              >
                {t("ui.byok.chooseBuiltinModels")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="tw-border tw-border-solid tw-border-border"
                onClick={addModel}
              >
                <Plus className="tw-size-3.5" />
                {t("ui.byok.addModel")}
              </Button>
            </div>
          </div>
          {draft.models.length === 0 && (
            <div className="tw-rounded-lg tw-border tw-border-dashed tw-border-border tw-p-6 tw-text-center tw-text-sm tw-text-muted">
              {t("ui.byok.empty")}
            </div>
          )}
          <div className="tw-space-y-2">
            {draft.models.map((model) => (
              <article
                key={model.key}
                aria-label={model.info.id || t("ui.byok.unsetId")}
                ref={(element) => {
                  if (element) cardNodes.current.set(model.key, element);
                  else cardNodes.current.delete(model.key);
                }}
                className={cn(
                  "tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-primary-alt tw-p-3 tw-transition-all tw-duration-150",
                  deleting.has(model.key) && "-tw-translate-x-4 tw-opacity-0"
                )}
              >
                <ModelCard
                  model={model}
                  providerType={draft.providerType}
                  invalidId={
                    !model.info.id.trim() ||
                    draft.models.some(
                      (other) =>
                        other.key !== model.key && other.info.id.trim() === model.info.id.trim()
                    )
                  }
                  testing={testing.has(model.key)}
                  onChange={(update) => patchModel(model.key, update)}
                  onToast={setToast}
                  onTest={() => {
                    void testModel(model);
                  }}
                  onDelete={() => {
                    setDeleting(new Set([...deleting, model.key]));
                  }}
                  container={portalContainer}
                  resolveModelInfo={resolveModelInfo}
                  supportsMaxEffort={supportsMaxEffort}
                />
              </article>
            ))}
          </div>
        </div>
      </div>
      {error && (
        <div role="alert" className="tw-text-sm tw-text-error">
          {error}
        </div>
      )}
      <footer className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
          <SettingSwitch
            checked={draft.enabled}
            aria-label={t("ui.byok.providerEnabled")}
            onCheckedChange={(enabled) => patch({ enabled })}
          />
          <div className="tw-text-xs">
            <div>{t("ui.byok.providerEnabled")}</div>
            <div className="tw-max-w-80 tw-text-muted">{t("ui.byok.providerEnabledHelp")}</div>
          </div>
        </div>
        <div className="tw-flex tw-flex-wrap tw-gap-2">
          {editing && (
            <Button
              variant="ghost2"
              className="hover:tw-text-error"
              onClick={onRemove}
              disabled={saving}
            >
              {t("ui.common.remove")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => {
              void save();
            }}
            disabled={!canSave || saving}
          >
            {saving && <Loader2 className="tw-size-4 tw-animate-spin" />}
            {t("ui.common.save")}
          </Button>
        </div>
      </footer>
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="tw-pointer-events-none tw-absolute tw-bottom-16 tw-left-1/2 tw-z-[110] tw-w-max tw-max-w-full -tw-translate-x-1/2 tw-rounded-lg tw-bg-modifier-message tw-px-4 tw-py-2 tw-text-center tw-text-sm tw-text-on-accent tw-shadow-lg"
        >
          {toast}
        </div>
      )}
      {selectOpen && (
        <ModelSelectionDialog
          draft={draft}
          models={catalogModels}
          onClose={() => {
            setSelectOpen(false);
            catalogButton.current?.focus();
          }}
          onAdd={(models) => {
            patch({ models: [...draft.models, ...models.map((info) => createModelDraft(info))] });
            setSelectOpen(false);
            catalogButton.current?.focus();
            setToast(t("ui.byok.modelsAdded", { count: models.length }));
          }}
        />
      )}
    </div>
  );
}

interface ModelCardProps {
  model: ModelDraft;
  providerType: ProviderType;
  invalidId: boolean;
  testing: boolean;
  onChange: (patch: Partial<ModelDraft>) => void;
  onToast: (message: string) => void;
  onDelete: () => void;
  onTest: () => void;
  container: HTMLElement | null;
  resolveModelInfo?: (id: string) => Promise<Partial<ModelInfo> | undefined>;
  supportsMaxEffort?: (id: string) => boolean;
}

function ModelCard({
  model,
  providerType,
  invalidId,
  testing,
  onChange,
  onToast,
  onDelete,
  onTest,
  container,
  resolveModelInfo,
  supportsMaxEffort,
}: ModelCardProps) {
  const [newEffort, setNewEffort] = useState<string | null>(null);
  const [customEfforts, setCustomEfforts] = useState<readonly string[]>(
    model.info.reasoningEfforts?.filter((effort) => !["low", "high", "max"].includes(effort)) ?? []
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const freshModel = useRef(!model.info.id);
  const touched = useRef(new Set<keyof ModelInfo>());
  const modelRef = useRef(model);
  modelRef.current = model;
  const loadDeclaration = async (): Promise<void> => {
    if (!freshModel.current || !resolveModelInfo || !model.info.id.trim()) return;
    const id = model.info.id.trim();
    const declared = await resolveModelInfo(id).catch(() => undefined);
    const current = modelRef.current;
    if (!declared || current.info.id.trim() !== id) return;
    const next = { ...current.info };
    for (const field of [
      "modalities",
      "capabilities",
      "reasoningEfforts",
      "reasoning",
      "toolCall",
    ] as const) {
      if (!touched.current.has(field) && declared[field] !== undefined)
        Object.assign(next, {
          [field]:
            field === "modalities"
              ? {
                  ...declared.modalities,
                  input: [
                    "text",
                    ...(declared.modalities?.input ?? []).filter((input) => input === "image"),
                  ],
                }
              : declared[field],
        });
    }
    onChange({
      info: next,
      context: current.context || String(declared.limits?.context ?? ""),
      output: current.output || String(declared.limits?.output ?? ""),
    });
  };
  useEffect(() => {
    if (model.expanded && !model.info.id) {
      inputRef.current?.scrollIntoView?.({ block: "nearest" });
      inputRef.current?.focus();
    }
  }, [model.expanded, model.info.id]);
  const name = model.info.id || t("ui.byok.unsetId");
  const inputs = [
    "text",
    ...(model.info.modalities?.input ?? []).filter((input) => input === "image"),
  ];
  const efforts = model.info.reasoningEfforts ?? [];
  const extraEfforts = [
    ...new Set([
      ...customEfforts,
      ...efforts.filter((effort) => !["low", "high", "max"].includes(effort)),
    ]),
  ];
  const updateInfo = (patch: Partial<ModelInfo>): void => {
    for (const key of Object.keys(patch) as (keyof ModelInfo)[]) touched.current.add(key);
    onChange({ info: { ...model.info, ...patch } });
  };
  const addEffort = (): void => {
    const value = newEffort?.trim();
    if (!value) return;
    if (["low", "high", "max", ...extraEfforts].includes(value)) {
      onToast(t("ui.byok.effortExists"));
      return;
    }
    setCustomEfforts([...customEfforts, value]);
    updateInfo({ reasoningEfforts: [...efforts, value] });
    setNewEffort(null);
  };
  const context = parseTokenCount(model.context);
  return (
    <>
      <div className="tw-flex tw-items-center tw-gap-1">
        <Button
          variant="ghost2"
          className="tw-h-auto tw-min-w-0 tw-flex-1 tw-flex-wrap tw-justify-start tw-gap-1.5 tw-p-0 tw-text-normal"
          onClick={() => onChange({ expanded: !model.expanded })}
          aria-expanded={model.expanded}
        >
          <span className="tw-break-all tw-font-mono tw-text-sm tw-font-semibold">{name}</span>
          {context && (
            <span className="tw-rounded tw-bg-modifier-hover tw-px-1.5 tw-text-xs">
              {formatContextWindow(context)}
            </span>
          )}
          {(
            [
              ["image", "ui.byok.vision"],
              ["video", "ui.byok.video"],
              ["pdf", "ui.byok.pdf"],
            ] as const
          )
            .filter(([input]) => inputs.includes(input))
            .map(([input, label]) => (
              <span
                key={input}
                className="tw-rounded tw-border tw-border-solid tw-border-border tw-px-1 tw-text-xs tw-text-muted"
              >
                {t(label)}
              </span>
            ))}
        </Button>
        <div
          className="tw-flex tw-shrink-0 tw-items-center tw-gap-1"
          onClick={(event) => event.stopPropagation()}
        >
          <SettingSwitch
            checked={model.enabled}
            aria-label={t("ui.byok.showModel", { model: name })}
            onCheckedChange={(enabled) => {
              onChange({ enabled });
              onToast(t(enabled ? "ui.byok.modelShown" : "ui.byok.modelHidden", { model: name }));
            }}
          />
          <Button
            variant="ghost2"
            size="icon"
            aria-label={t("ui.byok.deleteModel", { model: name })}
            className="hover:tw-text-error"
            onClick={onDelete}
          >
            <Trash2 className="tw-size-3.5" />
          </Button>
          <Button
            variant="ghost2"
            size="icon"
            aria-label={t("ui.byok.testModel", { model: name })}
            title={t("ui.byok.testModelDescription")}
            disabled={testing || !model.info.id.trim()}
            onClick={onTest}
          >
            <Zap className={cn("tw-size-3.5", testing && "tw-animate-spin")} />
          </Button>
          <Button
            variant="ghost2"
            size="icon"
            aria-label={t(model.expanded ? "ui.byok.collapse" : "ui.byok.expand")}
            aria-expanded={model.expanded}
            onClick={() => onChange({ expanded: !model.expanded })}
          >
            <ChevronDown
              className={cn(
                "tw-size-3.5 tw-transition-transform",
                model.expanded && "tw-rotate-180"
              )}
            />
          </Button>
        </div>
      </div>
      {model.expanded && (
        <div className="tw-space-y-3 tw-pt-3">
          <FormField
            label={t("ui.model.modelId")}
            error={invalidId}
            errorMessage={t("ui.byok.invalidId")}
          >
            <Input
              ref={inputRef}
              aria-label={t("ui.model.modelId")}
              onBlur={() => {
                void loadDeclaration();
              }}
              value={model.info.id}
              onChange={(event) => updateInfo({ id: event.target.value })}
              placeholder={t("ui.byok.idPlaceholder")}
              className="tw-font-mono"
            />
          </FormField>
          <div className="tw-grid tw-grid-cols-1 tw-gap-3 @[561px]/byok:tw-grid-cols-2">
            {(
              [
                ["context", "ui.byok.context", "ui.byok.contextPlaceholder"],
                ["output", "ui.byok.output", "ui.byok.outputPlaceholder"],
              ] as const
            ).map(([field, label, placeholder]) => (
              <FormField
                key={field}
                label={t(label)}
                error={parseTokenCount(model[field]) === null}
                errorMessage={t("ui.byok.invalidCount")}
              >
                <Input
                  aria-label={t(label)}
                  value={model[field]}
                  onChange={(event) => onChange({ [field]: event.target.value })}
                  placeholder={t(placeholder)}
                  className="tw-font-mono"
                />
              </FormField>
            ))}
          </div>
          <div className="tw-space-y-2">
            <HelpLabel
              label="ui.byok.inputTypes"
              content="ui.byok.inputHelp"
              container={container}
            />
            <div className="tw-flex tw-flex-wrap tw-gap-1.5">
              <Pill
                checked
                label={t("ui.byok.text")}
                onClick={() => onToast(t("ui.byok.textRequired"))}
              >
                <Lock className="tw-size-3" />
              </Pill>
              <Pill
                checked={inputs.includes("image")}
                label={t("ui.byok.image")}
                onClick={() =>
                  updateInfo({
                    modalities: {
                      ...model.info.modalities,
                      input: inputs.includes("image")
                        ? inputs.filter((input) => input !== "image")
                        : [...inputs, "image"],
                    },
                  })
                }
              />
              <Pill
                checked={false}
                disabled
                label={t("ui.byok.video")}
                reason={t("ui.byok.videoUnavailable")}
              />
              <Pill
                checked={false}
                disabled
                label={t("ui.byok.pdf")}
                reason={t("ui.byok.pdfUnavailable")}
              />
            </div>
            <p className="tw-m-0 tw-text-xs tw-text-faint">
              {t("ui.byok.videoUnavailable")} {t("ui.byok.pdfUnavailable")}
            </p>
          </div>
          <div className="tw-space-y-2">
            <HelpLabel
              label="ui.byok.capabilities"
              content="ui.byok.capabilityHelp"
              container={container}
            />
            <div className="tw-flex tw-flex-wrap tw-gap-1.5">
              {(
                [
                  ["structuredOutput", "ui.byok.structured"],
                  ["nativeWebSearch", "ui.byok.webSearch"],
                  ["midConversationSystemMessages", "ui.byok.midSystem"],
                ] as const
              ).map(([capability, label]) => {
                const disabled = capability === "nativeWebSearch" || providerType === "google";
                return (
                  <Pill
                    key={capability}
                    checked={!disabled && Boolean(model.info.capabilities?.[capability])}
                    disabled={disabled}
                    label={t(label)}
                    reason={
                      disabled
                        ? t(
                            capability === "nativeWebSearch"
                              ? "ui.byok.searchUnavailable"
                              : "ui.byok.compatUnavailable"
                          )
                        : undefined
                    }
                    onClick={() =>
                      updateInfo({
                        capabilities: {
                          ...model.info.capabilities,
                          [capability]: !model.info.capabilities?.[capability],
                        },
                      })
                    }
                  />
                );
              })}
            </div>
            <p className="tw-m-0 tw-text-xs tw-text-faint">
              {t("ui.byok.searchUnavailable")}
              {providerType === "google" && ` ${t("ui.byok.compatUnavailable")}`}
            </p>
          </div>
          <div className="tw-space-y-2">
            <HelpLabel label="ui.byok.efforts" content="ui.byok.effortHelp" container={container} />
            <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-1.5">
              {orderReasoningEfforts(["low", "high", "max", ...extraEfforts]).map((effort) => (
                <div key={effort} className="tw-group tw-relative">
                  <Pill
                    checked={
                      !(
                        effort === "max" &&
                        (providerType === "google" ||
                          (providerType === "anthropic" && !supportsMaxEffort?.(model.info.id)))
                      ) && efforts.includes(effort)
                    }
                    disabled={
                      effort === "max" &&
                      (providerType === "google" ||
                        (providerType === "anthropic" && !supportsMaxEffort?.(model.info.id)))
                    }
                    reason={effort === "max" ? t("ui.byok.maxEffortUnavailable") : undefined}
                    label={effort}
                    onClick={() =>
                      updateInfo({
                        reasoningEfforts: efforts.includes(effort)
                          ? efforts.filter((value) => value !== effort)
                          : [...efforts, effort],
                      })
                    }
                  />
                  {extraEfforts.includes(effort) && (
                    <Button
                      variant="secondary"
                      size="icon"
                      aria-label={t("ui.byok.removeEffort", { level: effort })}
                      className="tw-absolute -tw-right-1 -tw-top-1 tw-size-3 tw-rounded-full tw-opacity-0 focus:tw-opacity-100 group-hover:tw-opacity-100"
                      onClick={() => {
                        setCustomEfforts(customEfforts.filter((value) => value !== effort));
                        updateInfo({
                          reasoningEfforts: efforts.filter((value) => value !== effort),
                        });
                      }}
                    >
                      <X className="tw-size-3" />
                    </Button>
                  )}
                </div>
              ))}
              {newEffort === null && (
                <Button
                  variant="ghost2"
                  size="sm"
                  className="tw-border tw-border-dashed tw-border-border"
                  aria-label={t("ui.byok.addEffort")}
                  disabled={providerType !== "openai-compatible"}
                  title={
                    providerType !== "openai-compatible"
                      ? t("ui.byok.compatUnavailable")
                      : undefined
                  }
                  onClick={() => setNewEffort("")}
                >
                  <Plus className="tw-size-3" />
                </Button>
              )}
            </div>
            {newEffort !== null && (
              <div className="tw-flex tw-flex-wrap tw-gap-2">
                <Input
                  autoFocus
                  aria-label={t("ui.byok.addEffort")}
                  maxLength={20}
                  value={newEffort}
                  onChange={(event) => setNewEffort(event.target.value)}
                  placeholder={t("ui.byok.effortPlaceholder")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addEffort();
                    }
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setNewEffort(null);
                    }
                  }}
                />
                <Button size="sm" onClick={addEffort}>
                  {t("ui.byok.add")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  data-provider-layer-close="effort"
                  onClick={() => setNewEffort(null)}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

interface PillProps {
  checked: boolean;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  reason?: string;
  children?: React.ReactNode;
}
function Pill({ checked, label, onClick, disabled, reason, children }: PillProps) {
  return (
    <Button
      variant={checked ? "default" : "secondary"}
      size="sm"
      aria-pressed={checked}
      disabled={disabled}
      title={reason}
      onClick={onClick}
      className="tw-gap-1 tw-border tw-border-solid tw-border-border"
    >
      {checked && <Check className="tw-size-3" />}
      {label}
      {children}
    </Button>
  );
}
function HelpLabel({
  label,
  content,
  container,
}: {
  label: MessageKey;
  content: MessageKey;
  container: HTMLElement | null;
}) {
  return (
    <div className="tw-flex tw-items-center tw-gap-1 tw-text-xs tw-text-muted">
      {t(label)}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost2"
            size="icon"
            className="tw-size-5"
            aria-label={t("ui.byok.help", { name: t(label) })}
            data-provider-layer-close="help"
          >
            <HelpCircle className="tw-size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          container={container}
          side="bottom"
          align="start"
          className="tw-z-[110] tw-max-w-[calc(100vw-32px)] tw-text-xs"
        >
          {t(content)}
          <div className="tw-absolute -tw-top-1 tw-left-4 tw-size-2 tw-rotate-45 tw-border-l tw-border-t tw-border-border tw-bg-primary" />
        </PopoverContent>
      </Popover>
    </div>
  );
}

interface ModelSelectionDialogProps {
  draft: ProviderDraft;
  models: readonly ModelInfo[];
  onClose: () => void;
  onAdd: (models: ModelInfo[]) => void;
}
function ModelSelectionDialog({ draft, models, onClose, onAdd }: ModelSelectionDialogProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);
  const existing = new Set(draft.models.map((model) => model.info.id.trim()));
  const filtered = models.filter((model) =>
    `${model.id} ${model.displayName}`.toLowerCase().includes(query.toLowerCase())
  );
  const available = filtered.filter((model) => !existing.has(model.id));
  const allSelected = available.length > 0 && available.every((model) => selected.has(model.id));
  return (
    <div
      className="tw-fixed tw-inset-0 tw-z-[100] tw-flex tw-items-center tw-justify-center tw-p-4 tw-bg-secondary/80"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="byok-select-title"
        className="tw-flex tw-max-h-[80vh] tw-w-full tw-max-w-lg tw-flex-col tw-gap-3 tw-rounded-xl tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-3 tw-shadow-lg @[561px]/byok:tw-p-5"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
          if (event.key === "Tab") {
            const focusable = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), [tabindex="0"]'
              )
            );
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && event.currentTarget.ownerDocument.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (
              !event.shiftKey &&
              event.currentTarget.ownerDocument.activeElement === last
            ) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
          <h3 id="byok-select-title" className="tw-m-0 tw-text-base tw-font-semibold">
            {t("ui.byok.selectTitle")}
          </h3>
          <Button
            variant="ghost2"
            size="icon"
            aria-label={t("ui.byok.close")}
            data-provider-layer-close="selection"
            onClick={onClose}
          >
            <X className="tw-size-4" />
          </Button>
        </div>
        <p className="tw-m-0 tw-text-xs tw-text-muted">{t("ui.byok.selectSubtitle")}</p>
        <SearchBar value={query} onChange={setQuery} placeholder={t("ui.byok.searchModels")} />
        <Button
          variant="ghost2"
          size="sm"
          className="tw-self-start"
          onClick={() => {
            const next = new Set(selected);
            for (const model of available) {
              if (allSelected) next.delete(model.id);
              else next.add(model.id);
            }
            setSelected(next);
          }}
        >
          {t(allSelected ? "ui.byok.deselectAll" : "ui.byok.selectAll")}
        </Button>
        <div className="tw-min-h-24 tw-overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="tw-p-3 tw-text-center tw-text-sm tw-text-muted">
              {t(models.length === 0 ? "ui.byok.noBuiltinModels" : "ui.byok.noMatches")}
            </div>
          ) : (
            filtered.map((model) => (
              <label
                key={model.id}
                className={cn(
                  "tw-flex tw-cursor-pointer tw-items-center tw-gap-3 tw-rounded tw-p-2 hover:tw-bg-modifier-hover",
                  existing.has(model.id) && "tw-cursor-default tw-opacity-50"
                )}
              >
                <Checkbox
                  aria-label={model.id}
                  disabled={existing.has(model.id)}
                  checked={selected.has(model.id)}
                  onCheckedChange={(checked) => {
                    const next = new Set(selected);
                    if (checked) next.add(model.id);
                    else next.delete(model.id);
                    setSelected(next);
                  }}
                />
                <span className="tw-min-w-0 tw-flex-1 tw-break-all tw-font-mono tw-text-sm">
                  {model.id}
                </span>
                {existing.has(model.id) && (
                  <span className="tw-text-xs tw-text-muted">{t("ui.byok.alreadyAdded")}</span>
                )}
              </label>
            ))
          )}
        </div>
        <div className="tw-flex tw-justify-end tw-gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={selected.size === 0}
            onClick={() => onAdd(models.filter((model) => selected.has(model.id)))}
          >
            {t("ui.byok.addSelected", { count: selected.size })}
          </Button>
        </div>
      </div>
    </div>
  );
}
