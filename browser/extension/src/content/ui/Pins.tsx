import { useMemo } from 'preact/hooks';
import type { Comment, TargetInfo } from '@brm/shared';
import { STATUS_LABELS } from '@brm/shared';
import { findTarget } from '../targets.ts';
import { useTrackedRect } from '../hooks.ts';
import { px } from '../px.ts';

function Pin({ comment, onOpen, onHover }: { comment: Comment; onOpen: (id: number) => void; onHover: (id: number | null) => void }) {
  const target = comment.target as TargetInfo;
  const resolve = useMemo(() => () => findTarget(target), [target]);
  const rect = useTrackedRect(resolve, true);
  if (!rect) return null;
  if (rect.y + rect.height < 0 || rect.y > innerHeight || rect.x + rect.width < 0 || rect.x > innerWidth) return null;
  const left = Math.max(2, Math.min(innerWidth - 26, rect.x + rect.width - 12));
  const top = Math.max(2, Math.min(innerHeight - 26, rect.y - 12));
  return (
    <button
      class={`brm-ui brm-pin st-${comment.status}`}
      style={px({ left, top })}
      title={`#${comment.id} ${STATUS_LABELS[comment.status]}`}
      onClick={() => onOpen(comment.id)}
      onMouseEnter={() => onHover(comment.id)}
      onMouseLeave={() => onHover(null)}
    >
      {comment.id}
    </button>
  );
}

export function Pins({
  comments,
  onOpen,
  onHover,
}: {
  comments: Comment[];
  onOpen: (id: number) => void;
  onHover: (id: number | null) => void;
}) {
  return (
    <>
      {comments.map((c) => (
        <Pin key={c.id} comment={c} onOpen={onOpen} onHover={onHover} />
      ))}
    </>
  );
}

/** Outline around the element of a comment, for hover and "Show on page". */
export function Outline({ target, flash }: { target: TargetInfo; flash?: boolean }) {
  const resolve = useMemo(() => () => findTarget(target), [target]);
  const rect = useTrackedRect(resolve);
  if (!rect) return null;
  return (
    <div
      class={`brm-outline ${flash ? 'is-flash' : ''}`}
      style={px({ left: rect.x - 3, top: rect.y - 3, width: rect.width + 6, height: rect.height + 6 })}
    />
  );
}
