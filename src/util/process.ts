import { spawn } from 'child_process';
import { CancellationToken } from 'vscode';

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function spawnAsync(
  command: string,
  args: string[],
  cwd: string,
  token?: CancellationToken,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, shell: true });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on('error', (err) => {
      reject(err);
    });

    if (token) {
      token.onCancellationRequested(() => {
        proc.kill('SIGTERM');
        reject(new Error('Cancelled'));
      });
    }
  });
}
