import type { TraceNode } from '@/lib/shared/state'

const MARK: Record<string, string> = {
  success: '✓',
  failed: '✗',
  waiting: '⏸',
  running: '…',
  skipped: '↷',
  interrupted: '■',
}

export function TraceTree({ node }: { node: TraceNode }) {
  return (
    <div className="font-mono text-[10px] leading-relaxed text-muted-foreground">
      <Row node={node} depth={0} />
    </div>
  )
}

function Row({ node, depth }: { node: TraceNode; depth: number }) {
  return (
    <>
      <div style={{ paddingLeft: depth * 10 }}>
        {node.children.length > 0 ? '▾' : '▸'} {node.kind} {node.name}{' '}
        {MARK[node.status.toLowerCase()] ?? node.status}
        {node.durationMs !== undefined && ` ${node.durationMs}ms`}
      </div>
      {node.children.map((child, i) => (
        <Row key={i} node={child} depth={depth + 1} />
      ))}
    </>
  )
}
