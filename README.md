[![StepSecurity Maintained Action](https://raw.githubusercontent.com/step-security/maintained-actions-assets/main/assets/maintained-action-banner.png)](https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions)

# Studio Flow Actions

Four actions for treating Twilio Studio Flows as version-controlled code: pull them out of the console into your repository, validate them on a pull request, and publish them to an account on merge.

> This is a secure drop-in replacement for [zingdevlimited/studio-flow-actions](https://github.com/zingdevlimited/studio-flow-actions) — the inputs and behaviour match, so switching over is a change of `uses:` and nothing else. Learn more at [docs.stepsecurity.io](https://docs.stepsecurity.io/github-actions/actions/stepsecurity-maintained-actions).

## The problem these solve

A Studio Flow definition is full of SIDs — workflows, task channels, function versions, subflows — and every one of them differs between accounts. Copying a definition from staging to production leaves it pointing at resources that do not exist there.

These actions fix that by keeping definitions **portable**. A flow in your repository refers to resources by *name*; at deploy time the names are resolved to whatever SIDs the target account actually uses. The reverse also works: [sync](#sync) pulls a console-authored flow down and adds the name hints for you.

## Getting started

You need two things: flow definitions stored as JSON in your repository, and one configuration file describing them.

```json
{
  "$schema": "https://raw.githubusercontent.com/step-security/studio-flow-actions/v1/config-schema.json",
  "flows": [{ "name": "Inbound Voice", "path": "flows/inbound-voice.json" }],
  "replaceWidgetTypes": ["send-to-flex", "run-function"]
}
```

Setting `$schema` gives you completion and inline validation in most editors. The full field reference is in [configuration reference](reference/configuration.md).

## Actions

| Action | Twilio credentials | Use it for |
| --- | --- | --- |
| [check](#check) | no | Fast validation on any pull request, including from forks |
| [validate](#validate) | yes | Confirming a deploy will succeed before merging |
| [deploy](#deploy) | yes | Publishing definitions to an account |
| [sync](#sync) | yes | Capturing console edits back into the repository |

### check

Parses every definition and confirms it is structurally sound and carries the name hints a deploy needs. No account is contacted, so this is the one to run on untrusted pull requests — it needs no secrets.

```yaml
jobs:
  check:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
      - name: Check flow definitions
        uses: step-security/studio-flow-actions/check@v1
        with:
          CONFIG_PATH: studio-config.json
```

### validate

Everything `check` does, then resolves every name against a real account and asks Twilio's [Flow Validation API](https://www.twilio.com/docs/studio/rest-api/v2/flow-validate) whether the result would be accepted. Nothing is published.

Set `VALIDATE_PREVIOUS_REVISION_USER` to catch the case where someone edited a flow in the console since the last deploy — a deploy would silently discard that work.

```yaml
jobs:
  validate:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
      - name: Validate against staging
        uses: step-security/studio-flow-actions/validate@v1
        with:
          CONFIG_PATH: studio-config.json
          VALIDATE_PREVIOUS_REVISION_USER: true
          TWILIO_API_KEY: ${{ vars.TWILIO_API_KEY }}
          TWILIO_API_SECRET: ${{ secrets.TWILIO_API_SECRET }}
```

### deploy

Resolves and publishes each definition, creating flows that do not exist yet where `allowCreate` permits it.

Every flow is prepared and validated before any of them is published. A partial deploy is the outcome worth avoiding here — a parent flow pointing at a subflow that never got written leaves the account in a state no revision describes.

```yaml
jobs:
  deploy:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
      - name: Deploy to production
        uses: step-security/studio-flow-actions/deploy@v1
        with:
          CONFIG_PATH: studio-config.json
          TWILIO_API_KEY: ${{ vars.TWILIO_API_KEY }}
          TWILIO_API_SECRET: ${{ secrets.TWILIO_API_SECRET }}
```

Published revisions carry an `[Auto Deploy]` commit message, which is what `validate`'s `VALIDATE_PREVIOUS_REVISION_USER` check looks for.

### sync

Pulls the live definitions down, writes them to their configured paths, and opens a pull request. Use it when flows are authored in the Studio console — without it, the next deploy overwrites that work.

Two things make the output reviewable. States are written in a canonical order, so a diff shows real changes instead of the editor's arbitrary ordering. And the pull request body renders a Mermaid diagram of what changed, rather than leaving you to read raw JSON.

```yaml
permissions:
  contents: write
  pull-requests: write

jobs:
  sync:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
      - name: Sync from the development account
        uses: step-security/studio-flow-actions/sync@v1
        with:
          CONFIG_PATH: studio-config.json
          ADD_MISSING_DEPLOY_PROPERTIES: true
          SAVE_DIAGRAMS_TO_PATH: flow-diagrams
          TWILIO_API_KEY: ${{ vars.TWILIO_API_KEY }}
          TWILIO_API_SECRET: ${{ secrets.TWILIO_API_SECRET }}
```

`ADD_MISSING_DEPLOY_PROPERTIES` is what makes a console-authored flow deployable: it reverses each SID back to a name and records it in the definition. This is the inverse of what deploy does, and it is why a flow drawn by hand in the console can be committed and shipped elsewhere without further editing.

`SAVE_DIAGRAMS_TO_PATH` additionally commits an SVG per flow. It renders through the Mermaid CLI container, so the runner needs Docker available.

## Ready-made workflows

Three workflows under [`examples/`](examples/) cover the usual lifecycle, and are written to be copied into `.github/workflows/` with only the secret names changed:

| Workflow | When it runs | What it does |
| --- | --- | --- |
| [`pr-validation.yaml`](examples/pr-validation.yaml) | On pull requests touching flows | Checks the definitions with no credentials |
| [`manual-sync.yaml`](examples/manual-sync.yaml) | On demand | Captures console edits and raises a pull request |
| [`gated-deployment.yaml`](examples/gated-deployment.yaml) | On demand, per environment | Validates, waits for approval, then publishes |
