export type CommandDecision = 'allow' | 'ask' | 'deny';

export interface CommandResult {
  decision: CommandDecision;
  reason: string;
  pattern?: string;
}

interface CommandPattern {
  regex: RegExp;
  reason: string;
}

const HARD_DENY_PATTERNS: CommandPattern[] = [
  {
    regex: /rm\s+(-[rf]+\s+)*\//i,
    reason: 'rm: deletion of filesystem root (/)',
  },
  {
    regex: /rm\s+(-[rf]+\s+)*~/i,
    reason: 'rm: deletion of home directory (~)',
  },
  {
    regex: /cd\s+\/[\s;|&]([^;|&]*)?\s*(?:&&\s*)?(?:rm|del|format|mkfs|dd)/i,
    reason: 'cd / followed by destructive command',
  },
  {
    regex: /del\s+\/[sSqQfF]\s+/,
    reason: 'del: Windows delete with /S /Q flags',
  },
  {
    regex: /format\s+[a-z]:/i,
    reason: 'format: Windows drive formatting',
  },
  {
    regex: /mkfs(\.\w+)?\s+\/dev\//,
    reason: 'mkfs: filesystem creation on block device',
  },
  {
    regex: /dd\s+.*of=\/dev\/(sd|nvme|hd)/,
    reason: 'dd: raw disk write to block device',
  },
  {
    regex: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    reason: 'fork bomb detected (:() { :|:& };:)',
  },
  {
    regex: /^(shutdown|reboot|halt|poweroff)\b/i,
    reason: 'system shutdown/reboot/halt/poweroff command',
  },
  {
    regex: /sudo\s+(rm|dd|mkfs)\s/i,
    reason: 'sudo escalation combined with destructive command',
  },
  {
    regex: /(?:cat|grep|less|more|head|tail)\s+.*\.curie-settings\.json/i,
    reason: 'reading curie-agent settings file (contains API keys and secrets)',
  },
  // PowerShell equivalents
  {
    regex: /Remove-Item\s+.*(?:-Recurse|-Force).*(?:-Force|-Recurse)\s+[\/\\C-Z:]/i,
    reason: 'PowerShell Remove-Item: recursive force delete of root or drive path',
  },
  {
    regex: /Get-Content\s+.*\.curie-settings\.json/i,
    reason: 'PowerShell: reading curie-agent settings file (contains API keys and secrets)',
  },
  {
    regex: /Set-Content\s+.*\\\\\.\\PhysicalDrive/i,
    reason: 'PowerShell: raw disk write to physical drive',
  },
];

const ASK_PATTERNS: CommandPattern[] = [
  {
    regex: /curl\s+.*\|\s*(sh|bash|zsh|pwsh|powershell)/i,
    reason: 'pipe curl output to a shell (remote code execution risk)',
  },
  {
    regex: /wget\s+.*\|\s*(sh|bash|zsh|pwsh|powershell)/i,
    reason: 'pipe wget output to a shell (remote code execution risk)',
  },
  {
    regex: /\bsudo\b/i,
    reason: 'sudo: privilege escalation',
  },
  {
    regex: /chmod\s+-R\s+(777|0777)/,
    reason: 'chmod -R 777/0777: dangerous recursive permissions change',
  },
  {
    regex: /git\s+push\s+--force(?:-with-lease)?\s+(?:\S+\s+)?(main|master|HEAD)\b/i,
    reason: 'git push --force/--force-with-lease on a protected branch',
  },
  {
    regex: /\b(npm|pnpm|yarn)\s+publish\b/i,
    reason: 'irreversible npm/pnpm/yarn publish action',
  },
  {
    regex: /(?:grep|cat)\s+.*\/(?:\.ssh\/|\.aws\/|id_rsa|credentials\.json)/i,
    reason: 'credential file read: SSH keys, AWS credentials, or secrets',
  },
  {
    regex: /(?:grep|cat)\s+.*\/\.env\b/i,
    reason: 'env file read: accessing .env file contents',
  },
  // PowerShell equivalents
  {
    regex: /Invoke-Expression\s*\(?\s*(?:Invoke-WebRequest|iwr|curl|wget)\b/i,
    reason: 'PowerShell: remote code execution via Invoke-Expression + web download',
  },
  {
    regex: /\biex\s*\(?\s*(?:iwr|curl|wget)\b/i,
    reason: 'PowerShell: remote code execution via iex alias',
  },
  {
    regex: /Start-Process\s+.*-Verb\s+RunAs\b/i,
    reason: 'PowerShell: UAC elevation request (sudo equivalent)',
  },
  {
    regex: /Get-Content\s+.*\.env\b/i,
    reason: 'PowerShell: env file read via Get-Content',
  },
  {
    regex: /Get-Content\s+.*(?:\.ssh[\/\\]|\.aws[\/\\]|id_rsa|credentials\.json)/i,
    reason: 'PowerShell: credential file read via Get-Content',
  },
];

export function classifyCommand(command: string): CommandResult {
  const normalized = command.replace(/\s+/g, ' ').trim();

  for (const p of HARD_DENY_PATTERNS) {
    if (p.regex.test(normalized)) {
      return { decision: 'deny', reason: p.reason, pattern: 'destructive' };
    }
  }

  for (const p of ASK_PATTERNS) {
    if (p.regex.test(normalized)) {
      return { decision: 'ask', reason: p.reason, pattern: 'risky' };
    }
  }

  return { decision: 'allow', reason: 'no risky patterns detected' };
}
