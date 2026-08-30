export type MobileOverlayHash =
  | ''
  | '#sidebar'
  | '#settings'
  | '#inbox'
  | '#share'
  | '#files'
  | '#skills'
  | '#model-picker'
  | '#live';

export function readMobileOverlayHash(hash = window.location.hash): MobileOverlayHash {
  const normalized = hash.toLowerCase();
  if (normalized === '#sidebar') return '#sidebar';
  if (normalized === '#settings') return '#settings';
  if (normalized === '#inbox') return '#inbox';
  if (normalized === '#share') return '#share';
  if (normalized === '#files') return '#files';
  if (normalized === '#skills') return '#skills';
  if (normalized === '#model-picker' || normalized === '#model') return '#model-picker';
  if (normalized === '#live') return '#live';
  return '';
}

export function setMobileOverlayHash(hash: MobileOverlayHash): void {
  if (hash === '') {
    if (window.location.hash.length === 0) {
      return;
    }
    const url = `${window.location.pathname}${window.location.search}`;
    history.replaceState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  if (window.location.hash.toLowerCase() !== hash) {
    window.location.hash = hash;
  }
}
