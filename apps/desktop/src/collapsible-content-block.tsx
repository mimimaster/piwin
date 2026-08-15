/**
 * Collapsible content block with bottom mask-gradient blur and centered toggle icon.
 * Used for long bash outputs, diff blocks, and code panels.
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { IconChevronDown, IconChevronUp } from './shell-icons';

export type CollapsibleContentBlockProps = {
  children?: ReactNode;
  renderCollapsed?: () => ReactNode;
  renderExpanded?: () => ReactNode;
  maxCollapsedHeight?: number;
  defaultCollapsed?: boolean;
  /** Explicit override for whether content can be expanded/collapsed (bypasses measuring collapsed preview). */
  expandable?: boolean;
  className?: string;
};

export function CollapsibleContentBlock(props: CollapsibleContentBlockProps): ReactElement {
  const maxCollapsedHeight = props.maxCollapsedHeight ?? 130;
  const [collapsed, setCollapsed] = useState(props.defaultCollapsed ?? true);
  const [measuredOverflow, setMeasuredOverflow] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const isOverflowing =
    props.expandable !== undefined ? props.expandable || measuredOverflow : measuredOverflow;

  useEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    function checkOverflow(): void {
      if (!node) return;
      setMeasuredOverflow(node.scrollHeight > maxCollapsedHeight + 12);
    }

    checkOverflow();
    const observer = new ResizeObserver(checkOverflow);
    observer.observe(node);
    return () => observer.disconnect();
  }, [maxCollapsedHeight, props.children]);

  useEffect(() => {
    if (props.defaultCollapsed !== undefined) {
      setCollapsed(props.defaultCollapsed);
    }
  }, [props.defaultCollapsed]);

  const shouldCollapse = isOverflowing && collapsed;

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (shouldCollapse) {
      const target = e.target as HTMLElement;
      // Don't steal clicks from interactive controls; code text is fine to expand.
      if (target.closest('button, a')) {
        return;
      }
      setCollapsed(false);
    }
  };

  const renderedContent = shouldCollapse
    ? (props.renderCollapsed ? props.renderCollapsed() : props.children)
    : (props.renderExpanded ? props.renderExpanded() : props.children);

  return (
    <div
      className={`collapsible-content-block ${shouldCollapse ? 'is-collapsed' : 'is-expanded'} ${
        isOverflowing ? 'has-overflow' : ''
      } ${props.className ?? ''}`}
      onClick={handleContainerClick}
      data-testid="collapsible-content-block"
    >
      <div
        ref={contentRef}
        className="collapsible-content-inner"
        style={shouldCollapse ? { maxHeight: `${maxCollapsedHeight}px` } : undefined}
      >
        {renderedContent}
      </div>
      {isOverflowing ? (
        <button
          type="button"
          className="collapsible-content-toggle"
          onClick={(e) => {
            e.stopPropagation();
            setCollapsed((prev) => !prev);
          }}
          aria-label={collapsed ? 'Expand content' : 'Collapse content'}
          title={collapsed ? '展开' : '折叠'}
          data-testid="collapsible-content-toggle"
        >
          {collapsed ? (
            <IconChevronDown className="collapsible-toggle-icon" />
          ) : (
            <IconChevronUp className="collapsible-toggle-icon" />
          )}
        </button>
      ) : null}
    </div>
  );
}
