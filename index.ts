/**
 * Memory Auto-Recall Plugin
 *
 * Hooks into before_prompt_build to automatically search memory files
 * and inject relevant context into the system prompt. This ensures the
 * agent always has memory context without relying on voluntary tool calls.
 *
 * Based on the approach discussed by Brad Mills (@BradMills) on X.
 */

// Dynamic import to avoid module resolution issues with OpenClaw's plugin loader
let getMemorySearchManager: any;
try {
  const mod = require("openclaw/plugin-sdk/memory-core");
  getMemorySearchManager = mod.getMemorySearchManager;
} catch {
  try {
    // Fallback: try the direct path
    const mod = require(require("path").join(
      require("path").dirname(require.resolve("openclaw/package.json")),
      "dist/plugin-sdk/memory/search-manager.js"
    ));
    getMemorySearchManager = mod.getMemorySearchManager;
  } catch {
    getMemorySearchManager = null;
  }
}

interface MemoryRecallConfig {
  maxResults?: number;
  minScore?: number;
  maxChars?: number;
  skipHeartbeats?: boolean;
}

function extractLastUserMessage(messages: unknown[]): string | null {
  // Walk messages in reverse to find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown>;
    if (msg?.role === "user") {
      // Content can be a string or an array of content blocks
      const content = msg.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        const textParts = content
          .filter((block: any) => block?.type === "text" && block?.text)
          .map((block: any) => block.text);
        if (textParts.length > 0) return textParts.join(" ");
      }
    }
  }
  return null;
}

function isHeartbeat(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("heartbeat") ||
    lower.includes("heartbeat_ok") ||
    lower.startsWith("read heartbeat.md")
  );
}

const plugin = {
  id: "memory-recall",
  name: "Memory Auto-Recall",
  description:
    "Automatically searches memory before every prompt and injects relevant context.",

  register(api: any) {
    api.on(
      "before_prompt_build",
      async (
        event: { prompt: string; messages: unknown[] },
        ctx: { config: any; agentId?: string; sessionKey?: string }
      ) => {
        try {
          const pluginConfig: MemoryRecallConfig =
            ctx.config?.plugins?.entries?.["memory-recall"]?.config ?? {};

          const maxResults = pluginConfig.maxResults ?? 5;
          const minScore = pluginConfig.minScore ?? 0.3;
          const maxChars = pluginConfig.maxChars ?? 2000;
          const skipHeartbeats = pluginConfig.skipHeartbeats ?? true;

          // Extract the user's latest message for the search query
          const userMessage = extractLastUserMessage(event.messages);
          if (!userMessage || userMessage.trim().length < 5) {
            return {}; // Too short to search meaningfully
          }

          // Skip heartbeat messages if configured
          if (skipHeartbeats && isHeartbeat(userMessage)) {
            return {};
          }

          // Get the memory search manager
          if (!getMemorySearchManager) return {};
          const { manager, error } = await getMemorySearchManager({
            cfg: ctx.config,
            agentId: ctx.agentId ?? "main",
          });

          if (!manager || error) {
            return {};
          }

          // Truncate query to avoid sending huge messages as search queries
          const query = userMessage.slice(0, 500);

          // Search memory
          const results = await manager.search(query, {
            maxResults,
            minScore,
            sessionKey: ctx.sessionKey,
          });

          if (!results || results.length === 0) {
            return {};
          }

          // Build context string from results, respecting maxChars
          let context = "";
          for (const result of results) {
            const snippet = `[${result.path}#L${result.startLine}-${result.endLine}] ${result.snippet}`;
            if (context.length + snippet.length > maxChars) break;
            context += snippet + "\n\n";
          }

          if (!context.trim()) {
            return {};
          }

          // Inject as prepended context (per-turn, not cached)
          return {
            prependContext: `## Auto-Recalled Memory Context\nThe following memory snippets were automatically retrieved based on the current message. Use them if relevant.\n\n${context.trim()}\n`,
          };
        } catch (err) {
          // Silently fail - don't break the agent loop
          return {};
        }
      },
      { priority: 5 } // Run after other plugins but before the agent
    );
  },
};

export default plugin;
