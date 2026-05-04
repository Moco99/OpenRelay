import { execa } from 'execa'
import type { AgentConfig } from '@openrelay/core'
import type { IAgentAdapter, AgentChunk, ContextMessage, SendOptions, TokenUsage } from './types.js'

// Per-CLI invocation strategies for one-shot prompt mode
const CLI_ARGS: Record<string, (prompt: string, model: string) => string[]> = {
  claude:   (p, m) => ['--output-format', 'stream-json', '--model', m, '-p', p],
  opencode: (p, m) => ['run', '--message', p, '--model', m, '--output-format', 'stream-json'],
  gemini:   (p, m) => ['--model', m, '--prompt', p, '--yolo'],
  codex:    (p, _) => [p],
}
const DEFAULT_ARGS = (p: string, _m: string): string[] => ['-p', p]

export class CliAdapter implements IAgentAdapter {
  private usage: TokenUsage = { input: 0, output: 0 }

  constructor(private config: AgentConfig) {}

  async *send(prompt: string, context: ContextMessage[], options: SendOptions = {}): AsyncGenerator<AgentChunk> {
    const timeout = options.timeout ?? 120_000
    const cliName = this.config.cli!
    const argBuilder = CLI_ARGS[cliName] ?? DEFAULT_ARGS
    const args = argBuilder(prompt, this.config.model)

    this.usage.input += estimateTokens(prompt + context.map(c => c.content).join(' '))

    const proc = execa(cliName, args, {
      cwd: this.config.workingDir,
      env: { ...process.env, ...this.config.env },
      timeout,
      reject: false,
      lines: true,
    })

    let outputBuffer = ''

    if (proc.stdout) {
      for await (const line of proc.stdout) {
        const str = String(line)
        const parsed = this.tryParseStreamJson(str)
        if (parsed) {
          yield parsed
          continue
        }
        outputBuffer += str + '\n'
        yield { type: 'text', content: str }
      }
    }

    await proc

    if (proc.exitCode !== 0 && proc.exitCode !== null) {
      yield { type: 'error', content: `CLI "${cliName}" exited with code ${proc.exitCode}` }
    } else {
      this.usage.output += estimateTokens(outputBuffer)
      yield { type: 'done', content: '' }
    }
  }

  getTokensUsed(): TokenUsage {
    return { ...this.usage }
  }

  async terminate(): Promise<void> {
    // execa manages subprocess cleanup on timeout/rejection
  }

  // Parses Claude Code / OpenCode stream-json events.
  // Updates this.usage if a result event contains usage stats.
  private tryParseStreamJson(line: string): AgentChunk | null {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>

      if (obj['type'] === 'text' && typeof obj['text'] === 'string') {
        return { type: 'text', content: obj['text'] }
      }

      if (obj['type'] === 'result') {
        const usage = obj['usage'] as { input_tokens?: number; output_tokens?: number } | undefined
        if (usage) {
          this.usage.input  = usage.input_tokens  ?? this.usage.input
          this.usage.output = usage.output_tokens ?? this.usage.output
        }
        return { type: 'done', content: '' }
      }
    } catch {
      // Not JSON — caller will handle as plain text
    }
    return null
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
