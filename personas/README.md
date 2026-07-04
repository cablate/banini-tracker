# Personas

Persona files define who the tracker follows and how the analysis should interpret that person's posts.

```json
{
  "id": "banini",
  "displayName": "巴逆逆（8zz）",
  "source": {
    "type": "facebook",
    "target": "https://www.facebook.com/DieWithoutBang/"
  },
  "analysis": {
    "mode": "reverse",
    "promptTemplate": "Full system prompt or __DEFAULT_SYSTEM_PROMPT__",
    "trackingDays": 5,
    "thresholdPct": 1.0
  }
}
```

Fields:

| Field | Description |
|---|---|
| `id` | Stable lowercase identifier. |
| `displayName` | Reader-facing name shown in logs and prompts. |
| `source.type` | Currently only `facebook` is implemented. |
| `source.target` | Facebook page/profile URL passed to the source adapter. |
| `analysis.mode` | `reverse` for reverse-indicator tracking, `forward` for normal tracking. |
| `analysis.promptTemplate` | Full system prompt. The built-in Banini persona may use `__DEFAULT_SYSTEM_PROMPT__` to reuse the bundled prompt. |
| `analysis.trackingDays` | Number of trading days to keep tracking each prediction. |
| `analysis.thresholdPct` | Default public win-rate threshold. |

Use a custom persona:

```bash
npx @cablate/banini-tracker serve --persona ./personas/example.json
PERSONA_PATH=./personas/example.json npm run dry
```

Contribution notes:

- Keep persona files JSON-only; do not introduce YAML dependencies.
- Do not include private profile URLs, tokens, or non-public source data.
- If the prompt differs from the built-in prompt, include the full `promptTemplate` so reviews can see the behavior change.
