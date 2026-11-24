import * as THREE from 'three';
import {
  computeInverseHomography,
  matrix3ToColumnMajor,
  QuadCorners
} from './homography';
import {
  Surface,
  MediaSource,
  DrawingStroke
} from './protocol';

const VERTEX_SHADER = `
varying vec2 v_screenPos;

void main() {
  v_screenPos = position.xy;
  // position.x, y are in [0, 1]
  // Map x: [0, 1] -> [-1, 1]
  // Map y: [0, 1] -> [1, -1] (top is +1 in GL clip space)
  gl_Position = vec4(position.x * 2.0 - 1.0, 1.0 - position.y * 2.0, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform mat3 u_invHomography;
uniform sampler2D u_mediaTexture;
uniform float u_opacity;
uniform float u_bloom;
uniform bool u_calibration;

varying vec2 v_screenPos;

void main() {
  vec3 proj = u_invHomography * vec3(v_screenPos, 1.0);
  if (proj.z == 0.0) {
    discard;
  }
  vec2 uv = proj.xy / proj.z;

  // Strict quadrilateral boundary check
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    discard;
  }

  vec4 color = texture2D(u_mediaTexture, uv);

  // Calibration test pattern
  if (u_calibration) {
    vec2 grid = fract(uv * 10.0);
    bool isGridLine = (grid.x < 0.03 || grid.y < 0.03);
    bool isBorder = (uv.x < 0.015 || uv.x > 0.985 || uv.y < 0.015 || uv.y > 0.985);
    bool isCenterCross = (abs(uv.x - 0.5) < 0.008 || abs(uv.y - 0.5) < 0.008);
    if (isBorder || isCenterCross) {
      color = vec4(0.0, 0.95, 1.0, 1.0);
    } else if (isGridLine) {
      color = mix(color, vec4(0.0, 0.6, 0.8, 1.0), 0.7);
    }
  }

  color.a *= u_opacity;
  color.rgb *= (1.0 + u_bloom * 1.5);

  gl_FragColor = color;
}
`;

export interface SurfaceRenderSlot {
  surfaceId: string;
  offscreenCanvas: HTMLCanvasElement;
  offscreenCtx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  material: THREE.ShaderMaterial;
  mesh: THREE.Mesh;
}

export class WallboardWebGLCompositor {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private geometry: THREE.BufferGeometry;
  private slots: Map<string, SurfaceRenderSlot> = new Map();
  private startTime: number = Date.now();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setClearColor(0x000000, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);

    // Full-screen quad in Counter-Clockwise (CCW) winding in clip space
    this.geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      0, 0, 0,  // TL
      0, 1, 0,  // BL
      1, 1, 0,  // BR

      0, 0, 0,  // TL
      1, 1, 0,  // BR
      1, 0, 0   // TR
    ]);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    this.geometry.computeBoundingSphere();
  }

  public resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
  }

  private getOrCreateSlot(surface: Surface): SurfaceRenderSlot {
    let slot = this.slots.get(surface.id);
    if (!slot) {
      const offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = 1024;
      offscreenCanvas.height = 1024;
      const offscreenCtx = offscreenCanvas.getContext('2d', { alpha: true })!;

      const texture = new THREE.CanvasTexture(offscreenCanvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;

      const initialInv = computeInverseHomography(surface.geometry.corners);
      const colMajor = matrix3ToColumnMajor(initialInv);
      const invMatrix3 = new THREE.Matrix3();
      invMatrix3.fromArray(colMajor);

      const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms: {
          u_invHomography: { value: invMatrix3 },
          u_mediaTexture: { value: texture },
          u_opacity: { value: surface.opacity ?? 1.0 },
          u_bloom: { value: 0.5 },
          u_calibration: { value: false }
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide, // Prevent any culling of projection surface
        blending: surface.blendMode === 'screen' ? THREE.AdditiveBlending : THREE.NormalBlending
      });

      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false; // Always render fullscreen quad
      mesh.renderOrder = surface.geometry.zIndex || 0;
      this.scene.add(mesh);

      slot = {
        surfaceId: surface.id,
        offscreenCanvas,
        offscreenCtx,
        texture,
        material,
        mesh
      };
      this.slots.set(surface.id, slot);
    }
    return slot;
  }

  public render(
    surfaces: Surface[],
    sources: Record<string, MediaSource>,
    strokes: DrawingStroke[],
    masterBlackout: boolean,
    isCalibration: boolean
  ): void {
    if (masterBlackout) {
      this.renderer.clear();
      return;
    }

    const elapsed = (Date.now() - this.startTime) / 1000;
    const activeIds = new Set(surfaces.map((s) => s.id));

    // Remove obsolete slots
    for (const [id, slot] of this.slots.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(slot.mesh);
        slot.texture.dispose();
        slot.material.dispose();
        this.slots.delete(id);
      }
    }

    // Update each surface
    for (const surface of surfaces) {
      if (!surface.geometry.visible) continue;

      const slot = this.getOrCreateSlot(surface);
      const source = sources[surface.sourceId];

      // 1. Update homography matrix
      const invH = computeInverseHomography(surface.geometry.corners);
      const colMajor = matrix3ToColumnMajor(invH);
      slot.material.uniforms.u_invHomography.value.fromArray(colMajor);
      slot.material.uniforms.u_opacity.value = surface.opacity ?? 1.0;
      slot.material.uniforms.u_calibration.value = isCalibration;

      // Extract bloom from effects stack if present
      const bloomFx = surface.effects?.find((e) => e.type === 'bloom' && e.enabled);
      slot.material.uniforms.u_bloom.value = bloomFx ? (bloomFx.params as any).intensity || 1.0 : 0.0;

      // 2. Render Media Source onto Offscreen Canvas
      this.renderMediaOntoCanvas(
        slot.offscreenCtx,
        slot.offscreenCanvas.width,
        slot.offscreenCanvas.height,
        surface,
        source,
        strokes,
        elapsed
      );

      slot.texture.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
  }

  private renderMediaOntoCanvas(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    surface: Surface,
    source: MediaSource | undefined,
    strokes: DrawingStroke[],
    elapsed: number
  ): void {
    ctx.clearRect(0, 0, w, h);

    // Compute animation parameters (e.g. rotating gradient angle)
    let angleOffset = 0;
    const rotAnim = surface.animations?.find((a) => a.enabled && a.targetProperty === 'source.config.angle');
    if (rotAnim && rotAnim.duration > 0) {
      const progress = ((elapsed * rotAnim.playbackSpeed) % rotAnim.duration) / rotAnim.duration;
      angleOffset = progress * 360;
    }

    if (source) {
      const { type, config } = source.data;
      if (type === 'solid') {
        ctx.fillStyle = config.color;
        ctx.fillRect(0, 0, w, h);
      } else if (type === 'gradient_linear') {
        const totalAngle = ((config.angle || 0) + angleOffset) % 360;
        const rad = (totalAngle * Math.PI) / 180;
        const cx = w / 2;
        const cy = h / 2;
        const length = Math.sqrt(w * w + h * h) / 2;
        const x1 = cx - Math.cos(rad) * length;
        const y1 = cy - Math.sin(rad) * length;
        const x2 = cx + Math.cos(rad) * length;
        const y2 = cy + Math.sin(rad) * length;

        const grad = ctx.createLinearGradient(x1, y1, x2, y2);
        for (const stop of config.stops) {
          grad.addColorStop(stop.offset, stop.color);
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      } else if (type === 'gradient_radial') {
        const cx = (config.centerX ?? 0.5) * w;
        const cy = (config.centerY ?? 0.5) * h;
        const r = (config.radius ?? 0.5) * Math.max(w, h);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        for (const stop of config.stops) {
          grad.addColorStop(stop.offset, stop.color);
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
    } else {
      // Default fallback pattern
      ctx.fillStyle = '#00f0ff';
      ctx.fillRect(0, 0, w, h);
    }

    // 3. Composite drawing strokes assigned to this surface
    const now = Date.now();
    for (const stroke of strokes) {
      if (stroke.surfaceId && stroke.surfaceId !== surface.id) {
        continue;
      }

      let alpha = 1;
      if (stroke.decaySeconds && stroke.decaySeconds > 0) {
        const created = stroke.createdAt || now;
        const ageMs = now - created;
        const totalMs = stroke.decaySeconds * 1000;
        if (ageMs >= totalMs) continue;
        alpha = Math.max(0, 1 - ageMs / totalMs);
      }

      this.drawStrokeOnCanvas(ctx, stroke, w, h, alpha);
    }
  }

  private drawStrokeOnCanvas(
    ctx: CanvasRenderingContext2D,
    stroke: DrawingStroke,
    w: number,
    h: number,
    alpha: number
  ): void {
    if (!stroke.points || stroke.points.length === 0) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, stroke.width * Math.min(w, h));
    ctx.strokeStyle = stroke.color;

    // Luminous bloom glow
    ctx.shadowColor = stroke.color;
    ctx.shadowBlur = ctx.lineWidth * 2.5;

    ctx.beginPath();
    const p0 = stroke.points[0];
    ctx.moveTo(p0.x * w, p0.y * h);

    if (stroke.points.length === 1) {
      ctx.lineTo(p0.x * w + 0.5, p0.y * h + 0.5);
    } else {
      for (let i = 1; i < stroke.points.length; i++) {
        const p = stroke.points[i];
        ctx.lineTo(p.x * w, p.y * h);
      }
    }

    ctx.stroke();
    ctx.restore();
  }

  public dispose(): void {
    for (const slot of this.slots.values()) {
      slot.texture.dispose();
      slot.material.dispose();
    }
    this.slots.clear();
    this.geometry.dispose();
    this.renderer.dispose();
  }
}
