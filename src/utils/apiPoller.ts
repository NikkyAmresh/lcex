/**
 * Poll run status until terminal state or max tries.
 */
export async function pollRunStatus(
  getStatus: () => Promise<{ status: number; runOutput?: string; compileError?: string } | null>,
  options: { maxTries?: number; intervalMs?: number } = {}
): Promise<{ status: number; runOutput?: string; compileError?: string } | null> {
  const { maxTries = 20, intervalMs = 500 } = options;
  for (let i = 0; i < maxTries; i++) {
    const result = await getStatus();
    if (!result) return null;
    if (result.status !== 10) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

/**
 * Poll submit status until terminal state or max tries.
 */
export async function pollSubmitStatus(
  getStatus: () => Promise<{
    status: string;
    runSuccess?: boolean;
    compileError?: string;
    runtimeError?: string;
  } | null>,
  options: { maxTries?: number; intervalMs?: number } = {}
): Promise<{
  status: string;
  runSuccess?: boolean;
  compileError?: string;
  runtimeError?: string;
} | null> {
  const { maxTries = 30, intervalMs = 500 } = options;
  for (let i = 0; i < maxTries; i++) {
    const result = await getStatus();
    if (!result) return null;
    if (result.status !== "PENDING" && result.status !== "STARTED") return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}
