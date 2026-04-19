import junoG from './roland-juno-g.json';
import genericGM from './generic-gm.json';

const REGISTRY = [junoG, genericGM];

export function listProfiles() {
  return REGISTRY.slice();
}

export function getProfile(id) {
  return REGISTRY.find(p => p.id === id) || null;
}

export function getDefaultProfile() {
  return getProfile('generic-gm');
}
