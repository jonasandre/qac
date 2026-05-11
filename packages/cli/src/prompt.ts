import { createInterface, type Interface } from 'node:readline';

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

export async function promptSecret(label: string): Promise<string> {
  process.stderr.write(`${label}: `);
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  const muted = rl as Interface & { _writeToOutput?: (s: string) => void };
  muted._writeToOutput = (s: string) => {
    // Echo only newlines so the cursor advances on Enter; suppress typed chars.
    if (s === '\n' || s === '\r\n' || s === '\r') process.stderr.write(s);
  };
  try {
    const value = await new Promise<string>((resolve) => rl.question('', (answer) => resolve(answer)));
    return value.trim();
  } finally {
    rl.close();
  }
}

export function warnLiteralSecret(flag: string): void {
  process.stderr.write(
    `qac: warning: ${flag} passed as CLI arg may leak via shell history; prefer $env:VAR_NAME or omit the flag to be prompted.\n`,
  );
}
