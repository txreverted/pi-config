# Compaction-safe steering and follow-up directives

`extensions/directives.ts` augments Pi's native steering and follow-up queue with a durable directive ledger.

Pi 0.84.2 already keeps undelivered native steering and follow-up messages in memory through automatic compaction. This extension addresses the later lifecycle gap: after a queued message is delivered, a subsequent compaction can remove or paraphrase it before the full agent run settles.

## Behavior

Normal controls do not change:

- **Enter while running** queues a steering message.
- **Alt+Enter while running** queues a follow-up message.
- Pi's native queue remains responsible for ordering and delivery.

The extension observes these text prompts through the `input` event and writes hidden append-only ledger entries to the current session. When Pi starts the queued user message, the extension records its actual delivered text, including prompt-template or skill expansion.

Before every provider request, the extension checks active delivered directives against Pi's compaction-aware context:

- If the exact directive is still present, nothing is added.
- If compaction or reload removed it, one non-persistent custom context message reintroduces it.
- The reminder does not accumulate in the session or transcript.
- All active directives retire automatically at `agent_settled`, after retries, compaction recovery, steering, and follow-up continuations finish.

Queued directives restored from a session ledger without a corresponding native in-memory queue are marked `recovered`. They are reinforced on the next provider turn rather than automatically starting a potentially duplicate turn.

## Persistence

Ledger records use hidden custom session entries with type:

```text
pi-config-directive-ledger
```

Operations are versioned and append-only:

- `enqueue`
- `deliver`
- `recover`
- `retire`

On session startup or extension reload, state is reconstructed from the full active branch, not from compacted model context. This keeps state available across compaction and reload without modifying Pi's compaction summaries.

Pending prompt text is persisted slightly earlier than Pi normally persists a queued user message. Consequently, an aborted never-delivered queue message can remain in the session ledger until it is retired. Session files should already be treated as sensitive.

Images are still delivered by Pi's native queue, but only text is retained and reinforced by this extension. Large directive reminders are bounded to 24,000 characters, with each directive bounded to 12,000 characters for reinjection.

## Commands

### `/directives`

Shows active steering/follow-up directives and their state:

- `queued`: still expected from Pi's native queue.
- `delivered`: observed as a user message and active until settlement.
- `recovered`: restored from the ledger after native queue state was unavailable.

### `/directives-clear`

Stops ledger reinforcement for all active directives. It intentionally does **not** clear Pi's native undelivered queue because the public extension API does not expose a safe queue-removal operation. Native queued messages may still be delivered once.

Use Pi's normal Escape/Alt+Up behavior to abort or restore native queued messages.

## Non-goals

The extension does not:

- Replace native queue ordering or delivery modes.
- Automatically replay prompts and trigger turns after process restart.
- Customize compaction summaries.
- Persist image attachments.
- Decide whether a directive has been semantically completed before the overall run settles.
- Make prompt injection or user instructions safe.

## Tests

`test/directives-core.test.mjs` covers ledger validation/replay, delivery matching, compaction-aware presence checks, recovery, retirement, and reminder bounds.
