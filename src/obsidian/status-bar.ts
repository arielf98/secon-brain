import { statusLabel } from "./plugin-wiring.js";
import type { SyncReport } from "../sync/sync-report.js";

export class SyncStatusBar {
  constructor(private readonly element: HTMLElement) {}

  setReport(report: SyncReport): void {
    this.element.setText(statusLabel(report.status));
    this.element.dataset.syncStatus = report.status;
    this.element.title = report.errors.join("\n") || `${report.uploaded.length} uploaded, ${report.downloaded.length} downloaded`;
  }

  setText(text: string): void {
    this.element.setText(text);
  }
}
