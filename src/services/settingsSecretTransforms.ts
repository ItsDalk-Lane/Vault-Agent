import { DEFAULT_SETTINGS } from "@/constants";
import { type VaultAgentSettings } from "@/settings/model";
import { type CustomModel } from "@/aiParams";

export const MODEL_SECRET_FIELDS = ["apiKey"] as const;

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  const normalized = lower.replace(/[_-]/g, "");
  return (
    normalized.includes("apikey") ||
    lower.endsWith("token") ||
    lower.endsWith("accesstoken") ||
    lower.endsWith("secret") ||
    lower.endsWith("password") ||
    lower.endsWith("licensekey")
  );
}

export const TOP_LEVEL_SECRET_FIELDS: readonly string[] = Object.freeze(
  Object.keys(DEFAULT_SETTINGS as unknown as Record<string, unknown>).filter(isSensitiveKey)
);

function asRecord(obj: VaultAgentSettings): Record<string, unknown> {
  return obj as unknown as Record<string, unknown>;
}

export function stripKeychainFields(settings: VaultAgentSettings): VaultAgentSettings {
  const out = asRecord({ ...settings });

  for (const key of Object.keys(out)) {
    if (!isSensitiveKey(key)) continue;
    out[key] = "";
  }

  if ("activeModels" in out) {
    out.activeModels = stripModelSecrets(settings.activeModels ?? []);
  }
  return out as unknown as VaultAgentSettings;
}

function stripModelSecrets(models: CustomModel[]): CustomModel[] {
  if (!models?.length) return models;

  return models.map((model) => {
    const copy = { ...model } as unknown as Record<string, unknown>;
    for (const field of MODEL_SECRET_FIELDS) {
      copy[field] = "";
    }
    return copy as unknown as CustomModel;
  });
}
