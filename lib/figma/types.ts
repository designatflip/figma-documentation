/**
 * Minimal structural types for the slice of the Figma REST API we consume.
 *
 * Verified against figma/rest-api-spec (openapi.yaml). Deliberately partial —
 * modelling the whole node union buys nothing and rots faster.
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Present on FrameNode, ComponentNode and SectionNode. */
export interface DevStatus {
  type: "NONE" | "READY_FOR_DEV" | "COMPLETED";
  /** Designer-authored free text. We read this into `screens.description`. */
  description?: string;
}

/**
 * A named prototype entry point, as authored by the "Flow starting point" pin
 * in Figma. Present on CANVAS nodes only, and only for pages that have one.
 */
export interface FlowStartingPoint {
  /** The frame the flow starts on. */
  nodeId: string;
  /** Designer-authored, defaults to "Flow 1". */
  name: string;
}

/**
 * One thing a prototype interaction does. Only navigation is modelled: the
 * union also covers opening URLs, closing overlays, scrolling and setting
 * variables, and none of those move the flow on to another frame.
 */
export interface InteractionAction {
  type: string;
  /** Frame this action navigates to. Present on NODE actions. */
  destinationId?: string | null;
}

/** A trigger (tap, drag, hover…) paired with what it does. */
export interface Interaction {
  actions?: InteractionAction[];
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  /** Absent means visible; only ever present as `false`. */
  visible?: boolean;
  children?: FigmaNode[];
  absoluteBoundingBox?: BoundingBox | null;
  devStatus?: DevStatus | null;
  /** TEXT nodes only: the raw string content. */
  characters?: string;
  /** CANVAS nodes only: the page's prototype entry points. */
  flowStartingPoints?: FlowStartingPoint[];
  /** Prototype wiring on this node. Absent on nodes nobody has connected. */
  interactions?: Interaction[];
  /**
   * The pre-`interactions` way of saying the same thing, still returned for
   * older files. Read as well as `interactions`, since a file authored years
   * ago carries only this and would otherwise look like a dead end.
   */
  transitionNodeID?: string | null;
}

export interface ProjectFile {
  key: string;
  name: string;
  thumbnail_url?: string;
  last_modified: string;
}

export interface GetProjectFilesResponse {
  name: string;
  files: ProjectFile[];
}

export interface GetFileResponse {
  name: string;
  lastModified: string;
  thumbnailUrl?: string;
  document: FigmaNode;
}

export interface GetFileNodesResponse {
  name: string;
  nodes: Record<string, { document: FigmaNode } | null>;
}

export interface GetImagesResponse {
  err: string | null;
  /** A value can be `null` when that specific node failed to render. */
  images: Record<string, string | null>;
}

export interface DevResource {
  id: string;
  name: string;
  url: string;
  file_key: string;
  node_id: string;
}

export interface GetDevResourcesResponse {
  dev_resources: DevResource[];
}
