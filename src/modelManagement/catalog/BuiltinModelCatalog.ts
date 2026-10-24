import type { CatalogProvider } from "@/modelManagement/types/catalog";
import { BUILTIN_CATALOG } from "@/modelManagement/catalog/builtinCatalog.generated";

const PROVIDERS: readonly CatalogProvider[] = Object.freeze(BUILTIN_CATALOG);
const BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

export class BuiltinModelCatalog {
  getAllProviders(): readonly CatalogProvider[] {
    return PROVIDERS;
  }

  getProvider(id: string): CatalogProvider | undefined {
    return BY_ID.get(id);
  }
}
