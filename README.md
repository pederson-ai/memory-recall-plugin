# Memory Auto-Recall Plugin for OpenClaw

Automatically searches your agent's memory files before every prompt and injects relevant context into the conversation. No tool calls needed. The agent always has the right memory context without having to ask for it.

Based on the approach discussed by [Brad Mills (@BradMills)](https://x.com/BradMills) for persistent agent memory.

## What It Does

Every time a message comes in, this plugin:

1. Extracts the user's latest message
2. Searches your memory files (MEMORY.md, memory/*.md) using OpenClaw's built-in semantic search
3. Injects the top matching snippets into the system prompt as context
4. The agent sees relevant memory before it starts thinking about a response

The result: your agent remembers things without you having to say "check your memory" or wait for it to call the `memory_search` tool.

## Installation

### 1. Clone the repo

```bash
git clone https://github.com/pederson-ai/memory-recall-plugin.git ~/.openclaw/extensions/memory-recall
```

### 2. Register the plugin in your OpenClaw config

Edit `~/.openclaw/openclaw.json` (or use `openclaw config set`):

```json5
{
  "plugins": {
    "allow": [
      // ... your other plugins ...
      "memory-recall"
    ],
    "entries": {
      // ... your other plugins ...
      "memory-recall": {
        "enabled": true,
        "config": {
          "maxResults": 5,
          "minScore": 0.3,
          "maxChars": 2000,
          "skipHeartbeats": true
        }
      }
    }
  }
}
```

### 3. Restart OpenClaw

```bash
openclaw gateway restart
```

That's it. No npm install, no build step. OpenClaw loads the TypeScript directly.

## Configuration

All settings are optional. Defaults work well out of the box.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `maxResults` | number | `5` | Max number of memory snippets to inject per message |
| `minScore` | number | `0.3` | Minimum relevance score (0-1). Lower = more results, higher = stricter matching |
| `maxChars` | number | `2000` | Max total characters of memory context injected. Keeps token usage reasonable |
| `skipHeartbeats` | boolean | `true` | Skip memory search on heartbeat messages (saves tokens on periodic check-ins) |

### Tuning Tips

- **If the agent is missing relevant memory:** Lower `minScore` to 0.2 or increase `maxResults` to 8
- **If you're burning too many tokens:** Lower `maxChars` to 1000 or reduce `maxResults` to 3
- **If heartbeats are slow:** Make sure `skipHeartbeats` is `true` (default)

## Requirements

- OpenClaw 2026.3.x or later
- Memory search configured in your agent defaults (the `memorySearch` section of your config). This is standard in most OpenClaw setups:

```json5
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "sources": ["memory"],
        "experimental": {
          "sessionMemory": true  // optional: also search past session transcripts
        }
      }
    }
  }
}
```

- Memory files in your workspace: `MEMORY.md` and/or files in the `memory/` directory

## How It Works (Technical)

The plugin hooks into OpenClaw's `before_prompt_build` event, which fires before the LLM prompt is assembled for every turn.

1. **Extract query**: Pulls the last user message from the conversation (truncated to 500 chars for the search query)
2. **Search**: Uses OpenClaw's built-in `MemorySearchManager` for semantic search across memory files
3. **Filter**: Applies `minScore` threshold, limits to `maxResults`, caps at `maxChars`
4. **Inject**: Returns a `prependContext` block that gets added to the system prompt for that turn only (not cached, so it's fresh every message)

The plugin silently does nothing if:
- The user message is too short (< 5 chars)
- It's a heartbeat message (if `skipHeartbeats` is true)
- No memory results meet the score threshold
- The memory search system isn't available

It never breaks the agent loop. All errors are caught and silently skipped.

## File Structure

```
memory-recall/
├── index.ts                 # Plugin source (loaded directly by OpenClaw)
├── openclaw.plugin.json     # Plugin manifest (id, name, config schema)
└── README.md                # This file
```

## License

MIT
