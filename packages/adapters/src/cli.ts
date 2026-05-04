import { execa } from 'execa'
import type { AgentConfig } from '@openrelay/core'
import type { IAgentAdapter, AgentChunk, ContextMessage, SendOptions, TokenUsage } from './types.js'

// Per-CLI invocation strategies for one-shot prompt mode
const CLI_ARGS: Record<string, (prompt: string, model: string) => string[]> = {
  claude:   (p, m) => ['--output-format', 'stream-json', '--verbose', '--model', m, '-p', p],
  opencode: (p, m) => ['run', '--message', p, '--model', m, '--output-format', 'stream-json'],
  gemini:   (p, m) => ['--model', m, '--prompt', p, '--yolo', '--skip-trust'],
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
    })

    let textBuffer = ''
    let hasRealUsage = false
    let stderrBuf = ''
    if (proc.stderr) {
      proc.stderr.on('data', (chunk: unknown) => { stderrBuf += String(chunk) })
    }

    if (proc.stdout) {
      let partial = ''
      for await (const chunk of proc.stdout) {
        partial += String(chunk)
        const lines = partial.split('\n')
        partial = lines.pop() ?? ''  // last element may be an incomplete line

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          try {
            const obj = JSON.parse(trimmed) as Record<string, unknown>

            // Streaming text chunk (Claude Code non-verbose)
            if (obj['type'] === 'text' && typeof obj['text'] === 'string') {
              textBuffer += obj['text']
              yield { type: 'text', content: obj['text'] }
              continue
            }

            // Final result event — extract text (verbose mode) + usage
            if (obj['type'] === 'result') {
              const usage = obj['usage'] as { input_tokens?: number; output_tokens?: number } | undefined
              if (usage) {
                this.usage.input  = usage.input_tokens  ?? this.usage.input
                this.usage.output = usage.output_tokens ?? this.usage.output
                hasRealUsage = true
              }
              // Verbose mode: response text is in result.result, not in streaming text events
              if (!textBuffer && typeof obj['result'] === 'string' && obj['result']) {
                textBuffer = obj['result']
                yield { type: 'text', content: obj['result'] }
              }
              yield { type: 'done', content: '' }
              continue
            }

            // All other JSON events (system, assistant, user, tool_use…) → skip
          } catch {
            // Not JSON — plain text output (e.g. Gemini)
            textBuffer += trimmed + '\n'
            yield { type: 'text', content: trimmed }
          }
        }
      }

      // Flush any remaining partial line
      if (partial.trim()) {
        try {
          const obj = JSON.parse(partial.trim()) as Record<string, unknown>
          if (obj['type'] === 'result') {
            const usage = obj['usage'] as { input_tokens?: number; output_tokens?: number } | undefined
            if (usage) {
              this.usage.input  = usage.input_tokens  ?? this.usage.input
              this.usage.output = usage.output_tokens ?? this.usage.output
              hasRealUsage = true
            }
            if (!textBuffer && typeof obj['result'] === 'string' && obj['result']) {
              textBuffer = obj['result']
              yield { type: 'text', content: obj['result'] }
            }
            yield { type: 'done', content: '' }
          }
        } catch {
          textBuffer += partial.trim() + '\n'
          yield { type: 'text', content: partial.trim() }
        }
      }
    }

    await proc

    if (proc.exitCode !== 0 && proc.exitCode !== null) {
      const detail = stderrBuf.trim().slice(0, 500)
      yield { type: 'error', content: `CLI "${cliName}" exited with code ${proc.exitCode}${detail ? ':\n' + detail : ''}` }
    } else {
      if (!hasRealUsage) this.usage.output += estimateTokens(textBuffer)
      yield { type: 'done', content: '' }
    }
  }

  getTokensUsed(): TokenUsage {
    return { ...this.usage }
  }

  async terminate(): Promise<void> {
    // execa manages subprocess cleanup on timeout/rejection
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
