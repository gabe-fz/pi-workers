# pi-workers

A small [pi](https://pi.dev) extension that gives names to model + thinking-level combinations. A worker changes only the active model and thinking level; it preserves the current session, conversation, tools, and instructions.

## Install

```bash
pi install /absolute/path/to/pi-workers
cp /absolute/path/to/pi-workers/workers.example.json ~/.pi/agent/workers.json
```

Reload a running pi session with `/reload` after installing or editing the configuration. Because alias commands are registered when the extension loads, configuration changes require a reload.

## Configure

Create `~/.pi/agent/workers.json`:

```json
{
  "workers": {
    "quick": {
      "provider": "openai-codex",
      "model": "gpt-5.6-luna",
      "thinking": "high",
      "description": "Small fixes and routine implementation."
    },
    "architect": {
      "provider": "openai-codex",
      "model": "gpt-6-astra",
      "thinking": "medium",
      "description": "Architecture and difficult, ambiguous problems."
    }
  }
}
```

Aliases must start with a lowercase letter and contain only lowercase letters, digits, and hyphens. Built-in pi commands and `worker`/`workers` are reserved. Thinking can be `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.

## Use

- `/workers` — view descriptions and pick a worker.
- `/worker architect` — canonical switch command, with alias completion.
- `/architect` — automatically registered shorthand.

If an alias collides with another extension command, pi assigns this extension a numeric command suffix and pi-workers reports it at session start. `/worker <alias>` always remains available.

Switches are accepted only while pi is idle. Missing models, missing provider authentication, and unsupported or clamped thinking levels return explicit errors. A failed post-model-change validation is rolled back. The footer displays `worker:<alias>` only while the actual model and thinking level still exactly match the worker selected through pi-workers. Manual model or thinking changes clear that status.

## Extension API

Other extensions can import the typed client:

```ts
import { createWorkersClient, onWorkersChanged } from "pi-workers";

export default function (pi) {
  const workers = createWorkersClient(pi);

  pi.registerCommand("pick-implementation-worker", {
    description: "Example consumer",
    handler: async (_args, ctx) => {
      const available = await workers.list(); // includes capability descriptions
      const candidate = available.find((worker) => worker.alias === "quick");
      if (!candidate) return;

      const result = await workers.switch(candidate.alias);
      if (!result.ok) ctx.ui.notify(result.message, "error");
    },
  });

  onWorkersChanged(pi, ({ current }) => {
    // Refresh extension UI if needed.
    console.debug("worker changed", current.activeAlias);
  });
}
```

The client exposes version `1` and asynchronous `list()`, `get(alias)`, `current()`, and `switch(alias)` methods. If pi-workers is absent or not ready, calls reject with `WorkersUnavailableError`. Internally the protocol uses `pi.events` channels `pi-workers:request` and `pi-workers:changed`; consumers should prefer the client helper.

`switch()` returns structured failures with one of: `unknown-worker`, `model-unavailable`, `unsupported-thinking`, `busy`, or `switch-failed`. It never starts a turn, queues future work, opens a new session, or selects a worker automatically.

## Development

```bash
npm install
npm run check
```
