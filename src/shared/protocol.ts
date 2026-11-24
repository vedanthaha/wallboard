// Shared TypeScript Protocol — Surfaces, Decoupled Media, Effects, Animation & Scenes

export const MAX_POINTS_PER_STROKE = 12000;
export const MAX_STROKES = 5000;

// Re-export homography types
export * from './homography';

export interface Point {
  x: number;
  y: number;
  t?: number;
}

export interface CornerPins {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
}

export interface MeshWarpGrid {
  rows: number;
  cols: number;
  vertices: Point[][];
}

export interface SurfaceGeometry {
  id: string;
  name: string;
  type: 'quad' | 'mesh' | 'mask';
  zIndex: number;
  visible: boolean;
  locked: boolean;
  corners: CornerPins;
  mesh?: MeshWarpGrid;
}

export type SourceType =
  | 'solid'
  | 'gradient_linear'
  | 'gradient_radial'
  | 'drawing'
  | 'image'
  | 'video'
  | 'text'
  | 'generative';

export interface GradientStop {
  offset: number; // 0..1
  color: string;  // Hex/RGBA
}

export interface SolidConfig {
  color: string;
}

export interface LinearGradientConfig {
  angle: number; // 0..360
  stops: GradientStop[];
}

export interface RadialGradientConfig {
  centerX: number;
  centerY: number;
  radius: number;
  stops: GradientStop[];
}

export interface DrawingStroke {
  id: string;
  color: string;
  width: number;
  points: Point[];
  createdAt: number;
  surfaceId?: string;
  decaySeconds?: number;
}

export interface DrawingConfig {
  strokes: DrawingStroke[];
  decaySeconds: number;
  activeColor: string;
  activeWidth: number;
}

export interface ImageConfig {
  url: string;
  fit: 'contain' | 'cover' | 'stretch';
  scale: number;
}

export interface VideoConfig {
  url: string;
  loop: boolean;
  muted: boolean;
  playbackRate: number;
  volume: number;
  playing: boolean;
}

export interface TextConfig {
  content: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
  letterSpacing: number;
}

export interface GenerativeConfig {
  preset: 'plasma' | 'laser_tunnel' | 'waves';
  primaryColor: string;
  secondaryColor: string;
  speed: number;
}

export type MediaSourceData =
  | { type: 'solid'; config: SolidConfig }
  | { type: 'gradient_linear'; config: LinearGradientConfig }
  | { type: 'gradient_radial'; config: RadialGradientConfig }
  | { type: 'drawing'; config: DrawingConfig }
  | { type: 'image'; config: ImageConfig }
  | { type: 'video'; config: VideoConfig }
  | { type: 'text'; config: TextConfig }
  | { type: 'generative'; config: GenerativeConfig };

export interface MediaSource {
  id: string;
  name: string;
  data: MediaSourceData;
}

export type EffectType =
  | 'bloom'
  | 'blur'
  | 'color_adjust'
  | 'invert'
  | 'glitch';

export interface BloomEffectParams {
  intensity: number;
  radius: number;
  threshold: number;
}

export interface BlurEffectParams {
  radius: number;
}

export interface ColorAdjustParams {
  brightness: number;
  contrast: number;
  saturation: number;
  hueRotate: number;
}

export interface Effect {
  id: string;
  type: EffectType;
  enabled: boolean;
  params: BloomEffectParams | BlurEffectParams | ColorAdjustParams | Record<string, unknown>;
}

export interface Keyframe {
  time: number;
  value: number;
  easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
}

export interface AnimationTrack {
  id: string;
  enabled: boolean;
  targetProperty: string;
  duration: number;
  loop: boolean;
  playbackSpeed: number;
  keyframes: Keyframe[];
}

export interface Surface {
  id: string;
  name: string;
  geometry: SurfaceGeometry;
  sourceId: string;
  blendMode: 'screen' | 'lighter' | 'source-over' | 'multiply';
  opacity: number;
  effects: Effect[];
  animations: AnimationTrack[];
}

export interface Scene {
  id: string;
  name: string;
  surfaces: Surface[];
  sources: Record<string, MediaSource>;
  masterBlackout: boolean;
  masterIntensity: number;
  strokes?: DrawingStroke[]; // Optional backward compatibility
  quad?: CornerPins;          // Optional backward compatibility
  shapes?: unknown[];        // Optional backward compatibility
  createdAt?: number;
}

export interface ProjectFile {
  schemaVersion: 1;
  name: string;
  activeSceneId: string;
  scenes: Scene[];
  outputDisplayId: number | null;
  savedAt: number;
}

// Backward compatibility types
export type Quad = CornerPins;
export type Stroke = DrawingStroke;

export interface Spotlight {
  x: number;
  y: number;
  radius: number;
  color: string;
  active: boolean;
}

export interface CubeShape {
  id: string;
  type: 'cube';
  x: number;
  y: number;
  size: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  color: string;
  lineWidth: number;
}

export interface MaskShape {
  id: string;
  type: 'mask';
  points: Point[];
}

export interface CircleShape {
  id: string;
  type: 'circle';
  x: number;
  y: number;
  radius: number;
  rings: number;
  color: string;
}

export type MappingShape = CubeShape | MaskShape | CircleShape;

// Validator functions
export function isValidPoint(point: unknown): point is Point {
  if (!point || typeof point !== 'object') return false;
  const p = point as Record<string, unknown>;
  return (
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    (p.x as number) >= 0 &&
    (p.x as number) <= 1 &&
    (p.y as number) >= 0 &&
    (p.y as number) <= 1 &&
    (p.t === undefined || Number.isFinite(p.t))
  );
}

export function isValidCornerPins(corners: unknown): corners is CornerPins {
  if (!corners || typeof corners !== 'object') return false;
  const c = corners as Record<string, unknown>;
  return (
    isValidPoint(c.tl) &&
    isValidPoint(c.tr) &&
    isValidPoint(c.br) &&
    isValidPoint(c.bl)
  );
}

export function isValidQuad(quad: unknown): quad is Quad {
  return isValidCornerPins(quad);
}

export function isValidStroke(stroke: unknown): stroke is DrawingStroke {
  if (!stroke || typeof stroke !== 'object') return false;
  const s = stroke as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    s.id.length <= 80 &&
    typeof s.color === 'string' &&
    /^#[0-9a-fA-F]{6}$/.test(s.color as string) &&
    Number.isFinite(s.width) &&
    (s.width as number) >= 0.001 &&
    (s.width as number) <= 0.08 &&
    Array.isArray(s.points) &&
    s.points.length > 0 &&
    s.points.length <= MAX_POINTS_PER_STROKE &&
    s.points.every(isValidPoint) &&
    (s.surfaceId === undefined || typeof s.surfaceId === 'string') &&
    (s.decaySeconds === undefined || (Number.isFinite(s.decaySeconds) && (s.decaySeconds as number) >= 0))
  );
}

export function isValidSpotlight(spotlight: unknown): spotlight is Spotlight | null {
  if (spotlight === null) return true;
  if (!spotlight || typeof spotlight !== 'object') return false;
  const s = spotlight as Record<string, unknown>;
  return (
    Number.isFinite(s.x) &&
    Number.isFinite(s.y) &&
    (s.x as number) >= 0 &&
    (s.x as number) <= 1 &&
    (s.y as number) >= 0 &&
    (s.y as number) <= 1 &&
    Number.isFinite(s.radius) &&
    (s.radius as number) > 0 &&
    (s.radius as number) <= 1 &&
    typeof s.color === 'string' &&
    typeof s.active === 'boolean'
  );
}

export function isValidShape(shape: unknown): shape is MappingShape {
  if (!shape || typeof shape !== 'object') return false;
  const s = shape as Record<string, unknown>;
  if (s.type === 'cube') {
    return Boolean(
      typeof s.id === 'string' &&
      Number.isFinite(s.x) &&
      Number.isFinite(s.y) &&
      Number.isFinite(s.size) &&
      (s.size as number) > 0 &&
      typeof s.color === 'string'
    );
  }
  if (s.type === 'mask') {
    return Boolean(
      typeof s.id === 'string' &&
      Array.isArray(s.points) &&
      s.points.length >= 3 &&
      s.points.every(isValidPoint)
    );
  }
  if (s.type === 'circle') {
    return Boolean(
      typeof s.id === 'string' &&
      Number.isFinite(s.x) &&
      Number.isFinite(s.y) &&
      Number.isFinite(s.radius)
    );
  }
  return false;
}
