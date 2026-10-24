import { CustomModel } from "@/aiParams";
import { DEFAULT_BUILTIN_PREFERENCES } from "@/builtinSkills/builtinSkills";
import type { MessageKey } from "@/i18n";
import { type VaultAgentSettings } from "@/settings/model";
import { PromptSortStrategy } from "./types";

export const CHAT_VIEWTYPE = "vault-agent-chat-view";
export const CHAT_AGENT_VIEWTYPE = "vault-agent-chat-view";
export const AGENT_CHAT_MODE = "agent";
export const RELEVANT_NOTES_VIEWTYPE = "vault-agent-relevant-notes-view";
export const PLAN_PREVIEW_VIEW_TYPE = "vault-agent-plan-preview-view";
export const TURN_DIFF_VIEW_TYPE = "vault-agent-turn-diff-view";
export const APPLY_VIEW_TYPE = "vault-agent-apply-view";
export const SHARED_VIEW_TYPES = [CHAT_VIEWTYPE, APPLY_VIEW_TYPE, RELEVANT_NOTES_VIEWTYPE] as const;
export const DESKTOP_VIEW_TYPES = [
  ...SHARED_VIEW_TYPES,
  CHAT_AGENT_VIEWTYPE,
  PLAN_PREVIEW_VIEW_TYPE,
  TURN_DIFF_VIEW_TYPE,
] as const;
export const AGENT_VIEW_TYPES = [
  CHAT_AGENT_VIEWTYPE,
  PLAN_PREVIEW_VIEW_TYPE,
  TURN_DIFF_VIEW_TYPE,
] as const;

export const VAULT_AGENT_ICON_ID = "vault-agent";

export const VAULT_AGENT_ICON_TRANSFORM = "translate(0 8.2) scale(0.6579) translate(-4 -4)";
export const VAULT_AGENT_ICON_PATH =
  "M75.9 6.9c-6.8 1.4-12.5 6-35.5 29.3-33.5 33.8-33.5 33.9-34.2 62.2-0.3 12.4 0 20.2 0.7 22.7 2.4 7.8 10.8 11.2 17.6 7.1 1.7-1.1 14.9-14.1 29.5-29.1 14.5-14.9 26.7-27 27-26.9 0.3 0.2 12.4 12.4 27 27.3 14.6 14.8 27.6 27.8 29 28.7 5.1 3.6 13.6 1.4 16.5-4.2 1.2-2.3 1.5-6.9 1.5-22.3 0-22.9-1.2-28.6-8.3-37.9-7.6-10.2-50-52.3-54.9-54.6-5.1-2.4-10.9-3.2-15.9-2.3z";

export const VAULT_AGENT_ICON_SVG = `<g transform="${VAULT_AGENT_ICON_TRANSFORM}"><path fill="currentColor" d="${VAULT_AGENT_ICON_PATH}"/></g>`;

export const USER_SENDER = "user";
export const AI_SENDER = "ai";

export const VAULT_AGENT_FOLDER_ROOT = "vault-agent";
export const DEFAULT_VAULT_AGENT_FOLDER = VAULT_AGENT_FOLDER_ROOT;
export const DEFAULT_SKILLS_FOLDER = `${VAULT_AGENT_FOLDER_ROOT}/skills`;
export const VAULT_AGENT_CONVERSATION_TAG = "vault-agent-conversation";
export const DEFAULT_QA_EXCLUSIONS_SETTING = VAULT_AGENT_FOLDER_ROOT;
export const DEFAULT_SYSTEM_PROMPT = `You are Vault Agent, a helpful assistant that integrates AI to Obsidian note-taking.
  1. Never mention that you do not have access to something. Always rely on the user provided context.
  2. Always answer to the best of your knowledge. If you are unsure about something, say so and ask the user to provide more context.
  3. If the user mentions "note", it most likely means an Obsidian note in the vault, not the generic meaning of a note.
  4. If the user mentions "@vault", it means the user wants you to search the Obsidian vault for information relevant to the query. The search results will be provided to you in the context along with the user query, read it carefully and answer the question based on the information provided. If there's no relevant information in the vault, just say so.
  5. If the user mentions any other tool with the @ symbol, check the context for their results. If nothing is found, just ignore the @ symbol in the query.
  6. Always use $'s instead of \\[ etc. for LaTeX equations.
  7. When showing note titles, use [[title]] format and do not wrap them in \` \`.
  8. When showing **Obsidian internal** image links, use ![[link]] format and do not wrap them in \` \`.
  9. When showing **web** image links, use ![link](url) format and do not wrap them in \` \`.
  10. When generating a table, format as github markdown tables, however, for table headings, immediately add ' |' after the table heading.
  11. Always respond in the language of the user's query.
  12. Do NOT mention the additional context provided such as getCurrentTime and getTimeRangeMs if it's irrelevant to the user message.
  13. If the user mentions "tags", it most likely means tags in Obsidian note properties.
  14. YouTube URLs: If the user provides YouTube URLs in their message, transcriptions will be automatically fetched and provided to you. You don't need to do anything special - just use the transcription content if available.`;

export const COMPOSER_OUTPUT_INSTRUCTIONS = `Return the new note content or canvas JSON in <writeFile> tags.

  # Steps to find the the target notes
  1. Extract the target note information from user message and find out the note path from the context below.
  2. If target note is not specified, use the <active_note> as the target note.
  3. If still failed to find the target note or the note path, ask the user to specify the target note.

  # Examples

  Input: Add a new section to note A
  Output:
  <writeFile>
  <path>path/to/file.md</path>
  <content>The FULL CONTENT of the note A with added section goes here</content>
  </writeFile>

  Input: Create a new canvas with "Hello, world!"
  Output:
  <writeFile>
  <path>path/to/file.canvas</path>
  <content>
  {
    "nodes": [
      {
        "id": "1",
        "type": "text",
        "text": "Hello, world!",
        "x": 0,
        "y": 0,
        "width": 200,
        "height": 50
      }
    ],
    "edges": []
  }
  </content>
  </writeFile>

  Input: Create a canvas with a file node and a group
  Output:
  <writeFile>
  <path>path/to/file.canvas</path>
  <content>
  {
    "nodes": [
      {"id": "1", "type": "file", "file": "note.md", "subpath": "#heading", "x": 100, "y": 100, "width": 300, "height": 200, "color": "2"},
      {"id": "2", "type": "group", "label": "My Group", "x": 50, "y": 50, "width": 400, "height": 300, "color": "1"},
      {"id": "3", "type": "link", "url": "https://example.com", "x": 500, "y": 100, "width": 200, "height": 100, "color": "#FF5733"}
    ],
    "edges": [
      {"id": "e1-2", "fromNode": "1", "toNode": "3", "fromSide": "right", "toSide": "left", "fromEnd": "arrow", "toEnd": "none", "color": "3", "label": "references"}
    ]
  }
  </content>
  </writeFile>

  # Canvas JSON Format (JSON Canvas spec 1.0)
  Required node fields: id, type, x, y, width, height
  Node types: "text" (needs text), "file" (needs file), "link" (needs url), "group" (optional label)
  Optional node fields: color (hex #FF0000 or preset "1"-"6"), subpath (file nodes, starts with #)
  Required edge fields: id, fromNode, toNode
  Optional edge fields: fromSide/toSide ("top"/"right"/"bottom"/"left"), fromEnd/toEnd ("none"/"arrow"), color, label
  All IDs must be unique. Edge nodes must reference existing node IDs.
  Position nodes with reasonable spacing and logical visual flow.
  `;

export const NOTE_CONTEXT_PROMPT_TAG = "note_context";
export const SELECTED_TEXT_TAG = "selected_text";
export const WEB_SELECTED_TEXT_TAG = "web_selected_text";
export const VARIABLE_TAG = "variable";
export const VARIABLE_NOTE_TAG = "variable_note";
export const EMBEDDED_PDF_TAG = "embedded_pdf";
export const EMBEDDED_NOTE_TAG = "embedded_note";
export const DATAVIEW_BLOCK_TAG = "dataview_block";
export const WEB_TAB_CONTEXT_TAG = "web_tab_context";
export const ACTIVE_WEB_TAB_CONTEXT_TAG = "active_web_tab";
export const YOUTUBE_VIDEO_CONTEXT_TAG = "youtube_video_context";
export const ACTIVE_WEB_TAB_MARKER = "{activeWebTab}";
export const CHUNK_SIZE = 6000;
export const TEXT_WEIGHT = 0.4;
export const MAX_CHARS_FOR_LOCAL_SEARCH_CONTEXT = 448000;
export const LLM_TIMEOUT_MS = 30000;
export const AGENT_LOOP_TIMEOUT_MS = 5 * 60 * 1000;
export const LOADING_MESSAGES = {
  DEFAULT: "",
  READING_FILES: "Reading files",
  SEARCHING_WEB: "Searching the web",
  READING_FILE_TREE: "Reading file tree",
  COMPACTING: "Compacting",
};

export enum ReasoningEffort {
  MINIMAL = "minimal",
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  XHIGH = "xhigh",
}

export enum Verbosity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}

/**
 * Output length to request from Anthropic, the one provider that will not accept "no limit".
 *
 * The Anthropic SDK rejects a non-streaming request it estimates will take over ten minutes
 * (`60min * maxTokens / 128_000`, so 21,333 tokens), and a provider rejects a request whose
 * prompt plus requested output exceeds the context window.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/312
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 20_000;

export const DEFAULT_MODEL_SETTING = {
  REASONING_EFFORT: ReasoningEffort.LOW,
  VERBOSITY: Verbosity.MEDIUM,
} as const;

export const DEFAULT_OLLAMA_NUM_CTX = 131072;

export enum ChatModels {
  GPT_5_5 = "gpt-5.5",
  GPT_5_4_mini = "gpt-5.4-mini",
  GPT_41 = "gpt-4.1",
  GPT_41_mini = "gpt-4.1-mini",
  GEMINI_3_PRO_PREVIEW = "gemini-3.1-pro-preview",
  GEMINI_3_5_FLASH = "gemini-3.5-flash",
  GEMINI_3_FLASH_LITE = "gemini-3.1-flash-lite",
  GEMINI_PRO = "gemini-2.5-pro",
  GEMINI_FLASH = "gemini-2.5-flash",
  CLAUDE_OPUS_4_7 = "claude-opus-4-7",
  CLAUDE_SONNET_4_6 = "claude-sonnet-4-6",
  CLAUDE_HAIKU_4_5 = "claude-haiku-4-5",
  GROK_4_3 = "grok-4.3",
  GROQ_LLAMA_8b = "llama3-8b-8192",
  COMMAND_R = "command-r",
  MISTRAL_TINY = "mistral-tiny-latest",
  DEEPSEEK_REASONER = "deepseek-reasoner",
  DEEPSEEK_CHAT = "deepseek-chat",
  OPENROUTER_GEMINI_3_5_FLASH = "google/gemini-3.5-flash",
  OPENROUTER_GEMINI_3_PRO_PREVIEW = "google/gemini-3.1-pro-preview",
  OPENROUTER_GEMINI_2_5_FLASH = "google/gemini-2.5-flash",
  OPENROUTER_GEMINI_2_5_PRO = "google/gemini-2.5-pro",
  OPENROUTER_GPT_5_5 = "openai/gpt-5.5",
  OPENROUTER_GPT_5_4_MINI = "openai/gpt-5.4-mini",
  OPENROUTER_GROK_4_3 = "x-ai/grok-4.3",
  SILICONFLOW_DEEPSEEK_V3 = "deepseek-ai/DeepSeek-V3",
  SILICONFLOW_DEEPSEEK_R1 = "deepseek-ai/DeepSeek-R1",
}

export enum ChatModelProviders {
  OPENROUTERAI = "openrouterai",
  OPENAI = "openai",
  OPENAI_FORMAT = "3rd party (openai-format)",
  ANTHROPIC = "anthropic",
  GOOGLE = "google",
  XAI = "xai",
  GROQ = "groq",
  OLLAMA = "ollama",
  LM_STUDIO = "lm-studio",
  MISTRAL = "mistralai",
  DEEPSEEK = "deepseek",
  COHEREAI = "cohereai",
  SILICONFLOW = "siliconflow",
}

export enum ModelCapability {
  REASONING = "reasoning",
  VISION = "vision",
  WEB_SEARCH = "websearch",
}

export const BUILTIN_CHAT_MODELS: CustomModel[] = [
  {
    name: ChatModels.OPENROUTER_GEMINI_2_5_FLASH,
    provider: ChatModelProviders.OPENROUTERAI,
    enabled: true,
    isBuiltIn: true,
    core: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.OPENROUTER_GEMINI_3_5_FLASH,
    provider: ChatModelProviders.OPENROUTERAI,
    enabled: true,
    isBuiltIn: true,
    capabilities: [ModelCapability.VISION, ModelCapability.REASONING],
  },
  {
    name: ChatModels.GPT_5_5,
    provider: ChatModelProviders.OPENAI,
    enabled: true,
    isBuiltIn: true,
    core: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.GPT_5_4_mini,
    provider: ChatModelProviders.OPENAI,
    enabled: true,
    isBuiltIn: true,
    core: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.CLAUDE_SONNET_4_6,
    provider: ChatModelProviders.ANTHROPIC,
    enabled: true,
    isBuiltIn: true,
    capabilities: [ModelCapability.VISION, ModelCapability.REASONING],
  },
  {
    name: ChatModels.GEMINI_3_5_FLASH,
    provider: ChatModelProviders.GOOGLE,
    enabled: true,
    isBuiltIn: true,
    capabilities: [ModelCapability.VISION, ModelCapability.REASONING],
  },
  {
    name: ChatModels.GEMINI_3_FLASH_LITE,
    provider: ChatModelProviders.GOOGLE,
    enabled: true,
    isBuiltIn: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.GEMINI_FLASH,
    provider: ChatModelProviders.GOOGLE,
    enabled: true,
    isBuiltIn: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.OPENROUTER_GEMINI_3_PRO_PREVIEW,
    provider: ChatModelProviders.OPENROUTERAI,
    enabled: false,
    isBuiltIn: true,
    capabilities: [ModelCapability.VISION, ModelCapability.REASONING],
  },
  {
    name: ChatModels.OPENROUTER_GEMINI_2_5_PRO,
    provider: ChatModelProviders.OPENROUTERAI,
    enabled: false,
    isBuiltIn: true,
    core: false,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.OPENROUTER_GPT_5_5,
    provider: ChatModelProviders.OPENROUTERAI,
    enabled: false,
    isBuiltIn: true,
    core: false,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.OPENROUTER_GPT_5_4_MINI,
    provider: ChatModelProviders.OPENROUTERAI,
    enabled: false,
    isBuiltIn: true,
    core: false,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.GROK_4_3,
    provider: ChatModelProviders.XAI,
    enabled: false,
    isBuiltIn: true,
    core: false,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.OPENROUTER_GROK_4_3,
    provider: ChatModelProviders.OPENROUTERAI,
    enabled: false,
    isBuiltIn: true,
    core: false,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.GPT_41,
    provider: ChatModelProviders.OPENAI,
    enabled: false,
    isBuiltIn: true,
    core: false,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.GPT_41_mini,
    provider: ChatModelProviders.OPENAI,
    enabled: false,
    isBuiltIn: true,
    core: false,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.CLAUDE_OPUS_4_7,
    provider: ChatModelProviders.ANTHROPIC,
    enabled: false,
    isBuiltIn: true,
    capabilities: [ModelCapability.VISION, ModelCapability.REASONING],
  },
  {
    name: ChatModels.CLAUDE_HAIKU_4_5,
    provider: ChatModelProviders.ANTHROPIC,
    enabled: false,
    isBuiltIn: true,
    capabilities: [ModelCapability.VISION, ModelCapability.REASONING],
  },
  {
    name: ChatModels.GEMINI_3_PRO_PREVIEW,
    provider: ChatModelProviders.GOOGLE,
    enabled: false,
    isBuiltIn: true,
    capabilities: [ModelCapability.VISION, ModelCapability.REASONING],
  },
  {
    name: ChatModels.GEMINI_PRO,
    provider: ChatModelProviders.GOOGLE,
    enabled: false,
    isBuiltIn: true,
    capabilities: [ModelCapability.VISION],
  },
  {
    name: ChatModels.DEEPSEEK_CHAT,
    provider: ChatModelProviders.DEEPSEEK,
    enabled: false,
    isBuiltIn: true,
  },
  {
    name: ChatModels.DEEPSEEK_REASONER,
    provider: ChatModelProviders.DEEPSEEK,
    enabled: false,
    isBuiltIn: true,
    capabilities: [ModelCapability.REASONING],
  },
  {
    name: ChatModels.SILICONFLOW_DEEPSEEK_V3,
    provider: ChatModelProviders.SILICONFLOW,
    enabled: false,
    isBuiltIn: false,
    baseUrl: "https://api.siliconflow.com/v1",
  },
  {
    name: ChatModels.SILICONFLOW_DEEPSEEK_R1,
    provider: ChatModelProviders.SILICONFLOW,
    enabled: false,
    isBuiltIn: false,
    baseUrl: "https://api.siliconflow.com/v1",
    capabilities: [ModelCapability.REASONING],
  },
];

export type Provider = ChatModelProviders;

export type SettingKeyProviders = Exclude<
  ChatModelProviders,
  ChatModelProviders.OPENAI_FORMAT | ChatModelProviders.LM_STUDIO | ChatModelProviders.OLLAMA
>;

export interface ProviderMetadata {
  label: string;
  host: string;
  curlBaseURL: string;
  keyManagementURL: string;
  testModel?: ChatModels;
}

export const ProviderInfo: Record<Provider, ProviderMetadata> = {
  [ChatModelProviders.OPENROUTERAI]: {
    label: "OpenRouter",
    host: "https://openrouter.ai/api/v1/",
    curlBaseURL: "https://openrouter.ai/api/v1",
    keyManagementURL: "https://openrouter.ai/keys",
    testModel: ChatModels.OPENROUTER_GPT_5_4_MINI,
  },
  [ChatModelProviders.GOOGLE]: {
    label: "Gemini",
    host: "https://generativelanguage.googleapis.com",
    curlBaseURL: "https://generativelanguage.googleapis.com/v1beta",
    keyManagementURL: "https://makersuite.google.com/app/apikey",
    testModel: ChatModels.GEMINI_FLASH,
  },
  [ChatModelProviders.ANTHROPIC]: {
    label: "Anthropic",
    host: "https://api.anthropic.com/",
    curlBaseURL: "https://api.anthropic.com",
    keyManagementURL: "https://console.anthropic.com/settings/keys",
    testModel: ChatModels.CLAUDE_SONNET_4_6,
  },
  [ChatModelProviders.OPENAI]: {
    label: "OpenAI",
    host: "https://api.openai.com",
    curlBaseURL: "https://api.openai.com/v1",
    keyManagementURL: "https://platform.openai.com/api-keys",
    testModel: ChatModels.GPT_5_5,
  },
  [ChatModelProviders.XAI]: {
    label: "XAI",
    host: "https://api.x.ai/v1",
    curlBaseURL: "https://api.x.ai/v1",
    keyManagementURL: "https://console.x.ai",
    testModel: ChatModels.GROK_4_3,
  },
  [ChatModelProviders.GROQ]: {
    label: "Groq",
    host: "https://api.groq.com/openai",
    curlBaseURL: "https://api.groq.com/openai/v1",
    keyManagementURL: "https://console.groq.com/keys",
    testModel: ChatModels.GROQ_LLAMA_8b,
  },
  [ChatModelProviders.COHEREAI]: {
    label: "Cohere",
    host: "https://api.cohere.ai/compatibility/v1",
    curlBaseURL: "https://api.cohere.ai/compatibility/v1",
    keyManagementURL: "https://dashboard.cohere.ai/api-keys",
    testModel: ChatModels.COMMAND_R,
  },
  [ChatModelProviders.SILICONFLOW]: {
    label: "SiliconFlow",
    host: "https://api.siliconflow.com/v1",
    curlBaseURL: "https://api.siliconflow.com/v1",
    keyManagementURL: "https://cloud.siliconflow.com/me/account/ak",
    testModel: ChatModels.SILICONFLOW_DEEPSEEK_V3,
  },
  [ChatModelProviders.OLLAMA]: {
    label: "Ollama",
    host: "http://localhost:11434/v1/",
    curlBaseURL: "http://localhost:11434",
    keyManagementURL: "",
  },
  [ChatModelProviders.LM_STUDIO]: {
    label: "LM Studio",
    host: "http://localhost:1234/v1",
    curlBaseURL: "http://localhost:1234/v1",
    keyManagementURL: "",
  },
  [ChatModelProviders.OPENAI_FORMAT]: {
    label: "OpenAI Format",
    host: "https://api.example.com/v1",
    curlBaseURL: "https://api.example.com/v1",
    keyManagementURL: "",
  },
  [ChatModelProviders.MISTRAL]: {
    label: "Mistral",
    host: "https://api.mistral.ai/v1",
    curlBaseURL: "https://api.mistral.ai/v1",
    keyManagementURL: "https://console.mistral.ai/api-keys",
    testModel: ChatModels.MISTRAL_TINY,
  },
  [ChatModelProviders.DEEPSEEK]: {
    label: "DeepSeek",
    host: "https://api.deepseek.com/",
    curlBaseURL: "https://api.deepseek.com",
    keyManagementURL: "https://platform.deepseek.com/api-keys",
    testModel: ChatModels.DEEPSEEK_CHAT,
  },
};

export const ProviderSettingsKeyMap: Record<SettingKeyProviders, keyof VaultAgentSettings> = {
  anthropic: "anthropicApiKey",
  openai: "openAIApiKey",
  google: "googleApiKey",
  groq: "groqApiKey",
  openrouterai: "openRouterAiApiKey",
  cohereai: "cohereApiKey",
  xai: "xaiApiKey",
  mistralai: "mistralApiKey",
  deepseek: "deepseekApiKey",
  siliconflow: "siliconflowApiKey",
};

export enum DEFAULT_OPEN_AREA {
  EDITOR = "editor",
  VIEW = "view",
}

export enum SEND_SHORTCUT {
  ENTER = "enter",
  SHIFT_ENTER = "shift+enter",
}

export const COMMAND_IDS = {
  NEW_AGENT_CHAT: "new-agent-chat",
  OPEN_AGENT_CHAT_WINDOW: "agent-chat-open-window",
  TOGGLE_AGENT_CHAT_WINDOW: "agent-chat-toggle-window",
  ADD_CUSTOM_COMMAND: "add-custom-command",
  OPEN_LOG_FILE: "open-log-file",
  CLEAR_LOG_FILE: "clear-log-file",
  NEXT_DIFF_CHANGE: "turn-diff-next-change",
  PREVIOUS_DIFF_CHANGE: "turn-diff-previous-change",
} as const;

export const COMMAND_NAME_KEYS: Record<CommandId, MessageKey> = {
  [COMMAND_IDS.NEW_AGENT_CHAT]: "command.newAgentChat",
  [COMMAND_IDS.OPEN_AGENT_CHAT_WINDOW]: "command.openAgentChat",
  [COMMAND_IDS.TOGGLE_AGENT_CHAT_WINDOW]: "command.toggleAgentChat",
  [COMMAND_IDS.ADD_CUSTOM_COMMAND]: "command.addCustomCommand",
  [COMMAND_IDS.OPEN_LOG_FILE]: "command.openLog",
  [COMMAND_IDS.CLEAR_LOG_FILE]: "command.clearLog",
  [COMMAND_IDS.NEXT_DIFF_CHANGE]: "command.nextDiff",
  [COMMAND_IDS.PREVIOUS_DIFF_CHANGE]: "command.previousDiff",
};

export type CommandId = (typeof COMMAND_IDS)[keyof typeof COMMAND_IDS];

export const COMMAND_ICONS: Partial<Record<CommandId, string>> = {
  [COMMAND_IDS.NEW_AGENT_CHAT]: VAULT_AGENT_ICON_ID,
  [COMMAND_IDS.OPEN_AGENT_CHAT_WINDOW]: VAULT_AGENT_ICON_ID,
  [COMMAND_IDS.TOGGLE_AGENT_CHAT_WINDOW]: VAULT_AGENT_ICON_ID,
  [COMMAND_IDS.ADD_CUSTOM_COMMAND]: "plus-circle",
  [COMMAND_IDS.OPEN_LOG_FILE]: "file-text",
  [COMMAND_IDS.CLEAR_LOG_FILE]: "file-x",
};

export const TEXT_READABLE_EXTENSIONS = ["md", "canvas", "base"];

export const ALLOWED_NOTE_CONTEXT_EXTENSIONS = [...TEXT_READABLE_EXTENSIONS, "pdf"];

export const RESTRICTION_MESSAGES = {
  NON_MARKDOWN_FILES_RESTRICTED:
    "Only markdown, canvas, and base files can be added as note context.",
  UNSUPPORTED_FILE_TYPE: (extension: string) =>
    `${extension.toUpperCase()} files are not supported in the current mode.`,
} as const;

export const DEFAULT_SETTINGS: VaultAgentSettings = {
  openAIApiKey: "",
  openAIOrgId: "",
  cohereApiKey: "",
  anthropicApiKey: "",
  googleApiKey: "",
  openRouterAiApiKey: "",
  xaiApiKey: "",
  mistralApiKey: "",
  deepseekApiKey: "",
  siliconflowApiKey: "",
  defaultModelKey: ChatModels.OPENROUTER_GEMINI_2_5_FLASH + "|" + ChatModelProviders.OPENROUTERAI,
  stream: true,
  vaultAgentFolder: DEFAULT_VAULT_AGENT_FOLDER,
  vaultAgentRootHistory: [],
  autosaveChat: true,
  defaultOpenArea: DEFAULT_OPEN_AREA.VIEW,
  defaultSendShortcut: SEND_SHORTCUT.ENTER,
  language: "auto",
  qaExclusions: DEFAULT_QA_EXCLUSIONS_SETTING,
  qaInclusions: "",
  debug: false,
  enableInlineCitations: true,
  groqApiKey: "",
  activeModels: BUILTIN_CHAT_MODELS,
  promptSortStrategy: PromptSortStrategy.TIMESTAMP,
  chatHistorySortStrategy: "recent",
  defaultConversationNoteName: "{$topic}@{$date}_{$time}",
  projectList: [],
  enableCustomPromptTemplating: true,
  enableSelfHostMode: false,
  selfHostSearchProvider: "firecrawl",
  firecrawlApiKey: "",
  perplexityApiKey: "",
  parallelApiKey: "",
  exaApiKey: "",
  reasoningEffort: DEFAULT_MODEL_SETTING.REASONING_EFFORT,
  defaultSystemPromptTitle: "",
  agentMode: {
    byok: {},
    activeBackend: "pi",
    backends: {},
    debugFullFrames: true,
    offerFeedbackCards: true,
    notificationSound: true,
    notificationSoundId: "piano",
    welcomeDismissed: false,
    skills: {
      folder: DEFAULT_SKILLS_FOLDER,
      builtinPreferences: DEFAULT_BUILTIN_PREFERENCES,
    },
  },
  providers: {},
  configuredModels: [],
  backends: {},
};

export const EVENT_NAMES = {
  CHAT_IS_VISIBLE: "chat-is-visible",
  ACTIVE_LEAF_CHANGE: "active-leaf-change",
  ABORT_STREAM: "abort-stream",
  INSERT_TEXT_TO_CHAT: "insert-text-to-chat",
};

export enum ABORT_REASON {
  USER_STOPPED = "user-stopped",
  NEW_CHAT = "new-chat",
  UNMOUNT = "component-unmount",
}
