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
