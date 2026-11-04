export type KnowledgeTopbarSearchProps = {
  searchPlaceholder: string;
  searchTestId: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
};

/**
 * One search box for the whole knowledge space. An empty query keeps the
 * current section; a non-empty query opens grouped materials/wiki/card hits.
 */
export function knowledgeTopbarSearch(args: {
  t: (en: string, zh: string) => string;
  query: string;
  onQueryChange: (value: string) => void;
}): { search: KnowledgeTopbarSearchProps } {
  return {
    search: {
      searchPlaceholder: args.t('Search materials, wiki and cards', '搜索资料、知识页和闪卡'),
      searchTestId: 'knowledge-topbar-search',
      searchValue: args.query,
      onSearchChange: args.onQueryChange,
    },
  };
}
