import { describe, it, expect } from 'vitest';
import {
  buildGraphModel,
  graphSignature,
  type Position,
  type WikiGraphInput,
} from './wiki-graph-model.js';

const page = (slug: string, category = 'concepts') => ({ slug, title: slug.split('/').pop()!, category });

const graph: WikiGraphInput = {
  nodes: [page('concepts/alpha'), page('concepts/beta'), page('entities/gamma', 'entities')],
  edges: [
    { source: 'concepts/alpha', target: 'concepts/beta' },
    { source: 'concepts/beta', target: 'entities/gamma' },
  ],
};

describe('buildGraphModel', () => {
  it('returns an empty model for null and for a graph with no nodes', () => {
    for (const input of [null, { nodes: [], edges: [] }]) {
      const model = buildGraphModel(input);
      expect(model.nodes).toEqual([]);
      expect(model.links).toEqual([]);
      expect(model.categories).toEqual([]);
      expect(model.droppedLinks).toBe(0);
    }
  });

  it('keeps links whose endpoints both resolve to a page', () => {
    const model = buildGraphModel(graph);
    expect(model.links).toHaveLength(2);
    expect(model.droppedLinks).toBe(0);
  });

  it('drops links pointing at a missing page and counts them', () => {
    // This is the normal case: wiki/src/graph.ts emits raw wikilink text as the
    // target, so most edges never resolve to a slug. d3-force throws on an
    // unresolvable id, so these must not reach the renderer.
    const model = buildGraphModel({
      ...graph,
      edges: [
        ...graph.edges,
        { source: 'concepts/alpha', target: 'Some Concept' },
        { source: 'Nowhere', target: 'concepts/beta' },
      ],
    });
    expect(model.links).toHaveLength(2);
    expect(model.droppedLinks).toBe(2);
    expect(model.links.every(l => l.target !== 'Some Concept')).toBe(true);
  });

  it('drops self-loops without counting them as unresolved', () => {
    const model = buildGraphModel({
      ...graph,
      edges: [{ source: 'concepts/alpha', target: 'concepts/alpha' }],
    });
    expect(model.links).toHaveLength(0);
    expect(model.droppedLinks).toBe(0);
  });

  it('collapses duplicate pairs, in either direction', () => {
    const model = buildGraphModel({
      ...graph,
      edges: [
        { source: 'concepts/alpha', target: 'concepts/beta' },
        { source: 'concepts/alpha', target: 'concepts/beta' },
        { source: 'concepts/beta', target: 'concepts/alpha' },
      ],
    });
    expect(model.links).toHaveLength(1);
  });

  it('computes degree from the filtered links only', () => {
    const model = buildGraphModel({
      ...graph,
      edges: [
        { source: 'concepts/alpha', target: 'concepts/beta' },
        { source: 'concepts/alpha', target: 'Missing Page' },
        { source: 'concepts/alpha', target: 'concepts/beta' },  // duplicate
      ],
    });
    const alpha = model.nodes.find(n => n.id === 'concepts/alpha')!;
    const gamma = model.nodes.find(n => n.id === 'entities/gamma')!;
    expect(alpha.degree).toBe(1);
    expect(gamma.degree).toBe(0);
  });

  it('sizes nodes by degree, monotonically', () => {
    const model = buildGraphModel(graph);
    const byDegree = [...model.nodes].sort((a, b) => a.degree - b.degree);
    for (let i = 1; i < byDegree.length; i++) {
      expect(byDegree[i]!.val).toBeGreaterThanOrEqual(byDegree[i - 1]!.val);
    }
    expect(model.nodes.every(n => n.val > 0)).toBe(true);
  });

  it('builds an undirected adjacency map', () => {
    const { adjacency } = buildGraphModel(graph);
    expect(adjacency.get('concepts/alpha')).toEqual(new Set(['concepts/beta']));
    expect(adjacency.get('concepts/beta')).toEqual(new Set(['concepts/alpha', 'entities/gamma']));
    expect(adjacency.get('entities/gamma')).toEqual(new Set(['concepts/beta']));
  });

  it('lists the categories present, sorted', () => {
    expect(buildGraphModel(graph).categories).toEqual(['concepts', 'entities']);
  });

  it('falls back to a slug-derived title and the other category', () => {
    const model = buildGraphModel({
      nodes: [{ slug: 'notes/untitled', title: '', category: '' }],
      edges: [],
    });
    expect(model.nodes[0]!.title).toBe('untitled');
    expect(model.nodes[0]!.category).toBe('other');
  });

  it('returns freshly allocated objects every call', () => {
    // react-force-graph writes x/y/z/vx/vy/vz onto nodes and replaces link
    // endpoints with node references. Sharing objects between calls would let it
    // mutate React state behind React's back.
    const a = buildGraphModel(graph);
    const b = buildGraphModel(graph);
    expect(a.nodes).not.toBe(b.nodes);
    expect(a.nodes[0]).not.toBe(b.nodes[0]);
    expect(a.links[0]).not.toBe(b.links[0]);
    expect(a.adjacency).not.toBe(b.adjacency);
    expect(a.nodes[0]).toEqual(b.nodes[0]);
  });

  it('does not mutate its input', () => {
    const input = structuredClone(graph);
    buildGraphModel(input);
    expect(input).toEqual(graph);
  });

  it('seeds positions from the cache so a rebuild resumes instead of re-exploding', () => {
    const seed = new Map<string, Position>([['concepts/beta', { x: 1, y: 2, z: 3 }]]);
    const model = buildGraphModel(graph, seed);
    expect(model.nodes.find(n => n.id === 'concepts/beta')).toMatchObject({ x: 1, y: 2, z: 3 });
    expect(model.nodes.find(n => n.id === 'concepts/alpha')!.x).toBeUndefined();
  });
});

describe('graphSignature', () => {
  it('is empty for null', () => {
    expect(graphSignature(null)).toBe('');
  });

  it('is stable when the input is merely reordered', () => {
    const reordered: WikiGraphInput = {
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
    };
    expect(graphSignature(reordered)).toBe(graphSignature(graph));
  });

  it('is stable across distinct objects with equal content', () => {
    expect(graphSignature(structuredClone(graph))).toBe(graphSignature(graph));
  });

  it('changes when a node, title, category or edge changes', () => {
    const base = graphSignature(graph);
    expect(graphSignature({ ...graph, nodes: [...graph.nodes, page('concepts/delta')] })).not.toBe(base);
    expect(graphSignature({ ...graph, edges: [] })).not.toBe(base);
    expect(graphSignature({
      ...graph,
      nodes: [{ ...graph.nodes[0]!, title: 'Renamed' }, ...graph.nodes.slice(1)],
    })).not.toBe(base);
    expect(graphSignature({
      ...graph,
      nodes: [{ ...graph.nodes[0]!, category: 'summaries' }, ...graph.nodes.slice(1)],
    })).not.toBe(base);
  });
});
