import { isDeepStrictEqual } from "util";
import type { FlowDefinition, FlowState, FlowTransition } from "./flow-schema";

/**
 * Renders Studio flows as Mermaid flowcharts, either whole or as a diff between
 * two revisions.
 *
 * Node ids are deliberately short. Mermaid documents are embedded in pull request
 * bodies, which GitHub caps at 65,536 characters, and a flow of any size spends
 * most of its budget on ids if they are spelled out. Ids are therefore allocated
 * from a compact alphabet and the readable name lives in the node label.
 */

/** How a node differs from the revision being compared against. */
export type NodeState = "added" | "changed" | "removed" | "unchanged";

const STYLES: Record<Exclude<NodeState, "unchanged">, { class: string; style: string; marker: string }> = {
  added: { class: "add", style: "stroke:#00C853,stroke-width:6px", marker: "+++" },
  changed: { class: "chg", style: "stroke:#006DFF,stroke-width:4px", marker: "~~~" },
  removed: { class: "del", style: "stroke:#D50000,stroke-width:2px", marker: "---" },
};

/**
 * Characters usable as Mermaid node ids. Digits are excluded from the first
 * position implicitly because ids are generated shortest-first from this set,
 * and the set omits letters that Mermaid treats specially in some contexts:
 * `o` and `x` (edge decorations), and `e` (leads to the reserved word `end`).
 */
const ID_ALPHABET = "abcdfghijklmnpqrstuvwyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Generates a1, a2 ... style ids from an incrementing counter. */
function idForIndex(index: number): string {
  let remaining = index;
  let id = "";
  do {
    id = ID_ALPHABET[remaining % ID_ALPHABET.length] + id;
    remaining = Math.floor(remaining / ID_ALPHABET.length);
  } while (remaining > 0);
  return id;
}

interface DiagramNode {
  name: string;
  type: string;
  state: NodeState;
}

interface DiagramEdge {
  from: string;
  to: string;
  label: string;
  /** Dashed edges denote a connection that no longer exists. */
  severed: boolean;
}

export interface RenderedDiagram {
  content: string;
  nodeCount: number;
  edgeCount: number;
}

/** Escapes a label for use inside a Mermaid quoted string. */
function escapeLabel(text: string): string {
  return text.replace(/"/g, "#quot;");
}

/** Builds the readable label for a node, prefixed by its diff marker. */
function labelFor(node: DiagramNode): string {
  const base = `${node.name}<br>(${node.type})`;
  if (node.state === "unchanged") return escapeLabel(base);
  // Marker characters are escaped so Mermaid does not read them as formatting.
  const marker = STYLES[node.state].marker.replace(/(.)/g, "\\$1");
  return escapeLabel(`${marker}<br>${base}`);
}

/** Chooses the node shape, giving structural widget types a distinct outline. */
function shapeFor(node: DiagramNode): string {
  const label = `"${labelFor(node)}"`;
  switch (node.type) {
    case "trigger":
      return ">Trigger]";
    case "split-based-on":
      return `{{${label}}}`;
    case "run-subflow":
      return `[[${label}]]`;
    default:
      return `(${label})`;
  }
}

/** Summarises a transition as an edge label: the event plus any conditions. */
function edgeLabel(transition: FlowTransition): string {
  const conditions = transition.conditions
    ?.map((condition) =>
      condition.value === undefined ? condition.type : `${condition.type} ${condition.value}`
    )
    .join(", ");

  return conditions ? `${transition.event}: ${conditions}` : transition.event;
}

class DiagramBuilder {
  private readonly nodes = new Map<string, DiagramNode>();

  private readonly edges: DiagramEdge[] = [];

  addNode(state: FlowState, nodeState: NodeState): void {
    if (this.nodes.has(state.name)) return;
    this.nodes.set(state.name, { name: state.name, type: state.type, state: nodeState });
  }

  addEdge(from: string, to: string, label: string, severed: boolean): void {
    if (this.edges.some((edge) => edge.from === from && edge.to === to)) return;
    this.edges.push({ from, to, label, severed });
  }

  /** Adds a widget together with the edges leaving it. */
  addWidget(state: FlowState, nodeState: NodeState): void {
    this.addNode(state, nodeState);
    for (const transition of state.transitions) {
      if (!transition.next) continue;
      this.addEdge(state.name, transition.next, edgeLabel(transition), nodeState === "removed");
    }
  }

  hasNode(name: string): boolean {
    return this.nodes.has(name);
  }

  hasEdgeTo(name: string): boolean {
    return this.edges.some((edge) => edge.to === name);
  }

  render(): RenderedDiagram | null {
    if (!this.nodes.size) return null;

    const ids = new Map<string, string>();
    let next = 0;
    for (const name of this.nodes.keys()) {
      ids.set(name, idForIndex(next));
      next += 1;
    }

    const lines = ["flowchart TD"];
    for (const [state, style] of Object.entries(STYLES)) {
      if ([...this.nodes.values()].some((node) => node.state === state)) {
        lines.push(`classDef ${style.class} ${style.style}`);
      }
    }

    // A node is spelled out with its shape the first time it appears; later
    // references use the bare id, which keeps the document compact.
    const declared = new Set<string>();
    const reference = (name: string): string => {
      const id = ids.get(name)!;
      if (declared.has(name)) return id;
      declared.add(name);

      const node = this.nodes.get(name)!;
      const suffix = node.state === "unchanged" ? "" : `:::${STYLES[node.state].class}`;
      return `${id}${shapeFor(node)}${suffix}`;
    };

    for (const edge of this.edges) {
      const from = reference(edge.from);
      const to = reference(edge.to);
      lines.push(edge.severed ? `${from}-.-x${to}` : `${from}--${edge.label}-->${to}`);
    }

    // Nodes with no edges at all would otherwise be omitted entirely.
    for (const name of this.nodes.keys()) {
      if (!declared.has(name)) lines.push(reference(name));
    }

    return { content: lines.join("\n"), nodeCount: declared.size, edgeCount: this.edges.length };
  }
}

/** Matches states across revisions on the pair that identifies a widget. */
function sameWidget(left: FlowState, right: FlowState): boolean {
  return left.name === right.name && left.type === right.type;
}

/**
 * Compares a widget's meaningful content. `offset` is the editor's canvas
 * position, so it is ignored — moving a widget in the Studio UI is not a change
 * worth drawing.
 */
function widgetDiffers(before: FlowState, after: FlowState): boolean {
  const stripOffset = (properties: Record<string, unknown>) => {
    const { offset: _offset, ...rest } = properties;
    return rest;
  };

  return (
    !isDeepStrictEqual(stripOffset(before.properties), stripOffset(after.properties)) ||
    !isDeepStrictEqual(before.transitions, after.transitions)
  );
}

/** Renders an entire flow with no diff highlighting. */
export function renderFlowDiagram(flow: FlowDefinition): RenderedDiagram | null {
  const builder = new DiagramBuilder();
  for (const state of flow.states) builder.addWidget(state, "unchanged");
  return builder.render();
}

/**
 * Renders only what changed between two revisions, plus the immediate
 * neighbourhood needed to place those changes in context.
 *
 * Drawing the whole flow would bury a two-widget change in a hundred-widget
 * diagram, so unchanged widgets appear only when they sit directly either side
 * of something that moved.
 */
export function renderFlowDiff(
  before: FlowDefinition,
  after: FlowDefinition
): RenderedDiagram | null {
  const builder = new DiagramBuilder();

  const missingFrom = (states: FlowState[]) => (state: FlowState) =>
    !states.some((candidate) => sameWidget(candidate, state));

  const added = after.states.filter(missingFrom(before.states));
  const removed = before.states.filter(missingFrom(after.states));
  const changed = after.states.filter((state) => {
    const previous = before.states.find((candidate) => sameWidget(candidate, state));
    return previous ? widgetDiffers(previous, state) : false;
  });

  for (const state of added) builder.addWidget(state, "added");
  for (const state of changed) builder.addWidget(state, "changed");
  for (const state of removed) builder.addWidget(state, "removed");

  const highlighted = [...added, ...changed, ...removed];
  const untouched = after.states.filter(missingFrom(highlighted));

  // Include an untouched widget when it either receives an edge already drawn,
  // or points at something that was highlighted.
  const adjacent = untouched.filter(
    (state) =>
      builder.hasEdgeTo(state.name) ||
      state.transitions.some((transition) => builder.hasNode(transition.next ?? ""))
  );
  for (const state of adjacent) builder.addWidget(state, "unchanged");

  // Connections that disappeared are drawn severed, provided their source is
  // already on the diagram.
  const connections = (flow: FlowDefinition) =>
    flow.states.flatMap((state) =>
      state.transitions
        .filter((transition) => transition.next)
        .map((transition) => `${state.name} ${transition.next}`)
    );

  const afterConnections = new Set(connections(after));
  for (const connection of connections(before)) {
    if (afterConnections.has(connection)) continue;
    const [from, to] = connection.split(" ");
    if (builder.hasNode(from)) builder.addEdge(from, to, "", true);
  }

  // Any node newly referenced as an edge target still needs declaring.
  for (const state of untouched) {
    if (builder.hasEdgeTo(state.name)) builder.addNode(state, "unchanged");
  }

  return builder.render();
}
