import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type TruncationResult,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";

export interface BoundedOutput {
  text: string;
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

export async function boundToolOutput(output: string, temporaryPrefix: string): Promise<BoundedOutput> {
  const initial = truncateHead(output, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  if (!initial.truncated) return { text: output };

  const directory = await mkdtemp(join(tmpdir(), `${temporaryPrefix}-`));
  await chmod(directory, 0o700);
  const fullOutputPath = join(directory, "output.md");
  await withFileMutationQueue(fullOutputPath, async () => {
    await writeFile(fullOutputPath, output, { encoding: "utf8", mode: 0o600 });
    await chmod(fullOutputPath, 0o600);
  });
  const notice = `\n\n[Output truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}. Full output saved to: ${fullOutputPath}]`;
  const bounded = truncateHead(output, {
    maxBytes: DEFAULT_MAX_BYTES - Buffer.byteLength(notice, "utf8"),
    maxLines: DEFAULT_MAX_LINES - notice.split("\n").length + 1,
  });
  return { text: bounded.content + notice, truncation: initial, fullOutputPath };
}
