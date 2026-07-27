/** CE-COMP: Pi FileOperations surface on product events (no reimplementation of Pi). */

export type CompactionFileOps = {
  readFiles: string[];
  modifiedFiles: string[];
  omittedCount?: number;
};
