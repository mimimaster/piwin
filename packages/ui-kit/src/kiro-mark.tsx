/**
 * Kiro brand mark. modelicons 0.1.3 has no Kiro entry, so the OAuth row
 * can still show the vendor chip.
 */
import type { CSSProperties, ReactElement } from 'react';
import type { BrandIcon } from './provider-brands-icons.js';

type MarkProps = {
  size?: number | string;
  style?: CSSProperties;
  className?: string;
};

function KiroGlyph(props: MarkProps): ReactElement {
  const size = props.size ?? '1em';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      className={props.className}
      style={{ display: 'block', flex: 'none', ...props.style }}
      aria-hidden
    >
      <path d="M4.594 6.677C6.67-2.226 18.746-2.211 21.16 6.632c.353 1.297 1.725 7.582-1.673 13.747-1.545 2.797-5.841 5.49-6.99 1.883C8.6 25.477 3.315 24.1 5.789 18.609l-.318.143c-3.57 1.305-3.863-1.208-3.173-2.513.45-.84.727-1.335.937-1.897.353-.975.458-1.568.593-2.498.27-1.837.277-3.607.765-5.167zm8.37.01a.92.92 0 00-.81.428c-.217.323-.33.825-.33 1.462 0 .705.15 1.89 1.14 1.89h.008c.757 0 1.214-.705 1.214-1.89 0-.622-.127-1.125-.367-1.455a1.014 1.014 0 00-.855-.435zm4.08 0a.92.92 0 00-.81.428c-.217.323-.33.825-.33 1.462 0 .705.15 1.89 1.14 1.89h.008c.757 0 1.215-.705 1.215-1.89 0-.622-.128-1.125-.368-1.455a1.014 1.014 0 00-.855-.435z" />
    </svg>
  );
}

function KiroAvatar(props: MarkProps): ReactElement {
  const size = props.size ?? '1em';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={props.className}
      style={{ display: 'block', flex: 'none', ...props.style }}
      aria-hidden
    >
      <path
        d="M18.8 0H5.2A5.2 5.2 0 000 5.2v13.6A5.2 5.2 0 005.2 24h13.6a5.2 5.2 0 005.2-5.2V5.2A5.2 5.2 0 0018.8 0z"
        fill="#9046FF"
      />
      <path
        d="M7.97 16.376c-1.644 3.642 1.86 4.556 4.443 2.424.76 2.39 3.608.607 4.631-1.247 2.251-4.084 1.342-8.249 1.108-9.108-1.6-5.859-9.6-5.869-10.976.03-.323 1.033-.328 2.206-.507 3.423-.09.617-.16 1.009-.393 1.655-.139.373-.323.7-.62 1.257-.458.865-.264 2.53 2.101 1.665l.224-.1h-.01l-.001.001z"
        fill="#fff"
      />
      <path
        d="M12.722 10.985c-.656 0-.755-.785-.755-1.252 0-.423.074-.756.218-.97a.61.61 0 01.537-.283c.229 0 .428.095.567.289.159.218.243.55.243.964 0 .785-.303 1.252-.805 1.252h-.005zm2.703 0c-.656 0-.755-.785-.755-1.252 0-.423.074-.756.219-.97a.61.61 0 01.536-.283c.229 0 .428.095.567.289.159.218.243.55.243.964 0 .785-.303 1.252-.805 1.252h-.005z"
        fill="#000"
      />
    </svg>
  );
}

export const KiroIcon: BrandIcon = Object.assign(KiroGlyph, {
  Avatar: KiroAvatar,
  Color: KiroGlyph,
  colorPrimary: '#9046ff',
  title: 'Kiro',
});
