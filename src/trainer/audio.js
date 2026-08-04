// Instrument facade.
//
// Two backends implement the same shape: a synthesised piano that is always
// available and costs nothing to start, and a sampled Salamander grand that
// sounds far better but needs a ~6.6 MB download first.
//
// Every call routes to the sampler when it's loaded and has a sample for the
// note, and falls back to the synth otherwise — so switching instruments mid
// phrase, or playing during the download, never produces silence.
import * as synth from './synth.js';
import * as sampler from './sampler.js';

export { getAudioContext, getMasterGain, resume, setMasterVolume } from './audio-context.js';
export { onSamplerStatus, status as samplerStatus } from './sampler.js';

export const INSTRUMENTS = {
  synth: { id: 'synth', label: 'Synth', hint: 'Instant, tiny, always available' },
  sampled: { id: 'sampled', label: 'Sampled grand', hint: 'Salamander Grand Piano — 6.6 MB download' },
};

let preferred = 'synth';
// Notes currently sounding on the sampler, so a note started there is
// released there even if the instrument is switched mid-note.
const sampledNotes = new Set();

export function getInstrument() { return preferred; }

// Selecting the sampled piano kicks off the download; playback keeps working
// on the synth until it lands.
export async function setInstrument(id) {
  preferred = INSTRUMENTS[id] ? id : 'synth';
  if (preferred === 'sampled') return sampler.load();
  return true;
}

export function loadSampler() { return sampler.load(); }

function useSampler() {
  return preferred === 'sampled' && sampler.isReady();
}

export function noteOn(midi, velocity = 80) {
  if (useSampler()) {
    const voice = sampler.noteOn(midi, velocity);
    if (voice) { sampledNotes.add(midi); return voice; }
    // No sample for this note yet — fall through rather than go silent.
  }
  sampledNotes.delete(midi);
  return synth.noteOn(midi, velocity);
}

export function noteOff(midi) {
  if (sampledNotes.has(midi)) {
    sampledNotes.delete(midi);
    sampler.noteOff(midi);
    return;
  }
  synth.noteOff(midi);
}

export function setSustain(on) {
  // Both backends track the pedal; whichever holds notes will honour it.
  synth.setSustain(on);
  sampler.setSustain(on);
}

export function allNotesOff() {
  sampledNotes.clear();
  synth.allNotesOff();
  sampler.allNotesOff();
}

export function playNote(midi, duration, velocity = 80) {
  if (useSampler()) {
    const voice = sampler.playNote(midi, duration, velocity);
    if (voice) return;
  }
  synth.playNote(midi, duration, velocity);
}
