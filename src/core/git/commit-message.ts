import { spawn } from "child_process";
import * as vscode from "vscode";
import { GeneratedMessage } from "../../shared/types";

/**
 * @description Longest commit message we keep, counted over the whole message
 * (subject, blank line and body). Anything longer is clamped: the body is
 * dropped first, since the subject carries the meaning.
 */
export const MAX_MESSAGE_LENGTH = 100;

/** What the model is asked for; the diff arrives on its stdin. */
const PROMPT = [
  "Generate one short imperative commit message for the diff on stdin.",
  "Start the subject with a conventional commit prefix: feat:, fix:, docs:,",
  "style:, refactor:, perf:, test:, build:, ci:, chore: or revert:.",
  `Keep the whole message within ${MAX_MESSAGE_LENGTH} characters.`,
  "Output only the message: the subject line, optionally a blank line and a",
  "short body. No quotes, no code fence, no commentary.",
].join(" ");

/** How long the generator may take before it is killed. */
const TIMEOUT_MS = 120_000;

/**
 * @description Splits a generator's stdout into a subject and an optional body,
 * tolerating the formatting models like to add anyway (a code fence, surrounding
 * quotes, leading "Subject:" chatter).
 *
 * @param raw - The generator's stdout
 * @returns The parsed message, or `null` when there is nothing usable
 */
export function parseGeneratedMessage(raw: string): GeneratedMessage | null {
  const cleaned = raw
    .replace(/\r\n/g, "\n")
    .replace(/^\s*```[a-zA-Z]*\s*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
  if (!cleaned) {
    return null;
  }
  const lines = cleaned.split("\n");
  const summary = lines[0]
    .replace(/^[`"']+/, "")
    .replace(/[`"']+$/, "")
    .replace(/^subject:\s*/i, "")
    .trim();
  if (!summary) {
    return null;
  }
  const body = lines.slice(1).join("\n").trim();
  return fitMessage(summary, body || null);
}

/**
 * @description Keeps the message within {@link MAX_MESSAGE_LENGTH} characters
 * counted over subject plus body.
 */
function fitMessage(
  summary: string,
  description: string | null,
): GeneratedMessage {
  const whole = description ? `${summary}\n\n${description}` : summary;
  if (whole.length <= MAX_MESSAGE_LENGTH) {
    return { summary, description };
  }
  return {
    summary: clampLine(summary, MAX_MESSAGE_LENGTH),
    description: null,
  };
}

/** Truncates on a word boundary, ending with an ellipsis. */
function clampLine(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const head = (
    lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut
  ).trimEnd();
  return `${head}…`;
}

/**
 * @description Generates a commit message by piping the diff into an external
 * agent CLI (default: `omp -p --model commit`). The command and its arguments
 * are configurable, and no shell is involved: the diff is written to the
 * child's stdin, the message is read back from its stdout.
 */
export class CliCommitMessageGenerator {
  async generate(diff: string): Promise<GeneratedMessage | null> {
    const config = vscode.workspace.getConfiguration("githubDesktopPlus");
    const command = config.get<string>("commitMessageCommand", "omp").trim();
    const args = config.get<string[]>("commitMessageArgs", [
      "-p",
      "--model",
      "commit",
    ]);
    if (!command) {
      throw new Error("No commit message command configured.");
    }

    const stdout = await run(command, [...args, PROMPT], diff);
    return parseGeneratedMessage(stdout);
  }
}

function run(command: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`${command} took longer than ${TIMEOUT_MS / 1000}s.`));
    }, TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(
        error.code === "ENOENT"
          ? new Error(
              `Could not run "${command}". Set "githubDesktopPlus.commitMessageCommand" to its full path.`,
            )
          : error,
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        finish();
        return;
      }
      const detail = stderr
        .trim()
        .split("\n")
        .slice(-3)
        .join(" ")
        .slice(0, 300);
      finish(
        new Error(
          `${command} exited with ${code}${detail ? `: ${detail}` : "."}`,
        ),
      );
    });

    // A generator that ignores stdin closes it early; that must not crash us.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input);
  });
}
