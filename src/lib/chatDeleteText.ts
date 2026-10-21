import { t } from "@/i18n";

interface DeleteTextDescriptor {
  displayName: string;
  agentProductName?: string;
}

function agentName(descriptor: DeleteTextDescriptor): string {
  return descriptor.agentProductName ?? descriptor.displayName;
}

export function describeChatDelete(descriptor: DeleteTextDescriptor | undefined): string {
  return descriptor
    ? t("chatDelete.confirmWithAgent", { agent: agentName(descriptor) })
    : t("chatDelete.confirm");
}

export function formatChatDeleteNotice(descriptor: DeleteTextDescriptor | undefined): string {
  return descriptor
    ? t("chatDelete.noticeWithAgent", { agent: agentName(descriptor) })
    : t("chatDelete.notice");
}
