import { useMemo, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';

// ---------- types ----------

interface WikiGraphData {
  nodes: Array<{ slug: string; title: string; category: string }>;
  edges: Array<{ source: string; target: string }>;
}

interface Props {
  graphData: WikiGraphData | null;
  loading: boolean;
  onNodeClick: (slug: string) => void;
}

// ---------- category config ----------

const CATEGORY: Record<string, {
  fill: string; light: string; dark: string;
  glowRgb: string; edgeColor: string; hex: string;
}> = {
  concepts:  { fill: '#f75858', light: '#ff9090', dark: '#be3232', glowRgb: '254,0,0',     edgeColor: 'rgba(254,0,0,0.55)',     hex: '#f75858' },
  entities:  { fill: '#5e89e0', light: '#8cb4ff', dark: '#3658b4', glowRgb: '16,96,255',   edgeColor: 'rgba(16,96,255,0.55)',   hex: '#5e89e0' },
  summaries: { fill: '#bd68bd', light: '#dc8cdc', dark: '#460f46', glowRgb: '171,49,170',  edgeColor: 'rgba(171,49,170,0.55)',  hex: '#bd68bd' },
  other:     { fill: '#24b550', light: '#82e6a0', dark: '#0c5023', glowRgb: '36,181,80',   edgeColor: 'rgba(36,181,80,0.55)',   hex: '#24b550' },
};

function getCat(cat: string) {
  return CATEGORY[cat.toLowerCase()] ?? CATEGORY.other!;
}

// ---------- node data ----------

type WikiNodeData = {
  slug: string;
  title: string;
  category: string;
  fill: string; light: string; dark: string;
  glowRgb: string;
  radius: number;
  degree: number;
  dimmed: boolean;
  hovered: boolean;
} & Record<string, unknown>;

type WikiFlowNode = Node<WikiNodeData, 'wikiNode'>;

// ---------- force layout ----------

function forceLayout(
  gNodes: WikiGraphData['nodes'],
  gEdges: WikiGraphData['edges'],
  iterations = 150,
): Map<string, { x: number; y: number }> {
  const n = gNodes.length;
  const pos = new Map<string, { x: number; y: number }>();
  const vel = new Map<string, { vx: number; vy: number }>();
  const r = Math.min(320, Math.max(80, n * 22));

  gNodes.forEach((nd, i) => {
    const a = (i / n) * 2 * Math.PI;
    pos.set(nd.slug, { x: 400 + r * Math.cos(a), y: 400 + r * Math.sin(a) });
    vel.set(nd.slug, { vx: 0, vy: 0 });
  });

  const slugs = gNodes.map(nd => nd.slug);

  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < slugs.length; i++) {
      for (let j = i + 1; j < slugs.length; j++) {
        const si = slugs[i]!, sj = slugs[j]!;
        const a = pos.get(si)!, b = pos.get(sj)!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = Math.max(1, dx * dx + dy * dy), d = Math.sqrt(d2);
        const f = 8000 / d2, fx = (dx / d) * f, fy = (dy / d) * f;
        const va = vel.get(si)!, vb = vel.get(sj)!;
        va.vx -= fx; va.vy -= fy; vb.vx += fx; vb.vy += fy;
      }
    }
    for (const e of gEdges) {
      const a = pos.get(e.source), b = pos.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy)), f = d * 0.04;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      const va = vel.get(e.source), vb = vel.get(e.target);
      if (va) { va.vx += fx; va.vy += fy; }
      if (vb) { vb.vx -= fx; vb.vy -= fy; }
    }
    for (const slug of slugs) {
      const p = pos.get(slug)!, v = vel.get(slug)!;
      v.vx = Math.max(-20, Math.min(20, v.vx));
      v.vy = Math.max(-20, Math.min(20, v.vy));
      p.x += v.vx; p.y += v.vy;
      v.vx *= 0.85; v.vy *= 0.85;
    }
  }
  return pos;
}

// ---------- node component ----------

const HUB = 5;
const BIG_HUB = 9;

function WikiNodeComp(props: NodeProps) {
  const d = props.data as WikiNodeData;
  const r = d.radius as number;
  const deg = d.degree as number;
  const isDimmed = d.dimmed as boolean;
  const isHovered = d.hovered as boolean;
  const rgb = d.glowRgb as string;
  const fill = d.fill as string;
  const isHub = deg >= HUB;
  const isBigHub = deg >= BIG_HUB;

  const shadow = isDimmed ? 'none'
    : isHovered
      ? `0 0 0 1.5px rgba(${rgb},0.8), 0 0 10px rgba(${rgb},1), 0 0 24px rgba(${rgb},0.7), 0 0 44px rgba(${rgb},0.3), 0 0 70px rgba(${rgb},0.12)`
      : `0 0 0 1px rgba(${rgb},0.35), 0 0 7px rgba(${rgb},0.65), 0 0 18px rgba(${rgb},0.25)`;

  const scale = isHovered ? 'scale(1.28)' : 'scale(1)';

  return (
    <div style={{ position: 'relative', width: r * 2, height: r * 2 }}>

      {/* Outer ambient glow ring (always visible on hub nodes) */}
      {isHub && !isDimmed && (
        <div style={{
          position: 'absolute',
          inset: -(r * 0.55),
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(${rgb},0.08) 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />
      )}

      {/* Pulse ring 1 */}
      {isHub && !isDimmed && (
        <div style={{
          position: 'absolute',
          inset: -(r * 0.45),
          borderRadius: '50%',
          border: `1.5px solid rgba(${rgb},0.5)`,
          animation: 'wikiNodePulse 2.6s cubic-bezier(0.4,0,0.6,1) infinite',
          pointerEvents: 'none',
        }} />
      )}

      {/* Pulse ring 2 — offset phase for very connected nodes */}
      {isBigHub && !isDimmed && (
        <div style={{
          position: 'absolute',
          inset: -(r * 0.8),
          borderRadius: '50%',
          border: `1px solid rgba(${rgb},0.28)`,
          animation: 'wikiNodePulse 3.8s cubic-bezier(0.4,0,0.6,1) infinite 1.1s',
          pointerEvents: 'none',
        }} />
      )}

      {/* Main circle */}
      <div style={{
        position: 'absolute',
        inset: 0,
        borderRadius: '50%',
        background: `radial-gradient(circle at 33% 28%, ${d.light as string} 0%, ${fill} 52%, ${d.dark as string} 100%)`,
        boxShadow: shadow,
        opacity: isDimmed ? 0.06 : 1,
        transform: scale,
        transition: 'transform 0.22s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s ease, opacity 0.18s ease',
        overflow: 'hidden',
      }}>
        {/* Specular highlight — the "glassy sphere" look */}
        <div style={{
          position: 'absolute',
          top: '9%', left: '14%',
          width: '38%', height: '38%',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,255,255,0.62) 0%, rgba(255,255,255,0.1) 55%, transparent 100%)',
          pointerEvents: 'none',
        }} />
        {/* Subtle bottom sheen */}
        <div style={{
          position: 'absolute',
          bottom: '10%', right: '12%',
          width: '22%', height: '22%',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,255,255,0.18) 0%, transparent 100%)',
          pointerEvents: 'none',
        }} />
      </div>

      {/* Floating label */}
      {!isDimmed && (
        <div style={{
          position: 'absolute',
          top: r * 2 + 5,
          left: '50%',
          transform: 'translateX(-50%)',
          whiteSpace: 'nowrap',
          maxWidth: 128,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontSize: isHovered ? 10 : 9,
          fontWeight: isHovered ? 600 : 400,
          color: isHovered ? fill : 'var(--text2)',
          background: 'color-mix(in srgb, var(--bg) 78%, transparent)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          padding: '1px 6px 2px',
          borderRadius: 5,
          border: isHovered ? `1px solid rgba(${rgb},0.4)` : '1px solid transparent',
          boxShadow: isHovered ? `0 0 8px rgba(${rgb},0.3)` : 'none',
          transition: 'all 0.2s ease',
          fontFamily: 'inherit',
          letterSpacing: isHovered ? '0.025em' : 'normal',
          pointerEvents: 'none',
        }}>
          {d.title as string}
        </div>
      )}

      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: 'none' }} />
    </div>
  );
}

const nodeTypes = { wikiNode: WikiNodeComp };

// ---------- legend ----------

const LEGEND = [
  { label: 'Concepts',  color: CATEGORY.concepts!.fill,  rgb: CATEGORY.concepts!.glowRgb  },
  { label: 'Entities',  color: CATEGORY.entities!.fill,  rgb: CATEGORY.entities!.glowRgb  },
  { label: 'Summaries', color: CATEGORY.summaries!.fill, rgb: CATEGORY.summaries!.glowRgb },
  { label: 'Other',     color: CATEGORY.other!.fill,     rgb: CATEGORY.other!.glowRgb     },
];

// ---------- main component ----------

export default function WikiGraphView({ graphData, loading, onNodeClick }: Props) {
  const { initNodes, initEdges, adjacency } = useMemo(() => {
    const gNodes = graphData?.nodes ?? [];
    const gEdges = graphData?.edges ?? [];

    if (gNodes.length === 0) {
      return { initNodes: [] as WikiFlowNode[], initEdges: [] as Edge[], adjacency: new Map<string, Set<string>>() };
    }

    const degree = new Map<string, number>();
    const slugToCat = new Map<string, string>();
    for (const nd of gNodes) { degree.set(nd.slug, 0); slugToCat.set(nd.slug, nd.category); }
    for (const e of gEdges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }

    const adj = new Map<string, Set<string>>();
    for (const nd of gNodes) adj.set(nd.slug, new Set());
    for (const e of gEdges) {
      adj.get(e.source)?.add(e.target);
      adj.get(e.target)?.add(e.source);
    }

    const positions = forceLayout(gNodes, gEdges, 150);

    const flowNodes: WikiFlowNode[] = gNodes.map(nd => {
      const deg = degree.get(nd.slug) ?? 0;
      const radius = Math.min(11, Math.max(4, 4 + deg * 0.8));
      const pos = positions.get(nd.slug) ?? { x: 400, y: 400 };
      const cat = getCat(nd.category);
      return {
        id: nd.slug,
        type: 'wikiNode' as const,
        position: pos,
        data: {
          slug: nd.slug,
          title: nd.title || (nd.slug.split('/').pop() ?? nd.slug),
          category: nd.category,
          fill: cat.fill,
          light: cat.light,
          dark: cat.dark,
          glowRgb: cat.glowRgb,
          radius,
          degree: deg,
          dimmed: false,
          hovered: false,
        },
      };
    });

    const flowEdges: Edge[] = gEdges.map((e, i) => {
      const cat = getCat(slugToCat.get(e.source) ?? 'other');
      return {
        id: `e${i}-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        type: 'straight',
        animated: true,
        style: { stroke: cat.edgeColor, strokeWidth: 1.3, opacity: 0.85 },
      };
    });

    return { initNodes: flowNodes, initEdges: flowEdges, adjacency: adj };
  }, [graphData]);

  const [nodes, setNodes, onNodesChange] = useNodesState<WikiFlowNode>(initNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges);

  useEffect(() => {
    setNodes(initNodes);
    setEdges(initEdges);
  }, [initNodes, initEdges, setNodes, setEdges]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_e, node) => { onNodeClick(node.id); },
    [onNodeClick],
  );

  const onNodeMouseEnter: NodeMouseHandler = useCallback((_e, node) => {
    const slug = node.id;
    const connected = new Set([slug, ...(adjacency.get(slug) ?? [])]);
    setNodes(nds => nds.map(n => ({
      ...n,
      data: { ...n.data, dimmed: !connected.has(n.id), hovered: n.id === slug },
    })));
    setEdges(eds => eds.map(e => ({
      ...e,
      style: {
        ...(e.style ?? {}),
        opacity: connected.has(e.source) && connected.has(e.target) ? 1 : 0.05,
      },
    })));
  }, [adjacency, setNodes, setEdges]);

  const onNodeMouseLeave: NodeMouseHandler = useCallback(() => {
    setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, dimmed: false, hovered: false } })));
    setEdges(eds => eds.map(e => ({ ...e, style: { ...(e.style ?? {}), opacity: 0.85 } })));
  }, [setNodes, setEdges]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4" style={{ color: 'var(--muted)' }}>
        <div style={{
          width: 36, height: 36,
          border: '2.5px solid var(--b2)',
          borderTopColor: 'var(--gold)',
          borderRadius: '50%',
          animation: 'wikiSpin 0.75s linear infinite',
          boxShadow: '0 0 12px rgba(224,175,104,0.35)',
        }} />
        <span className="text-[11px]">Building knowledge graph…</span>
      </div>
    );
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
        <div style={{
          width: 56, height: 56,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 30%, var(--s3), var(--s1))',
          border: '1px solid var(--b1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 24px rgba(224,175,104,0.08)',
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
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: 'var(--bg)' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        style={{ background: 'var(--bg)' }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.2} color="var(--b1)" />
        <Controls />
        <MiniMap
          nodeColor={(node) => getCat((node.data as WikiNodeData).category as string).hex}
          maskColor="color-mix(in srgb, var(--s1) 75%, transparent)"
          style={{
            background: 'color-mix(in srgb, var(--s2) 90%, transparent)',
            backdropFilter: 'blur(8px)',
            border: '1px solid color-mix(in srgb, var(--b2) 50%, transparent)',
            borderRadius: 10,
            boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
          }}
        />
      </ReactFlow>

      {/* Vignette — softens canvas edges, z-index above graph but below panels (z-5) */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: [
          'radial-gradient(ellipse 75% 75% at 50% 50%, transparent 25%, color-mix(in srgb, var(--s1) 65%, transparent) 100%)',
          'radial-gradient(circle at 25% 80%, rgba(224,175,104,0.03) 0%, transparent 50%)',
        ].join(', '),
        pointerEvents: 'none',
        zIndex: 3,
      }} />

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
        boxShadow: '0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}>
        {LEGEND.map(({ label, color, rgb }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 8, height: 8,
              borderRadius: '50%',
              background: color,
              boxShadow: `0 0 6px rgba(${rgb},0.7)`,
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'inherit', letterSpacing: '0.02em' }}>
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* Node + edge count badge */}
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
      }}>
        <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'inherit', letterSpacing: '0.04em' }}>
          <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{graphData.nodes.length}</span>
          {' '}nodes
        </span>
        <div style={{ width: 1, height: 10, background: 'var(--b2)' }} />
        <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'inherit', letterSpacing: '0.04em' }}>
          <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{graphData.edges.length}</span>
          {' '}connections
        </span>
      </div>
    </div>
  );
}
