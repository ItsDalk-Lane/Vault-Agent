import { t } from "@/i18n";

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME_MAX = 64;

export function suffixOnCollision(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let i = 2; i < 1_000_000; i++) {
    const candidate = `${name}-${i}`;
    if (candidate.length > NAME_MAX) {
      throw new Error(t("agentInfra.skills.manager.suffixTooLong", { name, max: NAME_MAX }));
    }
    if (!NAME_RE.test(candidate)) {
      continue;
    }
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(t("agentInfra.skills.manager.suffixUnavailable", { name }));
}
