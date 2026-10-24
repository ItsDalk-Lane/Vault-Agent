import { Scope } from "obsidian";

export function createProviderModalScope(
  parent: Scope,
  content: HTMLElement,
  close: () => void
): Scope {
  // Obsidian 的模态快捷键早于 React 浮层处理 Escape，必须先关闭最内层界面：https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  const scope = new Scope(parent);
  scope.register([], "Escape", () => {
    const innerClose =
      content.querySelector<HTMLElement>('[data-provider-layer-close="selection"]') ??
      content.querySelector<HTMLElement>(
        '[data-provider-layer-close="menu"][data-state="open"], [data-provider-layer-close="help"][data-state="open"]'
      ) ??
      content.querySelector<HTMLElement>('[data-provider-layer-close="effort"]');
    if (innerClose) innerClose.click();
    else close();
    return false;
  });
  return scope;
}
