/**
 * The 生肉 → 熟肉 → 强化 hop: distil a wiki concept from one source, then
 * produce cards from the same folder.
 *
 * The wiki half is best-effort: a source can still yield cards when no model is
 * configured, so a distill failure degrades to a message instead of failing the
 * whole run. Both halves stay on the existing Host job/command path.
 */
import { useCallback, useState } from 'react';
import type { HostCommand, HostResponse, KnowledgeBaseSummary, WikiDistillResult } from '@piwin/contracts';
import { runDoccardsGenerate } from '../../documents/doccards-generate-client.js';

export type KnowledgeProduceNotice = {
  count: number;
  folderName: string;
  /** Title of the wiki concept distilled in the same run, when one landed. */
  concept?: string;
};

export type KnowledgeProduceState = {
  generating: boolean;
  notice: KnowledgeProduceNotice | null;
  /** Error from the distill or the card run; nothing is swallowed. */
  error: string | null;
  produce: (folderPath: string) => Promise<void>;
};

export function useKnowledgeProduce(args: {
  request: (command: HostCommand) => Promise<HostResponse>;
  bases: readonly KnowledgeBaseSummary[];
}): KnowledgeProduceState {
  const { bases, request } = args;
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<KnowledgeProduceNotice | null>(null);
  const [error, setError] = useState<string | null>(null);

  const produce = useCallback(
    async (folderPath: string) => {
      setGenerating(true);
      setNotice(null);
      setError(null);
      const base = bases.find((entry) => entry.folderPath === folderPath);
      const folderName = base?.name ?? folderPath.split('/').pop() ?? folderPath;
      let distilled: string | undefined;
      let distillError: string | undefined;

      if (base) {
        try {
          const response = await request({ type: 'knowledge/wiki/distill', baseId: base.id });
          if (response.success) {
            const title = (response.data as Partial<WikiDistillResult> | undefined)?.concept?.title;
            if (typeof title === 'string' && title.length > 0) distilled = title;
          } else {
            distillError = response.error;
          }
        } catch (caught) {
          distillError = caught instanceof Error ? caught.message : String(caught);
        }
      }

      try {
        const job = await runDoccardsGenerate(
          (command) => request(command as unknown as HostCommand),
          { folderPath },
        );
        const created = job.created ?? job.createdCardIds?.length ?? 0;
        setNotice({ count: created, folderName, ...(distilled ? { concept: distilled } : {}) });
        if (distillError) setError(distillError);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        if (distilled) setNotice({ count: 0, folderName, concept: distilled });
      } finally {
        setGenerating(false);
      }
    },
    [bases, request],
  );

  return { generating, notice, error, produce };
}
