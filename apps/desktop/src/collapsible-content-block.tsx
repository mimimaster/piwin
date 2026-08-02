/**
 * Collapsible content block with bottom mask-gradient blur and centered toggle icon.
 * Used for long bash outputs, diff blocks, and code panels.
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { IconChevronDown, IconChevronUp } from './shell-icons';

export type CollapsibleContentBlockProps = {
  children: ReactNode;
  maxCollapsedHeight?: number;
  defaultCollapsed?: boolean;
  className?: string;
};

export function CollapsibleContentBlock(props: CollapsibleContentBlockProps): ReactElement {
  const maxCollapsedHeight = props.maxCollapsedHeight ?? 130;
  const [collapsed, setCollapsed] = useState(props.defaultCollapsed ?? true);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    function checkOverflow(): void {
      if (!node) return;
      setIsOverflowing(node.scrollHeight > maxCollapsedHeight + 12);
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
        {props.children}
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
