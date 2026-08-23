export type AiRequestState<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "error"; message: string };

export async function runAiRequest<T>(
  request: () => Promise<T>,
  onState: (state: AiRequestState<T>) => void,
): Promise<void> {
  onState({ status: "loading" });
  try {
    onState({ status: "ready", value: await request() });
  } catch (error) {
    onState({ status: "error", message: error instanceof Error ? error.message : String(error) });
  }
}
