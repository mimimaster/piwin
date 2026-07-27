/**
 * Settings → Pets page (Wave 2 migration from SettingsPanel).
 * Thin wrapper: renders the existing PetPanel behind the section registry.
 */
import type { ReactElement } from 'react';
import { PetPanel } from '../../PetPanel';
import { useSettings } from '../settings-context';

export function PetsPage(): ReactElement {
  const { requestPet, onPetActiveChanged } = useSettings();

  return (
    <div className="settings-card">
      <PetPanel request={requestPet} onActiveChanged={onPetActiveChanged} variant="inline" />
    </div>
  );
}
