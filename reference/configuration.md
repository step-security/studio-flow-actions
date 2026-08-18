# Configuration file

One JSON file tells every action which flows to manage and how to resolve the account-specific values inside them. All four actions take its path as `CONFIG_PATH`.

Point `$schema` at the published schema for editor completion and inline validation:

```json
{
  "$schema": "https://raw.githubusercontent.com/step-security/studio-flow-actions/v1/config-schema.json",
  "flows": [{ "name": "Inbound Voice", "path": "flows/inbound-voice.json" }],
  "replaceWidgetTypes": ["send-to-flex"]
}
```

## Top-level fields

| Field | Required | Description |
| --- | --- | --- |
| `flows` | yes | The flows to manage. See [flows](#flows). |
| `replaceWidgetTypes` | no | Which widget types get rewritten at deploy time. Defaults to none, meaning definitions are published unchanged. |
| `functionServices` | no | Functions services whose URLs may appear in `run-function` widgets. See [functionServices](#functionservices). |
| `workflowMap` | no | Pins a workflow name to a specific SID, overriding the account lookup. |
| `subflowMap` | no | Pins a subflow name to a specific SID, overriding the account lookup. |
| `variableReplacements` | no | Values injected into matching `set-variables` keys. See [set-variables](#set-variables). |
| `customPropertyReplacements` | no | Arbitrary property overrides. See [customPropertyReplacements](#custompropertyreplacements). |
| `enableShellVariables` | no | Expands `$VAR` references in this file. See [shell variables](#shell-variables). |

`replaceWidgetTypes` is the switch that matters most: a widget type absent from it is left exactly as written, even if everything else is configured. Listing only the types you rely on keeps the rewriting predictable.

## flows

```json
{
  "flows": [
    { "name": "Shared Menu", "path": "flows/shared-menu.json", "subflow": true },
    { "name": "Inbound Voice", "path": "flows/inbound-voice.json" },
    { "name": "New Callback", "path": "flows/new-callback.json", "allowCreate": true }
  ]
}
```

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | Friendly name of the flow. Used to find it on the account unless `sid` is set. |
| `path` | yes | Where the definition lives, relative to the repository root. |
| `sid` | no | Targets one specific flow, for when a friendly name is ambiguous. |
| `subflow` | no | Marks the flow as a subflow. Subflows are deployed before the flows that call them. |
| `allowCreate` | no | Permits the flow to be created when it is absent, rather than failing. |

A flow without `allowCreate` must already exist, and the run fails up front if it does not — before anything is written, rather than partway through.

## Replaceable widget types

### set-variables

Injects environment-specific values into a widget's variables. Only keys the widget already declares are touched; the rest are left alone, and a replacement key the widget does not have is ignored.

```json
{
  "replaceWidgetTypes": ["set-variables"],
  "variableReplacements": {
    "apiBaseUrl": "https://api.example.com",
    "supportEmail": "support@example.com"
  }
}
```

### run-function

Rewrites `service_sid`, `environment_sid`, `function_sid` and `url` to whatever the target account uses. The service is identified from the URL already in the widget, so a definition synced from one account redeploys against another without editing.

Every service referenced by a `run-function` widget must be declared:

```json
{
  "replaceWidgetTypes": ["run-function"],
  "functionServices": [{ "name": "my-api", "environmentSuffix": "dev" }]
}
```

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | Unique name of the service, or a regular expression when `pattern` is set. |
| `environmentSuffix` | yes | Domain suffix of the environment to read. Use `null` for none, or `0` for whichever environment comes first. |
| `pattern` | no | Treats `name` as a regular expression. |

Function paths are read from the build the environment is **deployed to**, not from the service's function list. A function that exists but was never deployed is therefore reported as missing — which is the useful answer, since a flow pointing at it would fail at runtime.

#### Generated service names

Services installed from the Flex plugin library get names with a version and random suffix, like `plibo-callback-and-voicemail-1-1-5-6672-kaqfvd`. You cannot know that ahead of time, so match it with a pattern:

```json
{
  "functionServices": [
    { "name": "^plibo-callback-and-voicemail", "environmentSuffix": 0, "pattern": true }
  ]
}
```

### send-to-flex

Rewrites `workflow` and `channel`. The names come from the widget's own `attributes`, which must carry `workflowName` and `channelName`:

```json
{
  "attributes": "{\"workflowName\":\"Assign to Anyone\",\"channelName\":\"voice\"}"
}
```

`workflowName` matches a Workflow friendly name; `channelName` matches a TaskChannel unique name. [sync](../README.md#sync) with `ADD_MISSING_DEPLOY_PROPERTIES` adds both for you.

To pin a name to a SID rather than resolving it from the account:

```json
{
  "replaceWidgetTypes": ["send-to-flex"],
  "workflowMap": { "Assign to Anyone": "WW00000000000000000000000000000000" }
}
```

Entries in `workflowMap` take precedence over the account lookup, so this also works for a workflow that lives in a different account.

### run-subflow

Rewrites `flow_sid` from the widget's `subflowName` parameter:

```json
{
  "properties": {
    "parameters": [{ "key": "subflowName", "value": "Shared Menu", "type": "string" }]
  }
}
```

The name resolves against the account's flows, a `subflowMap` entry, or a flow in this configuration marked `subflow` with `allowCreate` — that last case covers a subflow being created in the same run, whose SID is only known once it has been pushed.

```json
{
  "replaceWidgetTypes": ["run-subflow"],
  "subflowMap": { "Shared Menu": "FW00000000000000000000000000000000" }
}
```

### enqueue-call

Rewrites `workflow_sid` from `workflowName` in the widget's `task_attributes`:

```json
{
  "task_attributes": "{\"workflowName\":\"Assign to Anyone\"}"
}
```

Note the property names differ from `send-to-flex`: this widget uses `workflow_sid` and `task_attributes`, not `workflow` and `attributes`.

## customPropertyReplacements

An escape hatch for properties no widget handler covers. It reaches any widget by name, including unmanaged types, and sets one property to a literal string.

```json
{
  "customPropertyReplacements": [
    {
      "flowName": "Inbound Voice",
      "widgetName": "PlayGreeting",
      "propertyKey": "url",
      "propertyValue": "https://my-assets-1234.twil.io/greeting.mp3"
    }
  ]
}
```

These are applied after all widget rewriting, so an override always wins. Nothing validates the property name or value, so a typo produces a flow that deploys and then misbehaves — prefer a widget type where one applies.

## Shell variables

With `enableShellVariables` on, `$VAR` references anywhere in this file are replaced from the process environment before it is parsed. This keeps environment-specific values out of the file itself:

```json
{
  "enableShellVariables": true,
  "replaceWidgetTypes": ["set-variables"],
  "variableReplacements": {
    "apiBaseUrl": "$API_BASE_URL"
  }
}
```

Supply the value through the step's `env` block:

```yaml
      - uses: step-security/studio-flow-actions/deploy@v1
        with:
          CONFIG_PATH: studio-config.json
          TWILIO_API_KEY: ${{ vars.TWILIO_API_KEY }}
          TWILIO_API_SECRET: ${{ secrets.TWILIO_API_SECRET }}
        env:
          API_BASE_URL: ${{ vars.API_BASE_URL }}
```

An unset variable expands to an empty string, exactly as a shell would — so a misspelled name fails quietly rather than loudly. Check the rendered value in the step output if a replacement does not take effect.
