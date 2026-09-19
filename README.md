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
    "luna": {
      "provider": "openai-codex",
      "model": "gpt-5.6-luna",
      "thinking": "xhigh",
      "description": "Capable daily coding worker for well-scoped features, substantial implementation, tests, and debugging—not merely grunt work."
    },
    "terra": {
      "provider": "openai-codex",
      "model": "gpt-5.6-terra",
      "thinking": "high",
      "description": "Balanced worker for ambiguous, multi-file tasks that need repository exploration, edge-case discovery, and implementation with less hand-holding."
    },
    "sol": {
      "provider": "openai-codex",
      "model": "gpt-5.6-sol",
      "thinking": "medium",
      "description": "Strong specialist for architecture, migrations, difficult root-cause debugging, orchestration, and final review of risky changes."
    },
    "astra": {
      "provider": "openai-codex",
      "model": "gpt-6-astra",
      "thinking": "low",
      "description": "Selective high-leverage worker for the hardest planning, deep reasoning, architecture, and stubborn debugging; use sparingly because it consumes quota quickly."
    }
  }
}
```

Aliases must start with a lowercase letter and contain only lowercase letters, digits, and hyphens. Built-in pi commands and `worker`/`workers` are reserved. Thinking can be `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.

## Use

- `/workers` — view descriptions and pick a worker.
- `/worker luna` — canonical switch command, with alias completion.
- `/luna`, `/terra`, `/sol`, or `/astra` — automatically registered shorthand.

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
      const candidate = available.find((worker) => worker.alias === "luna");
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

The client exposes version `1` and asynchronous `list()`, `get(alias)`, `current()`, and `switch(alias)` methods. If pi-workers is absent, calls reject with `WorkersUnavailableError`. Internally the protocol uses `pi.events` channels `pi-workers:request` and `pi-workers:changed`; consumers should prefer the client helper.

`switch()` returns structured failures with one of: `unknown-worker`, `model-unavailable`, `unsupported-thinking`, `busy`, or `switch-failed`. It never starts a turn, queues future work, opens a new session, or selects a worker automatically.

## Why these example workers?

The example lineup is based on recurring reports in r/codex as of September 2026, not controlled benchmarks:

- **Luna XHigh** is repeatedly described as a strong value for well-defined implementation and can handle substantial work—not just mechanical edits.
- **Terra High** is commonly treated as the middle ground for ambiguous, multi-file work and exploration.
- **Sol Medium** is often reserved for architecture, planning, migrations, difficult debugging, and review.
- **Astra Low** is suggested for selective, high-leverage reasoning and planning because higher efforts can consume quota rapidly.

Reports are mixed and model behavior changes, so treat these as useful starting points and adjust effort levels to your own workload. Representative discussions:

- [Sol vs. Terra vs. Luna: early guide](https://www.reddit.com/r/codex/comments/1utzi5w/gpt56_sol_vs_terra_vs_luna_my_early_guide_to/)
- [Sol or Luna as a daily coding default](https://www.reddit.com/r/codex/comments/1w3nc2m/gpt56_sol_or_luna_as_a_daily_coding_default_i_ran/)
- [Luna Max is underrated](https://www.reddit.com/r/codex/comments/1w3uexn/luna_max_is_underrated/)
- [Sol Medium as a 5.5 XHigh replacement](https://www.reddit.com/r/codex/comments/1ughock/56solmedium_looks_like_the_replacement_for_55xhigh/)
- [Using GPT-6 Astra in Codex](https://www.reddit.com/r/codex/comments/1w8t735/how_are_you_using_gpt6_astra_in_codex_and_is_the/)

## Development

```bash
npm install
npm run check
```
