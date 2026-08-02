import { type ReactElement, type SVGProps } from 'react';

export type FileTypeKind =
  | 'react'
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'json'
  | 'css'
  | 'markdown'
  | 'html'
  | 'rust'
  | 'go'
  | 'shell'
  | 'image'
  | 'folder'
  | 'generic';

export type FileTypeInfo = {
  ext: string;
  label: string;
  kind: FileTypeKind;
  color: string;
};

// 1. React Icon (⚛)
export function IconReact(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg
      viewBox="-11.5 -10.23174 23 20.46348"
      width="1.1em"
      height="1.1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
      {...props}
    >
      <circle cx="0" cy="0" r="2.05" fill="currentColor" />
      <g stroke="currentColor">
        <ellipse rx="11" ry="4.2" />
        <ellipse rx="11" ry="4.2" transform="rotate(60)" />
        <ellipse rx="11" ry="4.2" transform="rotate(120)" />
      </g>
    </svg>
  );
}

// 2. TypeScript Vector Icon
export function IconTypeScript(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="currentColor" aria-hidden {...props}>
      <rect width="24" height="24" rx="4" fill="#3178c6" />
      <path
        fill="#ffffff"
        d="M11.9 16.5c.4.7 1.1 1.2 2.2 1.2 1.1 0 1.8-.5 1.8-1.3 0-.8-.6-1.1-1.8-1.6l-.7-.3c-1.8-.7-2.9-1.6-2.9-3.5 0-2.4 2-3.8 4.9-3.8 2.2 0 3.7.8 4.5 2.3l-1.9 1.2c-.5-.9-1.3-1.4-2.5-1.4-1.1 0-1.7.5-1.7 1.1 0 .7.4 1.1 1.7 1.6l.7.3c2.2.9 3.1 1.8 3.1 3.6 0 2.6-2 3.9-5.2 3.9-2.7 0-4.4-1.1-5.3-2.7l2.1-1.2zm-6.2-7.3h6v2.1h-2v8.5h-2.2v-8.5h-1.8v-2.1z"
      />
    </svg>
  );
}

// 3. JavaScript Vector Icon
export function IconJavaScript(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="currentColor" aria-hidden {...props}>
      <rect width="24" height="24" rx="4" fill="#f7df1e" />
      <path
        fill="#000000"
        d="M12.5 17.5c.4.7 1 1.2 2 1.2.9 0 1.5-.4 1.5-1 0-.7-.5-1-1.6-1.5l-.5-.2c-1.6-.7-2.6-1.4-2.6-3.1 0-2.1 1.7-3.4 4.3-3.4 1.9 0 3.2.7 4 2l-1.6 1c-.4-.7-1.1-1.1-2.2-1.1-.9 0-1.5.4-1.5 1 0 .6.4.9 1.5 1.4l.5.2c1.9.8 2.8 1.6 2.8 3.2 0 2.3-1.8 3.5-4.6 3.5-2.4 0-3.9-1-4.7-2.5l1.5-1.1zm-6.3.2c.4.7.8 1.1 1.5 1.1.7 0 1.1-.3 1.1-1.2v-7.9h2.3v8c0 2.1-1.2 3.1-3.2 3.1-1.7 0-2.8-.8-3.4-2.1l1.7-1z"
      />
    </svg>
  );
}

// 4. Python Vector Icon (Official 2-serpent Logo)
export function IconPython(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="none" aria-hidden {...props}>
      <path
        fill="#3776ab"
        d="M11.9 2c-4.8 0-4.5 2.1-4.5 2.1l.1 2.2h4.5v.6H5.8S2 6.4 2 11.3c0 4.8 3.3 4.7 3.3 4.7h2v-2.8s-.1-3.3 3.3-3.3h5.6s3.2 0 3.2-3.1V4.7S19.9 2 11.9 2zm-2.4 1.4c.5 0 .9.4.9.9s-.4.9-.9.9-.9-.4-.9-.9.4-.9.9-.9z"
      />
      <path
        fill="#ffd343"
        d="M12.1 22c4.8 0 4.5-2.1 4.5-2.1l-.1-2.2H12v-.6h6.2s3.8.5 3.8-4.4c0-4.8-3.3-4.7-3.3-4.7h-2v2.8s.1 3.3-3.3 3.3H7.8s-3.2 0-3.2 3.1v2.2s-.5 2.7 7.5 2.7zm2.4-1.4c-.5 0-.9-.4-.9-.9s.4-.9.9-.9.9.4.9.9-.4.9-.9.9z"
      />
    </svg>
  );
}

// 5. JSON Vector Icon ({})
export function IconJson(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.1em"
      height="1.1em"
      fill="none"
      stroke="#fbbf24"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M8 4c-1.5 0-2.5.8-2.5 2.5v3c0 1.2-.8 2-2 2 1.2 0 2 .8 2 2v3c0 1.7 1 2.5 2.5 2.5M16 4c1.5 0 2.5.8 2.5 2.5v3c0 1.2.8 2 2 2-1.2 0-2 .8-2 2v3c0 1.7-1 2.5-2.5 2.5" />
    </svg>
  );
}

// 6. Markdown Vector Icon (M↓)
export function IconMarkdown(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.1em"
      height="1.1em"
      fill="none"
      stroke="#34d399"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="M6 15V9l2.5 3L11 9v6M15 9v6M12.5 12.5L15 15l2.5-2.5" />
    </svg>
  );
}

// 7. CSS Vector Icon (#)
export function IconCss(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.1em"
      height="1.1em"
      fill="none"
      stroke="#f472b6"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M4 9h16M4 15h16M10 3l-2 18M16 3l-2 18" />
    </svg>
  );
}

// 8. HTML Vector Icon (</>)
export function IconHtml(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.1em"
      height="1.1em"
      fill="none"
      stroke="#fb923c"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <polyline points="7 8 3 12 7 16" />
      <polyline points="17 8 21 12 17 16" />
      <line x1="14" y1="4" x2="10" y2="20" />
    </svg>
  );
}

// 9. Rust Vector Icon
export function IconRust(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.1em"
      height="1.1em"
      fill="none"
      stroke="#f97316"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <circle cx="12" cy="12" r="8" />
      <path d="M9 16V8h3.5a2.5 2.5 0 0 1 0 5H9m3.5 0L15 16" />
    </svg>
  );
}

// 10. Go Vector Icon
export function IconGo(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.1em"
      height="1.1em"
      fill="none"
      stroke="#22d3ee"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M4 12a4 4 0 1 0 8 0v-1h-4" />
      <circle cx="17" cy="12" r="4" />
    </svg>
  );
}

// 11. Shell / Terminal Vector Icon (>_)
export function IconShell(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.1em"
      height="1.1em"
      fill="none"
      stroke="#4ade80"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <polyline points="4 17 10 12 4 7" />
      <line x1="12" y1="17" x2="20" y2="17" />
    </svg>
  );
}

// 12. Image File Vector Icon
export function IconImageFile(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.1em"
      height="1.1em"
      fill="none"
      stroke="#e879f9"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

// 13. Folder Vector Icon
export function IconFolder(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.1em"
      height="1.1em"
      fill="none"
      stroke="#60a5fa"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-11Z" />
    </svg>
  );
}

// 14. Document / Generic Text Vector Icon
export function IconFileText(props: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.1em"
      height="1.1em"
      fill="none"
      stroke="#94a3b8"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

export function resolveFileTypeInfo(filePathOrExt: string): FileTypeInfo {
  const clean = filePathOrExt.split(/[\\/]/).pop() || filePathOrExt;
  if (filePathOrExt.endsWith('/') || !clean.includes('.')) {
    return { ext: 'DIR', label: 'Folder', kind: 'folder', color: '#60a5fa' };
  }

  const match = /\.([a-zA-Z0-9]+)$/.exec(clean);
  const ext = (match && match[1] ? match[1] : clean).toLowerCase();

  switch (ext) {
    case 'tsx':
    case 'jsx':
      return { ext: 'TSX', label: 'React', kind: 'react', color: '#38bdf8' };
    case 'ts':
    case 'cts':
    case 'mts':
      return { ext: 'TS', label: 'TypeScript', kind: 'typescript', color: '#3178c6' };
    case 'js':
    case 'mjs':
    case 'cjs':
      return { ext: 'JS', label: 'JavaScript', kind: 'javascript', color: '#facc15' };
    case 'py':
    case 'ipynb':
      return { ext: 'PY', label: 'Python', kind: 'python', color: '#3776ab' };
    case 'json':
    case 'jsonc':
    case 'yaml':
    case 'yml':
    case 'toml':
      return { ext: ext.toUpperCase(), label: 'JSON', kind: 'json', color: '#fbbf24' };
    case 'css':
    case 'scss':
    case 'less':
      return { ext: ext.toUpperCase(), label: 'CSS', kind: 'css', color: '#f472b6' };
    case 'md':
    case 'mdx':
    case 'markdown':
      return { ext: 'MD', label: 'Markdown', kind: 'markdown', color: '#34d399' };
    case 'html':
    case 'htm':
    case 'svg':
      return { ext: ext.toUpperCase(), label: 'HTML', kind: 'html', color: '#fb923c' };
    case 'rs':
      return { ext: 'RS', label: 'Rust', kind: 'rust', color: '#f97316' };
    case 'go':
      return { ext: 'GO', label: 'Go', kind: 'go', color: '#22d3ee' };
    case 'sh':
    case 'bash':
    case 'zsh':
      return { ext: 'SH', label: 'Shell', kind: 'shell', color: '#4ade80' };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'gif':
      return { ext: 'IMG', label: 'Image', kind: 'image', color: '#e879f9' };
    default:
      return { ext: ext.toUpperCase(), label: 'File', kind: 'generic', color: '#94a3b8' };
  }
}

export function FileTypeIcon({
  filePathOrExt,
  className = '',
}: {
  filePathOrExt: string;
  className?: string | undefined;
}): ReactElement {
  const info = resolveFileTypeInfo(filePathOrExt);

  switch (info.kind) {
    case 'react':
      return <IconReact className={`file-icon file-icon-react ${className}`} style={{ color: info.color }} />;
    case 'typescript':
      return <IconTypeScript className={`file-icon file-icon-ts ${className}`} />;
    case 'javascript':
      return <IconJavaScript className={`file-icon file-icon-js ${className}`} />;
    case 'python':
      return <IconPython className={`file-icon file-icon-python ${className}`} />;
    case 'json':
      return <IconJson className={`file-icon file-icon-json ${className}`} />;
    case 'markdown':
      return <IconMarkdown className={`file-icon file-icon-md ${className}`} />;
    case 'css':
      return <IconCss className={`file-icon file-icon-css ${className}`} />;
    case 'html':
      return <IconHtml className={`file-icon file-icon-html ${className}`} />;
    case 'rust':
      return <IconRust className={`file-icon file-icon-rust ${className}`} />;
    case 'go':
      return <IconGo className={`file-icon file-icon-go ${className}`} />;
    case 'shell':
      return <IconShell className={`file-icon file-icon-shell ${className}`} />;
    case 'image':
      return <IconImageFile className={`file-icon file-icon-img ${className}`} />;
    case 'folder':
      return <IconFolder className={`file-icon file-icon-folder ${className}`} />;
    default:
      return <IconFileText className={`file-icon file-icon-generic ${className}`} />;
  }
}
