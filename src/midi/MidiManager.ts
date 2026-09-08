/**
 * Web MIDI live control surface.
 *
 * Maps a standard MIDI controller onto the engine with zero configuration:
 *   • CC 20–27  → eight macro knobs (bloom, glitch chroma, speed, intensity,
 *                 trails, particle size, core size, input sensitivity)
 *   • Pads      → palette cycling, zen / safe modes, preset slot recall
 *
 * A fixed default map keeps setup friction zero on stage (plug & play). All
 * scaling runs through the same declarative ranges that sanitise persisted
 * settings, so a controller can never push a parameter out of spec.
 */

import { SETTING_RANGES, type VisualSettings } from "../audio/state";

export type MidiAction = "paletteNext" | "palettePrev" | "zenToggle" | "safeToggle" | { presetSlot: number };

/** [controller number, settings field] — CC 20..27, hardware macro row. */
export const DEFAULT_CC_MAP: readonly (readonly [number, NumericSettingKey])[] = [
  [20, "bloom"],
  [21, "crystallineGlitch"],
  [22, "speed"],
  [23, "intensity"],
  [24, "trails"],
  [25, "particleSize"],
  [26, "coreSize"],
  [27, "sensitivity"],
] as const;

export type NumericSettingKey = {
  [K in keyof VisualSettings]: VisualSettings[K] extends number ? K : never;
}[keyof VisualSettings];

/** [note number, action] — bottom pad row of most pad controllers (36–47). */
export const DEFAULT_PAD_MAP: readonly (readonly [number, MidiAction])[] = [
  [36, "paletteNext"],
  [37, "palettePrev"],
  [38, "zenToggle"],
  [39, "safeToggle"],
  [40, { presetSlot: 0 }],
  [41, { presetSlot: 1 }],
  [42, { presetSlot: 2 }],
  [43, { presetSlot: 3 }],
  [44, { presetSlot: 4 }],
  [45, { presetSlot: 5 }],
  [46, { presetSlot: 6 }],
  [47, { presetSlot: 7 }],
] as const;

/** Scale a raw 0–127 MIDI value into a setting's sanitised range. */
export function scaleCc(key: NumericSettingKey, value: number): number {
  const range = SETTING_RANGES[key];
  const v = Math.max(0, Math.min(127, value)) / 127;
  if (!range) return v;
  const [min, max] = range;
  return min + (max - min) * v;
}

export interface MidiHandlers {
  /** A CC knob moved — receives the scaled, ready-to-`patch` value. */
  onParam: (key: NumericSettingKey, value: number) => void;
  /** A mapped pad was hit. */
  onAction: (action: MidiAction) => void;
  /** A controller plugged in / dropped out (`null` = no device). */
  onStatus: (deviceName: string | null) => void;
}

export class MidiManager {
  private access: MIDIAccess | null = null;
  private handlers: MidiHandlers | null = null;
  private deviceName: string | null = null;

  static get supported(): boolean {
    return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
  }

  /** Request access and attach to every current + future input. */
  async start(handlers: MidiHandlers): Promise<boolean> {
    if (!MidiManager.supported) return false;
    this.handlers = handlers;
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      return false; // user or policy refused — silently optional feature
    }
    this.attachAll();
    this.access.onstatechange = () => this.attachAll();
    return true;
  }

  stop(): void {
    if (this.access) this.access.onstatechange = null;
    for (const input of this.access?.inputs.values() ?? []) input.onmidimessage = null;
    this.access = null;
    this.deviceName = null;
    this.handlers?.onStatus(null);
    this.handlers = null;
  }

  private attachAll(): void {
    if (!this.access || !this.handlers) return;
    let firstName: string | null = null;
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (event: MIDIMessageEvent) => this.handleMessage(event);
      if (!firstName && input.name) firstName = input.name;
    }
    const name = firstName;
    if (name !== this.deviceName) {
      this.deviceName = name;
      this.handlers.onStatus(name);
    }
  }

  private handleMessage(event: MIDIMessageEvent): void {
    const data = event.data;
    if (!data || data.length < 3) return;
    const command = data[0] & 0xf0;

    if (command === 0xb0) {
      // control change — respond only to the mapped macro row
      const cc = data[1];
      const value = data[2];
      for (const [number, key] of DEFAULT_CC_MAP) {
        if (number === cc) this.handlers?.onParam(key, scaleCc(key, value));
      }
      return;
    }

    if (command === 0x90 && data[2] > 0) {
      const note = data[1];
      for (const [number, action] of DEFAULT_PAD_MAP) {
        if (number === note) this.handlers?.onAction(action);
      }
    }
  }
}
