export { StatusLine } from './status-line.js';
export { ChatSurface } from './chat-surface.js';
export { Header } from './header.js';
export { TabBar } from './tab-bar.js';
export { Footer } from './footer.js';
export { WaitingDot } from './waiting-dot.js';
export { KittIndicator } from './kitt-indicator.js';
export { EffortPicker, EFFORT_LEVELS } from './effort-picker.js';
export type { EffortLevel } from './effort-picker.js';
export { ModePicker, MODE_LEVELS } from './mode-picker.js';
export type { ModeLevel } from './mode-picker.js';
export { ApprovalPicker } from './approval-picker.js';
export { MascotBanner } from './mascot.js';
export { parseSlashCommand, handleSlashCommand, SLASH_COMMANDS } from './slash-commands.js';
export type { SlashCommandResult, SlashCommandContext, SlashCommandDef } from './slash-commands.js';
export type { SlashCommandInput, ChatMessage } from './chat-surface.js';
export { COLD_START_BANNER } from './chat-surface.js';
export type { TabId } from './tab-bar.js';
export { ProjectsTab } from './projects-tab.js';
export type { ProjectEntry } from './projects-tab.js';
export { StatsTab } from './stats-tab.js';
export { AgentsTab } from './agents-tab.js';
export type { AgentEntry } from './agents-tab.js';
export { ChannelsTab } from './channels-tab.js';
export type { ChannelTabEntry } from './channels-tab.js';
export { WikiTab } from './wiki-tab.js';
export type { WikiPageEntry } from './wiki-tab.js';
export {
  getInitialWizardState,
  isAlreadyInitialized,
  getConfirmationMessage,
  advanceStep,
  createIdentityFiles,
  PROVIDER_INFO,
  type InitWizardState,
  type InitData,
  type ProviderName,
} from './init-wizard.js';
