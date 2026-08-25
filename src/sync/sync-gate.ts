export class SyncGate {
  private active?: Promise<void>;

  run(operation: () => Promise<void>): Promise<boolean> {
    if (this.active) return Promise.resolve(false);
    const task = operation();
    this.active = task;
    return task
      .then(() => true)
      .finally(() => {
        if (this.active === task) this.active = undefined;
      });
  }
}
