# MOSAIC Evaluation Format

The evaluation view imports a local JSON document validated against schema
version 1. Its machine-readable definition is
[`evaluation/mosaic-evaluation.schema.json`](evaluation/mosaic-evaluation.schema.json).

Every Run must declare one primary strategy:

- `single_agent`
- `static_team`
- `mosaic`

Set `variant` only for an ablation, such as `without_recovery`. Variant Runs are
shown in the ablation section and are excluded from the primary three-way
aggregates.

Each Run requires at least one `evidenceRefs` value. Use stable references such
as a Session ID, Run ID, test report path, commit, or recording timestamp. The
view presents these references but does not claim to verify their contents.

Set `source.kind` to `real` only for measured execution results. Use `fixture`
for development data; the UI marks it as unsuitable for project evidence.

The browser validates and aggregates the imported file locally. It does not
upload the dataset or persist it across reloads.
