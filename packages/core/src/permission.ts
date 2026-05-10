export type ApprovalMode = 'plan' | 'edit' | 'auto' | 'yolo';

// Tools that only inspect state; safe to allow in plan mode.
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch']);
export type PermissionDecision = 'allow' | 'deny' | 'ask';

export interface PermissionRule {
  allow?: string[];
  ask?: string[];
  deny?: string[];
}

export interface PermissionResult {
  decision: PermissionDecision;
  reason: string;
}

function globMatch(pattern: string, str: string): boolean {
  const regex = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${regex}$`).test(str);
}

export class PermissionEngine {
  private rules: PermissionRule;
  private _mode: ApprovalMode;

  constructor(rules: PermissionRule = {}, mode: ApprovalMode = 'auto') {
    this.rules = rules;
    this._mode = mode;
  }

  get mode(): ApprovalMode {
    return this._mode;
  }

  check(toolName: string, input?: Record<string, unknown>): PermissionResult {
    const toolPattern = this.buildToolPattern(toolName, input);

    if (this.rules.deny?.some((p) => globMatch(p, toolPattern))) {
      return { decision: 'deny', reason: `Denied by rule: ${this.rules.deny.find((p) => globMatch(p, toolPattern))}` };
    }

    if (this.rules.allow?.some((p) => globMatch(p, toolPattern))) {
      return { decision: 'allow', reason: `Allowed by rule: ${this.rules.allow.find((p) => globMatch(p, toolPattern))}` };
    }

    if (this.rules.ask?.some((p) => globMatch(p, toolPattern))) {
      return { decision: 'ask', reason: `Ask by rule: ${this.rules.ask.find((p) => globMatch(p, toolPattern))}` };
    }

    switch (this.mode) {
      case 'yolo':
        return { decision: 'allow', reason: 'yolo: unsupervised, all tools auto-approved' };
      case 'auto':
        // Every tool call goes through LLM harm-evaluation.
        return { decision: 'ask', reason: 'auto: LLM harm-evaluation required' };
      case 'edit':
        // Every mutating step asks; reads are always free.
        if (READ_ONLY_TOOLS.has(toolName)) {
          return { decision: 'allow', reason: 'edit: read-only tools allowed' };
        }
        return { decision: 'ask', reason: 'edit: every change requires approval' };
      case 'plan':
        if (READ_ONLY_TOOLS.has(toolName)) {
          return { decision: 'allow', reason: 'plan: read-only tools allowed' };
        }
        if (toolName === 'Write' && this.isPlanFileWrite(input)) {
          return { decision: 'allow', reason: 'plan: writing plan file under plans/' };
        }
        return { decision: 'deny', reason: 'plan: mutations blocked — present a plan instead' };
      default:
        return { decision: 'ask', reason: 'unknown mode: defaulting to ask' };
    }
  }

  private isPlanFileWrite(input?: Record<string, unknown>): boolean {
    const p = typeof input?.['file_path'] === 'string' ? (input['file_path'] as string) : '';
    if (!p) return false;
    // Match any path whose last directory segment is "plans" (or contains /plans/).
    const normalized = p.replace(/\\/g, '/');
    return /(^|\/)plans\//.test(normalized);
  }

  private buildToolPattern(name: string, input?: Record<string, unknown>): string {
    if (name === 'Bash' && input?.command) {
      return `Bash(${String(input.command)})`;
    }
    return name;
  }
}
