import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D, {
  type ForceGraphMethods,
  type NodeObject,
  type LinkObject,
} from 'react-force-graph-3d';
import { Vector2 } from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import SpriteText from 'three-spritetext';

import { useThemeColors } from '../hooks/useThemeColors.js';
import { isLightTheme, mixHex } from '../lib/theme-colors.js';
import {
  buildGraphModel,
  graphSignature,
  type GraphLink3D,
  type GraphNode3D,
  type Position,
  type WikiGraphInput,
} from './wiki-graph-model.js';
import { buildPalette, categoryColor } from './wiki-graph-palette.js';
import { bloomParamsFor } from './wiki-graph-bloom.js';
import { cameraFitFor, viewDirection } from './wiki-graph-camera.js';

// ---------- types ----------

type FgNode = NodeObject<GraphNode3D>;
type FgLink = LinkObject<GraphNode3D, GraphLink3D>;
type FgMethods = ForceGraphMethods<FgNode, FgLink>;

interface Props {
  graphData: WikiGraphInput | null;
  loading: boolean;
  onNodeClick: (slug: string) => void;
}

// ---------- constants ----------

/**
 * Module-level on purpose. `WikiView` conditionally mounts this component, and
 * clicking a node navigates to the page — so the graph unmounts constantly.
 * Surviving positions mean coming back to the Graph tab resumes the layout
 * instead of re-exploding from the origin.
 */
const POSITION_CACHE = new Map<string, Position>();

/** Above this, only well-connected nodes get a label — each one is a canvas texture. */
const DENSE_NODE_COUNT = 220;
/**
 * The fly-in must *finish* before the page opens and the graph unmounts. An
 * in-flight camera tween keeps OrbitControls dispatching 'change', and the
 * library's listener walks link endpoints that teardown has already cleared —
 * "Cannot read properties of undefined (reading 'x')". Keep a margin here.
 */
const FLY_MS = 240;
/** Long enough for the camera move to read before the panel swaps. */
const OPEN_DELAY_MS = 380;

// ---------- helpers ----------

/** Link endpoints start as slug strings and are replaced by node refs once d3 initialises. */
function endpointId(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object' && 'id' in value) {
    return String((value as { id: unknown }).id);
  }
  return '';
}

function disposeSprites(cache: Map<string, SpriteText>): void {
  for (const sprite of cache.values()) {
    // Each SpriteText bakes its text into a CanvasTexture — that's the thing
    // that actually leaks. Geometry is deliberately left alone: three.Sprite
    // shares one module-level BufferGeometry across every instance.
    sprite.material.map?.dispose();
    sprite.material.dispose();
  }
  cache.clear();
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** Frame the whole graph. Replaces zoomToFit(), which does nothing in 1.29.1. */
function fitCamera(fg: FgMethods, durationMs: number): void {
  const bbox = fg.getGraphBbox();
  if (!bbox) return;

  const camera = fg.camera() as unknown as { fov?: number; aspect?: number; position: { x: number; y: number; z: number } };
  const { center, distance } = cameraFitFor(bbox, camera.fov ?? 50, camera.aspect ?? 1.6);
  const dir = viewDirection(camera.position, center);

  fg.cameraPosition(
    { x: center.x + dir.x * distance, y: center.y + dir.y * distance, z: center.z + dir.z * distance },
    center,
    durationMs,
  );
}

// ---------- main component ----------

export default function WikiGraphView({ graphData, loading, onNodeClick }: Props) {
  const colors = useThemeColors();
  const light = isLightTheme(colors);

  const fgRef = useRef<FgMethods | undefined>(undefined);
  /**
   * Teardown handles, captured while the graph is definitely alive.
   *
   * `fgRef` cannot be relied on during cleanup: ForceGraph3D is a child, so
   * react-kapsule clears the ref in its own unmount effect, which React runs
   * *before* this component's cleanup. Reading `fgRef.current` there found
   * `undefined`, the disposal silently no-opped, and 20 Graph-tab visits piled up
   * enough live contexts for Chrome to start evicting them
   * ("Too many active WebGL contexts").
   */
  const instanceRef = useRef<FgMethods | null>(null);
  const rendererRef = useRef<{ forceContextLoss: () => void; dispose: () => void } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const bloomRef = useRef<UnrealBloomPass | null>(null);
  const spriteCache = useRef(new Map<string, SpriteText>());
  const spriteStyleRef = useRef('');
  const flyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fitted = useRef(false);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [showLabels, setShowLabels] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);

  /**
   * Only `nodeColor` and `linkColor` get fresh identities per render; every other
   * ForceGraph3D prop below is referentially stable.
   *
   * The upstream `highlight-links` example breaks accessor identity to force a
   * repaint, which is genuinely how react-kapsule's prop diffing works — but
   * doing it for *every* accessor was catastrophic here. Anything that re-renders
   * the dashboard (a config event, a status tick) re-set the geometry-affecting
   * props too, reheating the d3 simulation: `onEngineStop` fired 99 times while
   * the page sat idle, the layout never settled, and the camera fit landed on a
   * half-finished layout. Colour-only accessors just recolour materials.
   *
   * Repainting imperatively instead is not an option: `ForceGraphMethods` exposes
   * no accessor setters (only `refresh()`, which rebuilds every node object and
   * reallocates all the label textures).
   */
  const [hover, setHover] = useState<{ id: string; connected: Set<string> } | null>(null);
  const userMoved = useRef(false);

  // ---- sizing: ForceGraph3D defaults to *window* dimensions, not the container ----

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver !== 'function') return;

    const apply = () => {
      const rect = el.getBoundingClientRect();
      // Only ever accept a non-zero measurement. A 0-width canvas yields a 0/0
      // camera aspect — a NaN projection matrix that never recovers — and the
      // container legitimately measures 0 before first paint.
      if (rect.width > 0 && rect.height > 0) {
        setSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
      }
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, []);

  // ---- model ----

  const signature = graphSignature(graphData);
  // Keyed on the content signature, not on `graphData` identity: WikiView
  // refetches on every `wiki-op` event and always produces a new object, which
  // would otherwise discard the settled layout on each wiki write.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const model = useMemo(() => buildGraphModel(graphData, POSITION_CACHE), [signature]);

  const palette = useMemo(() => buildPalette(model.categories, colors), [model, colors]);

  useEffect(() => { fitted.current = false; }, [signature]);

  const isEmpty = model.nodes.length === 0;
  const ready = !loading && !isEmpty && size.w > 0 && size.h > 0;

  // ---- labels ----

  const dense = model.nodes.length > DENSE_NODE_COUNT;
  const spriteStyle = `${colors['--text2']}|${colors['--s1']}|${dense ? 'd' : 'f'}`;

  /**
   * Stable across hover changes — that is the whole point. Sprite identity is
   * keyed only on `spriteStyle`, so a theme switch rebuilds labels (they bake
   * colour into a texture) while hovering never does. Breaking this callback's
   * identity per hover would rebuild every node's Object3D and allocate a fresh
   * texture per node on every mouse move.
   */
  const labelFor = useCallback((node: FgNode) => {
    const cache = spriteCache.current;
    if (spriteStyleRef.current !== spriteStyle) {
      disposeSprites(cache);
      spriteStyleRef.current = spriteStyle;
    }

    const id = String(node.id ?? '');
    const cached = cache.get(id);
    if (cached) return cached;

    const degree = typeof node.degree === 'number' ? node.degree : 0;
    if (dense && degree < 2) return undefined as unknown as SpriteText;

    const sprite = new SpriteText(String(node.title ?? id));
    sprite.textHeight = 2.6;
    sprite.color = colors['--text2'];
    // Outline rather than a filled chip: a chip would occlude nodes behind it,
    // and this reads on both light and dark backgrounds.
    sprite.backgroundColor = false;
    sprite.strokeWidth = 0.6;
    sprite.strokeColor = colors['--s1'];
    sprite.fontFace = 'JetBrains Mono, monospace';
    sprite.fontWeight = '500';
    sprite.center.y = 1.9; // sit below the sphere, as the 2D view did

    cache.set(id, sprite);
    return sprite;
  }, [spriteStyle, dense, colors]);

  // ---- colour accessors ----

  const nodeColorFor = (node: FgNode): string => {
    const category = typeof node.category === 'string' ? node.category : 'other';
    const base = categoryColor(category, palette, colors);
    if (!hover) return base;
    const id = String(node.id ?? '');
    if (id === hover.id) return mixHex(base, colors['--cream'], 0.35);
    if (hover.connected.has(id)) return base;
    return mixHex(base, colors['--s1'], 0.82);
  };

  const linkColorFor = (link: FgLink): string => {
    const category = typeof link.category === 'string' ? link.category : 'other';
    const base = categoryColor(category, palette, colors);
    if (!hover) return base;
    const hot = endpointId(link.source) === hover.id || endpointId(link.target) === hover.id;
    return hot ? mixHex(base, colors['--cream'], 0.25) : mixHex(base, colors['--s1'], 0.9);
  };

  const nodeLabelFor = useCallback((node: FgNode) => String(node.title ?? ''), []);

  // ---- interaction ----

  /**
   * Stop the scene emitting events. Controls dispatch 'change' independently of
   * the render loop and the library's listener walks link endpoints, so anything
   * that races teardown has to go through here first.
   */
  const quiesce = useCallback(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    try {
      const controls = instance.controls() as { enabled?: boolean } | undefined;
      if (controls) controls.enabled = false;
      instance.pauseAnimation();
    } catch {
      // Already torn down.
    }
  }, []);

  const savePositions = useCallback(() => {
    for (const node of model.nodes) {
      if (typeof node.x === 'number' && typeof node.y === 'number' && typeof node.z === 'number') {
        POSITION_CACHE.set(node.id, { x: node.x, y: node.y, z: node.z });
      }
    }
  }, [model]);

  const handleNodeHover = useCallback((node: FgNode | null) => {
    if (!node) { setHover(null); return; }
    const id = String(node.id ?? '');
    setHover({ id, connected: model.adjacency.get(id) ?? new Set<string>() });
  }, [model]);

  const clearHover = useCallback(() => { setHover(null); }, []);

  const handleEngineStop = useCallback(() => {
    savePositions();
    // Refit on every settle until the user takes the camera. The simulation can
    // reheat after the first stop, and a fit computed on a half-spread layout
    // leaves the graph tiny; refitting keeps the view honest without ever
    // yanking the camera away from a user who has started exploring.
    if (!userMoved.current) {
      const fg = fgRef.current;
      if (fg) fitCamera(fg, fitted.current ? 400 : 0);
      fitted.current = true;
    }
  }, [savePositions]);

  const handleNodeClick = useCallback((node: FgNode) => {
    const id = String(node.id ?? '');
    savePositions();

    const fg = fgRef.current;
    const { x, y, z } = node;
    if (fg && typeof x === 'number' && typeof y === 'number' && typeof z === 'number') {
      const ratio = 1 + 90 / (Math.hypot(x, y, z) || 1);
      fg.cameraPosition({ x: x * ratio, y: y * ratio, z: z * ratio }, { x, y, z }, FLY_MS);
    }

    // Let the fly-in read before WikiView swaps the panel out from under us.
    if (flyTimer.current) clearTimeout(flyTimer.current);
    flyTimer.current = setTimeout(() => {
      // Quiet the scene *before* handing off: opening the page unmounts this
      // component, and a controls 'change' landing mid-teardown makes the
      // library read link endpoints that no longer exist.
      quiesce();
      onNodeClick(id);
    }, OPEN_DELAY_MS);
  }, [onNodeClick, savePositions]);

  const resetView = useCallback(() => {
    fitted.current = true;
    userMoved.current = false;
    const fg = fgRef.current;
    if (fg) fitCamera(fg, 500);
  }, []);

  // Once the user drives the camera, stop refitting under them.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const mark = () => { userMoved.current = true; };
    el.addEventListener('pointerdown', mark);
    el.addEventListener('wheel', mark, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', mark);
      el.removeEventListener('wheel', mark);
    };
  }, []);

  // ---- bloom ----

  useEffect(() => {
    if (!ready) return;
    const fg = fgRef.current;
    if (!fg) return;

    instanceRef.current = fg;
    rendererRef.current = fg.renderer();

    const composer = fg.postProcessingComposer();
    // Resolution here is only the initial render-target size; the composer calls
    // setSize on the pass whenever the canvas resizes.
    const pass = new UnrealBloomPass(new Vector2(size.w, size.h), 1, 0.8, 0.2);
    bloomRef.current = pass;
    composer.addPass(pass);

    return () => {
      composer.removePass(pass);
      pass.dispose();
      if (bloomRef.current === pass) bloomRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    const pass = bloomRef.current;
    if (!pass) return;
    // Mutated in place rather than re-added: swapping the pass out on every
    // theme change would churn its render targets.
    const params = bloomParamsFor(colors);
    pass.enabled = params.enabled;
    pass.strength = params.strength;
    pass.radius = params.radius;
    pass.threshold = params.threshold;
  }, [colors, ready]);

  // ---- auto-rotate ----

  useEffect(() => {
    if (!ready) return;
    const controls = fgRef.current?.controls() as
      { autoRotate?: boolean; autoRotateSpeed?: number } | undefined;
    if (!controls) return;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.6;
  }, [autoRotate, ready]);

  // ---- teardown ----

  useEffect(() => {
    const sprites = spriteCache.current;
    return () => {
      if (flyTimer.current) clearTimeout(flyTimer.current);
      disposeSprites(sprites);
      try {
        // Quiet the scene first. Leaving it live produced a "Cannot read
        // properties of undefined (reading 'x')" from the library's own
        // position-update pass firing after teardown had begun.
        quiesce();
        const renderer = rendererRef.current;
        if (renderer) {
          // dispose() alone does NOT release the WebGL context, and browsers cap
          // live contexts (~16 in Chrome) before killing the oldest. This
          // component remounts on every Graph-tab visit, so the cap is reachable.
          renderer.forceContextLoss();
          renderer.dispose();
        }
      } catch {
        // Already torn down by the library's own destructor — nothing to do.
      }
      instanceRef.current = null;
      rendererRef.current = null;
    };
  }, [quiesce]);

  // ---- render ----

  const legend = [...palette.entries()];

  return (
    <div
      ref={wrapRef}
      style={{ width: '100%', height: '100%', position: 'relative', background: 'var(--s1)', overflow: 'hidden' }}
    >
      {ready && (
        <ForceGraph3D
          ref={fgRef}
          graphData={model}
          width={size.w}
          height={size.h}
          backgroundColor={colors['--s1']}
          showNavInfo={false}
          controlType="orbit"
          nodeId="id"
          nodeVal="val"
          nodeResolution={12}
          nodeOpacity={0.95}
          nodeLabel={nodeLabelFor}
          // Inline on purpose: identity must change for the hover recolour to
          // land. Safe for colour, unlike the geometry props below.
          nodeColor={(node: FgNode) => nodeColorFor(node)}
          nodeThreeObjectExtend
          nodeThreeObject={showLabels ? labelFor : undefined}
          linkColor={(link: FgLink) => linkColorFor(link)}
          // Constant width, and no directional particles: both are per-link
          // geometry, so driving them from hover rebuilt link objects on every
          // mouse move and reheated the layout. Hover highlights by colour only,
          // which is what the 2D view did too.
          linkWidth={0.5}
          linkOpacity={light ? 0.4 : 0.28}
          warmupTicks={60}
          cooldownTicks={200}
          onEngineStop={handleEngineStop}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          onBackgroundClick={clearHover}
        />
      )}

      {/* Loading */}
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4" style={{ color: 'var(--muted)', zIndex: 12 }}>
          <div style={{
            width: 36, height: 36,
            border: '2.5px solid var(--b2)',
            borderTopColor: 'var(--gold)',
            borderRadius: '50%',
            animation: 'wikiSpin 0.75s linear infinite',
            boxShadow: '0 0 12px color-mix(in srgb, var(--gold) 35%, transparent)',
          }} />
          <span className="text-[11px]">Building knowledge graph…</span>
        </div>
      )}

      {/* Empty */}
      {!loading && isEmpty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center" style={{ zIndex: 12 }}>
          <div style={{
            width: 56, height: 56,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 30%, var(--s3), var(--s1))',
            border: '1px solid var(--b1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 24px color-mix(in srgb, var(--gold) 8%, transparent)',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--gold)', opacity: 0.5 }}>
              <circle cx="12" cy="12" r="2.5" />
              <circle cx="4.5" cy="4.5" r="1.5" />
              <circle cx="19.5" cy="4.5" r="1.5" />
              <circle cx="4.5" cy="19.5" r="1.5" />
              <circle cx="19.5" cy="19.5" r="1.5" />
              <line x1="12" y1="9.5" x2="5.5" y2="5.5" />
              <line x1="12" y1="9.5" x2="18.5" y2="5.5" />
              <line x1="12" y1="14.5" x2="5.5" y2="18.5" />
              <line x1="12" y1="14.5" x2="18.5" y2="18.5" />
            </svg>
          </div>
          <div>
            <div className="text-[13px] font-semibold" style={{ color: 'var(--fg)' }}>Graph is empty</div>
            <div className="text-[11px] mt-1.5" style={{ color: 'var(--muted)' }}>Ingest documents to build the knowledge graph</div>
          </div>
          <div className="text-[10px] font-mono px-3 py-1.5 rounded-lg" style={{ background: 'var(--s2)', color: 'var(--muted)', border: '1px solid var(--b1)', letterSpacing: '0.02em' }}>
            ingest plans/spec.md into the wiki
          </div>
        </div>
      )}

      {!loading && !isEmpty && (
        <>
          {/* Vignette — skipped on light themes, where a dark radial reads as grime */}
          {!light && (
            <div style={{
              position: 'absolute',
              inset: 0,
              background: [
                'radial-gradient(ellipse 75% 75% at 50% 50%, transparent 25%, color-mix(in srgb, var(--s1) 65%, transparent) 100%)',
                'radial-gradient(circle at 25% 80%, color-mix(in srgb, var(--gold) 3%, transparent) 0%, transparent 50%)',
              ].join(', '),
              pointerEvents: 'none',
              zIndex: 3,
            }} />
          )}

          {/* Category legend */}
          <div style={{
            position: 'absolute',
            bottom: 14,
            left: 14,
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            background: 'color-mix(in srgb, var(--s2) 88%, transparent)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            border: '1px solid color-mix(in srgb, var(--b2) 45%, transparent)',
            borderRadius: 11,
            padding: '9px 13px',
            pointerEvents: 'none',
            boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
          }}>
            {legend.map(([category, color]) => (
              <div key={category} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 8, height: 8,
                  borderRadius: '50%',
                  background: color,
                  boxShadow: `0 0 6px ${color}`,
                  flexShrink: 0,
                }} />
                <span style={{ fontSize: 10, color: 'var(--text2)', letterSpacing: '0.02em' }}>
                  {titleCase(category)}
                </span>
              </div>
            ))}
          </div>

          {/* Counts */}
          <div style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'color-mix(in srgb, var(--s2) 88%, transparent)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            border: '1px solid color-mix(in srgb, var(--b2) 40%, transparent)',
            borderRadius: 20,
            padding: '3px 12px',
            pointerEvents: 'none',
            boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
            fontSize: 10,
            color: 'var(--text2)',
            letterSpacing: '0.04em',
          }}>
            <span><span style={{ color: 'var(--gold)', fontWeight: 600 }}>{model.nodes.length}</span> nodes</span>
            <div style={{ width: 1, height: 10, background: 'var(--b2)' }} />
            <span><span style={{ color: 'var(--gold)', fontWeight: 600 }}>{model.links.length}</span> connections</span>
            {model.droppedLinks > 0 && (
              <>
                <div style={{ width: 1, height: 10, background: 'var(--b2)' }} />
                <span
                  style={{ color: 'var(--muted)' }}
                  title="Wikilinks pointing at a page that doesn't exist under this slug — not drawn"
                >
                  <span style={{ fontWeight: 600 }}>{model.droppedLinks}</span> unresolved
                </span>
              </>
            )}
          </div>

          {/* Controls */}
          <div style={{
            position: 'absolute',
            bottom: 14,
            right: 14,
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}>
            <GraphButton label="Reset view" onClick={resetView}>⤢</GraphButton>
            <GraphButton label="Toggle auto-rotate" active={autoRotate} onClick={() => { setAutoRotate(v => !v); }}>◎</GraphButton>
            <GraphButton label="Toggle labels" active={showLabels} onClick={() => { setShowLabels(v => !v); }}>A</GraphButton>
          </div>
        </>
      )}
    </div>
  );
}

function GraphButton({ label, active, onClick, children }: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className="flex items-center justify-center w-7 h-7 rounded-lg text-[12px] cursor-pointer transition-all duration-150"
      style={{
        background: active ? 'var(--s3)' : 'color-mix(in srgb, var(--s2) 88%, transparent)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid color-mix(in srgb, var(--b2) 45%, transparent)',
        color: active ? 'var(--gold)' : 'var(--muted)',
      }}
    >
      {children}
    </button>
  );
}
