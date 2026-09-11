import type { ReactElement } from 'react';
import { Notice } from '@piwin/ui-kit';
import { extensionCompatCopy } from './extension-compat-copy.js';

export function ExtensionCompatNotice(props: { isChinese: boolean }): ReactElement {
  const copy = extensionCompatCopy(props.isChinese);
  return (
    <div className="ext-compat-notice">
      <Notice
        tone="info"
        title={copy.noticeTitle}
        testId="extensions-compat-notice"
        details={
          <details className="ext-compat-details">
            <summary>{copy.detailsSummary}</summary>
            <p className="ext-compat-heading">{copy.supportedHeading}</p>
            <ul className="ext-compat-list">
              {copy.supported.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="ext-compat-heading">{copy.unsupportedHeading}</p>
            <ul className="ext-compat-list">
              {copy.unsupported.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        }
      >
        {copy.body.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <p>{copy.privilege}</p>
      </Notice>
    </div>
  );
}
