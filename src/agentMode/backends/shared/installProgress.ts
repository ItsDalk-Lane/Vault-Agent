import { t } from "@/i18n";
import { formatBytes } from "@/utils/formatBytes";

export interface ManagedInstallProgress {
  label: string;
  percent: number;
}

const ELAPSED_TICK_MS = 5_000;
const DOWNLOAD_START_PERCENT = 10;
const DOWNLOAD_END_PERCENT = 75;

export class InstallProgressReporter {
  private ticker: number | null = null;

  constructor(
    private readonly displayName: string,
    private readonly publish: (progress: ManagedInstallProgress) => void
  ) {}

  connecting(): void {
    this.phase(t("agentInfra.backend.progress.connecting", { name: this.displayName }), 5);
  }

  download(received: number, total: number): void {
    this.stopTicker();
    const fraction = Math.min(1, received / total);
    this.publish({
      label: t("agentInfra.backend.progress.downloading", {
        name: this.displayName,
        received: formatBytes(received),
        total: formatBytes(total),
      }),
      percent:
        DOWNLOAD_START_PERCENT +
        Math.floor(fraction * (DOWNLOAD_END_PERCENT - DOWNLOAD_START_PERCENT)),
    });
  }

  extracting(): void {
    this.phase(t("agentInfra.backend.progress.extracting", { name: this.displayName }), 80);
  }

  verifying(subject = this.displayName): void {
    this.phase(t("agentInfra.backend.progress.verifying", { subject }), 90);
  }

  activating(): void {
    this.phase(t("agentInfra.backend.progress.activating", { name: this.displayName }), 98);
  }

  done(): void {
    this.stopTicker();
    this.publish({
      label: t("agentInfra.backend.progress.ready", { name: this.displayName }),
      percent: 100,
    });
  }

  dispose(): void {
    this.stopTicker();
  }

  private phase(label: string, percent: number): void {
    this.stopTicker();
    this.publish({ label, percent });
    const startedAt = Date.now();
    this.ticker = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      this.publish({
        label: t("agentInfra.backend.progress.elapsed", { label, seconds }),
        percent,
      });
    }, ELAPSED_TICK_MS);
  }

  private stopTicker(): void {
    if (this.ticker !== null) window.clearInterval(this.ticker);
    this.ticker = null;
  }
}
