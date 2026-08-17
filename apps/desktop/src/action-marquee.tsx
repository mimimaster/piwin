import { useEffect, useState, useRef, type ReactElement } from 'react';

export type ActionMarqueeProps = {
  activeText: string;
  className?: string;
  prefixIcon?: ReactElement;
};

/**
 * Single-line action marquee with smooth vertical slide-up & fade transition
 * matching Cursor's live execution indicator.
 */
export function ActionMarquee(props: ActionMarqueeProps): ReactElement {
  const [currentText, setCurrentText] = useState(props.activeText);
  const [animating, setAnimating] = useState(false);
  const prevTextRef = useRef(props.activeText);

  useEffect(() => {
    if (props.activeText !== prevTextRef.current) {
      prevTextRef.current = props.activeText;
      setCurrentText(props.activeText);
      setAnimating(true);
      const timer = window.setTimeout(() => setAnimating(false), 320);
      return () => window.clearTimeout(timer);
    }
  }, [props.activeText]);

  return (
    <span
      className={`action-marquee-container ${props.className ?? ''}`}
      data-testid="action-marquee"
    >
      {props.prefixIcon ? (
        <span className="action-marquee-icon" aria-hidden="true">
          {props.prefixIcon}
        </span>
      ) : null}
      <span
        key={currentText}
        className={`action-marquee-text${animating ? ' is-animating' : ''}`}
        title={currentText}
      >
        {currentText}
      </span>
    </span>
  );
}
