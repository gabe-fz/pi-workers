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
      "model": "gpt-6-luna",
      "thinking": "xhigh",
      "description": "Best-value, high-throughput default for well-scoped features, substantial implementation, tests, and debugging—not merely grunt work; XHigh costs more than lower Luna efforts."
    },
    "terra": {
      "provider": "openai-codex",
      "model": "gpt-5.6-terra",
      "thinking": "high",
      "description": "Moderate-cost middle ground for ambiguous, multi-file work needing exploration, edge-case discovery, and more autonomy than Luna; typically slower and costlier than Luna."
    },
    "sol": {
      "provider": "openai-codex",
      "model": "gpt-6.1-sol",
      "thinking": "medium",
      "description": "Expensive specialist for architecture, migrations, difficult root-cause debugging, orchestration, and final review; reserve it for work where stronger judgment repays the extra quota."
    },
    "astra": {
      "provider": "openai-codex",
      "model": "gpt-6-astra",
      "thinking": "low",
      "description": "Premium, quota-heavy worker for only the hardest planning, deep reasoning, architecture, and stubborn debugging; Low effort limits cost, but use it sparingly."
    }
  }
}
```

Aliases must start with a lowercase letter and contain only lowercase letters, digits, and hyphens. Built-in pi commands and `worker`/`workers`/`default`/`none`/`updates` are reserved. Thinking can be `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.

## Use

- `/workers` — view descriptions and pick a worker.
- `/worker luna` — canonical switch command, with alias completion.
- `/astra m` or `/worker astra m` — switch with medium thinking. Shortcuts: `o` (off), `min`, `l`, `m`, `h`, `x`/`xh` (xhigh), and `max`; full names also work. Omitting effort restores the worker's configured thinking.
- `/worker default` — pick a persistent startup default.
- `/worker default luna` — save Luna as the default in `~/.pi/agent/workers.json` (`"defaultWorker": "luna"`).
- `/worker default none` — remove the startup default.
- `/worker updates` — refresh the configured providers' model catalogs and report newer numeric versions of each worker's *same named model family* (for example, `gpt-6-sol` → `gpt-6.1-sol`). A failed or timed-out refresh does **not** silently use stale catalog data.
- `/worker updates apply` — save compatible newer model IDs to `workers.json` and reload the extension; it never switches the active model. Other settings and descriptions are preserved. Review the report first: a higher version is not necessarily cheaper or better.

The saved default applies on pi startup (including startup with a resumed session) and `/new`, not `/reload`, `/resume`, or `/fork` within a running pi. It overrides the initially selected model/thinking at startup; subsequent switches remain yours. Saving a default does not switch the current worker. Invalid or unavailable defaults report an error instead of silently falling back.
- `/luna`, `/terra`, `/sol`, or `/astra` — automatically registered shorthand.

If an alias collides with another extension command, pi assigns this extension a numeric command suffix and pi-workers reports it at session start. `/worker <alias>` always remains available.

Switches are accepted only while pi is idle. Missing models, missing provider authentication, and unsupported or clamped thinking levels return explicit errors. A failed post-model-change validation is rolled back. The native footer displays `[astra] gpt-6-astra • low` on its existing model row (no extra worker line) only while the actual model and thinking level still exactly match the worker and optional thinking override selected through pi-workers. Manual model or thinking changes clear that label. On crowded rows, padding is reduced and stats are truncated as needed to make room for the worker label. Custom replacement footers are left unchanged. Since pi has no native model-label hook, this uses a reversible adapter around the exported native footer renderer, removed on shutdown/reload.

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

The example model IDs track the latest available versions in the OpenAI Codex catalog: GPT-6 Luna, GPT-5.6 Terra, GPT-6.1 Sol, and GPT-6 Astra. The roles and effort levels below originated from recurring reports in r/codex as of September 2026, not controlled benchmarks; the older reports do not establish GPT-6 Luna or Sol performance or cost:

- **Luna XHigh** is the best-value, high-throughput default for well-defined implementation and can handle substantial work—not just mechanical edits. XHigh still costs more than lower Luna efforts.
- **Terra High** is a moderate-cost middle ground for ambiguous, multi-file work, trading more time and quota for autonomy beyond Luna.
- **Sol Medium** is an expensive specialist best reserved for architecture, planning, migrations, difficult debugging, and review.
- **Astra Low** is a premium, quota-heavy choice for selective high-leverage reasoning; Low effort moderates cost, but it remains a scarce option.

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
